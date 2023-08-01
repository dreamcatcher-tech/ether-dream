// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './IDreamcatcher.sol';

interface IQA {
  function appealFundThreshold() external view returns (Payment memory);

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

contract QA is IQA {
  function appealFundThreshold()
    external
    view
    override
    returns (Payment memory)
  {
    // TODO
    return Payment(ETH_ADDRESS, ETH_TOKEN_ID, 0);
  }

  function publishTransition(uint id) external override returns (bool) {
    // TODO
    return true;
  }

  function defunded(uint id) external override returns (bool) {
    // TODO
    return true;
  }

  function passQA(uint id, address dreamcatcher) external {
    IDreamcatcher dc = IDreamcatcher(dreamcatcher);
    Shares[] memory shares = new Shares[](1);
    shares[0] = Shares(msg.sender, 1);
    dc.qaResolve(id, shares);
  }

  function failQA(uint id, bytes32 reason, address dc) external {
    IDreamcatcher dreamcatcher = IDreamcatcher(dc);
    dreamcatcher.qaReject(id, reason);
  }

  function getUri(uint id) external view override returns (string memory) {
    // TODO
    return 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  }
}
