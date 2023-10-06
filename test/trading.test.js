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

  test.only('funded packet content shares can trade', {
    dbg: true,
    first: true,
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
    verify: (sut) => expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
  })
  // test('unfunded packet content shares trade without claim', {
  //   toState: (state) =>
  //     state.matches('solved') &&
  //     is({ contentTraded: true, funded: false })(state.context),
  //   filter: and(
  //     filters.skipFunding,
  //     filters.skipMetaTrading,
  //     filters.skipDefunding,
  //     filters.skipDisputes
  //   ),
  //   verify: (sut) =>
  //     expect(sut.tests.noFundsToClaim).to.have.been.calledTwice &&
  //     expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
  // })
  // test('unclaimed packet content shares cannot trade', {
  //   toState: (state) =>
  //     state.matches('tradePacketContent') &&
  //     is({ isClaimed: false, funded: true, defundExited: false })(
  //       state.context
  //     ),
  //   filter: and(
  //     filters.skipMetaFunding,
  //     filters.skipMetaTrading,
  //     filters.skipFundTrading,
  //     filters.skipDefunding,
  //     filters.skipDisputes,
  //     filters.dai
  //   ),
  //   verify: (sut) =>
  //     expect(sut.tests.packetContentUntransferrable).to.have.been.calledOnce,
  // })
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
