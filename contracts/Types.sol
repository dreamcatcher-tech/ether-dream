// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

address constant ETH_ADDRESS = address(0);
uint constant ETH_TOKEN_ID = 0;
uint constant APPEAL_WINDOW = 3 days;

struct Change {
  ChangeType changeType;
  uint timestamp;
  bytes32 contents; // v1 CID hash component
  bytes32 rejectionReason;
  Wallet funds;
  mapping(address => Wallet) fundingShares;
  mapping(address => uint) lockedFundingShares;
  mapping(address => Wallet) withdrawals;
  mapping(address => uint) solutionShares; // assigned by QA
  uint appealWindowStart;
  uint uplink; //packets to headers, solutions to packets, appeals to metas
  uint[] downlinks; // packets to solutions, metas to appeals
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

enum ChangeType {
  HEADER,
  PACKET,
  SOLUTION,
  APPEAL
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
