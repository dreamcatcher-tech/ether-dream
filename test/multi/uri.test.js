import { is } from './multiMachine.js'
import test from '../testFactory.js'
import { startLoggingActor, scripts } from './paths.js'
import { expect } from 'chai'
import {
  and,
  isCount,
  skipAccountMgmt,
  skipNavigation,
  skipRejection,
  skipDefunding,
  skipEvents,
  max,
  withActors,
} from './filters.js'
import Debug from 'debug'
const debug = Debug('test')

globalThis.process.env.MODEL === '1' &&
  describe('all nft types are generated', () => {
    it('generates all nft types', (done) => {
      const actor = startLoggingActor(done, debug)
      const {
        proposePacket,
        fundEth,
        resolve,
        time,
        enact,
        solve,
        disputeResolve,
        uphold,
      } = scripts
      actor(proposePacket, fundEth, resolve, time, enact)
      expect(actor.state.matches('stack.open')).to.be.true
      expect(is({ type: 'PACKET' })(actor.state)).to.be.true

      actor(fundEth)
      actor(solve, resolve)
      // TODO expect state to be packet pending
      actor(disputeResolve, fundEth)
      // TODO expect state to be packet pending
      actor(time, uphold)
      expect(actor.state.matches('stack.open')).to.be.true

      actor(resolve, time, enact)

      const { state } = actor
      expect(
        isCount(1, { type: 'HEADER', fundedEth: true, disputed: false })(state)
      ).to.be.true
      expect(
        isCount(1, { type: 'PACKET', fundedEth: true, enacted: true })(state)
      ).to.be.true
      expect(
        isCount(1, {
          type: 'DISPUTE',
          disputeType: 'resolve',
          disputeUpheld: true,
          fundedEth: true,
        })(state)
      ).to.be.true
      expect(isCount(1, { type: 'SOLUTION', fundedEth: false })(state)).to.be
        .true
      done()
    })
    test('all packet types', {
      // expand: true,
      toState: and(
        isCount(1, { type: 'HEADER', fundedEth: true, disputed: false }),
        isCount(1, { type: 'PACKET', fundedEth: true, enacted: true }),
        isCount(1, {
          type: 'DISPUTE',
          disputeType: 'resolve',
          disputeUpheld: true,
          fundedEth: true,
        }),
        isCount(1, { type: 'SOLUTION', fundedEth: false })
      ),
      filter: and(
        withActors(
          'qa',
          'funder',
          'solver',
          'disputer',
          'time',
          'service',
          'superQa'
        ),
        skipAccountMgmt(),
        max(1, { type: 'HEADER' }),
        max(0, { type: 'HEADER', disputed: true }),
        max(1, { type: 'SOLUTION' }),
        max(1, { type: 'DISPUTE' }),
        max(4),
        skipRejection(),
        skipNavigation(),
        skipDefunding(),
        skipEvents(
          'FUND_DAI',
          'FUND_1155',
          'FUND_721',
          'ALL_DISPUTES_DISMISSED',
          'DISPUTE_SHARES',
          'DISPUTE_UPHELD_SHARES'
        )
      ),
      sut: {},
    })
  })
