// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './LibraryUtils.sol';

library LibraryQA {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using Counters for Counters.Counter;
  event ChangeDisputed(uint changeId, uint disputeId);
  event QAResolved(uint transitionHash);
  event QARejected(uint transitionHash);
  event QAClaimed(uint metaId);
  event DisputesDismissed(uint changeId);
  event DisputesUpheld(uint changeId);

  function qaResolve(
    State storage state,
    uint id,
    Share[] calldata shares
  ) external {
    require(isQa(state, id), 'Must be transition QA');
    Change storage change = state.changes[id];
    require(shares.length > 0, 'Must provide shares');
    require(change.contentShares.holders.length() == 0, 'Already resolved');
    qaStart(change);
    allocateShares(change, shares);
    emit QAResolved(id);
  }

  function qaReject(State storage state, uint id, bytes32 reason) public {
    require(isQa(state, id), 'Must be transition QA');
    Change storage change = state.changes[id];
    require(LibraryUtils.isIpfs(reason), 'Invalid rejection hash');
    qaStart(change);
    change.rejectionReason = reason;
    emit QARejected(id);
  }

  function qaStart(Change storage change) internal {
    require(change.createdAt != 0, 'Transition does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');
    change.disputeWindowStart = block.timestamp;
  }

  function allocateShares(Change storage c, Share[] calldata shares) internal {
    require(c.contentShares.holders.length() == 0, 'Already resolved');
    bool isDispute = c.changeType == ChangeType.DISPUTE;
    uint total = 0;
    for (uint i = 0; i < shares.length; i++) {
      Share memory share = shares[i];
      require(share.holder != address(0), 'Owner cannot be 0');
      require(isDispute || share.holder != msg.sender, 'Owner cannot be QA');
      require(share.amount > 0, 'Amount cannot be 0');
      require(!c.contentShares.holders.contains(share.holder), 'Owner exists');

      // TODO call onERC1155Received

      c.contentShares.holders.add(share.holder);
      c.contentShares.balances[share.holder] = share.amount;
      total += share.amount;
    }
    require(total == SHARES_TOTAL, 'Shares must sum to SHARES_TOTAL');
  }

  function disputeResolve(
    State storage state,
    uint id,
    bytes32 reason
  ) public returns (uint) {
    Change storage c = state.changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.holders.length() != 0, 'Not solved');

    return disputeStart(state, id, reason);
  }

  function disputeShares(
    State storage state,
    uint id,
    bytes32 reason,
    Share[] calldata s
  ) public returns (uint) {
    Change storage c = state.changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.holders.length() != 0, 'Not solved');

    uint disputeId = disputeStart(state, id, reason);
    Change storage dispute = state.changes[disputeId];
    allocateShares(dispute, s);
    return disputeId;
  }

  function disputeRejection(
    State storage state,
    uint id,
    bytes32 reason
  ) external returns (uint) {
    Change storage c = state.changes[id];
    require(c.rejectionReason != 0, 'Not a rejection');

    return disputeStart(state, id, reason);
  }

  function disputeStart(
    State storage state,
    uint id,
    bytes32 reason
  ) internal returns (uint) {
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    Change storage c = state.changes[id];
    require(c.createdAt != 0, 'Change does not exist');
    require(c.disputeWindowStart > 0, 'Dispute window not started');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime < DISPUTE_WINDOW, 'Dispute window closed');
    require(c.changeType != ChangeType.PACKET, 'Cannot dispute packets');
    require(c.changeType != ChangeType.DISPUTE, 'Cannot dispute disputes');

    state.changeCounter.increment();
    uint disputeId = state.changeCounter.current();
    Change storage dispute = state.changes[disputeId];
    dispute.changeType = ChangeType.DISPUTE;
    dispute.createdAt = block.timestamp;
    dispute.contents = reason;
    dispute.uplink = id;

    c.downlinks.push(disputeId);

    emit ChangeDisputed(id, disputeId);
    return disputeId;
  }

  function qaDisputesDismissed(
    State storage state,
    uint changeId,
    bytes32 reason
  ) external {
    require(isQa(state, changeId));
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    Change storage change = state.changes[changeId];
    require(change.disputeWindowStart > 0, 'Dispute window not started');
    uint elapsedTime = block.timestamp - change.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');

    DisputeRound memory round;
    round.roundHeight = change.downlinks.length;
    round.outcome = DISPUTE_ROUND_DISMISSED;
    round.reason = reason;
    change.disputeRounds.push(round);

    emit DisputesDismissed(changeId);
  }

  function qaDisputeUpheld(
    State storage state,
    uint disputeId,
    Share[] calldata shares,
    bytes32 reason
  ) external {
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    require(shares.length > 0, 'Must provide shares');
    Change storage dispute = state.changes[disputeId];
    require(dispute.createdAt != 0, 'Dispute does not exist');
    require(dispute.changeType == ChangeType.DISPUTE, 'Not a dispute');
    require(isQa(state, disputeId));

    Change storage change = state.changes[dispute.uplink];
    require(change.disputeWindowStart > 0, 'Dispute window not started');
    uint elapsedTime = block.timestamp - change.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');

    if (change.rejectionReason != 0) {
      delete change.rejectionReason;
      delete change.disputeWindowStart;
    } else if (dispute.contentShares.holders.length() != 0) {
      deallocateShares(change);
      copyShares(dispute.contentShares, change.contentShares);
      delete dispute.contentShares;
    } else {
      delete change.disputeWindowStart;
      deallocateShares(change);
    }

    DisputeRound memory round;
    round.roundHeight = change.downlinks.length;
    round.outcome = disputeId;
    round.reason = reason;
    change.disputeRounds.push(round);

    allocateShares(dispute, shares);
    emit DisputesUpheld(disputeId);

    // TODO handle concurrent disputes
  }

  function copyShares(
    ContentShares storage from,
    ContentShares storage to
  ) internal {
    require(to.holders.length() == 0);
    uint holdersCount = from.holders.length();
    for (uint i = 0; i < holdersCount; i++) {
      address holder = from.holders.at(i);
      uint balance = from.balances[holder];
      require(!to.holders.contains(holder));
      to.holders.add(holder);
      to.balances[holder] = balance;
    }
  }

  function deallocateShares(Change storage change) internal {
    ContentShares storage contentShares = change.contentShares;
    uint holdersCount = contentShares.holders.length();
    for (uint i = holdersCount; i > 0; i--) {
      address holder = contentShares.holders.at(i - 1);
      delete contentShares.balances[holder];
      contentShares.holders.remove(holder);
    }
  }

  function claimQa(State storage state, uint id) public {
    require(isQa(state, id), 'Must be transition QA');
    Change storage change = state.changes[id];
    require(change.changeType != ChangeType.PACKET, 'Cannot claim packets');
    require(change.createdAt != 0, 'Change does not exist');
    require(change.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - change.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');

    if (change.funds.length() == 0) {
      revert('No funds to claim');
    }
    uint[] memory nftIds = change.funds.keys();
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];

    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      uint funds = change.funds.get(nftId);
      require(funds > 0, 'No funds');
      if (change.contentShares.withdrawn[nftId] != 0) {
        revert('Already claimed');
      }
      TaskNft memory nft = state.taskNfts[nftId];
      require(nft.changeId == id, 'NFT not for this transition');

      uint debt = 0;
      if (debts.contains(nft.assetId)) {
        debt = debts.get(nft.assetId);
      }
      debts.set(nft.assetId, debt + funds);
      change.contentShares.withdrawn[nftId] = funds;
    }
    emit QAClaimed(id);
  }

  function isQa(State storage state, uint id) public view returns (bool) {
    Change storage change = state.changes[id];
    if (change.changeType == ChangeType.HEADER) {
      return state.qaMap[id] == msg.sender;
    }
    if (change.changeType == ChangeType.SOLUTION) {
      return isQa(state, change.uplink);
    }
    if (change.changeType == ChangeType.PACKET) {
      return isQa(state, change.uplink);
    }
    if (change.changeType == ChangeType.DISPUTE) {
      return isQa(state, change.uplink);
    }
    revert('Invalid change');
  }
}
