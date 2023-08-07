// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import './Types.sol';

library Utils {
  function isEther(Payment memory p) internal pure returns (bool) {
    return p.token == ETH_ADDRESS && p.tokenId == ETH_TOKEN_ID;
  }

  function isIpfs(bytes32 ipfsHash) internal pure returns (bool) {
    return true;
  }
}
