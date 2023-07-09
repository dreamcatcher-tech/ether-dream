# ether-dream

This project uses hardhat as the framework for developing ethereum smart contracts that provide a payments and escrow service for the [Dreamcatcher](https://dreamcatcher.land)

Use `npm` and not `yarn` as hardhat requires `npm` for its plugins to work correctly.  Apparently.

`npm i`

`npm t` to see the tests run - this uses model based testing to execute all the paths thru a state machine that models its behaviour.

`npm run watch` to get developing

`npm run gas` to see how much you'll lose by using these contracts in USD - not counting emotional damage


