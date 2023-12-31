import { initializeSut } from './sut.js'
import {
  and,
  isCount,
  skipActors,
  skipAccountMgmt,
  skipEvents,
  skipDisputes,
  skipDefunding,
  skipFundPackets,
  skipMetaFunding,
  skipMetaTrading,
  skipNext,
  max,
  skipRejection,
  skipFundsTrading,
} from './multi/filters.js'
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
  test('header funding shares can trade', {
    toState: isCount(1, {
      type: 'HEADER',
      enacted: true,
      fundedEth: true,
      qaResolved: true,
      tradedFundsSome: true,
      tradedContentSome: true,
    }),
    filter: and(
      skipActors('proposer', 'solver', 'editor', 'superQa'),
      skipEvents('FUND_DAI', 'FUND_1155', 'FUND_721'),
      skipAccountMgmt(),
      skipDisputes(),
      skipDefunding(),
      skipFundPackets(),
      max(2)
    ),
    verify: async (sut) =>
      expect(sut.events.TRADE_SOME_FUNDS).to.have.been.calledOnce &&
      expect(sut.events.TRADE_SOME_CONTENT).to.have.been.calledOnce &&
      expect(sut.tests.nooneHasNoBalance).to.have.been.calledOnce,
  })

  test('funded packet content shares can trade', {
    toState: isCount(1, {
      type: 'PACKET',
      fundedEth: true,
      tradedContentSome: true,
      tradedMedallion: true,
      tradedContentAll: true,
    }),
    filter: and(
      skipActors('proposer', 'editor', 'superQa'),
      skipMetaFunding(),
      skipMetaTrading(),
      skipEvents('FUND_DAI', 'FUND_1155', 'FUND_721'),
      skipAccountMgmt(),
      skipDisputes(),
      skipDefunding(),
      skipRejection(),
      skipFundsTrading(),
      skipNext(),
      max(3)
    ),
    verify: (sut) => {
      expect(sut.events.TRADE_SOME_CONTENT).to.have.been.calledOnce
      expect(sut.events.TRADE_ALL_CONTENT).to.have.been.calledOnce
      expect(sut.events.TRADE_MEDALLION).to.have.been.calledOnce
    },
  })
  it('header QA shares can be traded')
  it('content shares can be traded')
  it('funding shares can be traded')
  it('no trading before claimin')
  it('unfunded packets are tradeable without claim')
  it('QA Medallion can be traded')
  it('cannot trade solution content shares')
  it('handles 999 share holders')
  it('can claim over two transactions')
  it('can fund an existing nft against a packet')
  it('can fund a qaMedallion against a packet')
  it('cannot transfer nfts that are part of an open dispute')
  it('trades after enacted if was defundable')
})
