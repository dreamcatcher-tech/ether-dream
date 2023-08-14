// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import './Types.sol';
import 'base58-solidity/contracts/Base58.sol';

library LibraryUtils {
  function isEther(Payment memory p) internal pure returns (bool) {
    return p.token == ETH_ADDRESS && p.tokenId == ETH_TOKEN_ID;
  }

  function isIpfs(bytes32 ipfsHash) internal pure returns (bool) {
    return true;
  }

  function toCIDv0(
    bytes32 ipfsHash,
    string memory suffix
  ) public pure returns (string memory) {
    string memory cid = Base58.encodeToString(
      abi.encodePacked(hex'1220', ipfsHash)
    );
    return string(abi.encodePacked('ipfs://', cid, '/', suffix));
  }
}
