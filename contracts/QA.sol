// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './IDreamcatcher.sol';
import './IQA.sol';

contract QA is IQA {
  IDreamcatcher dreamcatcher;

  constructor(address _dreamcatcher) {
    dreamcatcher = IDreamcatcher(_dreamcatcher);
  }

  function isJudgeable(uint) external pure returns (bool) {
    // TODO - check funding
    return true;
  }

  function passQA(uint id, Share[] calldata shares) external {
    dreamcatcher.qaResolve(id, shares);
  }

  function failQA(uint id, bytes32 reason) external {
    dreamcatcher.qaReject(id, reason);
  }

  function getUri(uint) external pure override returns (string memory) {
    // TODO
    return 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  }

  function disputesDismissed(uint changeId, bytes32 reason) external {
    dreamcatcher.qaDisputesDismissed(changeId, reason);
  }

  function disputeUpheld(
    uint id,
    Share[] calldata shares,
    bytes32 reason
  ) external {
    dreamcatcher.qaDisputeUpheld(id, shares, reason);
  }

  function claimQa(uint id) external {
    dreamcatcher.claimQa(id);
  }

  function exit() external {
    dreamcatcher.exit();
  }

  receive() external payable {}

  function name() external pure returns (string memory) {
    return 'Test QA';
  }
}
