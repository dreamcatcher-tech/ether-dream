require('@nomicfoundation/hardhat-toolbox')
require('hardhat-gas-reporter')
require('dotenv').config()

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: '0.8.18',
  gasReporter: {
    currency: 'USD',
    token: 'ETH',
    coinmarketcap: process.env.CMC,
  },
  // networks: {
  //   hardhat: {
  //     allowUnlimitedContractSize: true,
  //   },
  // },
}
