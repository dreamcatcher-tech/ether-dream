// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';
import '@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol';
import './Types.sol';
import './IQA.sol';
import './IDreamcatcher.sol';

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

  function proposePacket(bytes32 contents, address qa) external {
    require(isIpfs(contents), 'Invalid header');
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
    require(change.createdAt != 0, 'Transition does not exist');
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
      IERC20 token = IERC20(p.token);
      require(token.transferFrom(msg.sender, address(this), p.amount));
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
    require(change.createdAt != 0, 'Transition does not exist');
    require(change.fundingShares.defundWindows[msg.sender] == 0);

    change.fundingShares.defundWindows[msg.sender] = block.timestamp;
  }

  function defund(uint id) public {
    Change storage change = changes[id];
    FundingShares storage shares = change.fundingShares;
    require(change.createdAt != 0, 'Transition does not exist');
    require(shares.defundWindows[msg.sender] != 0);

    uint lockedTime = shares.defundWindows[msg.sender];
    uint elapsedTime = block.timestamp - lockedTime;
    require(elapsedTime > DEFUND_WINDOW, 'Defund timeout not reached');

    EnumerableMap.UintToUintMap storage holdings = shares.balances[msg.sender];
    uint[] memory nftIds = holdings.keys(); // nftId => amount
    Payment[] memory withdrawals;
    uint wid = 0;
    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      uint amount = holdings.get(nftId);
      // TODO emit burn event
      holdings.remove(nftId);
      uint total = change.funds.get(nftId);
      uint newTotal = total - amount;
      if (newTotal == 0) {
        change.funds.remove(nftId);
      } else {
        change.funds.set(nftId, newTotal);
      }
      TaskNft memory nft = taskNfts[nftId];
      Asset memory asset = assets[nft.assetId];
      withdrawals[wid++] = Payment(asset.tokenContract, asset.tokenId, amount);
    }

    delete shares.defundWindows[msg.sender];
    delete shares.balances[msg.sender];
    shares.holders.remove(msg.sender);

    // TODO handle misbehaving contracts that might take all your gas
    // possibly move to a holding area and allow withdrawal later of
    // specific assets, letting you pool your balance
    for (uint i = 0; i < withdrawals.length; i++) {
      Payment memory p = withdrawals[i];
      // TODO handle ERC20
      if (isEther(p)) {
        payable(msg.sender).transfer(p.amount);
      } else {
        IERC1155 token = IERC1155(p.token);
        try
          token.safeTransferFrom(
            address(this),
            msg.sender,
            p.tokenId,
            p.amount,
            ''
          )
        {} catch {}
      }
    }

    // TODO make a token to allow spending of locked funds
    // TODO check if any solutions have passed threshold and revert if so
    // TODO ensure not in the dispute period, which means no defunding
  }

  function qaResolve(uint id, Share[] calldata shares) external {
    require(shares.length > 0, 'Must provide shares');

    Change storage c = qaStart(id);
    require(c.contentShares.holders.length() == 0);
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
    emit QAResolved(id);
  }

  function qaReject(uint id, bytes32 reason) public {
    require(isIpfs(reason), 'Invalid rejection hash');

    Change storage c = qaStart(id);
    c.rejectionReason = reason;
    emit QARejected(id);
  }

  function qaStart(uint id) internal returns (Change storage) {
    Change storage change = changes[id];
    require(change.createdAt != 0, 'Transition does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');
    require(isQa(id), 'Must be transition QA');

    change.disputeWindowStart = block.timestamp;
    return change;
  }

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) external {
    // used if the resolve is fine, but the shares are off.
    // passing this change will modify the shares split
    // and resolve the disputed change allowing finalization
  }

  function disputeResolve(uint id, bytes32 reason) external {
    // the resolve should have been a rejection
    // will halt the transition, return the qa funds, and await
  }

  function disputeRejection(uint id, bytes32 reason) external {
    require(isIpfs(reason), 'Invalid reason hash');
    Change storage c = changes[id];
    require(c.createdAt != 0, 'Transition does not exist');
    require(c.rejectionReason != 0, 'Not a rejection');
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

    emit ChangeDisputed(disputeId);
  }

  function enact(uint id) external {
    Change storage c = changes[id];
    require(c.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');
    // TODO check no other disputes are open too

    if (c.changeType == ChangeType.HEADER) {
      require(c.downlinks.length == 0, 'Header already enacted');
      changeCounter.increment();
      uint packetId = changeCounter.current();
      Change storage packet = changes[packetId];
      require(packet.createdAt == 0, 'Packet already exists');
      packet.changeType = ChangeType.PACKET;
      packet.createdAt = block.timestamp;
      packet.uplink = id;
      c.downlinks.push(packetId);

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

  function enactPacket(uint packetId) public {
    // may be called externally if a packet gets stuck due to isPossible()
    // TODO remove this function and make it automatic
    Change storage packet = changes[packetId];
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    for (uint i = 0; i < packet.downlinks.length; i++) {
      uint solutionId = packet.downlinks[i];
      Change storage solution = changes[solutionId];
      if (isPossible(solution)) {
        return; // this is not the final solution
      }
    }
    normalizeShares(packet.contentShares);
    emit PacketResolved(packetId);
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

  function consume(uint packetId, uint[] calldata ratios) external payable {
    require(ratios.length == 3);
    uint solvers = ratios[0];
    uint funders = ratios[1];
    uint dependencies = ratios[2];
    require(solvers + funders + dependencies > 0);
    Change storage packet = changes[packetId];
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    // TODO buffer the payments so Dreamcatcher can disperse
    // people can send in funds that get dispersed to the contributors
    // can send in any erc20 or erc1155 that can be dispersed
    // this is the foundational training set we need
  }

  function claim(uint id) public {
    Change storage c = changes[id];
    require(c.createdAt != 0, 'Transition does not exist');
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
    for (uint i = 0; i < nftIds.length; i++) {
      uint nftId = nftIds[i];
      uint total = c.funds.get(nftId);
      TaskNft memory nft = taskNfts[nftId];
      require(nft.changeId == id, 'NFT not for this transition');
      Asset memory asset = assets[nft.assetId];
      uint withdrawable = 0;
      uint claimableAmount = 0;

      if (c.changeType == ChangeType.PACKET) {
        uint share = c.contentShares.balances[msg.sender];
        require(share > 0, 'No share');
        claimableAmount = (total * share) / SHARES_DECIMALS;
        uint claimed = 0;
        if (c.contentShares.claims[msg.sender].contains(nftId)) {
          claimed = c.contentShares.claims[msg.sender].get(nftId);
        }
        if (claimableAmount > claimed) {
          withdrawable = claimableAmount - claimed;
        }
      } else {
        // QA is claiming, so hand it all over
        withdrawable = total;
      }
      if (withdrawable == 0) {
        continue;
      }

      // TODO handle ERC20 and Ether
      IERC1155 token = IERC1155(asset.tokenContract);
      try
        token.safeTransferFrom(
          address(this),
          msg.sender,
          asset.tokenId,
          withdrawable,
          ''
        )
      {
        if ((total - withdrawable) == 0) {
          c.funds.remove(nftId);
        } else {
          c.funds.set(nftId, total - withdrawable);
        }
        if (claimableAmount > 0) {
          c.contentShares.claims[msg.sender].set(nftId, claimableAmount);
        }
      } catch {}
      // TODO check the gas before starting again
    }
  }

  function claimBatch(uint[] calldata ids) external {
    uint opCost = 0;
    for (uint i = 0; i < ids.length; i++) {
      uint id = ids[i];
      uint256 gasRemaining = gasleft();
      if (gasRemaining < opCost) {
        break;
      }
      claim(id);
      if (i == 0) {
        uint safetyFactor = 2;
        opCost = safetyFactor * (gasRemaining - gasleft());
      }
    }
  }

  function claimAll() external {
    // get the address of the caller
    // work our way thru a list of all tokens they hold
    // claim any one they still have funds inside of
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

  function isFinalSolution(uint solutionId) internal returns (bool) {
    // TODO make sure no other valid solutions are present

    // TODO go thru all solutions targetting this packet
    // and check if this is the last one
    // what if another solution is in dispute too ?

    return true;
  }

  function isPossible(Change storage solution) internal returns (bool) {
    // is it possible that this solution become an accepted solution
    return false;
  }

  function isSolved(Change storage solution) internal returns (bool) {
    // ???? how to mark the packet as resolved tho ?
    return true;
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
    // TODO normalize all shares to 1000 again
    uint concurrency = contentShares.concurrency.current();
    contentShares.concurrency.reset();

    // loop thru all holders and divide by the concurrency
    // if they have less than 1, then remove them
    // select someone randomly to receive the remainder
  }

  function isIpfs(bytes32 ipfsHash) internal pure returns (bool) {
    return true;
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

  function isEther(Payment memory p) internal pure returns (bool) {
    return p.token == ETH_ADDRESS && p.tokenId == ETH_TOKEN_ID;
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

  // to notify opensea to halt trading
  event Locked(uint256 tokenId);
  event Unlocked(uint256 tokenId);
  // or, if the number of events is high
  event Staked(address indexed user, uint256[] tokenIds, uint256 stakeTime);
  event Unstaked(address indexed user, uint256[] tokenIds);

  function balanceOf(
    address account,
    uint256 id
  ) external view returns (uint256) {}

  function balanceOfBatch(
    address[] calldata accounts,
    uint256[] calldata ids
  ) external view returns (uint256[] memory) {}

  function setApprovalForAll(address operator, bool approved) external {}

  function isApprovedForAll(
    address account,
    address operator
  ) external view returns (bool) {}

  function safeTransferFrom(
    address from,
    address to,
    uint256 id,
    uint256 amount,
    bytes calldata data
  ) external {
    // if you haven't withdrawn it, then you can't transfer it
    // TODO transfer resets the defund window
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
