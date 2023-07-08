// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract MockDai is ERC20 {
  constructor() ERC20('MockDai', 'DAI') {
    _mint(msg.sender, 100000000 * 10 ** decimals());
  }
}
