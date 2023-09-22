import { isChange, isDirect, machine, options } from './multiMachine.js'
import test, { logConfig } from '../testFactory.js'
import { longest } from '../utils.js'
import { and } from '../conditions.js'
import { createActor, createMachine, assign } from 'xstate'
import { expect } from 'chai'
import Debug from 'debug'
const debug = Debug('tests')

const skipActors = (...actors) => {
  for (const actor of actors) {
    if (machine.states.actors.states[actor] === undefined) {
      throw new Error(`Actor ${actor} not found`)
    }
  }
  return (state) => {
    for (const actor of actors) {
      if (state.matches('actors.' + actor)) {
        return false
      }
    }
    return true
  }
}

const skipAccountMgmt = (...groups) => {
  if (!groups.length) {
    groups = ['exited', 'approvalSet']
  }
  if (!groups.length) {
    throw new Error('No groups provided')
  }
  return skipActors(...groups)
}
const skipNavigation = (state, event) => {
  if (event.type === 'NEXT' || event.type === 'PREV') {
    return false
  }
  return true
}

const max = (limit, params) => (state) => {
  let count = 0
  for (const change of state.context.changes) {
    if (isChange(change, params)) {
      count++
    }
    if (count > limit) {
      return false
    }
  }
  return true
}
const globalEvents = new Set(Object.keys(machine.config.on))
const skipJitter = (state, event) => {
  const localEvents = state.nextEvents.filter((e) => {
    return !globalEvents.has(e)
  })
  if (!localEvents.length) {
    return true
  }
  return localEvents.includes(event.type)
}
const SKIPS = [
  'NEXT',
  'PREV',
  'MANUAL_TICK_TIME',
  'EXIT',
  'EXIT_SINGLE',
  'BURN',
  'REVOKE_OPERATOR',
  'APPROVE_OPENSEA',
  'APPROVE_OPERATOR',
  'REVOKE_OPENSEA',
]

describe('machine scripted testing', () => {
  it('gets to enacted', (done) => {
    const loggingOptions = logConfig(options)
    const logging = createMachine(machine.config, loggingOptions)
    const actor = createActor(logging).start()
    let current
    actor.subscribe({
      next: (state) => {
        debug('state', state.toStrings())
        debug(
          state.nextEvents.filter(
            (e) => !e.startsWith('BE_') && !SKIPS.includes(e)
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
    const proposePacket = ['BE_PROPOSER', 'DO']
    const resolveChange = [
      'BE_QA',
      'DO',
      'QA_RESOLVE',
      'MANUAL_TICK_TIME',
      'BE_SERVICE',
      'DO',
    ]
    Debug.enable('tests*')
    send(actor, proposePacket, resolveChange)

    expect(current.matches('stack.open')).to.be.true
    expect(isDirect(current.context, { type: 'PACKET' })).to.be.true

    const proposeSolution = ['BE_SOLVER', 'DO']
    send(actor, proposeSolution, resolveChange)

    expect(current.matches('stack.enacted')).to.be.true
    expect(isDirect(current.context, { type: 'PACKET' })).to.be.true

    done()
  })
})

const send = (actor, ...actions) => {
  const script = []
  for (const actionArray of actions) {
    if (!Array.isArray(actionArray)) {
      script.push([actionArray])
    } else {
      script.push(...actionArray)
    }
  }
  for (const action of script) {
    debug('sending: ', action)
    actor.send({ type: action })
  }
}

describe.only('multiMachine', () => {
  Debug.enable('tests:action')
  test({
    toState: (state) => {
      return (
        isDirect(state.context, { type: 'PACKET' }) &&
        state.matches('stack.enacted')
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
      max(1, { type: 'SOLUTION' }),
      max(0, { type: 'DISPUTE' }),
      skipNavigation,
      skipJitter
      // (state, event) => {
      //   // console.log('state', longest(state), 'event', event.type)
      //   // console.log('changeCount', state.context.changes.length)
      //   console.log(
      //     'changes',
      //     state.context.changes.map((c) => c.type),
      //     state.toStrings(),
      //     event.type
      //   )
      //   return true
      // }
    ),
  })
})

// provide a limits object that has a set of predefined fields
// which limit the machine traversal, like number of changes allowed,
// number of defund cycles, number of dispute cycles, etc.

it('can survive multiple dispute rounds')
