import { isDirect, getChange, isChange } from './multiMachine.js'
import test from '../testFactory.js'
import { expect } from 'chai'
import {
  and,
  isCount,
  count,
  skipActors,
  skipAccountMgmt,
  max,
} from './filters.js'
import { startLoggingActor, scripts } from './paths.js'
import Debug from 'debug'
const debug = Debug('tests')

globalThis.process.env.MODEL === '1' &&
  describe('double solutions', () => {
    it('handles two resolved solutions', (done) => {
      const actor = startLoggingActor(done, debug)
      const { proposePacket, resolveChange, solve } = scripts
      actor(proposePacket, resolveChange)

      expect(actor.state.matches('stack.open')).to.be.true
      expect(isDirect(actor.context, { type: 'PACKET' })).to.be.true

      actor(solve, resolveChange)

      expect(actor.state.matches('stack.enacted')).to.be.true
      expect(count({ type: 'PACKET', enacted: true })(actor.state)).to.equal(1)

      actor('PREV')
      expect(isDirect(actor.context, { type: 'PACKET' })).to.be.true
      actor(solve, resolveChange)

      expect(count({ type: 'SOLUTION' })(actor.state)).to.equal(2)

      done()
    })

    it('can survive multiple dispute rounds')
    it('does not dither between next and prev', (done) => {
      const actor = startLoggingActor(done, debug)
      const { proposePacket } = scripts
      actor(proposePacket, proposePacket, proposePacket)

      expect(actor.context.changes.length).to.equal(3)
      expect(actor.context.selectedChange).to.equal(2)
      actor('PREV', 'PREV', 'PREV')
      expect(actor.context.selectedChange).to.equal(0)

      actor('NEXT')
      expect(actor.context.selectedChange).to.equal(0)

      done()
    })

    test('double solution', {
      toState: and(
        isCount(1, { type: 'PACKET', enacted: true }),
        isCount(1, { type: 'SOLUTION', qaResolved: true, qaTickStart: 1 }),
        isCount(2, { type: 'SOLUTION', qaRejected: true, qaTickStart: 1 })
      ),
      filter: and(
        skipActors('funder', 'trader', 'editor', 'superQa'),
        skipAccountMgmt(),
        max(5), // max total changes
        max(1, { type: 'HEADER' }),
        max(3, { type: 'SOLUTION' }),
        max(1, { type: 'SOLUTION', qaResolved: true }),
        max(2, { type: 'SOLUTION', qaRejected: true }),
        max(0, { type: 'DISPUTE' }),
        (state, event) => {
          // vastly reduces the possible paths
          if (event.type === 'PREV') {
            const change = getChange(state.context)
            return isChange(change, {
              type: 'SOLUTION',
              qaTickStart: 1,
            })
          }
          if (event.type === 'NEXT') {
            return false
          }
          return true
        }
      ),
      sut: {},
    })
  })
