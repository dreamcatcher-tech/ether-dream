// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

interface IQA {
  /**
   * If a change is not funded above this amount, the QA will not process it.
   * This is to prevent spam.
   */
  function isJudgeable(uint id) external view returns (bool);

  // no id => uri of the whole team.  id => uri of the individual qa'er
  function getUri(uint id) external view returns (string memory);

  function name() external view returns (string memory);

  // TODO add an onChange function to be called when a change is made
  // this is the chance for a given QA to reject a change automatically
  // or perform any other function they may wish to do
}
