// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './LibraryUtils.sol';

library LibraryQA {
  using EnumerableSet for EnumerableSet.AddressSet;
  using Counters for Counters.Counter;
  event ChangeDisputed(uint disputeId);

  function qaResolve(Change storage c, Share[] calldata shares) public {
    require(shares.length > 0, 'Must provide shares');
    require(c.contentShares.holders.length() == 0);
    qaStart(c);
    allocateShares(c, shares);
  }

  function qaReject(Change storage change, bytes32 reason) public {
    require(LibraryUtils.isIpfs(reason), 'Invalid rejection hash');
    qaStart(change);
    change.rejectionReason = reason;
  }

  function qaStart(Change storage change) internal {
    require(change.createdAt != 0, 'Transition does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');
    change.disputeWindowStart = block.timestamp;
  }

  function allocateShares(Change storage c, Share[] calldata shares) internal {
    bool isDispute = c.changeType == ChangeType.DISPUTE;
    uint total = 0;
    for (uint i = 0; i < shares.length; i++) {
      Share memory share = shares[i];
      require(share.holder != address(0), 'Owner cannot be 0');
      require(isDispute || share.holder != msg.sender, 'Owner cannot be QA');
      require(share.amount > 0, 'Amount cannot be 0');
      require(!c.contentShares.holders.contains(share.holder), 'Owner exists');

      c.contentShares.holders.add(share.holder);
      c.contentShares.balances[share.holder] = share.amount;
      total += share.amount;
    }
    require(total == SHARES_TOTAL, 'Shares must sum to SHARES_TOTAL');
  }

  function disputeShares(
    State storage state,
    uint id,
    bytes32 reason,
    Share[] calldata s
  ) public {
    Change storage c = state.changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.holders.length() != 0, 'Not solved');

    uint disputeId = disputeStart(state, id, reason);
    Change storage dispute = state.changes[disputeId];
    LibraryQA.allocateShares(dispute, s);
  }

  function disputeResolve(State storage state, uint id, bytes32 reason) public {
    Change storage c = state.changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.holders.length() != 0, 'Not solved');

    disputeStart(state, id, reason);
  }

  function disputeRejection(
    State storage state,
    uint id,
    bytes32 reason
  ) external {
    Change storage c = state.changes[id];
    require(c.rejectionReason != 0, 'Not a rejection');

    disputeStart(state, id, reason);
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

    emit ChangeDisputed(disputeId);
    return disputeId;
  }
}
