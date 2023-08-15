// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import './Types.sol';
import 'base58-solidity/contracts/Base58.sol';

library LibraryUtils {
  function isEther(Asset memory asset) internal pure returns (bool) {
    return asset.tokenContract == ETH_ADDRESS && asset.tokenId == ETH_TOKEN_ID;
  }

  function isIpfs(bytes32 ipfsHash) internal pure returns (bool) {
    return ipfsHash != 0;
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
