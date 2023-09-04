// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/utils/Counters.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './IDreamcatcher.sol';
import './LibraryChange.sol';
import './LibraryQA.sol';

library LibraryState {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using Counters for Counters.Counter;
  using LibraryChange for Change;

  event PacketCreated(uint packetId);
  event SolutionAccepted(uint transitionHash);
  event PacketResolved(uint packetId);
  event ProposedPacket(uint headerId);
  event FundedTransition(uint transitionHash, address owner);
  event SolutionProposed(uint solutionId);
  event Claimed(uint packetId, address holder);
  event DefundStarted(uint indexed id, address indexed holder);
  event Defunded(uint indexed id, address indexed holder);
  event DefundStopped(uint indexed id, address indexed holder);
  event ProposeEdit(uint indexed forId, uint indexed editId);

  function proposePacket(
    State storage state,
    bytes32 contents,
    address qa
  ) public returns (uint) {
    require(qa.code.length > 0, 'QA must be a contract');
    state.changeCounter.increment();
    uint headerId = state.changeCounter.current();
    Change storage header = state.changes[headerId];
    header.createHeader(contents);

    assert(state.qaMap[headerId] == address(0));
    state.qaMap[headerId] = qa;
    // create a new nft so it can be advertised in opensea
    upsertNftId(state, headerId, CONTENT_ASSET_ID);

    LibraryQA.onChange(state, headerId);
    emit ProposedPacket(headerId);
    return headerId;
  }

  function fund(
    State storage state,
    uint changeId,
    Payment[] calldata payments
  ) public {
    require(msg.value > 0 || payments.length > 0, 'Must send funds');
    Change storage change = state.changes[changeId];
    require(change.isOpen(), 'Change is not open for funding');

    if (msg.value > 0) {
      Payment memory eth = Payment(ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
      updateHoldings(state, changeId, eth);
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

      updateHoldings(state, changeId, p);
    }
    delete change.fundingShares.defundWindows[msg.sender];

    LibraryQA.onFund(state, changeId, payments);
    emit FundedTransition(changeId, msg.sender);
  }

  function updateHoldings(
    State storage state,
    uint changeId,
    Payment memory payment
  ) internal {
    Change storage change = state.changes[changeId];
    uint assetId = upsertAssetId(state, payment);
    uint nftId = upsertNftId(state, changeId, assetId);

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

  function defundStart(State storage state, uint id) public {
    Change storage change = state.changes[id];
    require(change.isOpen(), 'Change is not open for defunding');
    require(
      change.fundingShares.defundWindows[msg.sender] == 0,
      'Already started'
    );

    change.fundingShares.defundWindows[msg.sender] = block.timestamp;
    emit DefundStarted(id, msg.sender);
  }

  function defundStop(State storage state, uint id) external {
    Change storage change = state.changes[id];
    require(change.isOpen(), 'Change is not open for defunding');
    require(
      change.fundingShares.defundWindows[msg.sender] != 0,
      'Defund not started'
    );

    delete change.fundingShares.defundWindows[msg.sender];
    emit DefundStopped(id, msg.sender);
  }

  function defund(State storage state, uint id) public {
    Change storage change = state.changes[id];
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];
    require(change.isOpen(), 'Change is not open for defunding');
    FundingShares storage shares = change.fundingShares;
    require(shares.defundWindows[msg.sender] != 0, 'Defund not started');

    uint lockedTime = shares.defundWindows[msg.sender];
    uint elapsedTime = block.timestamp - lockedTime;
    require(elapsedTime > DEFUND_WINDOW, 'Defund timeout not reached');

    EnumerableMap.UintToUintMap storage holdings = shares.balances[msg.sender];
    uint[] memory nftIds = holdings.keys(); // nftId => amount
    require(nftIds.length > 0, 'No funds to defund');

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
      if (debts.contains(state.taskNfts[nftId].assetId)) {
        debt = debts.get(state.taskNfts[nftId].assetId);
      }
      debts.set(state.taskNfts[nftId].assetId, debt + amount);
    }

    delete shares.defundWindows[msg.sender];
    delete shares.balances[msg.sender];
    shares.holders.remove(msg.sender);
    emit Defunded(id, msg.sender);

    // TODO make a token to allow spending of locked funds
    // TODO check if any solutions have passed threshold and revert if so
  }

  function solve(
    State storage state,
    uint packetId,
    bytes32 contents
  ) external {
    require(LibraryUtils.isIpfs(contents), 'Invalid contents');
    Change storage packet = state.changes[packetId];
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    require(packet.createdAt != 0, 'Packet does not exist');

    state.changeCounter.increment();
    uint solutionId = state.changeCounter.current();
    Change storage solution = state.changes[solutionId];
    require(solution.createdAt == 0, 'Solution exists');

    solution.changeType = ChangeType.SOLUTION;
    solution.createdAt = block.timestamp;
    solution.contents = contents;

    solution.uplink = packetId;
    packet.downlinks.push(solutionId);

    LibraryQA.onChange(state, solutionId);
    emit SolutionProposed(solutionId);
  }

  function claim(State storage state, uint id) public {
    Change storage c = state.changes[id];
    EnumerableMap.UintToUintMap storage debts = state.exits[msg.sender];
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
      require(
        state.taskNfts[nftId].changeId == id,
        'NFT is not for this transition'
      );

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
      if (debts.contains(state.taskNfts[nftId].assetId)) {
        debt = debts.get(state.taskNfts[nftId].assetId);
      }
      debts.set(state.taskNfts[nftId].assetId, debt + withdrawable);
    }
    emit Claimed(id, msg.sender);
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

  function enact(State storage state, uint id) public {
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
      // TODO emit mint event
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

    uint qaMedallionNftId = upsertNftId(state, packetId, QA_MEDALLION_ID);
    packet.mintQaMedallion(LibraryQA.getQa(state, packetId), qaMedallionNftId);
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

  function edit(
    State storage state,
    uint id,
    bytes32 editContents,
    bytes32 reason
  ) external {
    require(LibraryUtils.isIpfs(editContents), 'Invalid editContents hash');
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    Change storage change = state.changes[id];
    require(change.createdAt != 0, 'Change does not exist');
    require(change.changeType != ChangeType.PACKET, 'Cannot edit packets');

    state.changeCounter.increment();
    uint editId = state.changeCounter.current();
    Change storage editChange = state.changes[editId];
    require(editChange.createdAt == 0, 'Edit already exists');

    editChange.changeType = ChangeType.EDIT;
    editChange.createdAt = block.timestamp;
    editChange.contents = reason;
    editChange.editContents = editContents;
    editChange.uplink = id;
    change.edits.push(editId);
    upsertNftId(state, editId, CONTENT_ASSET_ID);

    LibraryQA.onChange(state, editId);
    emit ProposeEdit(id, editId);
  }

  function merge(
    State storage state,
    uint fromId,
    uint toId,
    bytes32 reason
  ) external {
    // TODO ensure this is just an edit on a packet - only packets can merge
    // merge the change of fromId to the change of toId for the given reason
    // require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    // Change storage from = state.changes[fromId];
    // Change storage to = state.changes[toId];
    // require(from.createdAt != 0, 'From change does not exist');
    // require(to.createdAt != 0, 'To change does not exist');
    // require(from.changeType == to.changeType, 'Change types must match');
    // require(from.changeType != ChangeType.MERGE, 'Cannot merge merges');
    // address fromQa = state.getQa(fromId);
    // address toQa = state.getQa(toId);
    // require(fromQa == toQa, 'QA must match');
  }
}
