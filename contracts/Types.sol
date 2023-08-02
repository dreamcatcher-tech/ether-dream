// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

address constant ETH_ADDRESS = address(0);
uint constant ETH_TOKEN_ID = 0;
uint constant DISPUTE_WINDOW = 3 days;
uint constant DEFUND_WINDOW = 7 days;
uint constant SHARES_DECIMALS = 1000;

struct Change {
  ChangeType changeType;
  uint timestamp;
  bytes32 contents; // v1 CID hash component
  bytes32 rejectionReason;
  Wallet funds;
  mapping(address => Wallet) fundingShares;
  mapping(address => uint) defundWindowStart;
  mapping(address => Wallet) withdrawals;
  ShareTable solutionShares; // assigned by QA
  uint disputeWindowStart;
  uint uplink; //packets to headers, solutions to packets, appeals to metas
  uint[] downlinks; // packets to solutions, metas to appeals
}

struct Payment {
  address token;
  uint tokenId;
  uint amount;
}

enum NftType {
  MetaFunding,
  MetaSolution,
  MetaQA,
  PacketFunding,
  PacketSolution,
  PacketQA,
  PacketBuying,
  Correction
}

enum ChangeType {
  HEADER,
  PACKET,
  SOLUTION,
  DISPUTE,
  EDIT,
  MERGE,
  DELETE
}
struct Share {
  address owner;
  uint amount;
}
struct ShareTable {
  address[] owners;
  uint total;
  mapping(address => uint) shares;
  // in a packet with multiple solutions, we need to block claims until all
  // possible solutions have been enacted.
  bool isChanging;
}

struct Wallet {
  // wallet holds many tokens.  Each funder has one, as does the trans.
  address[] tokens;
  // token addresses => PerTokenWallet
  mapping(address => TokenWallet) tokenWallet;
}
struct TokenWallet {
  // TokenWallet is scoped to a token address
  uint[] tokenIds;
  // token ids => amount
  mapping(uint => uint) balances;
}
struct Token {
  address tokenAddress;
  uint tokenId;
}
struct Funding {
  uint changeId;
  uint tokenMapId;
  uint amount;
}
// each funding share is of the form:
// address > token address > token id > amount
// so each time funding occurs, we need to make a new NFT listing
// wallets can be compacted into this central LUT
// basically our own NFT representation of all external tokens

// but then we need a mapping for each packet scoped version of the token
// so we have our nft id, and this points to a packet and a tokenMap id
// from the tokenmap we get the address and tokenId of that token
// from the packet we get the amount that was funded
