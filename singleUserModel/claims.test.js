import { expect } from 'chai'
import { filters } from './machine.js'
import { is, and } from './conditions.js'
import test from './testFactory.js'

describe(`claims`, () => {
  describe(`solver can claim funds`, () => {
    test({
      toState: (state) =>
        state.matches('solved') && is({ isClaimed: true })(state.context),
      filter: and(
        filters.skipMetaFunding,
        filters.skipTrading,
        filters.skipDefunding,
        filters.skipDisputes
      ),
      verify: (sut) =>
        expect(sut.events.CLAIM).to.have.been.calledOnce &&
        expect(sut.tests.noQaClaimPackets).to.have.been.calledTwice,
    })
  })
  describe('only QA can claim meta funding', () => {
    test({
      toState: (state) =>
        state.matches('enacted') && is({ isQaClaimed: true })(state.context),
      filter: and(
        filters.skipPacketFunding,
        filters.skipTrading,
        filters.dai,
        filters.skipDisputes,
        filters.skipDefunding
      ),
      verify: (sut) =>
        expect(sut.events.QA_CLAIM).to.have.been.calledOnce &&
        expect(sut.tests.qaReClaim).to.have.been.calledOnce &&
        expect(sut.tests.qaInvalidClaim).to.have.been.calledOnce,
    })
  })
  describe('claim rejects when no funding present', () => {
    test({
      toState: (state) => state.matches('solved'),
      filter: and(
        filters.skipFunding,
        filters.skipTrading,
        filters.skipDisputes
      ),
      verify: (sut) => expect(sut.tests.noFundsToClaim).to.have.been.calledOnce,
    })
  })
  describe('QA claim rejects when no funding present', () => {
    test({
      toState: (state) =>
        state.matches('qaClaim') && is({ funded: false })(state.context),
      filter: and(
        filters.skipFunding,
        filters.skipTrading,
        filters.skipDisputes
      ),
      verify: (sut) =>
        expect(sut.tests.noQaFundsToClaim).to.have.been.calledOnce,
    })
  })

  describe('QA cannot claim packets', () => {
    test({
      toState: (state) =>
        state.matches('solved') &&
        is({ funded: true, isClaimed: false })(state.context),
      filter: and(
        filters.skipMetaFunding,
        filters.skipTrading,
        filters.skipDefunding,
        filters.skipDisputes,
        filters.dai
      ),
      verify: (sut) =>
        expect(sut.tests.noQaClaimPackets).to.have.been.calledOnce,
    })
  })

  it.skip('a single NFT can be claimed between two content share holders')
})
