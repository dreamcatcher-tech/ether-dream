// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import './Types.sol';

interface IQA {
  /**
   * If a change is not funded above this amount, the QA will not process it.
   * This is to prevent spam.
   */
  function fundThreshold() external view returns (Payment memory);

  /** causes the QA contract to publish NFTs to seaport for funding
   *  Applies a special balance to the QA contract which is non transferrable,
   * and can only sold.
   * Should check the packet has the min funding required to prevent spam.
   */
  function publishTransition(uint id) external returns (bool);

  // if now under threshold, unpublish from opensea
  function defunded(uint id) external returns (bool);

  // no id => uri of the whole team.  id => uri of the individual qa'er
  function getUri(uint id) external view returns (string memory);
}
