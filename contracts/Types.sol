// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

address constant ETH_ADDRESS = address(0);
uint constant ETH_TOKEN_ID = 0;
uint constant APPEAL_WINDOW = 3 days;

struct Transition {
    uint timestamp;
    uint rejectionHash;
    Wallet funds;
    mapping(address => Wallet) fundingShares;
    mapping(address => uint) lockedFundingShares;
    mapping(address => Wallet) withdrawals;
    mapping(address => uint) solutionShares; // assigned by QA
    uint appealWindowStart;
}

enum PacketState {
    // TODO remove this and deduce from state
    Proposing, // initial state
    Rejected, // if proposal is rejected
    Open, // if proposal is accepted
    Solving, // the timeout period for vetoing
    Solved // once solution proposal is passed
}

struct Payment {
    address token;
    uint tokenId;
    uint amount;
}

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
