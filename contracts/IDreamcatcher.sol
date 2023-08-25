// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';

import './Types.sol';

interface IDreamcatcher is IERC1155, IERC1155Receiver, IERC1155MetadataURI {
  function proposePacket(bytes32 contents, address qa) external;

  function fund(uint id, Payment[] calldata payments) external payable;

  function defundStart(uint id) external;

  function defundStop(uint id) external;

  function defund(uint id) external;

  function qaResolve(uint id, Share[] calldata shares) external;

  function qaReject(uint id, bytes32 reason) external;

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) external;

  function disputeResolve(uint id, bytes32 reason) external;

  function disputeRejection(uint id, bytes32 reason) external;

  function qaDisputeDismissed(uint id, bytes32 reason) external;

  function qaDisputeUpheld(uint id) external;

  function enact(uint id) external;

  function solve(uint packetId, bytes32 contents) external;

  function merge(uint fromId, uint toId, bytes32 reasons) external;

  function edit(uint id, bytes32 contents, bytes32 reasons) external;

  function claim(uint id) external;

  function claimQa(uint id) external;

  function exit() external;

  function exitList(address holder) external view returns (Payment[] memory);

  function exitSingle(uint assetId) external;

  function exitBurn(uint assetId) external;

  event Exit(address indexed user);
  event ExitBurn(address indexed user, uint assetId);

  // to notify opensea to halt trading
  event Locked(uint tokenId);
  event Unlocked(uint tokenId);
  // or, if the number of events is high
  event Staked(address indexed user, uint[] tokenIds, uint stakeTime);
  event Unstaked(address indexed user, uint[] tokenIds);

  // from LibraryChanges.sol
  event PacketCreated(uint packetId);
  event SolutionAccepted(uint transitionHash);
  event PacketResolved(uint packetId);
  event ProposedPacket(uint headerId);
  event FundedTransition(uint transitionHash, address owner);
  event SolutionProposed(uint solutionId);
  event Claimed(uint packetId, address holder);

  // from LibraryQA.sol
  event ChangeDisputed(uint disputeId);
  event QAResolved(uint transitionHash);
  event QARejected(uint transitionHash);
  event QAClaimed(uint metaId);
  event DisputeDismissed(uint disputeId);
  event DisputeUpheld(uint disputeId);

  // from LibraryState.sol
  event DefundStarted(uint indexed id, address indexed holder);
  event Defunded(uint indexed id, address indexed holder);
  event DefundStopped(uint indexed id, address indexed holder);

  // views
  function isNftHeld(
    uint changeId,
    address holder
  ) external view returns (bool);

  function fundingNftIds(uint id) external view returns (uint[] memory);

  function fundingNftIdsFor(uint id) external view returns (uint[] memory);

  function fundingNftIdsFor(
    uint id,
    address holder
  ) external view returns (uint[] memory);

  function contentNftId(uint id) external view returns (uint);
}
