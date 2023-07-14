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
  uint public changesCount = 0;
  mapping(uint => Change) private changes;
  // what amounts of all the tokens in this contract does each address hodl
  mapping(address => TokenWallet) private balances;

  mapping(uint => uint[]) public payableSolutions; // packetId => solutionIds
  mapping(uint => address) public qaMap; // headerHash => qa

  function proposePacket(bytes32 contents, address qa) public {
    require(isIpfs(contents), 'Invalid header');
    require(isContract(qa), 'QA must be a contract');
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
    require(change.appealWindowStart == 0, 'Appeal period started');

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
    delete change.lockedFundingShares[msg.sender];
    emit FundedTransition(id, msg.sender);
  }

  function listTransition(uint transitionHash) public {
    // by default, proposed packets are not listed on opensea
    // but this function allows them to be, it just costs
    // more gas plus some min qa payment to prevent spam
    // this function is also the same for listing packets
    // they always relate to a packetId

    // call the QA contract and get it to list
    QA qa = QA(qaMap[transitionHash]);
    require(qa.publishTransition(transitionHash));
  }

  function defund(uint id) public {
    // TODO defund a specific item, not just all by default ?
    Change storage change = changes[id];
    require(change.timestamp != 0, 'Transition does not exist');
    require(change.lockedFundingShares[msg.sender] == 0);

    change.lockedFundingShares[msg.sender] = block.timestamp;
  }

  function finalizeDefund(uint id) public {
    Change storage change = changes[id];
    require(change.timestamp != 0, 'Transition does not exist');
    uint lockedTime = change.lockedFundingShares[msg.sender];
    uint elapsedTime = block.timestamp - lockedTime;
    require(elapsedTime > APPEAL_WINDOW, 'Defund timeout not reached');

    // process the unfunding
    // notify the QA
    // uint headerHash = _findHeaderHash(id);
    // IQA qa = IQA(qaMap[headerHash]);
    // qa.defunded(id); // QA contract may delist from opensea
    // TODO make a token to allow spending of locked funds
    // TODO check if any solutions have passed threshold and revert if so
  }

  function qaResolve(uint id, Shares[] calldata shares) public {
    require(shares.length > 0, 'Must provide shares');

    Change storage c = qaLoad(id);
    for (uint i = 0; i < shares.length; i++) {
      Shares memory share = shares[i];
      require(c.solutionShares[share.owner] == 0, 'Duplicate owner');
      require(share.owner != address(0), 'Owner cannot be 0');
      require(share.owner != msg.sender, 'Owner cannot be QA');
      require(share.amount > 0, 'Amount cannot be 0');
      c.solutionShares[share.owner] = share.amount;
    }
    emit QAResolved(id);
  }

  function qaReject(uint id, bytes32 reason) public {
    require(isIpfs(reason), 'Invalid rejection hash');

    Change storage c = qaLoad(id);
    c.rejectionReason = reason;
    emit QARejected(id);
  }

  function qaLoad(uint id) internal returns (Change storage) {
    Change storage change = changes[id];
    require(change.timestamp != 0, 'Transition does not exist');
    require(change.appealWindowStart == 0, 'Appeal period started');
    require(isQa(id), 'Must be transition QA');

    change.appealWindowStart = block.timestamp;
    return change;
  }

  function appealShares(uint id, bytes32 reason, Shares[] calldata s) public {
    // used if the resolve is fine, but the shares are off.
    // passing this change will modify the shares split
    // are resolve the appealed change
  }

  function appealResolve(uint id, bytes32 reason) public {
    // the resolve should have been a rejection
    // will halt the transition, return the qa funds, and await
  }

  function appealRejection(uint id, bytes32 reason) public {
    require(isIpfs(reason), 'Invalid reason hash');
    Change storage c = changes[id];
    require(c.timestamp != 0, 'Transition does not exist');
    require(c.appealWindowStart > 0, 'Appeal window not started');
    uint elapsedTime = block.timestamp - c.appealWindowStart;
    require(elapsedTime < APPEAL_WINDOW, 'Appeal window closed');
    require(c.rejectionReason > 0, 'Not a rejection');

    uint appealId = ++changesCount;
    Change storage appeal = changes[appealId];
    appeal.changeType = ChangeType.APPEAL;
    appeal.timestamp = block.timestamp;
    appeal.contents = reason;
    appeal.uplink = id;

    if (c.changeType == ChangeType.HEADER) {
      emit HeaderAppealed(appealId);
    }
    if (c.changeType == ChangeType.SOLUTION) {
      emit SolutionAppealed(id);
    }
  }

  function finalize(uint id) public {
    Change storage c = changes[id];
    require(c.appealWindowStart > 0, 'Not passed by QA');
    uint elapsedTime = block.timestamp - c.appealWindowStart;
    require(elapsedTime > APPEAL_WINDOW, 'Appeal window still open');
    // TODO check no other appeals are open too

    if (c.changeType == ChangeType.HEADER) {
      require(c.downlinks.length == 0, 'Header already consumed');
      uint packetId = ++changesCount;
      Change storage packet = changes[packetId];
      require(packet.timestamp == 0, 'Packet already exists');
      packet.changeType = ChangeType.PACKET;
      packet.timestamp = block.timestamp;
      packet.uplink = id;
      c.downlinks.push(packetId);

      emit PacketCreated(packetId);
      return;
    }
    if (c.changeType == ChangeType.SOLUTION) {
      emit SolutionAccepted(id);
      if (isFinalSolution(id)) {
        Change storage packet = changes[c.uplink];
        require(packet.changeType == ChangeType.PACKET, 'Not a packet');
        require(packet.timestamp != 0, 'Packet does not exist');

        for (uint i = 0; i < packet.downlinks.length; i++) {
          uint solutionId = packet.downlinks[i];
          payableSolutions[c.uplink].push(solutionId);
        }
        // ???? how to mark the packet as resolved tho ?
        emit PacketResolved(c.uplink);
      }
      return;
    }
    revert('Invalid transition type');
  }

  function proposeSolution(uint packetId, bytes32 contents) public {
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

  function withdrawAllPossible(uint id) public {
    // withdraws all the divisible tokens you have
    // trading between solutionShares needs to occur before non divisible
    // tokens can be withdrawn
    // will keep going until the block gas limit is reached
    // must track the withdrawls, in case something indivisible is stuck.
    //
  }

  function drain(uint[] calldata id) public {
    // take all the funds available in all the ids provided
    // and store them in the top level wallet for the
    // calling address.
    // Purpose is to allow a bulk withdrawl of all funds with
    // lowest possible tx costs.
    // Eg: if you have 1000 solutions all with DAI, you can drain them all
    // then make a single DAI withdrawl call.
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
    // what if another solution is in appeal ?

    return true;
  }

  function isContract(address account) internal view returns (bool) {
    return account.code.length > 0;
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
    if (change.changeType == ChangeType.APPEAL) {
      return isQa(change.uplink);
    }
    revert('Invalid change');
  }

  function ipfsCid(uint id) public view returns (string memory) {
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
  event SolutionAppealed(uint solutionHash);
  event HeaderAppealed(uint headerId);
}

// packet solving another packet must be in the solved state
// we need to ensure that no loops can occur - that problem solution tree is DAG

// block datahashes from being reused
// switch to indices for all transitions
