// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;

import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableMap.sol';
import '@openzeppelin/contracts/utils/structs/BitMaps.sol';
import './Counters.sol';

address constant OPEN_SEA = address(0x495f947276749Ce646f68AC8c248420045cb7b5e);
address constant ETH_ADDRESS = address(0);
uint constant ETH_TOKEN_ID = 0;
uint constant DISPUTE_ROUND_DISMISSED = 2 ** 256 - 1;
uint constant GAS_PER_CLAIMABLE = 100000;

// PREALLOCATED ASSET IDs
uint constant CONTENT_ASSET_ID = 0;
uint constant QA_MEDALLION_ASSET_ID = 1; // QA medallion assigned by packet
uint constant LAST_PREALLOCATED_ASSET_ID = QA_MEDALLION_ASSET_ID;

// TUNABLE PARAMETERS
uint constant DISPUTE_WINDOW = 7 days;
uint constant DEFUND_WINDOW = 14 days;
uint constant SHARES_TOTAL = 1000;

enum NftType {
  QA,
  META, // content shares in a header, edit, or a merge
  META_FUNDING, // funding shares in a header, solution, edit, or a merge
  DISPUTE, // content shares in a dispute that was upheld
  DISPUTE_FUNDING, // funding shares in a dispute that was upheld
  PACKET, // content shares in a solution that solved a packet
  PACKET_FUNDING // then subclasses into funding types
}
enum ChangeType {
  HEADER,
  PACKET,
  SOLUTION,
  DISPUTE,
  EDIT,
  MERGE
}
struct Change {
  //
  // info
  ChangeType changeType;
  uint createdAt;
  bytes32 contents; // v1 CID hash component
  bytes32 rejectionReason;
  uint disputeWindowEnd;
  uint disputeWindowSize;
  bytes32 editContents; // if an edit, this is the replacement contents
  bool isEnacted; // TODO change to a timestamp ?
  //
  // shares
  EnumerableMap.UintToUintMap funds; // nftId => amount
  FundingShares fundingShares;
  ContentShares contentShares; // assigned by QA
  //
  // links
  uint uplink; //packets to headers, solutions to packets, disputes to metas, headers to packets
  uint[] downlinks; // packets to solutions, metas to disputes
  uint[] edits; // packets to merges, metas to edits
  DisputeRound[] disputeRounds;
}
struct DisputeRound {
  uint roundHeight; // length of downlinks array at time of round close
  uint outcome; // chosen downlink index or DISPUTE_ROUND_DISMISSED
  bytes32 reason; // the reason for the outcome
}
// TODO check we never try to delete a struct with a mapping inside
struct FundingShares {
  EnumerableSet.AddressSet holders;
  mapping(address => EnumerableMap.UintToUintMap) balances; // nftId => amount
  mapping(address => uint) defundWindows;
}
struct ContentShares {
  // TODO make claimables be ordered, and remove bigdog field
  EnumerableMap.AddressToUintMap claimables; // solver => amount
  EnumerableMap.AddressToUintMap holders; // all who have traded shares
  BitMaps.BitMap claimed; // tracks which claimables have been claimed
  address bigdog; // the solver with the most shares
  // TODO test trading all before withdrawing holding correct balances
  QaMedallion qaMedallion; // QA medallion minted on packet resolved
}
struct QaMedallion {
  uint nftId;
  address holder;
}
struct Share {
  address holder;
  uint amount;
}
struct Payment {
  address token;
  uint tokenId;
  uint amount;
}
struct Nft {
  uint changeId;
  uint assetId;
}
struct NftsLut {
  // changeId => assetId => nftId
  mapping(uint => mapping(uint => uint)) lut;
}
struct Asset {
  address tokenContract;
  uint tokenId;
}
struct AssetsLut {
  // tokenAddress => tokenId => assetId
  mapping(address => mapping(uint => uint)) lut;
}
enum Approval {
  NONE,
  APPROVED,
  REJECTED
}
struct Exits {
  uint atIndex;
  EnumerableMap.UintToUintMap balances; // assetId => amount
  bool inProgress;
}
struct AssetFilter {
  uint createdAt;
  mapping(uint => bool) allow;
  mapping(uint => bool) deny;
  bool isOnly; // if true, allow is exclusive
  uint[] inherits;
}
struct State {
  Counters.Counter changeCounter;
  mapping(uint => Change) changes;
  mapping(uint => address) qaMap; // headerId => qa
  Counters.Counter nftCounter;
  mapping(uint => Nft) nfts;
  NftsLut nftsLut;
  Counters.Counter assetCounter;
  mapping(uint => Asset) assets; // saves storage space
  AssetsLut assetsLut; // tokenAddress => tokenId => assetId
  mapping(address => Exits) exits;
  mapping(address => EnumerableSet.UintSet) claimables;
  mapping(address => mapping(address => Approval)) approvals;
  Counters.Counter filterCounter;
  mapping(uint => AssetFilter) filters;
}
