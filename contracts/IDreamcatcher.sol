// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';

interface IDreamcatcher {
  function proposePacket(bytes32 header, address qa) external;

  function fund(uint id, Payment[] calldata payments) external payable;

  function defund(uint id) external;

  function qaResolve(uint id, Share[] calldata shares) external;

  function qaReject(uint id, bytes32 reason) external;

  function disputeShares(uint id, bytes32 reason, Share[] calldata s) external;

  function disputeResolve(uint id, bytes32 reason) external;

  function disputeRejection(uint id, bytes32 reason) external;

  function enact(uint id) external;

  function solve(uint packetId, bytes32 contents) external;

  function getIpfsCid(uint id) external view returns (string memory);
}
