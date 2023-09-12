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
    return 'https://dreamcatcher.land';
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

  function exit() external {
    dreamcatcher.exit();
  }

  receive() external payable {}

  function name() external pure returns (string memory) {
    return 'Dreamcatcher Command';
  }

  bool rejectOnChange = false;

  function setRejectOnChange() external {
    rejectOnChange = true;
  }

  function onChange(uint) external view {
    if (rejectOnChange) {
      revert('QA: onChange rejected');
    }
  }

  bool rejectOnFund = false;

  function setRejectOnFund() external {
    rejectOnFund = true;
  }

  function onFund(uint, Payment[] calldata) external view {
    if (rejectOnFund) {
      revert('QA: onFund rejected');
    }
  }

  function onTransfer(
    address operator,
    address from,
    address to,
    uint id,
    uint amount
  ) external view {}
}
