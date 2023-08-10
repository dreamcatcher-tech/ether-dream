// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableMap.sol';
import '@openzeppelin/contracts/utils/Counters.sol';

address constant OPEN_SEA = address(0x495f947276749Ce646f68AC8c248420045cb7b5e);
address constant ETH_ADDRESS = address(0);
uint constant ETH_TOKEN_ID = 0;
uint constant DISPUTE_WINDOW = 3 days;
uint constant DEFUND_WINDOW = 7 days;
uint constant SHARES_TOTAL = 1000;
uint constant CONTENT_ASSET_ID = 0;

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
  uint disputeWindowStart;
  //
  // shares
  EnumerableMap.UintToUintMap funds; // nftId => amount
  FundingShares fundingShares;
  ContentShares contentShares; // assigned by QA
  //
  // links
  uint uplink; //packets to headers, solutions to packets, appeals to metas
  uint[] downlinks; // packets to solutions, metas to appeals
}
struct FundingShares {
  EnumerableSet.AddressSet holders;
  mapping(address => EnumerableMap.UintToUintMap) balances; // nftId => amount
  mapping(address => uint) defundWindows;
}
struct ContentShares {
  EnumerableSet.AddressSet holders;
  mapping(address => uint) balances;
  mapping(address => uint) claims; // holder => claimedShareCount
  mapping(uint => uint) withdrawn; // nftId => amount
  uint totalClaims;
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
struct TaskNft {
  uint changeId;
  uint assetId;
}
struct TaskNftsLut {
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
