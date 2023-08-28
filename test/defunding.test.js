import { filters } from './machine.js'
import { is, and } from './conditions.js'
import { expect } from 'chai'
import test from './testFactory.js'

const filter = and(
  filters.skipPacketFunding,
  filters.skipTrading,
  filters.allowedStates('idle', 'open', 'defund'),
  filters.dai
)

describe('defunding', () => {
  describe('start to defund a header', () => {
    test({
      toState: (state) =>
        state.matches('open') && is({ defundStarted: true })(state.context),
      filter,
      verify: (sut) =>
        expect(sut.events.DEFUND_START).to.have.been.calledOnce &&
        expect(sut.tests.defundExitBeforeStart).to.have.been.calledOnce &&
        expect(sut.tests.defundStopBeforeStart).to.have.been.calledOnce &&
        expect(sut.tests.defundDoubleStart).to.have.been.calledOnce,
    })
  })
  describe('defund a header', () => {
    test({
      toState: (state) =>
        state.matches('open') &&
        is({ defundEnded: true, defundExited: true })(state.context),
      filter,
      verify: (sut) =>
        expect(sut.events.DEFUND_START).to.have.been.calledOnce &&
        expect(sut.events.DEFUND_EXIT).to.have.been.calledOnce &&
        expect(sut.events.DEFUND_STOP).to.have.not.been.called &&
        expect(sut.tests.defundDoubleExit).to.have.been.calledOnce &&
        expect(sut.tests.defundEarly).to.have.been.calledOnce,
    })
  })
  describe('stop a defund on a header', () => {
    test({
      toState: (state) =>
        state.matches('open') &&
        is({ defundEnded: true, defundExited: false })(state.context),
      filter,
      verify: (sut) =>
        expect(sut.events.DEFUND_START).to.have.been.calledOnce &&
        expect(sut.events.DEFUND_STOP).to.have.been.calledOnce &&
        expect(sut.events.DEFUND_EXIT).to.have.not.been.called &&
        expect(sut.tests.defundRestart).to.have.been.calledOnce,
    })
  })
  describe('started defund is ignored in pending', () => {
    test({
      toState: (state) =>
        state.matches('pending') &&
        is({ defundStarted: true, defundEnded: false })(state.context),
      filter: and(
        filters.skipPacketFunding,
        filters.skipTrading,
        filters.allowedStates('idle', 'open', 'defund', 'pending'),
        filters.dai
      ),
      verify: (sut) =>
        expect(sut.tests.defundExitAfterQa).to.have.been.calledOnce &&
        expect(sut.tests.defundInvalidStart).to.have.been.calledOnce &&
        expect(sut.tests.defundInvalidStop).to.have.been.calledOnce,
    })
  })
  describe('started defund is ignored in enacted', () => {
    test({
      toState: (state) =>
        state.matches('enacted') &&
        is({ defundStarted: true, defundEnded: false })(state.context),
      filter: and(
        filters.skipPacketFunding,
        filters.skipTrading,
        filters.allowedStates('idle', 'open', 'defund', 'pending', 'enacted'),
        filters.dai
      ),
      verify: (sut) =>
        expect(sut.tests.defundExitAfterQa).to.have.been.calledTwice &&
        expect(sut.tests.defundInvalidStart).to.have.been.calledTwice &&
        expect(sut.tests.defundInvalidStop).to.have.been.calledTwice,
    })
  })
  it.skip('started defund is ignored in rejected')
  it.skip('reverts for a non-existent change')
  it.skip('non holder cannot defund')
  it.skip('can defund by one of two holders')
  it.skip('can partially defund a change')
  it.skip('can defund to an account with an existing exit debt')
})
