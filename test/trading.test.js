import { initializeSut } from './sut.js'
import {
  and,
  isCount,
  skipActors,
  skipAccountMgmt,
  skipNavigation,
  max,
} from './multi/filters.js'
import { expect } from 'chai'
import test from './testFactory.js'

describe.only(`trading`, () => {
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
  test.only('header funding shares can trade', {
    dry: true,
    toState: (state) => state.matches('stack.contentTrading.traded'),
    // && state.matches('stack.fundsTrading.traded')
    // && state.matches('stack.qaMedallionTrading.traded')
    filter: and(
      skipActors('solver', 'editor', 'superQa'),
      skipAccountMgmt(),
      max(1, { type: 'HEADER' }),
      max(1),
      skipNavigation
    ),
    verify: async (sut) =>
      expect(sut.events.TRADE_FUNDS).to.have.been.calledOnce &&
      expect(sut.tests.nooneHasNoBalance).to.have.been.calledOnce,
  })

  // test('meta content shares can trade', {
  //   toState: (state) =>
  //     state.matches('enacted') && is({ contentTraded: true })(state.context),
  //   filter: and(
  //     filters.skipFunding,
  //     filters.skipDefunding,
  //     filters.skipDisputes
  //   ),
  //   verify: async (sut) => {
  //     expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce
  //     const { dreamEther, solver1, noone } = sut.fixture
  //     const firstId = 1
  //     const nftId = await dreamEther.contentNftId(firstId)
  //     const balance = await dreamEther.balanceOf(solver1, nftId)
  //     expect(balance).to.be.greaterThan(0)
  //     const tx = dreamEther
  //       .connect(solver1)
  //       .safeTransferFrom(solver1, noone, nftId, balance, '0x')
  //     await expect(tx).to.emit(dreamEther, 'TransferSingle')
  //     expect(await dreamEther.balanceOf(solver1, nftId)).to.equal(0)
  //   },
  // })
  // test('funded packet content shares can trade', {
  //   toState: (state) =>
  //     state.matches('solved') &&
  //     is({
  //       contentTraded: true,
  //       isClaimed: true,
  //       fundedEth: true,
  //       fundedDai: false,
  //     })(state.context),
  //   filter: and(
  //     filters.skipMetaFunding,
  //     filters.skipMetaTrading,
  //     filters.skipFundTrading,
  //     filters.skipDefunding,
  //     filters.skipDisputes,
  //     filters.skipExit
  //   ),
  //   verify: (sut) => expect(sut.events.TRADE_CONTENT).to.have.been.calledOnce,
  // })
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
})
