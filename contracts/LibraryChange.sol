// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;

import './Types.sol';
import './LibraryUtils.sol';

library LibraryChange {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableMap for EnumerableMap.AddressToUintMap;

  function createHeader(Change storage header, bytes32 contents) public {
    require(LibraryUtils.isIpfs(contents), 'Invalid contents');
    require(header.createdAt == 0, 'Header already exists');

    header.changeType = ChangeType.HEADER;
    header.createdAt = block.timestamp;
    header.contents = contents;
  }

  function isOpen(Change storage change) public view returns (bool) {
    // TODO extend this to handle packets
    return change.createdAt != 0 && change.disputeWindowEnd == 0;
  }

  function isPacketSolved(Change storage packet) public view returns (bool) {
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET);

    return packet.contentShares.claimables.length() != 0;
  }

  function slurpShares(
    Change storage packet,
    mapping(uint => Change) storage changes
  ) public {
    ContentShares storage contentShares = packet.contentShares;
    assert(contentShares.claimables.length() == 0);
    assert(contentShares.holders.length() == 0);

    uint solutionCount = 0;
    for (uint i = 0; i < packet.downlinks.length; i++) {
      uint solutionId = packet.downlinks[i];
      Change storage solution = changes[solutionId];
      assert(solution.changeType == ChangeType.SOLUTION);
      assert(solution.createdAt != 0);
      if (solution.rejectionReason != 0 || solution.disputeWindowEnd == 0) {
        // dispute window has passed, else isFeasible() would have failed.
        continue;
      }

      uint claimablesCount = solution.contentShares.claimables.length();
      assert(claimablesCount > 0);
      for (uint j = 0; j < claimablesCount; j++) {
        (address solver, uint amount) = solution.contentShares.claimables.at(j);
        uint share = 0;
        if (contentShares.claimables.contains(solver)) {
          share = contentShares.claimables.get(solver);
        }
        contentShares.claimables.set(solver, share + amount);
      }
      solutionCount++;
    }
    assert(solutionCount > 0);
    if (solutionCount == 1) {
      return;
    }

    address bigdog = address(0);
    uint bigdogBalance = 0;
    bool bigdogTie = false;
    address[] memory toDelete;
    uint toDeleteIndex = 0;
    uint sum = 0;

    uint packetHoldersCount = contentShares.claimables.length();
    for (uint i = 0; i < packetHoldersCount; i++) {
      (address solver, uint amount) = contentShares.claimables.at(i);
      if (amount > bigdogBalance) {
        bigdogBalance = amount;
        bigdog = solver;
        bigdogTie = false;
      } else if (amount == bigdogBalance) {
        bigdogTie = true;
      }
      uint normalized = amount / solutionCount;
      if (normalized == 0) {
        toDelete[toDeleteIndex++] = solver;
      } else {
        contentShares.claimables.set(solver, normalized);
        sum += normalized;
      }
    }
    require(bigdog != address(0), 'Must have biggest holder');
    if (bigdogTie) {
      // TODO take from the least and give to the beast
    }
    // TODO if all balances are zero, take all the bigdogs and split it all
    uint remainder = SHARES_TOTAL - sum;
    bigdogBalance = contentShares.claimables.get(bigdog);
    contentShares.claimables.set(bigdog, bigdogBalance + remainder);

    for (uint i = 0; i < toDelete.length; i++) {
      address solver = toDelete[i];
      assert(bigdog != solver);
      contentShares.claimables.remove(solver);
    }
    contentShares.bigdog = bigdog;
  }

  function mintQaMedallion(
    Change storage packet,
    address qa,
    uint nftId
  ) public {
    require(packet.changeType == ChangeType.PACKET);
    require(qa != address(0));
    require(nftId != 0);
    require(packet.contentShares.qaMedallion.nftId == 0);

    packet.contentShares.qaMedallion.nftId = nftId;
    packet.contentShares.qaMedallion.holder = qa;
  }
}
