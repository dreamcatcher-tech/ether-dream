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

  function passQA(
    uint id,
    address[] calldata solvers,
    uint[] calldata amounts
  ) external {
    IDreamcatcher dc = IDreamcatcher(dreamcatcher);
    Share[] memory shares = new Share[](solvers.length);
    require(solvers.length == amounts.length);
    require(solvers.length > 0);

    for (uint i = 0; i < solvers.length; i++) {
      shares[i] = Share(solvers[i], amounts[i]);
    }
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

  function exit() external {
    dreamcatcher.exit();
  }

  receive() external payable {}
}
