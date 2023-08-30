// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/utils/Counters.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import './IQA.sol';
import './IDreamcatcher.sol';
import './LibraryUtils.sol';
import './LibraryQA.sol';
import './LibraryState.sol';

/**
 * Convert assets into task completion, with quality oversight
 */

contract DreamEther is IDreamcatcher {
  using Counters for Counters.Counter;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using EnumerableSet for EnumerableSet.AddressSet;
  using LibraryQA for State;
  using LibraryState for State;

  State state;

  constructor() {
    require(CONTENT_ASSET_ID == state.assetCounter.current());
    uint[1] memory assetIds = [QA_MEDALLION_ID];
    for (uint i = 0; i < assetIds.length; i++) {
      state.assetCounter.increment();
      require(state.assetCounter.current() == assetIds[i], 'Asset ID mismatch');
    }
    require(state.assetCounter.current() == 1, 'AssetIDs must be preallocated');
  }

  function proposePacket(bytes32 contents, address qa) external {
    state.proposePacket(contents, qa);
  }

  function fund(uint changeId, Payment[] calldata payments) external payable {
    state.fund(changeId, payments);
  }

  function defundStart(uint id) external {
    state.defundStart(id);
  }

  function defundStop(uint id) external {
    state.defundStop(id);
  }

  function defund(uint id) external {
    state.defund(id);
  }

  function qaResolve(uint id, Share[] calldata shares) external {
    state.qaResolve(id, shares);
  }

  function qaReject(uint id, bytes32 reason) public {
    state.qaReject(id, reason);
  }

  function disputeResolve(uint id, bytes32 reason) external {
    uint disputeId = state.disputeResolve(id, reason);
    state.upsertNftId(disputeId, CONTENT_ASSET_ID);
  }

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) external {
    uint disputeId = state.disputeShares(id, reason, s);
    state.upsertNftId(disputeId, CONTENT_ASSET_ID);
  }

  function disputeRejection(uint id, bytes32 reason) external {
    uint disputeId = state.disputeRejection(id, reason);
    state.upsertNftId(disputeId, CONTENT_ASSET_ID);
  }

  function qaDisputesDismissed(uint changeId, bytes32 reason) external {
    state.qaDisputesDismissed(changeId, reason);
  }

  function qaDisputeUpheld(uint id, Share[] calldata s, bytes32 r) external {
    state.qaDisputeUpheld(id, s, r);
  }

  function enact(uint id) external {
    state.enact(id);
  }

  function solve(uint packetId, bytes32 contents) external {
    state.solve(packetId, contents);
  }

  function merge(uint fromId, uint toId, bytes32 reasons) external {
    // TODO ensure this is just an edit on a packet - only packets can merge
    // merge the change of fromId to the change of toId for the given reasons
    require(LibraryUtils.isIpfs(reasons), 'Invalid reason hash');
    Change storage from = state.changes[fromId];
    Change storage to = state.changes[toId];
    require(from.createdAt != 0, 'From change does not exist');
    require(to.createdAt != 0, 'To change does not exist');
    require(from.changeType == to.changeType, 'Change types must match');
    require(from.changeType != ChangeType.MERGE, 'Cannot merge merges');
    address fromQa = state.getQa(fromId);
    address toQa = state.getQa(toId);
    require(fromQa == toQa, 'QA must match');
  }

  function edit(uint id, bytes32 contents, bytes32 reasons) external {
    // edit the given id with the new contents for the given reasons
  }

  function claim(uint id) public {
    state.claim(id);
  }

  function claimQa(uint id) external {
    state.claimQa(id);
  }

  function exitBurn(uint assetId) external {
    // used when the exit is problematic
    require(state.exits[msg.sender].contains(assetId), 'No exit for asset');
    state.exits[msg.sender].remove(assetId);
    emit ExitBurn(msg.sender, assetId);
  }

  function exit() external {
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];
    require(debts.length() > 0, 'No exits available');
    uint[] memory assetIds = debts.keys();

    for (uint i = 0; i < assetIds.length; i++) {
      uint assetId = assetIds[i];
      exitSingleInternal(assetId);
    }
    delete state.exits[msg.sender];
    emit Exit(msg.sender);
  }

  function exitList(address holder) public view returns (Payment[] memory) {
    require(holder != address(0), 'Invalid holder');
    EnumerableMap.UintToUintMap storage debts = state.exits[holder];
    uint[] memory assetIds = debts.keys();
    Payment[] memory payments = new Payment[](assetIds.length);
    for (uint i = 0; i < assetIds.length; i++) {
      uint assetId = assetIds[i];
      Asset memory asset = state.assets[assetId];
      payments[i] = Payment(
        asset.tokenContract,
        asset.tokenId,
        debts.get(assetId)
      );
    }
    return payments;
  }

  function exitSingle(uint assetId) public {
    exitSingleInternal(assetId);
    emit Exit(msg.sender);
  }

  function exitSingleInternal(uint assetId) internal {
    Asset memory asset = state.assets[assetId];
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];
    require(debts.contains(assetId), 'No exit for asset');

    Payment memory payment = Payment(
      asset.tokenContract,
      asset.tokenId,
      debts.get(assetId)
    );
    debts.remove(assetId);

    if (LibraryUtils.isEther(asset)) {
      uint amount = payment.amount;
      (bool sent, bytes memory data) = msg.sender.call{value: amount}('');
      require(sent && (data.length == 0), 'Failed to send Ether');
    } else if (payment.tokenId == 0) {
      // TODO handle erc1155 with a tokenId of zero
      IERC20 token = IERC20(payment.token);

      require(token.transfer(msg.sender, payment.amount));
    } else {
      IERC1155 token = IERC1155(payment.token);
      token.safeTransferFrom(
        address(this),
        msg.sender,
        payment.tokenId,
        payment.amount,
        ''
      );
    }
  }

  function balanceOf(address account, uint256 id) public view returns (uint) {
    TaskNft memory nft = state.taskNfts[id];
    require(nft.changeId != 0, 'NFT does not exist');
    Change storage change = state.changes[nft.changeId];
    if (nft.assetId == CONTENT_ASSET_ID) {
      if (change.contentShares.holders.contains(account)) {
        // TODO handle id being part of an open share dispute
        return change.contentShares.balances[account];
      }
      return 0;
    }
    if (change.fundingShares.holders.contains(account)) {
      if (change.fundingShares.balances[account].contains(id)) {
        return change.fundingShares.balances[account].get(id);
      }
    }
    return 0;
  }

  function balanceOfBatch(
    address[] calldata accounts,
    uint256[] calldata ids
  ) external view returns (uint256[] memory) {
    uint[] memory balances = new uint[](ids.length);
    for (uint i = 0; i < ids.length; i++) {
      balances[i] = balanceOf(accounts[i], ids[i]);
    }
    return balances;
  }

  function setApprovalForAll(address operator, bool approved) external {
    require(operator != address(0));
    require(msg.sender != operator, 'Setting approval status for self');
    Approval positive = operator == OPEN_SEA
      ? Approval.NONE
      : Approval.APPROVED;
    Approval negative = operator == OPEN_SEA
      ? Approval.REJECTED
      : Approval.NONE;

    Approval approval = approved ? positive : negative;
    state.approvals[msg.sender][operator] = approval;
    emit ApprovalForAll(msg.sender, operator, approved);
  }

  function isApprovedForAll(
    address account,
    address operator
  ) public view returns (bool) {
    if (account == operator) {
      return true;
    }
    Approval approval = state.approvals[account][operator];
    if (operator == OPEN_SEA) {
      return approval == Approval.NONE;
    } else {
      return approval == Approval.APPROVED;
    }
  }

  function safeTransferFrom(
    address from,
    address to,
    uint256 nftId,
    uint256 amount,
    bytes calldata data
  ) public {
    require(data.length == 0, 'Data not supported');
    require(isApprovedForAll(from, msg.sender), 'Not approved');
    require(balanceOf(from, nftId) >= amount, 'Insufficient funds');

    TaskNft memory nft = state.taskNfts[nftId];
    Change storage change = state.changes[nft.changeId];

    if (nft.assetId == CONTENT_ASSET_ID) {
      require(LibraryState.isTransferrable(change, from), 'Untransferrable');
      // TODO handle id being part of an open share dispute
      uint fromBalance = change.contentShares.balances[from];
      uint fromRemaining = fromBalance - amount;
      if (fromRemaining == 0) {
        change.contentShares.holders.remove(from);
        delete change.contentShares.balances[from];
        delete change.contentShares.claims[from];
      } else {
        change.contentShares.balances[from] = fromRemaining;
        change.contentShares.claims[from] = fromRemaining;
      }
      if (!change.contentShares.holders.contains(to)) {
        change.contentShares.holders.add(to);
      }
      change.contentShares.balances[to] += amount;
      change.contentShares.claims[to] += amount;
    } else {
      require(change.fundingShares.holders.contains(from));
      require(change.fundingShares.defundWindows[to] == 0, 'to is defunding');

      uint fromBalance = change.fundingShares.balances[from].get(nftId);
      uint fromRemaining = fromBalance - amount;
      if (fromRemaining == 0) {
        change.fundingShares.balances[from].remove(nftId);
        if (change.fundingShares.balances[from].length() == 0) {
          change.fundingShares.holders.remove(from);
          delete change.fundingShares.balances[from];
          delete change.fundingShares.defundWindows[from];
        }
      } else {
        change.fundingShares.balances[from].set(nftId, fromRemaining);
      }

      // TODO check if to is a contract and call onERC1155Received
      if (!change.fundingShares.holders.contains(to)) {
        change.fundingShares.holders.add(to);
      }
      uint toBalance = 0;
      if (change.fundingShares.balances[to].contains(nftId)) {
        toBalance = change.fundingShares.balances[to].get(nftId);
      }
      change.fundingShares.balances[to].set(nftId, toBalance + amount);
    }
    emit TransferSingle(msg.sender, from, to, nftId, amount);
  }

  function safeBatchTransferFrom(
    address from,
    address to,
    uint[] calldata ids,
    uint[] calldata amounts,
    bytes calldata data
  ) external {
    for (uint i = 0; i < ids.length; i++) {
      safeTransferFrom(from, to, ids[i], amounts[i], data);
    }
  }

  function supportsInterface(bytes4 interfaceId) external view returns (bool) {}

  // ERC1155Supply extension
  function totalSupply(uint id) public view returns (uint) {
    TaskNft memory nft = state.taskNfts[id];
    require(nft.changeId != 0, 'NFT does not exist');
    if (nft.assetId == CONTENT_ASSET_ID) {
      return SHARES_TOTAL;
    }
    Change storage change = state.changes[nft.changeId];
    require(change.funds.contains(id), 'NFT not found');
    return change.funds.get(id);
  }

  // IERC1155Receiver
  function onERC1155Received(
    address operator,
    address from,
    uint256 id,
    uint256 value,
    bytes calldata data
  ) external returns (bytes4) {}

  function onERC1155BatchReceived(
    address operator,
    address from,
    uint256[] calldata ids,
    uint256[] calldata values,
    bytes calldata data
  ) external returns (bytes4) {}

  // IERC1155MetadataURI
  function uri(uint id) external view returns (string memory) {
    TaskNft memory nft = state.taskNfts[id];
    require(nft.changeId != 0, 'NFT does not exist');
    Change storage change = state.changes[nft.changeId];
    return LibraryUtils.uri(change, nft.assetId);
  }

  function isNftHeld(
    uint changeId,
    address holder
  ) external view returns (bool) {
    require(holder != address(0), 'Invalid holder');
    Change storage change = state.changes[changeId];
    if (change.fundingShares.holders.contains(holder)) {
      return true;
    }
    if (change.contentShares.holders.contains(holder)) {
      return true;
    }
    return false;
  }

  function fundingNftIdsFor(
    uint changeId
  ) external view returns (uint[] memory) {
    return fundingNftIdsFor(changeId, msg.sender);
  }

  function fundingNftIdsFor(
    uint changeId,
    address holder
  ) public view returns (uint[] memory) {
    require(holder != address(0), 'Invalid holder');
    Change storage change = state.changes[changeId];
    return change.fundingShares.balances[holder].keys();
  }

  function fundingNftIds(uint changeId) external view returns (uint[] memory) {
    Change storage change = state.changes[changeId];
    return change.funds.keys();
  }

  function contentNftId(uint changeId) external view returns (uint) {
    Change storage change = state.changes[changeId];
    require(change.createdAt != 0, 'Change does not exist');
    return state.taskNftsLut.lut[changeId][CONTENT_ASSET_ID];
  }

  function getAssetId(
    address tokenAddress,
    uint tokenId
  ) external view returns (uint) {
    uint assetId = state.assetsLut.lut[tokenAddress][tokenId];
    require(assetId != 0, 'Asset does not exist');
    return assetId;
  }

  function version() external pure returns (string memory) {
    return '0.0.1';
  }

  function issues() external pure returns (string memory) {
    return 'https://github.com/dreamcatcher-tech/ether-dream/issues';
  }
}
