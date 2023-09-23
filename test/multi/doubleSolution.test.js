import {
  ACCOUNT_MANAGEMENT_EVENTS,
  isDirect,
  machine,
  options,
} from './multiMachine.js'
import test, { logConfig } from '../testFactory.js'
import { sendBatch } from '../utils.js'
import { and } from '../conditions.js'
import { createActor, createMachine, assign } from 'xstate'
import { expect } from 'chai'
import { skipActors, skipAccountMgmt, skipNavigation, max } from './filters.js'
import Debug from 'debug'
const debug = Debug('tests')

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
    expect(isDirect(current.context, { type: 'PACKET' })).to.be.true

    done()
  })
})

describe('double solution', () => {
  test.skip({
    toState: (state) => {
      return (
        isDirect(state.context, { type: 'PACKET' }) &&
        state.matches('stack.enacted') &&
        count({ type: 'SOLUTION' })(state) === 2
      )
    },
    dry: true,
    // debug: true,
    first: true,
    filter: and(
      skipActors(
        'funder',
        // 'disputer',
        'trader',
        // 'service',
        'editor',
        'superQa'
        // 'qa',
        // 'solver'
      ),
      skipAccountMgmt(),
      max(1, { type: 'HEADER' }),
      max(2, { type: 'SOLUTION' }),
      max(0, { type: 'DISPUTE' }),
      skipNavigation,

      // next and prev should not be able to dither
      // they can only go to the end directly if they make no changes
      (state, event) => {
        // console.log('state', longest(state), 'event', event.type)
        // console.log('changeCount', state.context.changes.length)
        console.log(
          'changes',
          state.context.changes.map((c) => c.type),
          state.toStrings(),
          event.type
        )
        return true
      }
    ),
  })
})

it('can survive multiple dispute rounds')
