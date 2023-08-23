import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine, is, filters, and } from './machine.js'
import { expect } from 'chai'

describe(`exits`, () => {
  it('reverts on no exit balance', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    const msg = 'No exit for asset'
    const notAssets = [0, 1, 100]
    for (const assetId of notAssets) {
      await expect(dreamEther.exitBurn(assetId)).to.be.revertedWith(msg)
      await expect(dreamEther.exitSingle(assetId)).to.be.revertedWith(msg)
    }
  })

  describe('exit all assets', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('solved') && is({ isClaimed: true })(state.context),
      filter: and(filters.skipMetaFunding, filters.skipTrading),
    })
    expect(shortestPaths.length).to.be.greaterThan(0)
    // UP TO HERE
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        const sut = await initializeSut()
        await path.test(sut)
      })
    })
  })
  describe('exit a specific asset', () => {
    // test claiming a funded header and a funded solution all at once
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('enacted') && is({ contentTraded: true })(state.context),
      filter: filters.skipFunding,
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('burn a single asset', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('solved') && is({ contentTraded: true })(state.context),
      filter: filters.skipFunding,
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('unclaimed packet content shares error', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('tradePacketContent') &&
        is({ isClaimed: false, funded: true })(state.context),
      filter: and(
        filters.skipMetaFunding,
        filters.skipMetaTrading,
        filters.skipFundTrading
      ),
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  it.skip('header QA shares can be traded')

  it.skip('content shares can be traded')
  it.skip('funding shares can be traded')
  it.skip('can deny opensea operator access')
  it.skip('no trading before claimin')
  it.skip('unfunded packets are tradeable without claim')
})
