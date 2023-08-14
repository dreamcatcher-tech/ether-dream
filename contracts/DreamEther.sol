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
import './LibraryChanges.sol';

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
  using LibraryChanges for Change;

  Counters.Counter changeCounter;
  mapping(uint => Change) private changes;

  mapping(uint => address) public qaMap; // headerId => qa

  Counters.Counter nftCounter;
  mapping(uint => TaskNft) public taskNfts;
  TaskNftsLut taskNftsLut; // changeId => assetId => nftId

  Counters.Counter assetCounter;
  mapping(uint => Asset) public assets; // saves storage space
  AssetsLut assetsLut; // tokenAddress => tokenId => assetId

  mapping(address => EnumerableMap.UintToUintMap) private exits;

  mapping(address => mapping(address => Approval)) private approvals;

  function proposePacket(bytes32 contents, address qa) external {
    require(LibraryUtils.isIpfs(contents), 'Invalid header');
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
    upsertNftId(headerId, CONTENT_ASSET_ID);
    emit ProposedPacket(headerId);
  }

  function fund(uint id, Payment[] calldata payments) external payable {
    require(msg.value > 0 || payments.length > 0, 'Must send funds');
    Change storage change = changes[id];
    require(change.createdAt != 0, 'Change does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');
    // TODO consume exits balance first

    if (!change.fundingShares.holders.contains(msg.sender)) {
      change.fundingShares.holders.add(msg.sender);
    }
    if (msg.value > 0) {
      Payment memory eth = Payment(ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
      updateNftHoldings(id, change.funds, eth);
      updateNftHoldings(id, change.fundingShares.balances[msg.sender], eth);
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
      updateNftHoldings(id, change.funds, p);
      updateNftHoldings(id, change.fundingShares.balances[msg.sender], p);
    }
    delete change.fundingShares.defundWindows[msg.sender];
    emit FundedTransition(id, msg.sender);
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
    require(change.createdAt != 0, 'Change does not exist');
    FundingShares storage shares = change.fundingShares;
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
      uint debt = 0;
      if (debts.contains(nft.assetId)) {
        debt = debts.get(nft.assetId);
      }
      debts.set(nft.assetId, debt + amount);
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

    uint disputeId = disputeStart(id, reason);
    Change storage dispute = changes[disputeId];
    LibraryQA.allocateShares(dispute, s);
  }

  function disputeResolve(uint id, bytes32 reason) external {
    Change storage c = changes[id];
    require(c.rejectionReason == 0, 'Not a resolve');
    require(c.contentShares.holders.length() != 0, 'Not solved');

    disputeStart(id, reason);
  }

  function disputeRejection(uint id, bytes32 reason) external {
    Change storage c = changes[id];
    require(c.rejectionReason != 0, 'Not a rejection');

    disputeStart(id, reason);
  }

  function disputeStart(uint id, bytes32 reason) internal returns (uint) {
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
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

  function qaDisputeDismissed(uint id, bytes32 reason) external {
    require(isQa(id));
    require(LibraryUtils.isIpfs(reason), 'Invalid reason hash');
    Change storage dispute = changes[id];
    require(dispute.createdAt != 0, 'Change does not exist');
    require(dispute.changeType == ChangeType.DISPUTE, 'Not a dispute');

    dispute.rejectionReason = reason;
    emit DisputeDismissed(id);
  }

  function qaDisputeUpheld(uint id) external {
    require(isQa(id));
    Change storage dispute = changes[id];
    require(dispute.createdAt != 0, 'Change does not exist');
    require(dispute.changeType == ChangeType.DISPUTE, 'Not a dispute');

    // TODO if shares, change the share allocations
    // TODO if resolve, then undo the resolve, change back to open
    // TODO if reject, then undo the reject, change back to open
    // TODO handle concurrent disputes

    // mint dispute nfts
    emit DisputeUpheld(id);
  }

  function enact(uint id) external {
    Change storage c = changes[id];
    require(c.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');
    require(c.changeType != ChangeType.DISPUTE, 'Cannot enact disputes');
    require(c.changeType != ChangeType.PACKET, 'Cannot enact packets');
    // TODO check no other disputes are open too

    if (c.rejectionReason != 0) {
      if (c.changeType == ChangeType.SOLUTION) {
        enactPacket(c.uplink);
      }
      return;
    }

    upsertNftId(id, CONTENT_ASSET_ID);

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

      enactPacket(c.uplink);
    } else if (c.changeType == ChangeType.EDIT) {
      // TODO
    } else if (c.changeType == ChangeType.MERGE) {
      // TODO
    } else {
      revert('Invalid transition type');
    }
  }

  function enactPacket(uint packetId) internal {
    Change storage packet = changes[packetId];
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    require(packet.contentShares.holders.length() == 0, 'Already enacted');

    for (uint i = 0; i < packet.downlinks.length; i++) {
      uint solutionId = packet.downlinks[i];
      if (isPossible(solutionId)) {
        return; // this is not the final solution
      }
    }
    mergeShares(packet);
    upsertNftId(packetId, CONTENT_ASSET_ID);
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

  function isTransferrable(
    Change storage c,
    address holder
  ) internal view returns (bool) {
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

  function claim(uint id) public {
    Change storage c = changes[id];
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
    EnumerableMap.UintToUintMap storage debts = exits[msg.sender];

    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      TaskNft memory nft = taskNfts[nftId];
      require(nft.changeId == id, 'NFT is not for this transition');

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
      if (debts.contains(nft.assetId)) {
        debt = debts.get(nft.assetId);
      }
      debts.set(nft.assetId, debt + withdrawable);
    }
    emit Claimed(id, msg.sender, unclaimed);
  }

  function claimQa(uint id) external {
    require(isQa(id), 'Must be transition QA');
    Change storage change = changes[id];
    require(change.changeType != ChangeType.PACKET);
    require(change.createdAt != 0, 'Change does not exist');
    require(change.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - change.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');

    uint[] memory nftIds = change.funds.keys();
    EnumerableMap.UintToUintMap storage debts = exits[msg.sender];

    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      uint totalFunds = change.funds.get(nftId);
      TaskNft memory nft = taskNfts[nftId];
      require(nft.changeId == id, 'NFT not for this transition');

      uint debt = 0;
      if (debts.contains(nft.assetId)) {
        debt = debts.get(nft.assetId);
      }
      debts.set(nft.assetId, debt + totalFunds);
      change.funds.remove(nftId);
    }
  }

  function exitBurn(uint assetId) external {
    // used when the exit is problematic
    require(exits[msg.sender].contains(assetId), 'No exit for asset');
    exits[msg.sender].remove(assetId);
  }

  function exit() external {
    Payment[] memory payments = exitList();
    delete exits[msg.sender];

    for (uint i = 0; i < payments.length; i++) {
      Payment memory p = payments[i];
      exitSingle(p);
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

  function exitSingle(Payment memory payment) public returns (bool) {
    // TODO handle ERC20
    if (LibraryUtils.isEther(payment)) {
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

  function enter(Payment[] calldata payments) external {
    for (uint i = 0; i < payments.length; i++) {
      Payment memory payment = payments[i];
      require(payment.amount > 0, 'Amount cannot be 0');
      require(payment.token != address(0), 'Token address invalid');
      if (payment.tokenId == 0) {
        // TODO handle erc1155 with a tokenId of zero
        IERC20 token = IERC20(payment.token);
        require(token.transferFrom(msg.sender, address(this), payment.amount));
      } else {
        IERC1155 token = IERC1155(payment.token);
        try
          token.safeTransferFrom(
            msg.sender,
            address(this),
            payment.tokenId,
            payment.amount,
            ''
          )
        {} catch {
          revert('Transfer failed');
        }
      }
      uint assetId = upsertAssetId(payment);
      EnumerableMap.UintToUintMap storage debts = exits[msg.sender];
      uint debt = 0;
      if (debts.contains(assetId)) {
        debt = debts.get(assetId);
      }
      debts.set(assetId, debt + payment.amount);
    }
  }

  function upsertAssetId(Payment memory payment) internal returns (uint) {
    uint assetId = assetsLut.lut[payment.token][payment.tokenId];
    if (assetId == 0) {
      assetCounter.increment();
      assetId = assetCounter.current();
      Asset storage asset = assets[assetId];
      asset.tokenContract = payment.token;
      asset.tokenId = payment.tokenId;
      assetsLut.lut[payment.token][payment.tokenId] = assetId;
    }
    return assetId;
  }

  function updateNftHoldings(
    uint changeId,
    EnumerableMap.UintToUintMap storage holdings,
    Payment memory payment
  ) internal {
    require(payment.amount > 0, 'Amount cannot be 0');

    uint assetId = upsertAssetId(payment);
    uint nftId = upsertNftId(changeId, assetId);
    uint balance = 0;
    if (holdings.contains(nftId)) {
      balance = holdings.get(nftId);
    }
    holdings.set(nftId, balance + payment.amount);
  }

  function mergeShares(Change storage packet) internal {
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

  function upsertNftId(uint changeId, uint assetId) internal returns (uint) {
    uint nftId = taskNftsLut.lut[changeId][assetId];
    if (nftId == 0) {
      nftCounter.increment();
      nftId = nftCounter.current();
      TaskNft storage nft = taskNfts[nftId];
      nft.changeId = changeId;
      nft.assetId = assetId;
      taskNftsLut.lut[changeId][assetId] = nftId;
    }
    return nftId;
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
  event Claimed(uint packetId, address holder, uint sharesClaimed);

  // to notify opensea to halt trading
  event Locked(uint256 tokenId);
  event Unlocked(uint256 tokenId);
  // or, if the number of events is high
  event Staked(address indexed user, uint256[] tokenIds, uint256 stakeTime);
  event Unstaked(address indexed user, uint256[] tokenIds);

  function balanceOf(address account, uint256 id) public view returns (uint) {
    TaskNft memory nft = taskNfts[id];
    require(nft.changeId != 0, 'NFT does not exist');
    Change storage change = changes[nft.changeId];
    if (nft.assetId == CONTENT_ASSET_ID) {
      if (change.contentShares.holders.contains(account)) {
        // TODO handle id being part of an open share dispute
        return change.contentShares.balances[account];
      }
      return 0;
    }
    if (change.fundingShares.holders.contains(account)) {
      if (change.fundingShares.balances[account].contains(id)) {
        return change.fundingShares.balances[account].get(id);
      }
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
    require(operator != address(0));
    require(msg.sender != operator, 'Setting approval status for self');
    Approval positive = operator == OPEN_SEA
      ? Approval.NONE
      : Approval.APPROVED;
    Approval negative = operator == OPEN_SEA
      ? Approval.REJECTED
      : Approval.NONE;

    Approval approval = approved ? positive : negative;
    approvals[msg.sender][operator] = approval;
    emit ApprovalForAll(msg.sender, operator, approved);
  }

  function isApprovedForAll(
    address account,
    address operator
  ) public view returns (bool) {
    if (account == operator) {
      return true;
    }
    Approval approval = approvals[account][operator];
    if (operator == OPEN_SEA) {
      return approval == Approval.NONE;
    } else {
      return approval == Approval.APPROVED;
    }
  }

  function safeTransferFrom(
    address from,
    address to,
    uint256 nftId,
    uint256 amount,
    bytes calldata data
  ) public {
    require(data.length == 0, 'Data not supported');
    require(isApprovedForAll(from, msg.sender), 'Not approved');
    require(balanceOf(from, nftId) >= amount, 'Insufficient funds');

    TaskNft memory nft = taskNfts[nftId];
    Change storage change = changes[nft.changeId];

    if (nft.assetId == CONTENT_ASSET_ID) {
      require(isTransferrable(change, from), 'Not transferrable');
      // TODO handle id being part of an open share dispute
      uint fromBalance = change.contentShares.balances[from];
      uint fromRemaining = fromBalance - amount;
      if (fromRemaining == 0) {
        change.contentShares.holders.remove(from);
        delete change.contentShares.balances[from];
        delete change.contentShares.claims[from];
      } else {
        change.contentShares.balances[from] = fromRemaining;
        change.contentShares.claims[from] = fromRemaining;
      }
      if (!change.contentShares.holders.contains(to)) {
        change.contentShares.holders.add(to);
      }
      change.contentShares.balances[to] += amount;
      change.contentShares.claims[to] += amount;
    } else {
      require(change.fundingShares.holders.contains(from));
      require(change.fundingShares.defundWindows[to] == 0, 'to is defunding');

      uint fromBalance = change.fundingShares.balances[from].get(nftId);
      uint fromRemaining = fromBalance - amount;
      if (fromRemaining == 0) {
        change.fundingShares.balances[from].remove(nftId);
        if (change.fundingShares.balances[from].length() == 0) {
          change.fundingShares.holders.remove(from);
          delete change.fundingShares.balances[from];
          delete change.fundingShares.defundWindows[from];
        }
      } else {
        change.fundingShares.balances[from].set(nftId, fromRemaining);
      }

      // TODO check if to is a contract and call onERC1155Received
      if (!change.fundingShares.holders.contains(to)) {
        change.fundingShares.holders.add(to);
      }
      uint toBalance = 0;
      if (change.fundingShares.balances[to].contains(nftId)) {
        toBalance = change.fundingShares.balances[to].get(nftId);
      }
      change.fundingShares.balances[to].set(nftId, toBalance + amount);
    }
  }

  function safeBatchTransferFrom(
    address from,
    address to,
    uint[] calldata ids,
    uint[] calldata amounts,
    bytes calldata data
  ) external {
    for (uint i = 0; i < ids.length; i++) {
      safeTransferFrom(from, to, ids[i], amounts[i], data);
    }
  }

  function supportsInterface(bytes4 interfaceId) external view returns (bool) {}

  // ERC1155Supply extension
  function totalSupply(uint id) public view returns (uint) {
    TaskNft memory nft = taskNfts[id];
    require(nft.changeId != 0, 'NFT does not exist');
    if (nft.assetId == CONTENT_ASSET_ID) {
      return SHARES_TOTAL;
    }
    Change storage change = changes[nft.changeId];
    require(change.funds.contains(id), 'NFT not found');
    return change.funds.get(id);
  }

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
  function uri(uint256 id) external view returns (string memory) {
    TaskNft memory nft = taskNfts[id];
    require(nft.changeId != 0, 'NFT does not exist');
    Change storage c = changes[nft.changeId];
    string memory suffix = '';
    if (nft.assetId == CONTENT_ASSET_ID) {
      if (c.changeType == ChangeType.PACKET) {
        suffix = 'PACKET';
      } else if (c.changeType == ChangeType.DISPUTE) {
        suffix = 'DISPUTE';
      } else {
        suffix = 'META';
      }
    } else {
      if (c.changeType == ChangeType.PACKET) {
        suffix = 'PACKET_FUNDING';
      } else if (c.changeType == ChangeType.DISPUTE) {
        suffix = 'DISPUTE_FUNDING';
      } else {
        suffix = 'META_FUNDING';
      }
    }

    // TODO figure out how to know if it was QA
    return LibraryUtils.toCIDv0(c.contents, suffix);
  }
}
