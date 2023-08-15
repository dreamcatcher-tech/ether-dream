// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';
import '@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol';
import '@openzeppelin/contracts/utils/Counters.sol';

import './IQA.sol';
import './IDreamcatcher.sol';
import './LibraryUtils.sol';
import './LibraryQA.sol';
import './LibraryChanges.sol';

/**
 * Convert assets into task completion, with quality oversight
 */

contract DreamEther is
  IERC1155,
  IERC1155Receiver,
  IERC1155MetadataURI,
  IDreamcatcher
{
  using Counters for Counters.Counter;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using EnumerableSet for EnumerableSet.AddressSet;
  using LibraryChanges for Change;
  using LibraryQA for State;

  State state;

  function proposePacket(bytes32 contents, address qa) external {
    LibraryChanges.proposePacket(state, contents, qa);
  }

  function fund(uint changeId, Payment[] calldata payments) external payable {
    LibraryChanges.fund(state, changeId, payments);
  }

  function defundStart(uint id) external {
    Change storage change = state.changes[id];
    change.defundStart();
  }

  function defundStop(uint id) external {
    Change storage change = state.changes[id];
    change.defundStop();
  }

  function defund(uint id) public {
    Change storage change = state.changes[id];
    change.defund(state.exits[msg.sender], state.taskNfts);
  }

  function qaResolve(uint id, Share[] calldata shares) external {
    require(isQa(id), 'Must be transition QA');
    Change storage change = state.changes[id];
    LibraryQA.qaResolve(change, shares);
    emit QAResolved(id);
  }

  function qaReject(uint id, bytes32 reason) public {
    require(isQa(id), 'Must be transition QA');
    Change storage change = state.changes[id];
    LibraryQA.qaReject(change, reason);
    emit QARejected(id);
  }

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) external {
    state.disputeShares(id, reason, s);
  }

  function disputeResolve(uint id, bytes32 reason) external {
    state.disputeResolve(id, reason);
  }

  function disputeRejection(uint id, bytes32 reason) external {
    state.disputeRejection(id, reason);
  }

  function qaDisputeDismissed(uint id, bytes32 reason) external {
    require(isQa(id));
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    Change storage dispute = state.changes[id];
    require(dispute.createdAt != 0, 'Change does not exist');
    require(dispute.changeType == ChangeType.DISPUTE, 'Not a dispute');

    dispute.rejectionReason = reason;
    emit DisputeDismissed(id);
  }

  function qaDisputeUpheld(uint id) external {
    require(isQa(id));
    Change storage dispute = state.changes[id];
    require(dispute.createdAt != 0, 'Change does not exist');
    require(dispute.changeType == ChangeType.DISPUTE, 'Not a dispute');

    // TODO if shares, change the share allocations
    // TODO if resolve, then undo the resolve, change back to open
    // TODO if reject, then undo the reject, change back to open
    // TODO handle concurrent disputes

    // mint dispute nfts
    emit DisputeUpheld(id);
  }

  function enact(uint id) external {
    LibraryChanges.enact(id, state);
  }

  function solve(uint packetId, bytes32 contents) external {
    Change storage packet = state.changes[packetId];
    state.changeCounter.increment();
    uint solutionId = state.changeCounter.current();
    Change storage solution = state.changes[solutionId];
    packet.solve(solution, contents);
    solution.uplink = packetId;
    packet.downlinks.push(solutionId);
    emit SolutionProposed(solutionId);
  }

  function merge(uint fromId, uint toId, bytes32 reasons) external {
    // merge the change of fromId to the change of toId for the given reasons
    require(LibraryUtils.isIpfs(reasons), 'Invalid reason hash');
    Change storage from = state.changes[fromId];
    Change storage to = state.changes[toId];
    require(from.createdAt != 0, 'From change does not exist');
    require(to.createdAt != 0, 'To change does not exist');
    require(from.changeType == to.changeType, 'Change types must match');
    require(from.changeType != ChangeType.MERGE, 'Cannot merge merges');
  }

  function edit(uint id, bytes32 contents, bytes32 reasons) external {
    // edit the given id with the new contents for the given reasons
  }

  function claim(uint id) public {
    Change storage c = state.changes[id];
    c.claim(id, state.exits[msg.sender], state.taskNfts);
    emit Claimed(id, msg.sender);
  }

  function claimQa(uint id) external {
    require(isQa(id), 'Must be transition QA');
    Change storage change = state.changes[id];
    require(change.changeType != ChangeType.PACKET);
    require(change.createdAt != 0, 'Change does not exist');
    require(change.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - change.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');

    uint[] memory nftIds = change.funds.keys();
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];

    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      uint totalFunds = change.funds.get(nftId);
      TaskNft memory nft = state.taskNfts[nftId];
      require(nft.changeId == id, 'NFT not for this transition');

      uint debt = 0;
      if (debts.contains(nft.assetId)) {
        debt = debts.get(nft.assetId);
      }
      debts.set(nft.assetId, debt + totalFunds);
      change.funds.remove(nftId);
    }
  }

  function exitBurn(uint assetId) external {
    // used when the exit is problematic
    require(state.exits[msg.sender].contains(assetId), 'No exit for asset');
    state.exits[msg.sender].remove(assetId);
  }

  function exit() external {
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];
    uint[] memory assetIds = debts.keys();
    delete state.exits[msg.sender];

    for (uint i = 0; i < assetIds.length; i++) {
      uint assetId = assetIds[i];
      exitSingle(assetId);
    }
  }

  function exitList() public view returns (Payment[] memory) {
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];
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
      payable(msg.sender).transfer(payment.amount);
    } else if (payment.tokenId == 0) {
      // TODO handle erc1155 with a tokenId of zero
      IERC20 token = IERC20(payment.token);
      require(token.transferFrom(address(this), msg.sender, payment.amount));
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

  function isQa(uint id) internal view returns (bool) {
    Change storage change = state.changes[id];
    if (change.changeType == ChangeType.HEADER) {
      return state.qaMap[id] == msg.sender;
    }
    if (change.changeType == ChangeType.SOLUTION) {
      return isQa(change.uplink);
    }
    if (change.changeType == ChangeType.PACKET) {
      return isQa(change.uplink);
    }
    if (change.changeType == ChangeType.DISPUTE) {
      return isQa(change.uplink);
    }
    revert('Invalid change');
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
      require(change.isTransferrable(from), 'Not transferrable');
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
}
