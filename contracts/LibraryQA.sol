// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './LibraryUtils.sol';

library LibraryQA {
  using EnumerableSet for EnumerableSet.AddressSet;

  function qaResolve(Change storage c, Share[] calldata shares) external {
    require(shares.length > 0, 'Must provide shares');
    require(c.contentShares.holders.length() == 0);
    qaStart(c);
    allocateShares(c, shares);
  }

  function qaReject(Change storage change, bytes32 reason) public {
    require(Utils.isIpfs(reason), 'Invalid rejection hash');
    qaStart(change);
    change.rejectionReason = reason;
  }

  function qaStart(Change storage change) internal {
    require(change.createdAt != 0, 'Transition does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');
    change.disputeWindowStart = block.timestamp;
  }

  function allocateShares(Change storage c, Share[] calldata shares) internal {
    uint total = 0;
    for (uint i = 0; i < shares.length; i++) {
      Share memory share = shares[i];
      require(share.holder != address(0), 'Owner cannot be 0');
      require(share.holder != msg.sender, 'Owner cannot be QA');
      require(share.amount > 0, 'Amount cannot be 0');
      require(!c.contentShares.holders.contains(share.holder), 'Owner exists');

      c.contentShares.holders.add(share.holder);
      c.contentShares.balances[share.holder] = share.amount;
      total += share.amount;
    }
    require(total == SHARES_DECIMALS, 'Shares must sum to SHARES_DECIMALS');
  }
}
