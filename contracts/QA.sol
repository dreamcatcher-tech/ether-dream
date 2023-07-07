// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./Types.sol";

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
}
