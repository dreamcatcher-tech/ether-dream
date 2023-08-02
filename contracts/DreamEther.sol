// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './IQA.sol';

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
contract DreamEther {
  uint public changesCount = 0;
  mapping(uint => Change) private changes;
  // what amounts of all the tokens in this contract does each address hodl
  // used for balanceOf() requests
  mapping(address => TokenWallet) private balances;

  // used to generate our own NFTs for every funding type
  uint public nftCount = 2; // 0 is qa, 1 is solution
  mapping(uint => Token) private tokenMap;

  mapping(uint => Funding) private fundingNfts;

  mapping(uint => address) public qaMap; // headerHash => qa

  function proposePacket(bytes32 contents, address qa) public {
    require(isIpfs(contents), 'Invalid header');
    require(qa.code.length > 0, 'QA must be a contract');
    uint headerId = ++changesCount;
    Change storage header = changes[headerId];
    require(header.timestamp == 0, 'Header already exists');

    header.changeType = ChangeType.HEADER;
    header.timestamp = block.timestamp;
    header.contents = contents;

    require(qaMap[headerId] == address(0), 'QA exists');
    qaMap[headerId] = qa;
    emit ProposedPacket(headerId);
  }

  function fund(uint id, Payment[] calldata payments) public payable {
    require(msg.value > 0 || payments.length > 0, 'Must send funds');
    Change storage change = changes[id];
    require(change.timestamp != 0, 'Transition does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');

    Wallet storage funds = change.funds;
    Wallet storage shares = change.fundingShares[msg.sender];
    if (msg.value > 0) {
      updateWallet(funds, ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
      updateWallet(shares, ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
    }
    for (uint i = 0; i < payments.length; i++) {
      Payment memory p = payments[i];
      require(p.amount > 0, 'Amount cannot be 0');
      require(p.token != address(0), 'Token cannot be 0');
      IERC20 token = IERC20(p.token);
      require(token.transferFrom(msg.sender, address(this), p.amount));
      updateWallet(funds, p.token, p.tokenId, p.amount);
      updateWallet(shares, p.token, p.tokenId, p.amount);
      // TODO handle erc1155 token transfers
    }
    delete change.defundWindowStart[msg.sender];
    emit FundedTransition(id, msg.sender);
  }

  function listTransition(uint transitionHash) public {
    // by default, proposed packets are not listed on opensea
    // but this function allows them to be, it just costs
    // more gas plus some min qa payment to prevent spam
    // this function is also the same for listing packets
    // they always relate to a packetId

    // call the QA contract and get it to list
    IQA qa = IQA(qaMap[transitionHash]);
    require(qa.publishTransition(transitionHash));
  }

  function defundStart(uint id) public {
    Change storage change = changes[id];
    require(change.timestamp != 0, 'Transition does not exist');
    require(change.defundWindowStart[msg.sender] == 0);
    change.defundWindowStart[msg.sender] = block.timestamp;
  }

  function defund(uint id) public {
    Change storage change = changes[id];
    require(change.timestamp != 0, 'Transition does not exist');
    uint lockedTime = change.defundWindowStart[msg.sender];
    uint elapsedTime = block.timestamp - lockedTime;
    require(elapsedTime > DEFUND_WINDOW, 'Defund timeout not reached');

    // process the unfunding
    // notify the QA
    // uint headerHash = _findHeaderHash(id);
    // IQA qa = IQA(qaMap[headerHash]);
    // qa.defunded(id); // QA contract may delist from opensea
    // TODO make a token to allow spending of locked funds
    // TODO check if any solutions have passed threshold and revert if so
    // TODO ensure not in the dispute period, which means no defunding
  }

  function qaResolve(uint id, Share[] calldata shares) public {
    require(shares.length > 0, 'Must provide shares');

    Change storage c = qaStart(id);
    uint total = 0;
    for (uint i = 0; i < shares.length; i++) {
      Share memory share = shares[i];
      require(share.owner != address(0), 'Owner cannot be 0');
      require(share.owner != msg.sender, 'Owner cannot be QA');
      require(share.amount > 0, 'Amount cannot be 0');
      require(c.solutionShares.shares[share.owner] == 0, 'Owner exists');
      if (c.solutionShares.shares[share.owner] == 0) {
        c.solutionShares.owners.push(share.owner);
      }
      c.solutionShares.shares[share.owner] = share.amount;
      total += share.amount;
    }
    require(total == SHARES_DECIMALS, 'Shares must sum to SHARES_DECIMALS');
    c.solutionShares.total = total;
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
    require(change.timestamp != 0, 'Transition does not exist');
    require(change.disputeWindowStart == 0, 'Dispute period started');
    require(isQa(id), 'Must be transition QA');

    change.disputeWindowStart = block.timestamp;
    return change;
  }

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) public {
    // used if the resolve is fine, but the shares are off.
    // passing this change will modify the shares split
    // and resolve the disputed change allowing finalization
  }

  function disputeResolve(uint id, bytes32 reason) public {
    // the resolve should have been a rejection
    // will halt the transition, return the qa funds, and await
  }

  function disputeRejection(uint id, bytes32 reason) public {
    require(isIpfs(reason), 'Invalid reason hash');
    Change storage c = changes[id];
    require(c.timestamp != 0, 'Transition does not exist');
    require(c.rejectionReason != 0, 'Not a rejection');
    require(c.disputeWindowStart > 0, 'Dispute window not started');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime < DISPUTE_WINDOW, 'Dispute window closed');

    uint disputelId = ++changesCount;
    Change storage dispute = changes[disputelId];
    dispute.changeType = ChangeType.DISPUTE;
    dispute.timestamp = block.timestamp;
    dispute.contents = reason;
    dispute.uplink = id;

    if (c.changeType == ChangeType.HEADER) {
      emit HeaderDisputed(disputelId);
    }
    if (c.changeType == ChangeType.SOLUTION) {
      emit SolutionDisputed(id);
    }
  }

  function enact(uint id) public {
    Change storage c = changes[id];
    require(c.disputeWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - c.disputeWindowStart;
    require(elapsedTime > DISPUTE_WINDOW, 'Dispute window still open');
    // TODO check no other disputes are open too

    if (c.changeType == ChangeType.HEADER) {
      require(c.downlinks.length == 0, 'Header already enacted');
      uint packetId = ++changesCount;
      Change storage packet = changes[packetId];
      require(packet.timestamp == 0, 'Packet already exists');
      packet.changeType = ChangeType.PACKET;
      packet.timestamp = block.timestamp;
      packet.uplink = id;
      c.downlinks.push(packetId);

      emit PacketCreated(packetId);
    } else if (c.changeType == ChangeType.SOLUTION) {
      emit SolutionAccepted(id);
      // TODO handle concurrent solutions
      Change storage packet = changes[c.uplink];
      require(packet.timestamp != 0, 'Packet does not exist');
      require(packet.changeType == ChangeType.PACKET, 'Not a packet');
      require(!c.solutionShares.isChanging, 'Solution error');
      require(c.solutionShares.total == SHARES_DECIMALS, 'Solution error');

      mergeShareTable(packet.solutionShares, c.solutionShares);

      for (uint i = 0; i < packet.downlinks.length; i++) {
        uint solutionId = packet.downlinks[i];
        Change storage solution = changes[solutionId];
        if (isPossible(solution)) {
          packet.solutionShares.isChanging = true;
          return; // this is not the final solution
        }
      }
      packet.solutionShares.isChanging = false;
      emit PacketResolved(c.uplink);
    } else if (c.changeType == ChangeType.DISPUTE) {
      // TODO
    } else if (c.changeType == ChangeType.EDIT) {
      // TODO
    } else {
      revert('Invalid transition type');
    }
  }

  function solve(uint packetId, bytes32 contents) public {
    Change storage packet = changes[packetId];
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    require(packet.timestamp != 0, 'Packet does not exist');

    uint solutionId = ++changesCount;
    Change storage solution = changes[solutionId];
    require(solution.timestamp == 0, 'Solution exists');

    solution.changeType = ChangeType.SOLUTION;
    solution.timestamp = block.timestamp;
    solution.contents = contents;
    solution.uplink = packetId;
    packet.downlinks.push(solutionId);
    emit SolutionProposed(solutionId);
  }

  function merge(uint fromId, uint toId, bytes32 reasons) public {
    // merge the change of fromId to the change of toId for the given reasons
  }

  function edit(uint id, bytes32 contents, bytes32 reasons) public {
    // edit the given id with the new contents for the given reasons
  }

  function consume(uint packetId, uint[] calldata ratios) public payable {
    require(ratios.length == 3);
    uint solvers = ratios[0];
    uint funders = ratios[1];
    uint dependencies = ratios[2];
    require(solvers + funders + dependencies > 0);
    Change storage packet = changes[packetId];
    require(packet.timestamp != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET, 'Not a packet');
    // TODO buffer the payments so Dreamcatcher can disperse
    // people can send in funds that get dispersed to the contributors
    // can send in any erc20 or erc1155 that can be dispersed
    // this is the foundational training set we need
  }

  function claim(uint id) public {
    // withdraw your entitlement based on the shares you have
    // TODO must freeze transfers for a period to prevent rug pulls
    // withdraws all the divisible tokens you have
    // trading between solutionShares needs to occur before non divisible
    // tokens can be withdrawn
    // will keep going until the block gas limit is reached
    // must track the withdrawls, in case something indivisible is stuck.
    //
  }

  function claimBatch(uint[] calldata ids) public {
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

  function claimAll() public {
    // get the address of the caller
    // work our way thru a list of all tokens they hold
    // claim any one they still have funds inside of
  }

  function updateWallet(
    Wallet storage wallet,
    address token,
    uint tokenId,
    uint amount
  ) internal {
    require(amount > 0, 'Amount cannot be 0');
    if (wallet.tokenWallet[token].balances[tokenId] == 0) {
      wallet.tokenWallet[token].tokenIds.push(tokenId);
    }
    wallet.tokenWallet[token].balances[tokenId] += amount;
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
    ShareTable storage to,
    ShareTable storage from
  ) internal {
    require(from.total == SHARES_DECIMALS, 'Must sum to SHARES_DECIMALS');
    require(from.isChanging == false, 'Cannot merge changing table');
    for (uint i = 0; i < from.owners.length; i++) {
      address owner = from.owners[i];
      uint amount = from.shares[owner];
      if (to.shares[owner] == 0) {
        to.owners.push(owner);
      }
      to.shares[owner] += amount;
    }
    to.total += from.total;
  }

  function isIpfs(bytes32 ipfsHash) public pure returns (bool) {
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

  function getIpfsCid(uint id) public view returns (string memory) {
    // TODO https://github.com/storyicon/base58-solidity
    Change storage c = changes[id];
    return string(abi.encodePacked('todo', c.contents));
  }

  event ProposedPacket(uint headerId);
  event FundedTransition(uint transitionHash, address owner);
  event QAResolved(uint transitionHash);
  event QARejected(uint transitionHash);
  event SolutionAccepted(uint transitionHash);
  event PacketCreated(uint packetId);
  event SolutionProposed(uint solutionId);
  event PacketResolved(uint packetId);
  event SolutionDisputed(uint solutionHash);
  event HeaderDisputed(uint headerId);
}
