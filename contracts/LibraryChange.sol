// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './LibraryUtils.sol';

library LibraryChange {
  using EnumerableSet for EnumerableSet.AddressSet;

  function createHeader(Change storage header, bytes32 contents) internal {
    require(LibraryUtils.isIpfs(contents), 'Invalid contents');
    require(header.createdAt == 0, 'Header already exists');

    header.changeType = ChangeType.HEADER;
    header.createdAt = block.timestamp;
    header.contents = contents;
  }

  function exists(Change storage change) public view returns (bool) {
    return change.createdAt != 0;
  }

  function isOpen(Change storage change) internal view returns (bool) {
    return change.createdAt != 0 && change.disputeWindowStart == 0;
  }

  function isPacketSolved(Change storage packet) internal view returns (bool) {
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET);

    return packet.contentShares.holders.length() != 0;
  }

  function mergeShares(
    Change storage packet,
    mapping(uint => Change) storage changes
  ) internal {
    ContentShares storage contentShares = packet.contentShares;
    require(contentShares.holders.length() == 0);

    uint solutionCount = 0;
    for (uint i = 0; i < packet.downlinks.length; i++) {
      uint solutionId = packet.downlinks[i];
      Change storage solution = changes[solutionId];
      require(solution.changeType == ChangeType.SOLUTION);

      if (solution.rejectionReason != 0) {
        continue;
      }
      if (solution.disputeWindowStart == 0) {
        // dispute window has passed, else isPossible() would have failed.
        continue;
      }
      uint holdersCount = solution.contentShares.holders.length();
      require(holdersCount > 0);
      for (uint j = 0; j < holdersCount; j++) {
        address holder = solution.contentShares.holders.at(j);
        uint balance = solution.contentShares.balances[holder];
        if (!contentShares.holders.contains(holder)) {
          contentShares.holders.add(holder);
        }
        contentShares.balances[holder] += balance;
      }
      solutionCount++;
    }
    require(solutionCount > 0, 'Must have downlinks');
    if (solutionCount == 1) {
      return;
    }

    uint biggestBalance = 0;
    address biggestHolder = address(0);
    address[] memory toDelete;
    uint toDeleteIndex = 0;
    uint sum = 0;

    uint packetHoldersCount = contentShares.holders.length();
    for (uint i = 0; i < packetHoldersCount; i++) {
      address holder = contentShares.holders.at(i);
      uint balance = contentShares.balances[holder];
      if (balance > biggestBalance) {
        biggestBalance = balance;
        biggestHolder = holder;
      }
      uint newBalance = balance / solutionCount;
      if (newBalance == 0) {
        toDelete[toDeleteIndex++] = holder;
        continue;
      }
      contentShares.balances[holder] = newBalance;
      sum += newBalance;
    }
    require(biggestHolder != address(0), 'Must have biggest holder');
    uint remainder = SHARES_TOTAL - sum;
    contentShares.balances[biggestHolder] += remainder;

    for (uint i = 0; i < toDelete.length; i++) {
      address holder = toDelete[i];
      delete contentShares.balances[holder];
      contentShares.holders.remove(holder);
    }
  }
}
