// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;
import './Types.sol';
import 'base58-solidity/contracts/Base58.sol';

library LibraryUtils {
  function isEther(Asset memory asset) internal pure returns (bool) {
    return asset.tokenContract == ETH_ADDRESS && asset.tokenId == ETH_TOKEN_ID;
  }

  function isIpfs(bytes32 ipfsHash) internal pure returns (bool) {
    return ipfsHash != 0;
  }

  function uri(
    Change storage c,
    uint assetId
  ) public view returns (string memory) {
    string memory suffix = '';

    if (assetId == CONTENT_ASSET_ID) {
      if (c.changeType == ChangeType.PACKET) {
        suffix = 'PACKET';
      } else if (c.changeType == ChangeType.DISPUTE) {
        suffix = 'DISPUTE';
      } else {
        suffix = 'META';
      }
    } else if (assetId == QA_MEDALLION_ASSET_ID) {
      suffix = 'QA_MEDALLION';
    } else {
      if (c.changeType == ChangeType.PACKET) {
        suffix = 'PACKET_FUNDING';
      } else if (c.changeType == ChangeType.DISPUTE) {
        suffix = 'DISPUTE_FUNDING';
      } else {
        suffix = 'META_FUNDING';
      }
    }
    assert(bytes(suffix).length > 0);

    return toCIDv0(c.contents, suffix);
  }

  function toCIDv0(
    bytes32 ipfsHash,
    string memory suffix
  ) internal pure returns (string memory) {
    string memory cid = Base58.encodeToString(
      abi.encodePacked(hex'1220', ipfsHash)
    );
    return string(abi.encodePacked('ipfs://', cid, '/', suffix));
  }
}
