import { initializeSut } from './sut.js'
import { filters } from './machine.js'
import { is, and, globalIs } from './conditions.js'
import { expect } from 'chai'
import test from './testFactory.js'

describe(`exits`, () => {
  it('reverts on no exit balance', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    await expect(dreamEther.exit()).to.be.revertedWith('No exits available')
    const msg = 'No exit for asset'
    const notAssets = [0, 1, 100]
    for (const assetId of notAssets) {
      await expect(dreamEther.exitBurn(assetId)).to.be.revertedWith(msg)
      await expect(dreamEther.exitSingle(assetId)).to.be.revertedWith(msg)
    }
  })
  it('reverts on invalid tokens', async () => {
    const sut = await initializeSut()
    const { dreamEther, dai } = sut.fixture
    const notYetValidTokenId = 0
    await expect(
      dreamEther.getAssetId(dai.target, notYetValidTokenId)
    ).to.be.revertedWith('Asset does not exist')
  })
  it('reverts on invalid burn', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    const invalidAssetIds = [0, 1, 100]
    for (const assetId of invalidAssetIds) {
      await expect(dreamEther.exitBurn(assetId)).to.be.revertedWith(
        'No exit for asset'
      )
    }
  })
  it('reverts on invalid holder', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
    await expect(dreamEther.exitList(ZERO_ADDRESS)).to.be.revertedWith(
      'Invalid holder'
    )
  })

  describe('exit all assets', () => {
    test({
      toState: (state) =>
        state.matches('solved') &&
        is({ exited: true, fundedDai: true, fundedEth: true })(state.context),
      filter: and(
        filters.skipMetaFunding,
        filters.skipTrading,
        filters.skipDisputes,
        filters.skipDefunding
      ),
      verify: (sut) => expect(sut.events.EXIT).to.have.been.calledOnce,
    })
  })
  describe('exit specific assets', () => {
    test({
      toState: (state) =>
        state.matches('solved') &&
        is({ exited: true, fundedDai: true, fundedEth: true })(state.context),
      filter: and(
        filters.skipMetaFunding,
        filters.skipTrading,
        filters.skipDefunding,
        filters.skipDisputes
      ),
      verify: (sut) =>
        expect(sut.events.EXIT).to.have.been.calledOnce &&
        expect(sut.tests.exitSingle).to.have.been.calledOnce &&
        expect(sut.tests.exitBurn).to.have.been.calledOnce,
    })
  })
  describe('qa can exit', () => {
    test({
      toState: (state) =>
        state.matches('enacted') &&
        and(
          globalIs({ qaExited: true }),
          is({ isQaClaimed: true })
        )(state.context),
      filter: and(
        filters.skipTrading,
        filters.skipPacketFunding,
        filters.skipDefunding,
        filters.skipDisputes,
        filters.dai
      ),
      verify: (sut) =>
        expect(sut.events.QA_EXIT).to.have.been.calledOnce &&
        expect(sut.events.EXIT).to.not.have.been.called,
    })
  })
})
