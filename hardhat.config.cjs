require('@nomicfoundation/hardhat-toolbox')
require('hardhat-gas-reporter')
require('hardhat-contract-sizer')
require('dotenv').config()

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: '0.8.18',
  gasReporter: {
    currency: 'USD',
    token: 'ETH',
    coinmarketcap: process.env.CMC,
    // token: 'MATIC',
    // gasPriceApi:
    //   'https://api.polygonscan.com/api?module=proxy&action=eth_gasPrice',
  },
  // networks: {
  //   hardhat: {
  //     allowUnlimitedContractSize: true,
  //   },
  // },
  contractSizer: {
    // runOnCompile: true,
  },
}
