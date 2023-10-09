// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;

import '@openzeppelin/contracts/token/ERC1155/extensions/IERC1155MetadataURI.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';

import './Types.sol';

interface IDreamcatcher is IERC1155, IERC1155Receiver, IERC1155MetadataURI {
  function proposePacket(bytes32 contents, address qa) external returns (uint);

  function fund(uint id, Payment[] calldata payments) external payable;

  function defundStart(uint id, uint windowMs) external;

  function defundStop(uint id) external;

  function defund(uint id) external;

  function qaResolve(uint id, Share[] calldata shares) external;

  function qaReject(uint id, bytes32 reason) external;

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) external;

  function disputeResolve(uint id, bytes32 reason) external;

  function disputeReject(uint id, bytes32 reason) external;

  function qaDisputesDismissed(uint changeId, bytes32 reason) external;

  function qaDisputeUpheld(uint id, Share[] calldata s, bytes32 r) external;

  function enact(uint id) external;

  function proposeSolution(uint packetId, bytes32 contents) external;

  function proposeMerge(uint fromId, uint toId, bytes32 reason) external;

  function proposeEdit(uint id, bytes32 editContents, bytes32 reason) external;

  function exit(uint filterId) external;

  function exitList(address holder) external view returns (Payment[] memory);

  // views
  function isNftHeld(
    uint changeId,
    address holder
  ) external view returns (bool);

  function fundingNftIds(uint id) external view returns (uint[] memory);

  function fundingNftIdsFor(
    address holder,
    uint id
  ) external view returns (uint[] memory);

  function contentNftId(uint id) external view returns (uint);

  function qaMedallionNftId(uint id) external view returns (uint);

  function changeCount() external view returns (uint);

  event ExitFailed(uint indexed assetId);

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
  event ProposedPacket(uint headerId, uint disputeWindowSeconds);
  event FundedTransition(uint transitionHash, address owner);
  event SolutionProposed(uint solutionId);
  event Claimed(uint packetId, address holder);

  // from LibraryQA.sol
  event ChangeDisputed(uint changeId, uint disputeId);
  event QAResolved(uint transitionHash);
  event QARejected(uint transitionHash);
  event QAClaimed(uint metaId);
  event DisputesDismissed(uint changeId);
  event DisputesUpheld(uint changeId);

  // from LibraryState.sol
  event DefundStarted(uint indexed id, address indexed holder);
  event Defunded(uint indexed id, address indexed holder);
  event DefundStopped(uint indexed id, address indexed holder);
}
