// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;
import './Types.sol';

interface IQA {
  /**
   * If a change is not funded above this amount, the QA will not process it.
   * This is to prevent spam.
   */
  function isJudgeable(uint id) external view returns (bool);

  // no id => uri of the whole team.  id => uri of the individual qa'er
  function getUri(uint id) external view returns (string memory);

  function name() external view returns (string memory);

  /**
   * The QA can opt to veto the change by reverting this call.
   * Allows the QA to be selective about what they will accept.
   * @param changeId the id of the change
   * @return the dispute window size in seconds used for this change.  Only
   * used for headers and packets
   */
  function onChange(uint changeId) external view returns (uint);

  /**
   * The QA can opt to veto the change by reverting this call
   * Allows the QA to be selective about what they will accept.
   * @param changeId id of the change
   * @param payments list of payments being used to fund with
   */
  function onFund(uint changeId, Payment[] calldata payments) external view;

  /**
   * QA for a change can control all the transfer operations
   * @param operator the address doing the transfer
   * @param from the address the transfer is from
   * @param to the address the transfer is to
   * @param id the id of the token
   * @param amount the amount of the token
   */
  function onTransfer(
    address operator,
    address from,
    address to,
    uint id,
    uint amount
  ) external view;
}
