import {
  ACCOUNT_MANAGEMENT_EVENTS,
  isDirect,
  machine,
  options,
} from './multiMachine.js'
import test, { logConfig } from '../testFactory.js'
import { createActor, createMachine } from 'xstate'
import { expect } from 'chai'
import { sendBatch } from '../utils.js'
import {
  and,
  isCount,
  skipActors,
  skipAccountMgmt,
  skipNavigation,
  max,
} from './filters.js'
import Debug from 'debug'
const debug = Debug('tests')

describe('basics', () => {
  it('gets to enacted packet', (done) => {
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
    expect(isCount(1, { type: 'PACKET', enacted: true })(current)).to.be.true

    done()
  })

  test('simple solve packet', {
    toState: isCount(1, { type: 'PACKET', enacted: true }),
    filter: and(
      skipActors('funder', 'trader', 'editor', 'superQa'),
      skipAccountMgmt(),
      max(1, { type: 'HEADER' }),
      max(1, { type: 'SOLUTION' }),
      max(0, { type: 'DISPUTE' }),
      skipNavigation
    ),
    sut: {},
  })

  it('can survive multiple dispute rounds')
})
