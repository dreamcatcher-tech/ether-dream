import { initializeSut } from './sut.js'
import { is, filters, and } from './machine.js'
import { expect } from 'chai'
import test from './tester.js'

describe(`trading`, () => {
  it('errors on totalSupply for invalid nft id', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    const msg = 'NFT does not exist'
    await expect(dreamEther.totalSupply(0)).to.be.revertedWith(msg)
    await expect(dreamEther.totalSupply(1)).to.be.revertedWith(msg)
    await expect(dreamEther.totalSupply(100)).to.be.revertedWith(msg)
  })
  describe('header funding shares can trade', () => {
    test({
      toState: (state) =>
        state.matches('open') && is({ tradedFunds: true })(state.context),
      filter: (state) =>
        state.matches('open') ||
        state.matches('idle') ||
        state.matches('tradeFunds'),
      verify: async (sut) =>
        expect(sut.events.TRADE_FUNDS).to.have.been.calledOnce,
    })
  })

  describe('meta content shares can trade', () => {
    test({
      toState: (state) =>
        state.matches('enacted') && is({ contentTraded: true })(state.context),
      filter: filters.skipFunding,
      verify: (sut) => expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
    })
  })
  describe('funded packet content shares can trade', () => {
    test({
      toState: (state) =>
        state.matches('solved') &&
        is({
          contentTraded: true,
          isClaimed: true,
          fundedEth: true,
          fundedDai: false,
        })(state.context),
      filter: and(
        filters.skipMetaFunding,
        filters.skipMetaTrading,
        filters.skipFundTrading
      ),
      verify: (sut) => expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
    })
  })
  describe('unfunded packet content shares trade without claim', () => {
    test({
      toState: (state) =>
        state.matches('solved') &&
        is({ contentTraded: true, funded: false })(state.context),
      filter: and(filters.skipFunding, filters.skipMetaTrading),
      verify: (sut) =>
        expect(sut.tests.noFundsToClaim).to.have.been.calledTwice &&
        expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
    })
  })
  describe('unclaimed packet content shares cannot trade', () => {
    test({
      toState: (state) =>
        state.matches('tradePacketContent') &&
        is({ isClaimed: false, funded: true })(state.context),
      filter: and(
        filters.skipMetaFunding,
        filters.skipMetaTrading,
        filters.skipFundTrading
      ),
      verify: (sut) =>
        expect(sut.tests.packetContentUntransferrable).to.have.been.calledOnce,
    })
  })
  it.skip('header QA shares can be traded')

  it.skip('content shares can be traded')
  it.skip('funding shares can be traded')
  it.skip('can deny opensea operator access')
  it.skip('no trading before claimin')
  it.skip('unfunded packets are tradeable without claim')
})
