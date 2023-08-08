// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';
import '@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol';
import './Types.sol';
import './IQA.sol';
import './IDreamcatcher.sol';
import './LibraryUtils.sol';
import './LibraryQA.sol';

interface IERC20 {
  function transferFrom(
    address from,
    address to,
    uint256 value
  ) external returns (bool);
}

/**
 * Convert assets into task completion, with quality oversight
 */

contract DreamEther is
  IERC1155,
  IERC1155Receiver,
  IERC1155MetadataURI,
  IDreamcatcher
{
  using Counters for Counters.Counter;
  using EnumerableMap for EnumerableMap.AddressToUintMap;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using EnumerableSet for EnumerableSet.AddressSet;

  Counters.Counter changeCounter;
  mapping(uint => Change) private changes;

  mapping(uint => address) public qaMap; // headerId => qa

  Counters.Counter nftCounter;
  mapping(uint => TaskNft) public taskNfts;
  TaskNftsLut taskNftsLut; // changeId => assetId => nftId

  Counters.Counter assetCounter;
  mapping(uint => Asset) public assets; // saves storage space
  AssetsLut assetsLut; // token => tokenId => assetId

  mapping(address => EnumerableMap.UintToUintMap) private exits;

  mapping(address => mapping(address => bool)) private approvals;

  function proposePacket(bytes32 contents, address qa) external {
    require(Utils.isIpfs(contents), 'Invalid header');
    require(qa.code.length > 0, 'QA must be a contract');
    changeCounter.increment();
    uint headerId = changeCounter.current();
    Change storage header = changes[headerId];
    require(header.createdAt == 0, 'Header already exists');

    header.changeType = ChangeType.HEADER;
    header.createdAt = block.timestamp;
    header.contents = contents;

    require(qaMap[headerId] == address(0), 'QA exists');
    qaMap[headerId] = qa;
    emit ProposedPacket(headerId);
  }

  function fund(uint id, Payment[] calldata payments) external payable {
    require(msg.value > 0 || payments.length > 0, 'Must send funds');
    Change storage change = changes[id];
    require(change.createdAt != 0, 'Change does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');

    change.fundingShares.holders.add(msg.sender);
    EnumerableMap.UintToUintMap storage funds = change.funds;
    EnumerableMap.UintToUintMap storage shares = change.fundingShares.balances[
      msg.sender
    ];
    if (msg.value > 0) {
      Payment memory eth = Payment(ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
      updateNftHoldings(id, funds, eth);
      updateNftHoldings(id, shares, eth);
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
        try
          token.safeTransferFrom(
            msg.sender,
            address(this),
            p.tokenId,
            p.amount,
            ''
          )
        {} catch {
          revert('Transfer failed');
        }
      }
      updateNftHoldings(id, funds, p);
      updateNftHoldings(id, shares, p);
    }
    delete change.fundingShares.defundWindows[msg.sender];
    emit FundedTransition(id, msg.sender);
  }

  function listChange(uint id) public {
    // by default, proposed packets are not listed on opensea
    // but this function allows them to be, it just costs
    // more gas plus some min qa payment to prevent spam
    // this function is also the same for listing packets
    // they always relate to a packetId

    // call the QA contract and get it to list
    IQA qa = IQA(qaMap[id]);
    require(qa.publishTransition(id));
  }

  function defundStart(uint id) external {
    Change storage change = changes[id];
    require(change.createdAt != 0, 'Change does not exist');
    require(change.fundingShares.defundWindows[msg.sender] == 0);

    change.fundingShares.defundWindows[msg.sender] = block.timestamp;
  }

  function defundStop(uint id) external {
    Change storage change = changes[id];
    require(change.createdAt != 0, 'Change does not exist');
    require(change.fundingShares.defundWindows[msg.sender] != 0);

    delete change.fundingShares.defundWindows[msg.sender];
  }

  function defund(uint id) public {
    Change storage change = changes[id];
    FundingShares storage shares = change.fundingShares;
    require(change.createdAt != 0, 'Change does not exist');
    require(shares.defundWindows[msg.sender] != 0);

    uint lockedTime = shares.defundWindows[msg.sender];
    uint elapsedTime = block.timestamp - lockedTime;
    require(elapsedTime > DEFUND_WINDOW, 'Defund timeout not reached');

    EnumerableMap.UintToUintMap storage holdings = shares.balances[msg.sender];
    uint[] memory nftIds = holdings.keys(); // nftId => amount
    EnumerableMap.UintToUintMap storage debts = exits[msg.sender];

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
      TaskNft memory nft = taskNfts[nftId];
      debts.set(nft.assetId, debts.get(nft.assetId) + amount);
    }

    delete shares.defundWindows[msg.sender];
    delete shares.balances[msg.sender];
    shares.holders.remove(msg.sender);

    // TODO make a token to allow spending of locked funds
    // TODO check if any solutions have passed threshold and revert if so
    // TODO ensure not in the dispute period, which means no defunding
  }

  function qaResolve(uint id, Share[] calldata shares) external {
    require(isQa(id), 'Must be transition QA');
    Change storage change = changes[id];
    LibraryQA.qaResolve(change, shares);
    emit QAResolved(id);
  }

  function qaReject(uint id, bytes32 reason) public {
    require(isQa(id), 'Must be transition QA');
    Change storage change = changes[id];
    LibraryQA.qaReject(change, reason);
    emit QARejected(id);
  }

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) external {
    Change storage c = changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.holders.length() != 0, 'Not solved');
    require(c.contentShares.concurrency.current() == 0, 'Not normalized');

    uint disputeId = disputeStart(id, reason);
    Change storage dispute = changes[disputeId];
    LibraryQA.allocateShares(dispute, s);
  }

  function disputeResolve(uint id, bytes32 reason) external {
    Change storage c = changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.holders.length() != 0, 'Not solved');
    require(c.contentShares.concurrency.current() == 0, 'Not normalized');

    disputeStart(id, reason);
  }

  function disputeRejection(uint id, bytes32 reason) external {
    Change storage c = changes[id];
    require(c.rejectionReason != 0, 'Not a rejection');

    disputeStart(id, reason);
  }

  function disputeStart(uint id, bytes32 reason) internal returns (uint) {
    require(Utils.isIpfs(reason), 'Invalid reason hash');
    Change storage c = changes[id];
    require(c.createdAt != 0, 'Change does not exist');
    require(c.disputeWindowStart > 0, 'Dispute window not started');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime < DISPUTE_WINDOW, 'Dispute window closed');
    require(c.changeType != ChangeType.PACKET, 'Cannot dispute packets');
    require(c.changeType != ChangeType.DISPUTE, 'Cannot dispute disputes');

    changeCounter.increment();
    uint disputeId = changeCounter.current();
    Change storage dispute = changes[disputeId];
    dispute.changeType = ChangeType.DISPUTE;
    dispute.createdAt = block.timestamp;
    dispute.contents = reason;
    dispute.uplink = id;

    c.downlinks.push(disputeId);

    emit ChangeDisputed(disputeId);
    return disputeId;
  }

  function disputeDismissed(uint id, bytes32 reason) external {
    require(isQa(id));
    require(Utils.isIpfs(reason), 'Invalid reason hash');
    Change storage dispute = changes[id];
    require(dispute.createdAt != 0, 'Change does not exist');
    require(dispute.changeType == ChangeType.DISPUTE, 'Not a dispute');

    dispute.rejectionReason = reason;
    emit DisputeDismissed(id);
  }

  function disputeUpheld(uint id) external {
    require(isQa(id));
    Change storage dispute = changes[id];
    require(dispute.createdAt != 0, 'Change does not exist');
    require(dispute.changeType == ChangeType.DISPUTE, 'Not a dispute');

    // TODO

    emit DisputeUpheld(id);
  }

  function enact(uint id) external {
    Change storage c = changes[id];
    require(c.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');
    // TODO check no other disputes are open too

    if (c.rejectionReason != 0) {
      if (c.changeType == ChangeType.SOLUTION) {
        enactPacket(c.uplink);
      }
      return;
    }

    if (c.changeType == ChangeType.HEADER) {
      require(c.uplink == 0, 'Header already enacted');
      changeCounter.increment();
      uint packetId = changeCounter.current();
      Change storage packet = changes[packetId];
      require(packet.createdAt == 0, 'Packet already exists');
      packet.changeType = ChangeType.PACKET;
      packet.createdAt = block.timestamp;
      packet.uplink = id;
      c.uplink = packetId;

      emit PacketCreated(packetId);
    } else if (c.changeType == ChangeType.SOLUTION) {
      emit SolutionAccepted(id);
      Change storage packet = changes[c.uplink];
      require(packet.createdAt != 0, 'Packet does not exist');
      require(packet.changeType == ChangeType.PACKET, 'Not a packet');

      packet.contentShares.concurrency.increment();
      mergeShareTable(packet.contentShares, c.contentShares);

      enactPacket(c.uplink);
    } else if (c.changeType == ChangeType.DISPUTE) {
      // TODO
    } else if (c.changeType == ChangeType.EDIT) {
      // TODO
    } else if (c.changeType == ChangeType.MERGE) {
      // TODO
    } else {
      if (c.changeType != ChangeType.PACKET) {
        revert('Invalid transition type');
      }
    }
  }

  function enactPacket(uint packetId) internal {
    Change storage packet = changes[packetId];
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    for (uint i = 0; i < packet.downlinks.length; i++) {
      uint solutionId = packet.downlinks[i];
      if (isPossible(solutionId)) {
        return; // this is not the final solution
      }
    }
    if (packet.contentShares.concurrency.current() == 0) {
      return; // packet already enacted
    }
    normalizeShares(packet.contentShares);
    emit PacketResolved(packetId);
  }

  function isPossible(uint id) internal view returns (bool) {
    Change storage solution = changes[id];
    require(solution.createdAt != 0, 'Change does not exist');
    require(solution.changeType == ChangeType.SOLUTION, 'Not a solution');

    if (solution.disputeWindowStart == 0) {
      Change storage packet = changes[solution.uplink];
      IQA qa = IQA(qaMap[packet.uplink]);
      return qa.isJudgeable(id);
    }
    uint elapsedTime = block.timestamp - solution.disputeWindowStart;
    return elapsedTime < DISPUTE_WINDOW;
    // TODO handle disputes being outstanding after the window closed
  }

  function solve(uint packetId, bytes32 contents) external {
    Change storage packet = changes[packetId];
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    require(packet.createdAt != 0, 'Packet does not exist');

    changeCounter.increment();
    uint solutionId = changeCounter.current();
    Change storage solution = changes[solutionId];
    require(solution.createdAt == 0, 'Solution exists');

    solution.changeType = ChangeType.SOLUTION;
    solution.createdAt = block.timestamp;
    solution.contents = contents;
    solution.uplink = packetId;
    packet.downlinks.push(solutionId);
    emit SolutionProposed(solutionId);
  }

  function merge(uint fromId, uint toId, bytes32 reasons) external {
    // merge the change of fromId to the change of toId for the given reasons
  }

  function edit(uint id, bytes32 contents, bytes32 reasons) external {
    // edit the given id with the new contents for the given reasons
  }

  function consume(
    uint packetId,
    uint solvers,
    uint funders,
    uint dependencies,
    Payment[] calldata payments
  ) external payable {
    require(solvers + funders + dependencies > 0);
    Change storage packet = changes[packetId];
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    // TODO buffer the payments so Dreamcatcher can disperse
    // people can send in funds that get dispersed to the contributors
    // can send in any erc20 or erc1155 that can be dispersed
    // this is the foundational training set we need
  }

  function isClaimable(uint id) public {
    // tests if a given change has any claimable funds for the sender
  }

  function claim(uint id) public {
    Change storage c = changes[id];
    require(c.createdAt != 0, 'Change does not exist');
    require(c.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');
    if (c.changeType == ChangeType.PACKET) {
      require(c.contentShares.holders.contains(msg.sender), 'Not a holder');
      require(c.contentShares.concurrency.current() == 0, 'Not normalized');
    } else {
      require(isQa(id), 'Must be transition QA');
    }

    uint[] memory nftIds = c.funds.keys();
    EnumerableMap.UintToUintMap storage balances = exits[msg.sender];

    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      uint total = c.funds.get(nftId);
      TaskNft memory nft = taskNfts[nftId];
      require(nft.changeId == id, 'NFT not for this transition');
      uint withdrawable = 0;

      if (c.changeType == ChangeType.PACKET) {
        uint share = c.contentShares.balances[msg.sender];
        require(share > 0, 'No share');
        uint claimableAmount = (total * share) / SHARES_DECIMALS;
        uint claimed = 0;
        if (c.contentShares.claims[msg.sender].contains(nftId)) {
          claimed = c.contentShares.claims[msg.sender].get(nftId);
        }
        if (claimableAmount > claimed) {
          withdrawable = claimableAmount - claimed;
          c.contentShares.claims[msg.sender].set(nftId, claimableAmount);
        }
      } else {
        // QA is claiming, so hand it all over
        withdrawable = total;
      }
      if (withdrawable == 0) {
        continue;
      }

      balances.set(nft.assetId, balances.get(nft.assetId) + withdrawable);

      if ((total - withdrawable) == 0) {
        c.funds.remove(nftId);
      } else {
        c.funds.set(nftId, total - withdrawable);
      }
    }
  }

  function exit() external {
    Payment[] memory payments = exitList();
    delete exits[msg.sender];

    for (uint i = 0; i < payments.length; i++) {
      Payment memory p = payments[i];
      exitPayment(p);
    }
  }

  function exitList() public view returns (Payment[] memory) {
    EnumerableMap.UintToUintMap storage debts = exits[msg.sender];
    uint[] memory assetIds = debts.keys();
    Payment[] memory payments = new Payment[](assetIds.length);
    for (uint i = 0; i < assetIds.length; i++) {
      uint assetId = assetIds[i];
      Asset memory asset = assets[assetId];
      payments[i] = Payment(
        asset.tokenContract,
        asset.tokenId,
        debts.get(assetId)
      );
    }
    return payments;
  }

  function exitPayment(Payment memory payment) internal returns (bool) {
    // TODO handle ERC20
    if (Utils.isEther(payment)) {
      payable(msg.sender).transfer(payment.amount);
    } else {
      IERC1155 token = IERC1155(payment.token);
      try
        token.safeTransferFrom(
          address(this),
          msg.sender,
          payment.tokenId,
          payment.amount,
          ''
        )
      {} catch {
        return false;
      }
    }
    return true;
  }

  function updateNftHoldings(
    uint changeId,
    EnumerableMap.UintToUintMap storage holdings,
    Payment memory payment
  ) internal {
    require(payment.amount > 0, 'Amount cannot be 0');

    uint assetId = assetsLut.lut[payment.token][payment.tokenId];
    if (assetId == 0) {
      assetCounter.increment();
      assetId = assetCounter.current();
      Asset storage asset = assets[assetId];
      asset.tokenContract = payment.token;
      asset.tokenId = payment.tokenId;
      assetsLut.lut[payment.token][payment.tokenId] = assetId;
    }

    uint nftId = taskNftsLut.lut[changeId][assetId];
    if (nftId == 0) {
      nftCounter.increment();
      nftId = nftCounter.current();
      TaskNft storage nft = taskNfts[nftId];
      nft.changeId = changeId;
      nft.assetId = assetId;
      taskNftsLut.lut[changeId][assetId] = nftId;
    }

    uint balance = 0;
    if (holdings.contains(nftId)) {
      balance = holdings.get(nftId);
    }
    holdings.set(nftId, balance + payment.amount);
  }

  function mergeShareTable(
    ContentShares storage into,
    ContentShares storage from
  ) internal {
    require(into.concurrency.current() > 0, 'into is not concurrent');
    require(from.concurrency.current() == 0, 'From is not final');

    uint holdersCount = from.holders.length();
    for (uint i = 0; i < holdersCount; i++) {
      address holder = from.holders.at(i);
      if (!into.holders.contains(holder)) {
        into.holders.add(holder);
      }
      into.balances[holder] += from.balances[holder];
    }
  }

  function normalizeShares(ContentShares storage contentShares) internal {
    uint concurrency = contentShares.concurrency.current();
    require(concurrency > 0);
    contentShares.concurrency.reset();
    uint holdersCount = contentShares.holders.length();
    uint total = 0;
    uint biggestBalance = 0;
    uint biggestIndex = 0;
    address[] memory toDelete;
    uint toDeleteIndex = 0;

    for (uint i = 0; i < holdersCount; i++) {
      address holder = contentShares.holders.at(i);
      uint balance = contentShares.balances[holder];
      if (balance > biggestBalance) {
        biggestBalance = balance;
        biggestIndex = i;
      }
      uint newBalance = balance / concurrency;
      if (newBalance == 0) {
        toDelete[toDeleteIndex++] = holder;
        continue;
      }
      contentShares.balances[holder] = newBalance;
      total += newBalance;
    }
    uint remainder = SHARES_DECIMALS - total;
    contentShares.balances[contentShares.holders.at(biggestIndex)] += remainder;
    for (uint i = 0; i < toDelete.length; i++) {
      address holder = toDelete[i];
      delete contentShares.balances[holder];
      contentShares.holders.remove(holder);
    }
  }

  function isQa(uint id) internal view returns (bool) {
    Change storage change = changes[id];
    if (change.changeType == ChangeType.HEADER) {
      return qaMap[id] == msg.sender;
    }
    if (change.changeType == ChangeType.SOLUTION) {
      return isQa(change.uplink);
    }
    if (change.changeType == ChangeType.PACKET) {
      return isQa(change.uplink);
    }
    if (change.changeType == ChangeType.DISPUTE) {
      return isQa(change.uplink);
    }
    revert('Invalid change');
  }

  function getIpfsCid(uint id) external view returns (string memory) {
    // TODO https://github.com/storyicon/base58-solidity
    Change storage c = changes[id];
    return string(abi.encodePacked('todo ', c.contents));
  }

  event ProposedPacket(uint headerId);
  event FundedTransition(uint transitionHash, address owner);
  event QAResolved(uint transitionHash);
  event QARejected(uint transitionHash);
  event SolutionAccepted(uint transitionHash);
  event PacketCreated(uint packetId);
  event SolutionProposed(uint solutionId);
  event PacketResolved(uint packetId);
  event ChangeDisputed(uint disputeId);
  event DisputeDismissed(uint disputeId);
  event DisputeUpheld(uint disputeId);

  // to notify opensea to halt trading
  event Locked(uint256 tokenId);
  event Unlocked(uint256 tokenId);
  // or, if the number of events is high
  event Staked(address indexed user, uint256[] tokenIds, uint256 stakeTime);
  event Unstaked(address indexed user, uint256[] tokenIds);

  function balanceOf(address account, uint256 id) public view returns (uint) {
    TaskNft memory nft = taskNfts[id];
    Change storage change = changes[nft.changeId];
    if (change.funds.contains(id)) {
      if (change.fundingShares.holders.contains(account)) {
        return change.fundingShares.balances[account].get(id);
      }
      return 0;
    } else if (change.contentShares.holders.contains(account)) {
      // TODO handle id being part of an open share dispute
      return change.contentShares.balances[account];
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
    require(msg.sender != operator, 'Setting approval status for self');
    approvals[msg.sender][operator] = approved;
    emit ApprovalForAll(msg.sender, operator, approved);
  }

  function isApprovedForAll(
    address account,
    address operator
  ) external view returns (bool) {
    return approvals[account][operator];
  }

  function safeTransferFrom(
    address from,
    address to,
    uint256 id,
    uint256 amount,
    bytes calldata data
  ) external {
    // TODO if you haven't withdrawn it, then you can't transfer it

    TaskNft memory nft = taskNfts[id];
    Change storage change = changes[nft.changeId];
    if (change.funds.contains(id)) {
      require(change.fundingShares.holders.contains(from));
      require(change.fundingShares.defundWindows[to] == 0, 'to is defunding');

      uint fromBalance = change.fundingShares.balances[from].get(id);
      require(fromBalance >= amount, 'Insufficient funds');
      uint fromRemaining = fromBalance - amount;
      if (fromRemaining == 0) {
        change.fundingShares.balances[from].remove(id);
        change.fundingShares.holders.remove(from);
        delete change.fundingShares.defundWindows[from];
      } else {
        change.fundingShares.balances[from].set(id, fromRemaining);
      }

      // TODO check if to is a contract and call onERC1155Received
      if (!change.fundingShares.holders.contains(to)) {
        change.fundingShares.holders.add(to);
      }
      uint toBalance = change.fundingShares.balances[to].get(id);
      change.fundingShares.balances[to].set(id, toBalance + amount);
    } else if (change.contentShares.holders.contains(from)) {
      // TODO handle id being part of an open share dispute
      require(change.contentShares.concurrency.current() == 0, 'Unnormalized');
      uint fromBalance = change.contentShares.balances[from];
      require(fromBalance >= amount, 'Insufficient funds');
      uint fromRemaining = fromBalance - amount;
      // move the claims over too
      if (fromRemaining == 0) {
        change.contentShares.holders.remove(from);
        delete change.contentShares.balances[from];
        delete change.contentShares.claims[from];
      } else {
        change.contentShares.balances[from] = fromRemaining;
      }
    }
  }

  function safeBatchTransferFrom(
    address from,
    address to,
    uint256[] calldata ids,
    uint256[] calldata amounts,
    bytes calldata data
  ) external {}

  function supportsInterface(bytes4 interfaceId) external view returns (bool) {}

  // ERC1155Supply extension
  function totalSupply(uint256 id) public view returns (uint256) {}

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
  function uri(uint256 id) external view returns (string memory) {}
}
