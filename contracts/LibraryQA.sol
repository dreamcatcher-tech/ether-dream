// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;

import './Types.sol';
import './LibraryUtils.sol';
import './LibraryFilter.sol';
import './IQA.sol';

library LibraryQA {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using EnumerableMap for EnumerableMap.AddressToUintMap;
  using Counters for Counters.Counter;
  using LibraryFilter for AssetFilter;
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
    require(isQa(state, id), 'Must be the change QA');
    Change storage change = state.changes[id];
    qaStart(change, state);
    allocateShares(change, shares);
    emit QAResolved(id);
  }

  function qaReject(State storage state, uint id, bytes32 reason) public {
    require(isQa(state, id), 'Must be the change QA');
    require(LibraryUtils.isIpfs(reason), 'Invalid rejection hash');
    Change storage change = state.changes[id];
    qaStart(change, state);
    change.rejectionReason = reason;
    emit QARejected(id);
  }

  function qaStart(Change storage change, State storage state) internal {
    require(change.disputeWindowEnd == 0, 'Dispute window active');
    require(change.changeType != ChangeType.PACKET, 'Cannot QA packets');
    require(change.changeType != ChangeType.DISPUTE, 'Cannot QA disputes');

    uint disputeWindowSize = getDisputeWindowSize(state, change);
    assert(disputeWindowSize > 0);
    change.disputeWindowEnd = block.timestamp + change.disputeWindowSize;
  }

  function allocateShares(Change storage c, Share[] calldata shares) internal {
    require(shares.length > 0, 'Must provide shares');
    assert(c.contentShares.solvers.length() == 0);
    assert(c.contentShares.traders.length() == 0);

    bool isDispute = c.changeType == ChangeType.DISPUTE;
    uint total = 0;
    address bigdog;
    uint bigdogAmount = 0;
    bool bigdogTie = false;
    for (uint i = 0; i < shares.length; i++) {
      Share memory share = shares[i];
      require(share.holder != address(0), 'Owner cannot be 0');
      // TODO why isDispute allows QA to be a holder ?
      require(isDispute || share.holder != msg.sender, 'Owner cannot be QA');
      require(share.amount > 0, 'Amount cannot be 0');
      require(!c.contentShares.solvers.contains(share.holder), 'Duplicate');

      // TODO call onERC1155Received

      c.contentShares.solvers.set(share.holder, share.amount);
      total += share.amount;
      if (share.amount > bigdogAmount) {
        bigdogAmount = share.amount;
        bigdog = share.holder;
        bigdogTie = false;
      } else if (share.amount == bigdogAmount) {
        bigdogTie = true;
      }
    }
    require(total == SHARES_TOTAL, 'Shares must sum to SHARES_TOTAL');
    require(!bigdogTie, 'Shares must have a single bigdog');
    assert(bigdog != address(0));
  }

  function disputeResolve(
    State storage state,
    uint id,
    bytes32 reason
  ) public returns (uint) {
    Change storage c = state.changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.solvers.length() != 0, 'Not solved');

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

    uint disputeId = disputeStart(state, id, reason);
    Change storage dispute = state.changes[disputeId];
    allocateShares(dispute, s);
    return disputeId;
  }

  function disputeReject(
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
    require(c.disputeWindowEnd > 0, 'Dispute window not started');
    require(c.disputeWindowEnd > block.timestamp, 'Dispute window passed');
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

    onChange(state, disputeId);
    emit ChangeDisputed(id, disputeId);
    return disputeId;
  }

  function qaDisputesDismissed(
    State storage state,
    uint changeId,
    bytes32 reason
  ) external {
    require(isQa(state, changeId), 'Must be the change QA');
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    Change storage change = state.changes[changeId];
    require(change.disputeWindowEnd > 0, 'Dispute window not started');
    require(change.disputeWindowEnd <= block.timestamp, 'Dispute window open');
    require(isDisputed(change), 'No active disputes');

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
    require(isQa(state, disputeId), 'Must be the change QA');

    Change storage change = state.changes[dispute.uplink];
    require(change.disputeWindowEnd > 0, 'Dispute window not started');
    require(change.disputeWindowEnd <= block.timestamp, 'Dispute window open');
    require(isDisputed(change), 'No active disputes');

    if (change.rejectionReason != 0) {
      delete change.rejectionReason;
      delete change.disputeWindowEnd;
    } else if (dispute.contentShares.solvers.length() != 0) {
      deallocateShares(change);
      copyShares(dispute.contentShares, change.contentShares);
      delete dispute.contentShares;
    } else {
      delete change.disputeWindowEnd;
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
    assert(to.traders.length() == 0);
    assert(to.solvers.length() == 0);
    assert(from.traders.length() == 0);
    assert(from.solvers.length() > 0);
    uint count = from.solvers.length();
    for (uint i = 0; i < count; i++) {
      (address holder, uint balance) = from.solvers.at(i);
      to.solvers.set(holder, balance);
    }
  }

  function deallocateShares(Change storage change) internal {
    ContentShares storage contentShares = change.contentShares;
    assert(change.contentShares.traders.length() == 0);
    uint count = contentShares.solvers.length();
    for (uint i = count; i > 0; i--) {
      (address holder, ) = contentShares.solvers.at(i - 1);
      contentShares.solvers.remove(holder);
    }
  }

  function claimMeta(State storage state, uint id, uint filterId) internal {
    require(isQa(state, id), 'Must be transition QA');
    Change storage change = state.changes[id];
    require(change.changeType != ChangeType.PACKET, 'QA cannot claim packets');
    require(change.createdAt != 0, 'Change does not exist');
    require(change.disputeWindowEnd > 0, 'Not passed by QA');
    require(change.disputeWindowEnd <= block.timestamp, 'Window still open');
    AssetFilter storage filter = state.filters[filterId];
    assert(filter.isValid());

    // TODO test no double withdraws possible for solvers or QA
    Exits storage exits = state.exits[msg.sender];
    uint length = change.funds.length();
    for (uint i = 0; i < length; i++) {
      (uint nftId, uint amount) = change.funds.at(i);
      assert(amount > 0);
      Nft memory nft = state.nfts[nftId];
      assert(nft.changeId == id);

      uint exit = 0;
      if (exits.balances.contains(nft.assetId)) {
        exit = exits.balances.get(nft.assetId);
      }
      exits.balances.set(nft.assetId, exit + amount);
    }
    emit QAClaimed(id);
  }

  function isQa(State storage state, uint id) public view returns (bool) {
    Change storage change = state.changes[id];
    if (change.createdAt == 0) {
      revert('Change does not exist');
    }
    address qa = getQa(state, id);
    return qa == msg.sender;
  }

  function getQa(State storage state, uint id) public view returns (address) {
    Change storage change = state.changes[id];
    if (change.changeType == ChangeType.HEADER) {
      return state.qaMap[id];
    }
    if (change.changeType == ChangeType.SOLUTION) {
      return getQa(state, change.uplink);
    }
    if (change.changeType == ChangeType.PACKET) {
      return getQa(state, change.uplink);
    }
    if (change.changeType == ChangeType.DISPUTE) {
      return getQa(state, change.uplink);
    }
    revert('Invalid change');
  }

  function getDisputeWindowSize(
    State storage state,
    Change storage change
  ) internal view returns (uint) {
    if (change.changeType == ChangeType.HEADER) {
      return change.disputeWindowSize;
    }
    if (change.changeType == ChangeType.PACKET) {
      return change.disputeWindowSize;
    }
    return getDisputeWindowSize(state, state.changes[change.uplink]);
  }

  function isDisputed(Change storage change) internal view returns (bool) {
    DisputeRound memory last;
    if (change.disputeRounds.length > 0) {
      last = change.disputeRounds[change.disputeRounds.length - 1];
    }
    if (last.roundHeight == change.downlinks.length) {
      return false;
    }
    return true;
  }

  function onChange(
    State storage state,
    uint newId
  ) public view returns (uint) {
    address qa = getQa(state, newId);
    return IQA(qa).onChange(newId);
  }

  function onFund(
    State storage state,
    uint id,
    Payment[] calldata payments
  ) public view {
    address qa = getQa(state, id);
    IQA(qa).onFund(id, payments);
  }
}
