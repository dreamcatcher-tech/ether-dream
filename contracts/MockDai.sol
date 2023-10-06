// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.21;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

uint constant MAX_UINT = 2 ** 256 - 1;

contract MockDai is ERC20 {
  constructor(address dreamcatcher) ERC20('MockDai', 'DAI') {
    _mint(msg.sender, 100000000 * 10 ** decimals());
    approve(dreamcatcher, MAX_UINT);
  }
}
