import { isDirect, getChange, isChange } from './multiMachine.js'
import test from '../testFactory.js'
import { expect } from 'chai'
import {
  and,
  isCount,
  count,
  skipAccountMgmt,
  max,
  withActors,
} from './filters.js'
import { startLoggingActor, scripts } from './paths.js'
import Debug from 'debug'
const debug = Debug('test')

globalThis.process.env.MODEL === '1' &&
  describe('double solutions', () => {
    it('handles two resolved solutions', (done) => {
      const actor = startLoggingActor(done, debug)
      const { proposePacket, resolve, time, enact, solve } = scripts
      actor(proposePacket, resolve, time, enact)

      expect(actor.state.matches('stack.open')).to.be.true
      expect(isDirect(actor.context, { type: 'PACKET' })).to.be.true

      actor(solve, resolve, time, enact)

      expect(actor.state.matches('stack.enacted')).to.be.true
      expect(count({ type: 'PACKET', enacted: true })(actor.state)).to.equal(1)

      actor('PREV')
      expect(isDirect(actor.context, { type: 'PACKET' })).to.be.true
      actor(solve, resolve)

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
      expect(() => actor('PREV', 'PREV', 'PREV')).to.throw('not change')
      expect(actor.context.selectedChange).to.equal(0)

      expect(() => actor('NEXT')).to.throw('not change')
      expect(actor.context.selectedChange).to.equal(0)

      done()
    })
    test('triple solution', {
      toState: and(
        isCount(1, { type: 'PACKET', enacted: true }),
        isCount(1, {
          type: 'SOLUTION',
          qaResolved: true,
          qaTickStart: 1,
        }),
        isCount(2, {
          type: 'SOLUTION',
          qaRejected: true,
          qaTickStart: 1,
        })
      ),
      filter: and(
        withActors('qa', 'solver', 'time', 'service'),
        skipAccountMgmt(),
        max(5), // max total changes
        max(3, { type: 'SOLUTION' }),
        max(1, { type: 'SOLUTION', qaResolved: true }),
        max(2, { type: 'SOLUTION', qaRejected: true }),
        max(0, { type: 'SOLUTION', qaTickStart: 2 }),
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
