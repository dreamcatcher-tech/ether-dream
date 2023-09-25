import {
  ACCOUNT_MANAGEMENT_EVENTS,
  isDirect,
  machine,
  options,
  getChange,
  isChange,
} from './multiMachine.js'
import test, { logConfig } from '../testFactory.js'
import { sendBatch } from '../utils.js'
import { createActor, createMachine } from 'xstate'
import { expect } from 'chai'
import {
  and,
  isCount,
  count,
  skipActors,
  skipAccountMgmt,
  max,
} from './filters.js'
import Debug from 'debug'
const debug = Debug('tests')

globalThis.process.env.MODEL === '1' &&
  describe('double solutions', () => {
    it('handles two resolved solutions', (done) => {
      const loggingOptions = logConfig(options)
      const logging = createMachine(machine.config, loggingOptions)
      const actor = createActor(logging).start()
      const NO_LOG = ['NEXT', 'PREV', ...ACCOUNT_MANAGEMENT_EVENTS]
      let current

      actor.subscribe({
        next: (state) => {
          debug('state', state.toStrings())
          debug(
            state.nextEvents.filter(
              (e) => !e.startsWith('BE_') && !NO_LOG.includes(e)
            )
          )
          current = state
        },
        error: (error) => {
          done(error)
        },
        complete: () => {
          debug('DONE')
        },
      })
      const proposePacket = ['BE_PROPOSER', 'PROPOSE_PACKET']
      const resolveChange = [
        'BE_QA',
        'DO',
        'QA_RESOLVE',
        'BE_DISPUTER',
        'DO',
        'TICK_TIME',
        'BE_SERVICE',
        'ENACT',
      ]
      sendBatch(actor, proposePacket, resolveChange)

      expect(current.matches('stack.open')).to.be.true
      expect(isDirect(current.context, { type: 'PACKET' })).to.be.true

      const proposeSolution = ['BE_SOLVER', 'PROPOSE_SOLUTION']
      sendBatch(actor, proposeSolution, resolveChange)

      expect(current.matches('stack.enacted')).to.be.true
      expect(count({ type: 'PACKET', enacted: true })(current)).to.equal(1)

      sendBatch(actor, 'PREV')
      expect(isDirect(current.context, { type: 'PACKET' })).to.be.true
      sendBatch(actor, proposeSolution, resolveChange)

      expect(count({ type: 'SOLUTION' })(current)).to.equal(2)

      done()
    })

    it('can survive multiple dispute rounds')
    it('does not dither between next and prev', (done) => {
      const loggingOptions = logConfig(options)
      const logging = createMachine(machine.config, loggingOptions)
      const actor = createActor(logging).start()
      const NO_LOG = ['NEXT', 'PREV', ...ACCOUNT_MANAGEMENT_EVENTS]
      let current

      actor.subscribe({
        next: (state) => {
          debug('state', state.toStrings())
          debug(
            state.nextEvents.filter(
              (e) => !e.startsWith('BE_') && !NO_LOG.includes(e)
            )
          )
          current = state
        },
        error: (error) => {
          done(error)
        },
        complete: () => {
          debug('DONE')
        },
      })
      const proposePacket = ['BE_PROPOSER', 'PROPOSE_PACKET']
      sendBatch(actor, proposePacket, proposePacket, proposePacket)

      expect(current.context.changes.length).to.equal(3)
      expect(current.context.selectedChange).to.equal(2)
      sendBatch(actor, 'PREV', 'PREV', 'PREV')
      expect(current.context.selectedChange).to.equal(0)

      sendBatch(actor, 'NEXT')
      expect(current.context.selectedChange).to.equal(0)

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
