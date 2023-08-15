// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import './Types.sol';
import './LibraryUtils.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';

interface IERC20 {
  function transferFrom(
    address from,
    address to,
    uint256 value
  ) external returns (bool);
}

library LibraryChanges {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using LibraryChanges for Change;

  function isPacketSolved(Change storage packet) internal view returns (bool) {
    require(packet.createdAt != 0, 'Packet does not exist');
    require(packet.changeType == ChangeType.PACKET);

    return packet.contentShares.holders.length() != 0;
  }

  function createHeader(Change storage header, bytes32 contents) public {
    require(LibraryUtils.isIpfs(contents), 'Invalid contents');
    require(header.createdAt == 0, 'Header already exists');

    header.changeType = ChangeType.HEADER;
    header.createdAt = block.timestamp;
    header.contents = contents;
  }

  function isOpen(Change storage change) internal view returns (bool) {
    return change.createdAt != 0 && change.disputeWindowStart == 0;
  }

  function fund(
    Change storage change,
    Payment[] calldata payments
  ) public returns (Payment[] memory) {
    require(msg.value > 0 || payments.length > 0, 'Must send funds');
    require(change.isOpen(), 'Change is not open for funding');

    uint length = msg.value > 0 ? payments.length + 1 : payments.length;
    Payment[] memory funded = new Payment[](length);
    if (msg.value > 0) {
      Payment memory eth = Payment(ETH_ADDRESS, ETH_TOKEN_ID, msg.value);
      funded[payments.length] = eth;
    }
    for (uint i = 0; i < payments.length; i++) {
      Payment memory p = payments[i];
      require(p.amount > 0, 'Amount cannot be 0');
      require(p.token != address(0), 'Token address invalid');
      if (p.tokenId == 0) {
        // TODO handle erc1155 with a tokenId of zero
        IERC20 token = IERC20(p.token);
        require(token.transferFrom(msg.sender, address(this), p.amount));
      } else {
        IERC1155 token = IERC1155(p.token);
        token.safeTransferFrom(
          msg.sender,
          address(this),
          p.tokenId,
          p.amount,
          ''
        );
      }
      funded[i] = p;
    }
    delete change.fundingShares.defundWindows[msg.sender];
    return funded;
  }

  function updateHoldings(
    Change storage change,
    uint nftId,
    Payment memory payment
  ) public {
    uint funds = 0;
    if (change.funds.contains(nftId)) {
      funds = change.funds.get(nftId);
    }
    change.funds.set(nftId, funds + payment.amount);

    if (!change.fundingShares.holders.contains(msg.sender)) {
      change.fundingShares.holders.add(msg.sender);
    }
    uint holdings = 0;
    if (change.fundingShares.balances[msg.sender].contains(nftId)) {
      holdings = change.fundingShares.balances[msg.sender].get(nftId);
    }
    change.fundingShares.balances[msg.sender].set(
      nftId,
      holdings + payment.amount
    );
  }

  function defundStop(Change storage change) public {
    require(change.createdAt != 0, 'Change does not exist');
    require(change.fundingShares.defundWindows[msg.sender] != 0);

    delete change.fundingShares.defundWindows[msg.sender];
  }
}
