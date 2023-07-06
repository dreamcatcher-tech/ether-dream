// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// Uncomment this line to use console.log
import "hardhat/console.sol";

interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);
}

contract DreamEther {
    address constant ETH_ADDRESS = address(0);
    uint constant ETH_TOKEN_ID = 0;
    uint constant APPEAL_WINDOW = 3 days;

    uint public packetIdCounter = 0;

    // track balance of each address of each token type for reverse lookup
    mapping(address => mapping(uint => uint)) public balanceOf;

    enum NftType {
        ProposalFunding,
        ProposalSolution,
        ProposalQA,
        Funding,
        Buying,
        Solution,
        SolutionFunding,
        SolutionQA,
        Correction
    }

    enum PacketState {
        // TODO remove this and deduce from state
        Proposing, // initial state
        Rejected, // if proposal is rejected
        Open, // if proposal is accepted
        Solving, // the timeout period for vetoing
        Solved // once solution proposal is passed
    }
    enum TransitionType {
        Header,
        Packet,
        Solution
    }
    struct Shares {
        address owner;
        uint amount;
    }
    struct TokenWallet {
        // TokenWallet is scoped to a token address
        uint[] tokenIds;
        // token ids => amount
        mapping(uint => uint) balances;
    }
    struct Wallet {
        // wallet holds many tokens.  Each funder has one, as does the trans.
        address[] tokens;
        // token addresses => PerTokenWallet
        mapping(address => TokenWallet) tokenWallet;
    }
    struct Payment {
        address token;
        uint tokenId;
        uint amount;
    }
    struct Transition {
        uint timestamp;
        uint rejectionHash;
        Wallet funds;
        mapping(address => Wallet) fundingShares;
        mapping(address => uint) lockedFundingShares;
        mapping(address => Wallet) withdrawls;
        mapping(address => uint) solutionShares; // assigned by QA
        uint appealWindowStart;
    }
    mapping(uint => Transition) private transitions;
    mapping(uint => uint) public solutions; // solutionHash => packetHash
    mapping(uint => uint) public packets; // packetHash => headerHash
    mapping(uint => address) public qas; // transitionHash => qa
    mapping(uint => uint) public merges; // mergeHash => transitionHash

    function proposePacket(uint headerHash, address qa) public {
        require(qa != address(0), "QA cannot be 0");
        require(headerHash != 0, "Header hash cannot be 0");
        require(transitions[headerHash].timestamp == 0, "Transition exists");
        Transition storage transition = transitions[headerHash];
        transition.timestamp = block.timestamp;

        require(qas[headerHash] == address(0), "QA exists");
        qas[headerHash] = qa;
    }

    function fund(uint id, Payment[] calldata payment) public payable {
        require(msg.value > 0 || payment.length > 0, "Must send funds");
        Transition storage transition = _safeLoadTransition(id);
        Wallet storage funds = transition.funds;
        Wallet storage shares = transition.fundingShares[msg.sender];
        if (msg.value > 0) {
            _updateWallet(funds, ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
            _updateWallet(shares, ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
        }
        for (uint i = 0; i < payment.length; i++) {
            Payment memory p = payment[i];
            require(p.amount > 0, "Amount cannot be 0");
            require(p.token != address(0), "Token cannot be 0");
            IERC20 token = IERC20(p.token);
            require(token.transferFrom(msg.sender, address(this), p.amount));
            _updateWallet(funds, p.token, p.tokenId, p.amount);
            _updateWallet(shares, p.token, p.tokenId, p.amount);
            // TODO handle erc1155 token transfers
        }
        delete transition.lockedFundingShares[msg.sender];
    }

    function defund(uint transitionHash) public {
        Transition storage transition = _safeLoadTransition(transitionHash);
        require(transition.lockedFundingShares[msg.sender] == 0);
        transition.lockedFundingShares[msg.sender] = block.timestamp;
        // TODO make a token to allow spending of locked funds
    }

    function qaResolve(uint id, Shares[] calldata shares) public {
        Transition storage t = _safeLoadTransition(id);
        require(qas[id] == msg.sender, "Must be transition QA");
        require(shares.length > 0);

        t.appealWindowStart = block.timestamp;
        for (uint i = 0; i < shares.length; i++) {
            Shares memory share = shares[i];
            require(t.solutionShares[share.owner] == 0, "Duplicate owner");
            require(share.owner != address(0), "Owner cannot be 0");
            require(share.owner != msg.sender, "Owner cannot be QA");
            require(share.amount > 0, "Amount cannot be 0");
            t.solutionShares[share.owner] = share.amount;
        }
    }

    function qaReject(uint id, uint rejectionHash) public {
        Transition storage trans = _safeLoadTransition(id);
        require(qas[id] == msg.sender, "Must be transition QA");

        trans.appealWindowStart = block.timestamp;
        trans.rejectionHash = rejectionHash;
    }

    function appealShares(uint transitionId, Shares[] calldata shares) public {
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
        // once the appeal period is over, this function can be called
        Transition storage t = transitions[id];
        require(transitions[id].timestamp != 0);
        require(packets[id].length == 0, "Cannot directly load packet");
        uint elapsedTime = block.timestamp - t.appealWindowStart;
        require(elapsedTime > APPEAL_WINDOW, "Appeal window still open");

        TransitionType transitionType = _getTransitionType(t);

        if (transitionType == TransitionType.Header) {
            uint packetId = ++packetIdCounter;
            Transition storage packet = transitions[packetId];
            require(packet.timestamp == 0, "Packet exists");
            packet.timestamp = block.timestamp;
            packets[packetId] = id;
        } else if (transitionType == TransitionType.Solution) {
            // TODO make sure no other valid solutions are present
            // if we are the last or only solution, then close the packet
            if (_isFinalSolution(id)) {
                uint packetId = solutions[id];
                Transition storage packet = transitions[packetId];
                Shares[] mergeShares = _getMergedShares(packetId);
                qaResolve(packetId, mergedShares);
            }
        } else {
            revert("Invalid transition type");
        }

        // veto can only be from a higher QA, which should have
        // had veto time be listing time, as anyone can call veto.
    }

    function listTransition(uint transitionHash) public payable {
        // by default, proposed packets are not listed on opensea
        // but this function allows them to be, it just costs
        // more gas plus some min qa payment to prevent spam
        // this function is also the same for listing packets
        // they always relate to a packetId
    }

    // SOLVING
    function proposeSolution(uint packetId, uint solutionHash) public {
        require(packets[packetId].packetHash != 0, "Packet does not exist");
        require(packets[packetId].packetState != PacketState.Proposing);
        require(transitions[solutionHash].timestamp == 0);

        Transition storage solution = transitions[solutionHash];
        solution.timestamp = block.timestamp;
    }

    function mergePackets(uint fromId, uint toId, uint mergeHash) public {
        // this transition would merge two packets together
    }

    function switchQa(uint packetId, address qa) public {
        // creates a transition to switch the QA
        // payment goes to the old QA
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
        (uint solvers, uint funders, uint dependencies) = ratios;
        require(solvers + funders + dependencies > 0);
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
        require(amount > 0, "Amount cannot be 0");
        if (wallet.tokenWallet[token].balances[tokenId] == 0) {
            wallet.tokenWallet[token].tokenIds.push(tokenId);
        }
        wallet.tokenWallet[token].balances[tokenId] += amount;
    }

    function _safeLoadTransition(
        uint id
    ) internal returns (Transition storage) {
        require(packets[id].length == 0, "Cannot directly load packet");
        Transition storage transition = transitions[id];
        require(transition.timestamp != 0, "Transition does not exist");
        require(transition.appealWindowStart == 0, "Veto period started");
        require(transition.rejectionHash == 0, "Transition rejected");
        return transition;
    }

    function _getTransitionType(uint id) internal returns (TransitionType) {
        if (qas[id] != address(0)) {
            return TransitionType.Header;
        }
        if (packets[id] != 0) {
            return TransitionType.Packet;
        }
        if (solutions[id] != 0) {
            return TransitionType.Solution;
        }
        revert("Invalid transition type");
    }

    function _isFinalSolution(uint solutionId) internal returns (bool) {
        uint packetId = solutions[solutionId];
        // TODO go thru all solutions targetting this packet
        // and check if this is the last one
        return true;
    }
}

// packet solving another packet must be in the solved state
// we need to ensure that no loops can occur - that problem solution tree is DAG
