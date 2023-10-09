// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;

import './Counters.sol';
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
  using EnumerableMap for EnumerableMap.AddressToUintMap;
  using EnumerableSet for EnumerableSet.AddressSet;
  using LibraryQA for State;
  using LibraryState for State;
  using LibraryFilter for AssetFilter;

  State state;

  constructor() {
    assert(CONTENT_ASSET_ID == state.assetCounter.current());
    uint[1] memory assetIds = [QA_MEDALLION_ASSET_ID];
    for (uint i = 0; i < assetIds.length; i++) {
      state.assetCounter.increment();
      assert(state.assetCounter.current() == assetIds[i]);
    }
    assert(state.assetCounter.current() == 1);
  }

  function proposePacket(bytes32 contents, address qa) external returns (uint) {
    return state.proposePacket(contents, qa);
  }

  function fund(uint changeId, Payment[] calldata payments) external payable {
    state.fund(changeId, payments);
  }

  function defundStart(uint id, uint windowMs) external {
    state.defundStart(id, windowMs);
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

  function disputeReject(uint id, bytes32 reason) external {
    uint disputeId = state.disputeReject(id, reason);
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

  function proposeSolution(uint packetId, bytes32 contents) external {
    state.proposeSolution(packetId, contents);
  }

  function proposeMerge(uint fromId, uint toId, bytes32 reason) external {
    state.proposeMerge(fromId, toId, reason);
  }

  function proposeEdit(uint id, bytes32 editContents, bytes32 reason) external {
    state.proposeEdit(id, editContents, reason);
  }

  /**
   * Iterates all the exits, stops when it runs out of gas.
   * Stores where it was up to, so when called again it does
   * not retry any failed exits.
   * Because exits.balances does a tailpop on delete
   * the same index is reused when there is a deletion.
   * @dev Exit the contract with all assets owed to an account
   * @param filterId The filter to use for exiting.  Anything not matched by
   * this filter will be burned
   */
  function exit(uint filterId) external {
    Exits storage exits = state.exits[msg.sender];
    require(!exits.inProgress, 'Exit already in progress');
    exits.inProgress = true;
    // TODO check reentrancy attacks
    // TODO check filterId 0 is allow all
    AssetFilter storage filter = state.filters[filterId];
    require(filter.isValid(), 'Invalid filter');
    assert(exits.atIndex < exits.balances.length());
    for (; exits.atIndex < exits.balances.length(); ) {
      (uint assetId, uint amount) = exits.balances.at(exits.atIndex);
      assert(amount > 0);
      Asset memory asset = state.assets[assetId];
      uint tokenId = asset.tokenId;
      bool success;
      if (!filter.isAllowed(assetId, state)) {
        success = true;
      } else if (LibraryUtils.isEther(asset)) {
        // TODO set gas limits for transfers
        (bool sent, bytes memory data) = msg.sender.call{value: amount}('');
        success = (sent && (data.length == 0));
      } else if (tokenId == 0) {
        // TODO handle erc1155 with a tokenId of zero
        IERC20 token = IERC20(asset.tokenContract);
        try token.transfer(msg.sender, amount) returns (bool ok) {
          success = ok;
        } catch {
          success = false;
        }
      } else {
        // call erc1155 onErc1155Received
        IERC1155 token = IERC1155(asset.tokenContract);
        address from = msg.sender;
        try token.safeTransferFrom(address(this), from, tokenId, amount, '') {
          success = true;
        } catch {
          success = false;
        }
      }

      if (success) {
        exits.balances.remove(exits.atIndex);
      } else {
        emit ExitFailed(assetId);
        exits.atIndex++;
      }
      if (gasleft() < GAS_PER_CLAIMABLE) {
        break;
      }
    }
    if (exits.atIndex == exits.balances.length()) {
      exits.atIndex = 0;
    }
    exits.inProgress = false;
  }

  function exitList(address holder) public view returns (Payment[] memory) {
    require(holder != address(0), 'Invalid holder');
    Exits storage exits = state.exits[holder];
    Payment[] memory payments = new Payment[](exits.balances.length());
    for (uint i = 0; i < payments.length; i++) {
      (uint assetId, uint amount) = exits.balances.at(i);
      Asset memory asset = state.assets[assetId];
      assert(amount > 0);
      payments[i] = Payment(asset.tokenContract, asset.tokenId, amount);
    }
    return payments;
  }

  function balanceOf(address holder, uint256 nftId) public view returns (uint) {
    Nft memory nft = state.nfts[nftId];
    require(nft.changeId != 0, 'NFT does not exist');
    Change storage change = state.changes[nft.changeId];
    if (nft.assetId == CONTENT_ASSET_ID) {
      if (change.contentShares.traders.contains(holder)) {
        // TODO handle id being part of an open share dispute
        return change.contentShares.traders.get(holder);
      } else if (change.contentShares.claimables.contains(holder)) {
        return change.contentShares.claimables.get(holder);
      }
      return 0;
    } else if (nft.assetId == QA_MEDALLION_ASSET_ID) {
      QaMedallion memory qaMedallion = change.contentShares.qaMedallion;
      assert(qaMedallion.nftId == nftId);
      if (qaMedallion.holder == holder) {
        return 1;
      }
      return 0;
    }
    if (change.fundingShares.holders.contains(holder)) {
      if (change.fundingShares.balances[holder].contains(nftId)) {
        return change.fundingShares.balances[holder].get(nftId);
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
    require(operator != address(0), 'Invalid operator');
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
    bytes calldata
  ) public override {
    require(isApprovedForAll(from, msg.sender), 'Not approved');
    transferFrom(from, to, nftId, amount);
    emit TransferSingle(msg.sender, from, to, nftId, amount);
  }

  function transferFrom(
    address from,
    address to,
    uint256 nftId,
    uint256 amount
  ) internal {
    require(amount > 0, 'Invalid amount');
    uint fromBalance = balanceOf(from, nftId);
    require(fromBalance >= amount, 'Insufficient funds');

    Nft memory nft = state.nfts[nftId];
    Change storage change = state.changes[nft.changeId];

    if (nft.assetId == CONTENT_ASSET_ID) {
      require(change.changeType != ChangeType.SOLUTION, 'No Solution shares');
      uint fromRemaining = fromBalance - amount;
      bool isSolver = change.contentShares.claimables.contains(from);
      if (fromRemaining == 0 && !isSolver) {
        change.contentShares.traders.remove(from);
      } else {
        change.contentShares.traders.set(from, fromRemaining);
      }
      uint toBalance = 0;
      if (change.contentShares.traders.contains(to)) {
        toBalance = change.contentShares.traders.get(to);
      }
      change.contentShares.traders.set(to, toBalance + amount);
    } else if (nft.assetId == QA_MEDALLION_ASSET_ID) {
      require(amount == 1, 'QA Medallion amount must be 1');
      assert(change.changeType == ChangeType.PACKET);
      QaMedallion memory qaMedallion = change.contentShares.qaMedallion;
      assert(qaMedallion.nftId == nftId);
      require(qaMedallion.holder == from, 'Not the QA Medallion holder');
      change.contentShares.qaMedallion.holder = to;
    } else {
      require(change.fundingShares.holders.contains(from));
      if (!change.isEnacted) {
        require(change.fundingShares.defundWindows[to] == 0, 'to is defunding');
      }
      uint fromRemaining = fromBalance - amount;
      if (fromRemaining == 0) {
        change.fundingShares.balances[from].remove(nftId);
        if (change.fundingShares.balances[from].length() == 0) {
          delete change.fundingShares.balances[from];
          delete change.fundingShares.defundWindows[from];
          change.fundingShares.holders.remove(from);
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
    bytes calldata
  ) external {
    require(isApprovedForAll(from, msg.sender), 'Not approved');
    for (uint i = 0; i < ids.length; i++) {
      transferFrom(from, to, ids[i], amounts[i]);
    }
    emit TransferBatch(msg.sender, from, to, ids, amounts);
  }

  function supportsInterface(bytes4 interfaceId) external view returns (bool) {}

  // ERC1155Supply extension
  function totalSupply(uint id) public view returns (uint) {
    Nft memory nft = state.nfts[id];
    require(nft.changeId != 0, 'NFT does not exist');
    if (nft.assetId == CONTENT_ASSET_ID) {
      return SHARES_TOTAL;
    }
    Change storage change = state.changes[nft.changeId];
    assert(change.funds.contains(id));
    return change.funds.get(id);
    // TODO test total supply of the QA Medallion
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
    Nft memory nft = state.nfts[id];
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
    require(change.createdAt != 0, 'Change does not exist');

    if (change.contentShares.traders.contains(holder)) {
      if (change.contentShares.traders.get(holder) != 0) {
        return true;
      }
    } else {
      if (change.contentShares.claimables.contains(holder)) {
        return true;
      }
    }
    if (change.contentShares.qaMedallion.nftId != 0) {
      if (change.contentShares.qaMedallion.holder == holder) {
        return true;
      }
    }
    return change.fundingShares.holders.contains(holder);
  }

  function fundingNftIdsFor(
    address holder,
    uint changeId
  ) public view returns (uint[] memory) {
    require(holder != address(0), 'Invalid holder');
    Change storage change = state.changes[changeId];
    require(change.createdAt != 0, 'Change does not exist');
    return change.fundingShares.balances[holder].keys();
  }

  function fundingNftIds(uint changeId) external view returns (uint[] memory) {
    Change storage change = state.changes[changeId];
    require(change.createdAt != 0, 'Change does not exist');
    return change.funds.keys();
  }

  function contentNftId(uint changeId) external view returns (uint) {
    Change storage change = state.changes[changeId];
    require(change.createdAt != 0, 'Change does not exist');
    return state.nftsLut.lut[changeId][CONTENT_ASSET_ID];
  }

  function qaMedallionNftId(uint changeId) external view returns (uint) {
    Change storage change = state.changes[changeId];
    require(change.createdAt != 0, 'Change does not exist');
    uint id = state.nftsLut.lut[changeId][QA_MEDALLION_ASSET_ID];
    require(id != 0, 'QA Medallion does not exist');
    return id;
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

  function getQA(uint id) external view returns (address) {
    return state.getQa(id);
  }

  function changeCount() external view returns (uint) {
    return state.changeCounter.current();
  }
}
