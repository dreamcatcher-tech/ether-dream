// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// Uncomment this line to use console.log
import 'hardhat/console.sol';
import './Types.sol';
import './QA.sol';

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
  uint public headerCounter = 0;
  uint public packetCounter = 0;
  uint public solutionCounter = 0;

  // what amounts of all the tokens in this contract does each address hodl
  mapping(address => TokenWallet) private balances;

  mapping(uint => Transition) private headers;
  mapping(uint => Transition) private packets;
  mapping(uint => Transition) private solutions;
  mapping(uint => uint) public solutionsToPackets; // solutionHash => packetHash
  mapping(uint => uint[]) public packetsToSolutions; // packetHash => solutionHashes
  mapping(uint => uint) public packetHeaders; // packetHash => headerHash
  mapping(uint => uint[]) public payableSolutions; // packetHash => solutionHashes
  mapping(uint => address) public headerQas; // headerHash => qa
  mapping(uint => uint) public merges; // mergeHash => transitionHash

  function proposePacket(uint headerHash, address qa) public {
    require(_isContract(qa), 'QA must be a contract');
    require(headerHash != 0, 'Header hash cannot be 0');
    require(headers[headerHash].timestamp == 0, 'Transition exists');
    Transition storage header = headers[headerHash];
    header.timestamp = block.timestamp;

    require(headerQas[headerHash] == address(0), 'QA exists');
    headerQas[headerHash] = qa;
    emit ProposedPacket(headerHash, qa);
  }

  function fund(uint id, Payment[] calldata payments) public payable {
    require(msg.value > 0 || payments.length > 0, 'Must send funds');
    Transition storage transition = _loadTrans(id);
    require(transition.appealWindowStart == 0, 'Appeal period started');
    Wallet storage funds = transition.funds;
    Wallet storage shares = transition.fundingShares[msg.sender];
    if (msg.value > 0) {
      _updateWallet(funds, ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
      _updateWallet(shares, ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
    }
    for (uint i = 0; i < payments.length; i++) {
      Payment memory p = payments[i];
      require(p.amount > 0, 'Amount cannot be 0');
      require(p.token != address(0), 'Token cannot be 0');
      IERC20 token = IERC20(p.token);
      require(token.transferFrom(msg.sender, address(this), p.amount));
      _updateWallet(funds, p.token, p.tokenId, p.amount);
      _updateWallet(shares, p.token, p.tokenId, p.amount);
      // TODO handle erc1155 token transfers
    }
    delete transition.lockedFundingShares[msg.sender];
    emit FundedTransition(id, msg.sender);
  }

  function listTransition(uint transitionHash) public {
    // by default, proposed packets are not listed on opensea
    // but this function allows them to be, it just costs
    // more gas plus some min qa payment to prevent spam
    // this function is also the same for listing packets
    // they always relate to a packetId

    // call the QA contract and get it to list
    QA qa = QA(headerQas[transitionHash]);
    require(qa.publishTransition(transitionHash));
  }

  function defund(uint transitionHash) public {
    Transition storage transition = _loadTrans(transitionHash);
    require(transition.appealWindowStart == 0, 'Appeal period started');
    require(transition.lockedFundingShares[msg.sender] == 0);
    transition.lockedFundingShares[msg.sender] = block.timestamp;
    uint headerHash = _findHeaderHash(transitionHash);
    IQA qa = IQA(headerQas[headerHash]);
    qa.defunded(transitionHash); // QA contract may delist from opensea
    // TODO make a token to allow spending of locked funds
    // TODO check if any solutions have passed threshold and revert if so
  }

  function qaResolve(uint id, Shares[] calldata shares) public {
    Transition storage t = _loadMeta(id);
    require(t.appealWindowStart == 0, 'Appeal period started');
    uint headerHash = _findHeaderHash(id);
    require(headerQas[headerHash] == msg.sender, 'Must be transition QA');
    require(shares.length > 0, 'Must have shares');

    for (uint i = 0; i < shares.length; i++) {
      Shares memory share = shares[i];
      require(t.solutionShares[share.owner] == 0, 'Duplicate owner');
      require(share.owner != address(0), 'Owner cannot be 0');
      require(share.owner != msg.sender, 'Owner cannot be QA');
      require(share.amount > 0, 'Amount cannot be 0');
      t.solutionShares[share.owner] = share.amount;
    }
    t.appealWindowStart = block.timestamp;
    emit QAResolved(id);
  }

  function qaReject(uint id, uint rejectionHash) public {
    Transition storage t = _loadMeta(id);
    require(t.appealWindowStart == 0, 'Appeal period started');
    uint headerHash = _findHeaderHash(id);
    require(headerQas[headerHash] == msg.sender, 'Must be transition QA');

    t.appealWindowStart = block.timestamp;
    t.rejectionHash = rejectionHash;
    emit QARejected(id);
  }

  function appealShares(
    uint id,
    uint appealHash,
    Shares[] calldata shares
  ) public {
    // used if the resolve is fine, but the shares are off.
    // passing this transition will modify the shares split.
  }

  function appealResolve(uint transitionId, uint appealHash) public {
    // the resolve should have been a rejection
    // will halt the transition, return the qa funds, and await
  }

  function appealReject(uint transitionId, uint appealHash) public {
    // the resolve should have been a rejection
    // will halt the transition, return the qa funds, and await
  }

  function finalizeTransition(uint id) public {
    Transition storage t = _loadMeta(id);
    require(t.appealWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - t.appealWindowStart;
    require(elapsedTime > APPEAL_WINDOW, 'Appeal window still open');
    // TODO check no appeals are open

    TransitionType transitionType = _getTransitionType(id);

    if (transitionType == TransitionType.Header) {
      uint packetId = ++packetCounter;
      Transition storage packet = packets[packetId];
      require(packet.timestamp == 0, 'Packet exists');
      packet.timestamp = block.timestamp;
      packetHeaders[packetId] = id;
      emit PacketCreated(packetId);
    } else if (transitionType == TransitionType.Solution) {
      emit SolutionAccepted(id);
      if (_isFinalSolution(id)) {
        _resolvePacket(id);
        emit PacketResolved(solutionsToPackets[id]);
      }
    } else {
      revert('Invalid transition type');
    }
  }

  function proposeSolution(uint packetId, uint solutionHash) public {
    require(packets[packetId].timestamp != 0, 'Packet does not exist');
    require(solutions[solutionHash].timestamp == 0);

    Transition storage solution = solutions[solutionHash];
    solution.timestamp = block.timestamp;
    solutionsToPackets[solutionHash] = packetId;
    packetsToSolutions[packetId].push(solutionHash);
    emit SolutionProposed(packetId, solutionHash);
  }

  function mergePackets(uint fromId, uint toId, uint mergeHash) public {
    // this transition would merge two packets together
  }

  function modify(uint currentHash, uint nextHash, address qa) public {
    // ? is this a merge ?
    // if is a packet header, then can suggest the next qa
    // this should be the same as modifying any transition
    // if the transition was a packet header, then the packet is updated
    // qa can choose if they accept it or not as both the succession
    // and separately, for the original goal of the transition
    // it can be accepted as succesor, but not as goal
    // only existing qa can pass on to a new qa
  }

  function consume(uint packetId, uint[] calldata ratios) public payable {
    require(ratios.length == 3);
    (uint solvers, uint funders, uint dependencies) = (
      ratios[0],
      ratios[1],
      ratios[2]
    );
    require(solvers + funders + dependencies > 0);
    Transition storage packet = packets[packetId];
    require(packet.timestamp != 0, 'Packet does not exist');
    // TODO buffer the payments so Dreamcatcher can disperse
    // people can send in funds that get dispersed to the contributors
    // can send in any erc20 or erc1155 that can be dispersed
    // this is the foundational training set we need
  }

  function withdrawAllPossible(uint id) public {
    // withdraws all the divisible tokens you have
    // trading between solutionShares needs to occur before non divisible
    // tokens can be withdrawn
    // will keep going until the block gas limit is reached
    // must track the withdrawls, in case something indivisible is stuck.
    //
  }

  function _updateWallet(
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

  function _loadMeta(uint id) internal view returns (Transition storage) {
    Transition storage transition = _loadTrans(id);
    require(packets[id].timestamp == 0, 'Cannot directly load packet');
    return transition;
  }

  function _loadTrans(uint id) internal view returns (Transition storage) {
    Transition storage transition;
    if (headers[id].timestamp != 0) {
      transition = headers[id];
    } else if (solutions[id].timestamp != 0) {
      transition = solutions[id];
    } else if (packets[id].timestamp != 0) {
      transition = packets[id];
    } else {
      revert('Transition does not exist');
    }
    require(transition.rejectionHash == 0, 'Transition rejected');
    return transition;
  }

  function _getTransitionType(uint id) internal returns (TransitionType) {
    if (headers[id].timestamp != 0) {
      return TransitionType.Header;
    }
    if (packets[id].timestamp != 0) {
      return TransitionType.Packet;
    }
    if (solutions[id].timestamp != 0) {
      return TransitionType.Solution;
    }
    revert('Invalid transition type');
  }

  function _isFinalSolution(uint solutionId) internal returns (bool) {
    uint packetId = solutionsToPackets[solutionId];
    // TODO make sure no other valid solutions are present

    // TODO go thru all solutions targetting this packet
    // and check if this is the last one
    // what if another solution is in appeal ?

    return true;
  }

  function _resolvePacket(uint finalSolutionId) internal {
    uint packetId = solutionsToPackets[finalSolutionId];
    uint[] memory allSolutions = packetsToSolutions[packetId];
    for (uint i = 0; i < allSolutions.length; i++) {
      uint solutionId = allSolutions[i];
      Transition storage solution = solutions[solutionId];
      // TODO determine if it is a payable solution
      payableSolutions[packetId].push(solutionId);
    }
    // ???? how to mark the packet as resolved tho ?
  }

  function _isContract(address account) internal view returns (bool) {
    return account.code.length > 0;
  }

  function _findHeaderHash(uint transitionHash) internal returns (uint) {
    TransitionType transitionType = _getTransitionType(transitionHash);
    if (transitionType == TransitionType.Header) {
      return transitionHash;
    }
    if (transitionType == TransitionType.Packet) {
      return packetHeaders[transitionHash];
    }
    if (transitionType == TransitionType.Solution) {
      uint packetId = solutionsToPackets[transitionHash];
      return packetHeaders[packetId];
    }
    revert('Invalid transition type');
  }

  event ProposedPacket(uint headerHash, address QA);
  event FundedTransition(uint transitionHash, address owner);
  event QAResolved(uint transitionHash);
  event QARejected(uint transitionHash);
  event SolutionAccepted(uint transitionHash);
  event PacketCreated(uint packetId);
  event SolutionProposed(uint packetId, uint solutionHash);
  event PacketResolved(uint packetId);
  event SolutionAppealed(uint solutionHash);
  event HeaderAppealed(uint headerHash);
}

// packet solving another packet must be in the solved state
// we need to ensure that no loops can occur - that problem solution tree is DAG

// block datahashes from being reused
// switch to indices for all transitions
