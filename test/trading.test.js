import { initializeSut } from './sut.js'
import { filters } from './machine.js'
import { is, and } from './conditions.js'
import { expect } from 'chai'
import test from './testFactory.js'

describe(`trading`, () => {
  it('errors on totalSupply for invalid nft id', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    const msg = 'NFT does not exist'
    await expect(dreamEther.totalSupply(0)).to.be.revertedWith(msg)
    await expect(dreamEther.totalSupply(1)).to.be.revertedWith(msg)
    await expect(dreamEther.totalSupply(100)).to.be.revertedWith(msg)
  })
  it('rejects data on trades', async () => {
    const sut = await initializeSut()
    const { dreamEther, owner } = sut.fixture
    const fakeNftId = 0
    const fakeAmount = 0
    const fakeData = ethers.randomBytes(1)
    await expect(
      dreamEther.safeTransferFrom(owner, owner, fakeNftId, fakeAmount, fakeData)
    ).to.be.revertedWith('Data not supported')
  })
  describe('header funding shares can trade', () => {
    test({
      toState: (state) =>
        state.matches('open') && is({ tradedFunds: true })(state.context),
      filter: and(
        filters.allowedStates('idle', 'open', 'tradeFunds'),
        filters.skipDefunding,
        filters.skipDisputes,
        filters.dai
      ),
      verify: async (sut) =>
        expect(sut.events.TRADE_FUNDS).to.have.been.calledOnce &&
        expect(sut.tests.nooneHasNoBalance).to.have.been.calledOnce,
    })
  })

  describe('meta content shares can trade', () => {
    test({
      toState: (state) =>
        state.matches('enacted') && is({ contentTraded: true })(state.context),
      filter: and(
        filters.skipFunding,
        filters.skipDefunding,
        filters.skipDisputes
      ),
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
        filters.skipFundTrading,
        filters.skipDefunding,
        filters.skipDisputes,
        filters.skipExit
      ),
      verify: (sut) => expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
    })
  })
  describe('unfunded packet content shares trade without claim', () => {
    test({
      toState: (state) =>
        state.matches('solved') &&
        is({ contentTraded: true, funded: false })(state.context),
      filter: and(
        filters.skipFunding,
        filters.skipMetaTrading,
        filters.skipDefunding,
        filters.skipDisputes
      ),
      verify: (sut) =>
        expect(sut.tests.noFundsToClaim).to.have.been.calledTwice &&
        expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
    })
  })
  describe('unclaimed packet content shares cannot trade', () => {
    test({
      toState: (state) =>
        state.matches('tradePacketContent') &&
        is({ isClaimed: false, funded: true, defundExited: false })(
          state.context
        ),
      filter: and(
        filters.skipMetaFunding,
        filters.skipMetaTrading,
        filters.skipFundTrading,
        filters.skipDefunding,
        filters.skipDisputes,
        filters.dai
      ),
      verify: (sut) =>
        expect(sut.tests.packetContentUntransferrable).to.have.been.calledOnce,
    })
  })
  it('header QA shares can be traded')

  it('content shares can be traded')
  it('funding shares can be traded')
  it('no trading before claimin')
  it('unfunded packets are tradeable without claim')
  it('QA Medallion can be traded')
})
