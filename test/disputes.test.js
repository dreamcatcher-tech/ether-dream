import { filters, types } from './machine.js'
import { and, is } from './conditions.js'
import { expect } from 'chai'
import test from './testFactory.js'

const filter = and(
  filters.skipFunding,
  filters.skipTrading,
  filters.skipDefunding
)

describe('disputes', () => {
  describe('uphold dispute of a header being resolved', () => {
    test({
      toState: (state) =>
        state.matches('enacted') &&
        is({
          disputedResolve: true,
          disputeUpheld: true,
          type: types.HEADER,
        })(state.context),
      filter,
      verify: (sut) =>
        expect(sut.events.DISPUTE_RESOLVE).to.have.been.calledOnce &&
        expect(sut.events.SUPER_UPHELD).to.have.been.calledOnce &&
        expect(sut.events.SUPER_DISMISSED).to.have.not.been.called,
    })
  })
  describe('dismiss dispute of a header being resolved', () => {
    test({
      toState: (state) =>
        state.matches('enacted') &&
        is({
          disputedResolve: true,
          disputeDismissed: true,
          type: types.HEADER,
        })(state.context),
      filter,
      verify: (sut) =>
        expect(sut.events.DISPUTE_RESOLVE).to.have.been.calledOnce &&
        expect(sut.events.SUPER_DISMISSED).to.have.been.calledOnce &&
        expect(sut.tests.superDismissBeforeQa).to.have.been.calledOnce &&
        expect(sut.tests.superDismissInvalidHash).to.have.been.calledOnce &&
        expect(sut.tests.superDismissEarly).to.have.been.calledOnce &&
        expect(sut.tests.nonQaDismiss).to.have.been.calledOnce &&
        expect(sut.tests.superDismissAgain).to.have.been.calledOnce &&
        expect(sut.tests.superUpholdAfterDismiss).to.have.been.calledOnce &&
        expect(sut.events.SUPER_UPHELD).to.have.not.been.called,
    })
  })
  describe('uphold dispute of a header being rejected', () => {
    test({
      toState: (state) =>
        state.matches('enacted') &&
        is({
          disputedRejection: true,
          disputeUpheld: true,
          type: types.HEADER,
        })(state.context),
      filter,
      verify: (sut) =>
        expect(sut.events.QA_REJECT).to.have.been.calledOnce &&
        expect(sut.events.DISPUTE_REJECT).to.have.been.calledOnce &&
        expect(sut.events.SUPER_UPHELD).to.have.been.calledOnce &&
        expect(sut.tests.superDismissBeforeQa).to.have.been.calledTwice &&
        expect(sut.tests.disputeInvalidRejection).to.have.been.calledOnce,
    })
    // how does QA claim from a rejected header ?
    // can QA claim before enactment ?
  })
  it.skip('reverts if dispute window has passed')
  it.skip('disputes cannot be disputed')
  it.skip('cannot dispute a packet')
  it.skip('super qa can claim funds put against changes')
  it.skip('dispute upheld allocates shares')
  it.skip('dispute shares allows superQa to set any share split')
  it.skip('super cannot act before dispute window has passed')
})

// multiple concurrent disputes of the same type, or of different types

// dispute should pause the progress for a year.

// dispute should not be able to be settled until the pending window has closed
// this is required so that all disputes can be settled at once

// check getting the uri for the dispute

// check a dispute against resolve and shares concurrently

// MUST force superQa to only select one outcome for a given change

// check qa cannot claim while dispute is pending or after it got rejected

// check super qa can claim their fees

// check disputes are recognized so long as they are funded

// check cannot dispute an open change

// check only QA can super uphold

// open disputes during the solution packet closing time

// test storing our own nfts against packets

// test super timeout allowing anyone to enact packet.  If dispute super window has passed, then anyone can enact the packet.

// After dispute window, before super acts, no disputes are allowed

// superQa acting closes the round so not other actions are possible

// super cannot act until the dispute window has passed

// check that dispute content is created

// doulbe qa calls should error as the round has closed

// round outcome should be retrievable correctly
