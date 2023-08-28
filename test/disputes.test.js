import { filters, types } from './machine.js'
import { and, is } from './conditions.js'
import { expect } from 'chai'
import test from './testFactory.js'

describe('disputes', () => {
  describe('dispute a header', () => {
    // make a header, dispute it, approve it, observe header cancelled
    test({
      toState: (state) =>
        state.matches('enacted') &&
        is({ disputedResolve: true, type: types.HEADER })(state.context),
      filter: and(
        filters.skipFunding,
        filters.skipTrading,
        filters.skipDefunding
      ),
      verify: (sut) =>
        expect(sut.events.DISPUTE_RESOLVE).to.have.been.calledOnce &&
        expect(sut.events.SUPER_UPHELD).to.have.been.calledOnce,
    })
    // UP TO HERE - unverified test
  })
  it.skip('reverts if dispute window has passed')
  it.skip('disputes cannot be disputed')
  it.skip('cannot dispute a packet')
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
