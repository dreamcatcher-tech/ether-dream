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

  function isJudgeable(uint id) external pure returns (bool) {
    // TODO - check funding
    return true;
  }

  function passQA(uint id) external {
    IDreamcatcher dc = IDreamcatcher(dreamcatcher);
    Share[] memory shares = new Share[](1);
    shares[0] = Share(msg.sender, 1000);
    dc.qaResolve(id, shares);
  }

  function failQA(uint id, bytes32 reason) external {
    dreamcatcher.qaReject(id, reason);
  }

  function getUri(uint id) external view override returns (string memory) {
    // TODO
    return 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  }

  function disputeDismissed(uint id, bytes32 reason) external {
    dreamcatcher.qaDisputeDismissed(id, reason);
  }

  function disputeUpheld(uint id) external {
    dreamcatcher.qaDisputeUpheld(id);
  }

  function claimQa(uint id) external {
    dreamcatcher.claimQa(id);
  }
}
