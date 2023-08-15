// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './LibraryUtils.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/utils/Counters.sol';
import './IDreamcatcher.sol';
import './IQA.sol';

interface IERC20 {
  function transferFrom(
    address from,
    address to,
    uint256 value
  ) external returns (bool);
}

library LibraryChanges {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using LibraryChanges for Change;
  using Counters for Counters.Counter;

  event PacketCreated(uint packetId);
  event SolutionAccepted(uint transitionHash);
  event PacketResolved(uint packetId);
  event ProposedPacket(uint headerId);
  event FundedTransition(uint transitionHash, address owner);

  function isPacketSolved(Change storage packet) internal view returns (bool) {
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET);

    return packet.contentShares.holders.length() != 0;
  }

  function createHeader(Change storage header, bytes32 contents) public {
    require(LibraryUtils.isIpfs(contents), 'Invalid contents');
    require(header.createdAt == 0, 'Header already exists');

    header.changeType = ChangeType.HEADER;
    header.createdAt = block.timestamp;
    header.contents = contents;
  }

  function isOpen(Change storage change) internal view returns (bool) {
    return change.createdAt != 0 && change.disputeWindowStart == 0;
  }

  function proposePacket(
    State storage state,
    bytes32 contents,
    address qa
  ) public {
    require(qa.code.length > 0, 'QA must be a contract');
    state.changeCounter.increment();
    uint headerId = state.changeCounter.current();
    Change storage header = state.changes[headerId];
    createHeader(header, contents);

    require(state.qaMap[headerId] == address(0), 'QA exists');
    state.qaMap[headerId] = qa;
    upsertNftId(state, headerId, CONTENT_ASSET_ID);
    emit ProposedPacket(headerId);
  }

  function fund(
    State storage state,
    uint changeId,
    Payment[] calldata payments
  ) public {
    Change storage change = state.changes[changeId];
    Payment[] memory allPayments = change.fund(payments);
    for (uint i = 0; i < allPayments.length; i++) {
      uint assetId = upsertAssetId(state, allPayments[i]);
      uint nftId = upsertNftId(state, changeId, assetId);
      change.updateHoldings(nftId, allPayments[i]);
    }
    emit FundedTransition(changeId, msg.sender);
  }

  function fund(
    Change storage change,
    Payment[] calldata payments
  ) internal returns (Payment[] memory) {
    require(msg.value > 0 || payments.length > 0, 'Must send funds');
    require(change.isOpen(), 'Change is not open for funding');

    uint length = msg.value > 0 ? payments.length + 1 : payments.length;
    Payment[] memory funded = new Payment[](length);
    if (msg.value > 0) {
      Payment memory eth = Payment(ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
      funded[payments.length] = eth;
    }
    for (uint i = 0; i < payments.length; i++) {
      Payment memory p = payments[i];
      require(p.amount > 0, 'Amount cannot be 0');
      require(p.token != address(0), 'Token address invalid');
      if (p.tokenId == 0) {
        // TODO handle erc1155 with a tokenId of zero
        IERC20 token = IERC20(p.token);
        require(token.transferFrom(msg.sender, address(this), p.amount));
      } else {
        IERC1155 token = IERC1155(p.token);
        token.safeTransferFrom(
          msg.sender,
          address(this),
          p.tokenId,
          p.amount,
          ''
        );
      }
      funded[i] = p;
    }
    delete change.fundingShares.defundWindows[msg.sender];
    return funded;
  }

  function updateHoldings(
    Change storage change,
    uint nftId,
    Payment memory payment
  ) internal {
    uint funds = 0;
    if (change.funds.contains(nftId)) {
      funds = change.funds.get(nftId);
    }
    change.funds.set(nftId, funds + payment.amount);

    if (!change.fundingShares.holders.contains(msg.sender)) {
      change.fundingShares.holders.add(msg.sender);
    }
    uint holdings = 0;
    if (change.fundingShares.balances[msg.sender].contains(nftId)) {
      holdings = change.fundingShares.balances[msg.sender].get(nftId);
    }
    change.fundingShares.balances[msg.sender].set(
      nftId,
      holdings + payment.amount
    );
  }

  function defundStart(Change storage change) public {
    require(change.isOpen(), 'Change is not open for defunding');
    require(change.fundingShares.defundWindows[msg.sender] == 0);

    change.fundingShares.defundWindows[msg.sender] = block.timestamp;
  }

  function defundStop(Change storage change) public {
    require(change.createdAt != 0, 'Change does not exist');
    require(change.fundingShares.defundWindows[msg.sender] != 0);

    delete change.fundingShares.defundWindows[msg.sender];
  }

  function defund(
    Change storage change,
    EnumerableMap.UintToUintMap storage debts,
    mapping(uint => TaskNft) storage taskNfts
  ) public {
    require(change.isOpen(), 'Change is not open for defunding');
    FundingShares storage shares = change.fundingShares;
    require(shares.defundWindows[msg.sender] != 0);

    uint lockedTime = shares.defundWindows[msg.sender];
    uint elapsedTime = block.timestamp - lockedTime;
    require(elapsedTime > DEFUND_WINDOW, 'Defund timeout not reached');

    EnumerableMap.UintToUintMap storage holdings = shares.balances[msg.sender];
    uint[] memory nftIds = holdings.keys(); // nftId => amount

    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      uint amount = holdings.get(nftId);
      // TODO emit burn event
      uint total = change.funds.get(nftId);
      uint newTotal = total - amount;
      if (newTotal == 0) {
        change.funds.remove(nftId);
      } else {
        change.funds.set(nftId, newTotal);
      }
      uint debt = 0;
      if (debts.contains(taskNfts[nftId].assetId)) {
        debt = debts.get(taskNfts[nftId].assetId);
      }
      debts.set(taskNfts[nftId].assetId, debt + amount);
    }

    delete shares.defundWindows[msg.sender];
    delete shares.balances[msg.sender];
    shares.holders.remove(msg.sender);

    // TODO make a token to allow spending of locked funds
    // TODO check if any solutions have passed threshold and revert if so
  }

  function solve(
    Change storage packet,
    Change storage solution,
    bytes32 contents
  ) public {
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    require(packet.createdAt != 0, 'Packet does not exist');
    require(solution.createdAt == 0, 'Solution exists');
    require(LibraryUtils.isIpfs(contents), 'Invalid contents');

    solution.changeType = ChangeType.SOLUTION;
    solution.createdAt = block.timestamp;
    solution.contents = contents;
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

  function claim(
    Change storage c,
    uint id,
    EnumerableMap.UintToUintMap storage debts,
    mapping(uint => TaskNft) storage taskNfts
  ) public {
    require(c.isPacketSolved());
    require(c.contentShares.holders.contains(msg.sender), 'Not a holder');
    require(c.fundingShares.holders.length() != 0, 'No funds to claim');

    uint shares = c.contentShares.balances[msg.sender];
    uint claimed = c.contentShares.claims[msg.sender];
    uint unclaimed = shares - claimed;
    if (unclaimed == 0) {
      revert('Already claimed');
    }
    c.contentShares.totalClaims += unclaimed;
    c.contentShares.claims[msg.sender] = shares;

    uint[] memory nftIds = c.funds.keys();

    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      require(taskNfts[nftId].changeId == id, 'NFT is not for this transition');

      uint initialFunds = c.funds.get(nftId);
      uint withdrawn = c.contentShares.withdrawn[nftId];
      uint remainingFunds = initialFunds - withdrawn;
      uint withdrawable = 0;
      if (c.contentShares.totalClaims == SHARES_TOTAL) {
        // final claim gets all residues
        withdrawable = remainingFunds;
      } else {
        withdrawable = (remainingFunds * unclaimed) / SHARES_TOTAL;
      }
      if (withdrawable == 0) {
        continue;
      }
      c.contentShares.withdrawn[nftId] += withdrawable;

      uint debt = 0;
      if (debts.contains(taskNfts[nftId].assetId)) {
        debt = debts.get(taskNfts[nftId].assetId);
      }
      debts.set(taskNfts[nftId].assetId, debt + withdrawable);
    }
  }

  function isTransferrable(
    Change storage c,
    address holder
  ) public view returns (bool) {
    if (c.changeType != ChangeType.PACKET) {
      return true;
    }
    if (c.fundingShares.holders.length() == 0) {
      return true;
    }
    uint shares = c.contentShares.balances[holder];
    uint claimed = c.contentShares.claims[holder];
    return shares == claimed;
  }

  function enact(uint id, State storage state) public {
    Change storage c = state.changes[id];
    require(c.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');
    require(c.changeType != ChangeType.DISPUTE, 'Cannot enact disputes');
    require(c.changeType != ChangeType.PACKET, 'Cannot enact packets');
    // TODO check no other disputes are open too

    if (c.rejectionReason != 0) {
      if (c.changeType == ChangeType.SOLUTION) {
        enactPacket(c.uplink, state);
      }
      return;
    }

    upsertNftId(state, id, CONTENT_ASSET_ID);

    if (c.changeType == ChangeType.HEADER) {
      require(c.uplink == 0, 'Header already enacted');
      state.changeCounter.increment();
      uint packetId = state.changeCounter.current();
      Change storage packet = state.changes[packetId];
      require(packet.createdAt == 0, 'Packet already exists');
      packet.changeType = ChangeType.PACKET;
      packet.createdAt = block.timestamp;
      packet.uplink = id;
      c.uplink = packetId;

      emit PacketCreated(packetId);
    } else if (c.changeType == ChangeType.SOLUTION) {
      emit SolutionAccepted(id);
      Change storage packet = state.changes[c.uplink];
      require(packet.createdAt != 0, 'Packet does not exist');
      require(packet.changeType == ChangeType.PACKET, 'Not a packet');

      enactPacket(c.uplink, state);
    } else if (c.changeType == ChangeType.EDIT) {
      // TODO
    } else if (c.changeType == ChangeType.MERGE) {
      // TODO
    } else {
      revert('Invalid transition type');
    }
  }

  function upsertNftId(
    State storage state,
    uint changeId,
    uint assetId
  ) internal returns (uint) {
    uint nftId = state.taskNftsLut.lut[changeId][assetId];
    if (nftId == 0) {
      state.nftCounter.increment();
      nftId = state.nftCounter.current();
      TaskNft storage nft = state.taskNfts[nftId];
      nft.changeId = changeId;
      nft.assetId = assetId;
      state.taskNftsLut.lut[changeId][assetId] = nftId;
    }
    return nftId;
  }

  function enactPacket(uint packetId, State storage state) internal {
    Change storage packet = state.changes[packetId];
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    require(packet.contentShares.holders.length() == 0, 'Already enacted');

    for (uint i = 0; i < packet.downlinks.length; i++) {
      uint solutionId = packet.downlinks[i];
      if (isPossible(solutionId, state)) {
        return; // this is not the final solution
      }
    }
    packet.mergeShares(state.changes);
    upsertNftId(state, packetId, CONTENT_ASSET_ID);
    emit PacketResolved(packetId);
  }

  function isPossible(
    uint id,
    State storage state
  ) internal view returns (bool) {
    Change storage solution = state.changes[id];
    require(solution.createdAt != 0, 'Change does not exist');
    require(solution.changeType == ChangeType.SOLUTION, 'Not a solution');

    if (solution.disputeWindowStart == 0) {
      Change storage packet = state.changes[solution.uplink];
      IQA qa = IQA(state.qaMap[packet.uplink]);
      return qa.isJudgeable(id);
    }
    uint elapsedTime = block.timestamp - solution.disputeWindowStart;
    return elapsedTime < DISPUTE_WINDOW;
    // TODO handle disputes being outstanding after the window closed
  }

  function upsertAssetId(
    State storage state,
    Payment memory payment
  ) internal returns (uint) {
    uint assetId = state.assetsLut.lut[payment.token][payment.tokenId];
    if (assetId == 0) {
      state.assetCounter.increment();
      assetId = state.assetCounter.current();
      Asset storage asset = state.assets[assetId];
      asset.tokenContract = payment.token;
      asset.tokenId = payment.tokenId;
      state.assetsLut.lut[payment.token][payment.tokenId] = assetId;
    }
    return assetId;
  }
}
