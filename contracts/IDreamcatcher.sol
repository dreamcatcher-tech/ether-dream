// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';

interface IDreamcatcher {
  function proposePacket(bytes32 header, address qa) external;

  function fund(uint id, Payment[] calldata payments) external payable;

  function defund(uint id) external;

  function qaResolve(uint id, Shares[] calldata shares) external;

  function qaReject(uint id, bytes32 reason) external;

  function disputeShares(uint id, bytes32 reason, Shares[] calldata s) external;

  function disputeResolve(uint id, bytes32 reason) external;

  function disputeRejection(uint id, bytes32 reason) external;

  function finalize(uint id) external;

  function proposeSolution(uint packetId, bytes32 contents) external;

  function ipfsCid(uint id) external view returns (string memory);
}
