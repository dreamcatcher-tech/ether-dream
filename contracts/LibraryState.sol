// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;

import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './Types.sol';
import './Counters.sol';
import './IDreamcatcher.sol';
import './LibraryChange.sol';
import './LibraryQA.sol';
import './LibraryFilter.sol';

library LibraryState {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableSet for EnumerableSet.UintSet;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using EnumerableMap for EnumerableMap.AddressToUintMap;
  using Counters for Counters.Counter;
  using LibraryChange for Change;
  using LibraryFilter for AssetFilter;
  using BitMaps for BitMaps.BitMap;

  event PacketCreated(uint packetId);
  event SolutionAccepted(uint transitionHash);
  event PacketResolved(uint packetId);
  event ProposedPacket(uint headerId, uint disputeWindowSizeSeconds);
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

    header.disputeWindowSize = LibraryQA.onChange(state, headerId);
    emit ProposedPacket(headerId, header.disputeWindowSize);
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

  function defundStart(State storage state, uint id, uint windowMs) public {
    Change storage change = state.changes[id];
    require(change.isOpen(), 'Change is not open for defunding');
    require(change.fundingShares.defundWindows[msg.sender] == 0, 'Started');
    // TODO get the defund window by walking the changes
    require(windowMs >= DEFUND_WINDOW, 'Window too small');
    change.fundingShares.defundWindows[msg.sender] = block.timestamp + windowMs;
    emit DefundStarted(id, msg.sender);
  }

  function defundStop(State storage state, uint id) external {
    Change storage change = state.changes[id];
    require(change.isOpen(), 'Change is not open for defunding');
    require(change.fundingShares.defundWindows[msg.sender] != 0, 'Not started');

    delete change.fundingShares.defundWindows[msg.sender];
    emit DefundStopped(id, msg.sender);
  }

  function defund(State storage state, uint id) public {
    Change storage change = state.changes[id];
    require(change.isOpen(), 'Change is not open for defunding');
    FundingShares storage funding = change.fundingShares;
    require(funding.defundWindows[msg.sender] != 0, 'Defund not started');
    require(funding.defundWindows[msg.sender] < block.timestamp, 'Too early');
    require(funding.holders.contains(msg.sender), 'Not a holder');

    Exits storage exits = state.exits[msg.sender];

    EnumerableMap.UintToUintMap storage holdings = funding.balances[msg.sender];
    uint length = holdings.length();
    uint[] memory nftIds;
    for (uint i = 0; i < length; i++) {
      (uint nftId, uint amount) = holdings.at(i);
      nftIds[i] = nftId;
      // TODO emit burn event
      uint total = change.funds.get(nftId);
      uint newTotal = total - amount;
      if (newTotal == 0) {
        change.funds.remove(nftId);
      } else {
        change.funds.set(nftId, newTotal);
      }
      uint balance = 0;
      if (exits.balances.contains(state.nfts[nftId].assetId)) {
        balance = exits.balances.get(state.nfts[nftId].assetId);
      }
      exits.balances.set(state.nfts[nftId].assetId, balance + amount);
    }
    for (uint i = 0; i < nftIds.length; i++) {
      holdings.remove(nftIds[i]);
    }
    delete funding.defundWindows[msg.sender];
    delete funding.balances[msg.sender];
    funding.holders.remove(msg.sender);
    emit Defunded(id, msg.sender);

    // TODO check if any solutions have passed threshold and revert if so
  }

  function proposeSolution(
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

  function claim(State storage state, uint filterId) public {
    EnumerableSet.UintSet storage ids = state.claimables[msg.sender];
    require(ids.length() > 0, 'No claims to make');
    uint length = ids.length();
    for (uint i = length; i > 0; i--) {
      uint id = ids.at(i - 1);
      Change storage change = state.changes[id];
      if (change.changeType == ChangeType.PACKET) {
        claimPacket(state, id, filterId);
      } else {
        LibraryQA.claimMeta(state, id, filterId);
      }
      ids.remove(id);
      if (gasleft() < GAS_PER_CLAIMABLE) {
        // TODO sample how much gas it costs worst case
        break;
      }
    }
  }

  function claimPacket(State storage state, uint id, uint filterId) internal {
    Change storage c = state.changes[id];
    assert(c.changeType == ChangeType.PACKET);
    bool claimed = c.contentShares.claimed.get(uint(uint160(msg.sender)));
    require(claimed == false, 'Already claimed');
    Exits storage exits = state.exits[msg.sender];
    require(c.isPacketSolved());
    require(c.contentShares.solvers.contains(msg.sender), 'Not a holder');
    require(c.funds.length() > 0, 'No funds to claim');
    AssetFilter storage filter = state.filters[filterId];
    assert(filter.isValid());

    uint shares = c.contentShares.solvers.get(msg.sender);
    assert(shares > 0);

    uint length = c.funds.length();
    for (uint i = 0; i < length; i++) {
      (uint nftId, uint amount) = c.funds.at(i);
      if (!filter.isAllowed(state.nfts[nftId].assetId, state)) {
        continue;
      }
      assert(state.nfts[nftId].changeId == id);

      uint withdrawable;
      // TODO remove bigdog by requiring shares to be ordered
      if (c.contentShares.bigdog == msg.sender) {
        uint others = 0;
        for (uint j = 0; j < c.contentShares.solvers.length(); j++) {
          (address holder, uint share) = c.contentShares.solvers.at(j);
          if (holder == msg.sender) {
            continue;
          }
          others += (amount * share) / SHARES_TOTAL;
        }
        // others is how much of the nft went to others
        withdrawable = amount - others;
      } else {
        withdrawable = (amount * shares) / SHARES_TOTAL;
      }
      if (withdrawable == 0) {
        continue;
      }
      uint balance = 0;
      if (exits.balances.contains(state.nfts[nftId].assetId)) {
        balance = exits.balances.get(state.nfts[nftId].assetId);
      }
      exits.balances.set(state.nfts[nftId].assetId, balance + withdrawable);
    }
    c.contentShares.claimed.set(uint(uint160(msg.sender)));
  }

  function enact(State storage state, uint changeId) public {
    Change storage c = state.changes[changeId];
    require(c.disputeWindowEnd > 0, 'Not passed by QA');
    require(c.disputeWindowEnd < block.timestamp, 'Dispute window open');
    require(c.changeType != ChangeType.DISPUTE, 'Cannot enact disputes');
    require(c.changeType != ChangeType.PACKET, 'Cannot enact packets');
    // TODO check no other disputes are open too

    c.isEnacted = true;

    if (c.rejectionReason != 0) {
      if (c.changeType == ChangeType.SOLUTION) {
        enactPacket(c.uplink, state);
      }
      return;
    }

    upsertNftId(state, changeId, CONTENT_ASSET_ID);

    if (c.changeType == ChangeType.HEADER) {
      require(c.uplink == 0, 'Header already enacted');
      state.changeCounter.increment();
      uint packetId = state.changeCounter.current();
      Change storage packet = state.changes[packetId];
      assert(packet.createdAt == 0);
      packet.changeType = ChangeType.PACKET;
      packet.createdAt = block.timestamp;
      packet.uplink = changeId;
      c.uplink = packetId;
      packet.disputeWindowSize = LibraryQA.onChange(state, packetId);
      emit PacketCreated(packetId);
    } else if (c.changeType == ChangeType.SOLUTION) {
      emit SolutionAccepted(changeId);
      Change storage packet = state.changes[c.uplink];
      assert(packet.createdAt != 0);
      assert(packet.changeType == ChangeType.PACKET);

      enactPacket(c.uplink, state);
    } else if (c.changeType == ChangeType.EDIT) {
      // TODO
    } else if (c.changeType == ChangeType.MERGE) {
      // TODO
    } else {
      revert('Invalid transition type');
    }

    if (c.funds.length() == 0) {
      return;
    }

    if (c.changeType != ChangeType.PACKET) {
      // TODO claim everything for QA
    }
  }

  function enactPacket(uint packetId, State storage state) internal {
    Change storage packet = state.changes[packetId];
    assert(packet.createdAt != 0);
    assert(packet.changeType == ChangeType.PACKET);
    assert(packet.contentShares.traders.length() == 0);
    assert(!packet.isEnacted);

    IQA qa = IQA(LibraryQA.getQa(state, packetId));
    for (uint i = 0; i < packet.downlinks.length; i++) {
      uint solutionId = packet.downlinks[i];
      if (isFeasible(solutionId, qa, state)) {
        return; // this is not the final solution
      }
    }
    packet.slurpShares(state.changes);

    // TODO mark all solvers as being able to claim this packet

    uint qaMedallionNftId = upsertNftId(state, packetId, QA_MEDALLION_ASSET_ID);
    packet.mintQaMedallion(LibraryQA.getQa(state, packetId), qaMedallionNftId);
    upsertNftId(state, packetId, CONTENT_ASSET_ID);
    packet.isEnacted = true;
    emit PacketResolved(packetId);
  }

  function isFeasible(
    uint id,
    IQA qa,
    State storage state
  ) internal view returns (bool) {
    Change storage solution = state.changes[id];
    assert(solution.createdAt != 0);
    assert(solution.changeType == ChangeType.SOLUTION);

    if (solution.disputeWindowEnd == 0) {
      // has not been passed by QA yet, but is eligible
      return qa.isJudgeable(id);
    }
    if (solution.disputeWindowEnd >= block.timestamp) {
      // until the dispute window is closed the solution is still possible
      return true;
    }

    // TODO handle disputes being outstanding after the window closed
    // if there is an active dispute, honour that as it still might uphold

    if (LibraryQA.isDisputed(solution)) {
      return true;
    }
    if (solution.rejectionReason == 0) {
      return false;
    }
    // if this is not enacted, then it is feasible
    return !solution.isEnacted;
  }

  function upsertNftId(
    State storage state,
    uint changeId,
    uint assetId
  ) internal returns (uint) {
    uint nftId = state.nftsLut.lut[changeId][assetId];
    if (nftId == 0) {
      state.nftCounter.increment();
      nftId = state.nftCounter.current();
      // TODO emit mint event
      Nft storage nft = state.nfts[nftId];
      nft.changeId = changeId;
      nft.assetId = assetId;
      state.nftsLut.lut[changeId][assetId] = nftId;
    }
    return nftId;
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

  function proposeEdit(
    State storage state,
    uint id,
    bytes32 editContents,
    bytes32 reason
  ) external {
    require(LibraryUtils.isIpfs(editContents), 'Invalid editContents hash');
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    Change storage change = state.changes[id];
    require(change.createdAt != 0, 'Change does not exist');
    require(change.changeType != ChangeType.PACKET, 'Cannot edit Packets');
    require(change.changeType != ChangeType.EDIT, 'Cannot edit Edits');

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

  function proposeMerge(
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
