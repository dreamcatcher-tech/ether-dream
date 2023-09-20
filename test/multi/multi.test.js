import { getChange, machine } from './multiMachine.js'
import test from '../testFactory.js'
import { longest } from '../utils.js'
import { and } from '../conditions.js'
import { createActor } from 'xstate'
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

const maxHeaders = (maxHeaders) => (state, event) => {
  let headerCount = 0
  for (const change of state.context.changes) {
    if (change.type === 'HEADER') {
      headerCount++
    }
    if (headerCount > maxHeaders) {
      return false
    }
  }
  return true
}

describe('machine scripted testing', () => {
  it('gets to enacted', (done) => {
    Debug.enable('tests')
    const actor = createActor(machine).start()
    let current
    actor.subscribe({
      next: (state) => {
        debug('state', state.toStrings())
        debug(state.nextEvents.filter((e) => !e.startsWith('BE_')))
        current = state
      },
      error: (error) => {
        done(error)
      },
      complete: () => {
        debug('DONE')
      },
    })
    const resolveChange = [
      'BE_QA',
      'DO',
      'QA_RESOLVE',
      'MANUAL_TICK_TIME',
      'BE_SERVICE',
      'DO',
    ]
    const proposePacket = ['BE_PROPOSER', 'DO']
    send(actor, proposePacket, resolveChange)

    expect(current.matches('stack.actions.open')).to.be.true
    expect(current.matches('stack.view.type.packet')).to.be.true

    const proposeSolution = ['BE_SOLVER', 'DO']
    send(actor, proposeSolution, resolveChange)

    expect(current.matches('stack.actions.open')).to.be.true
    expect(current.matches('stack.view.type.packet')).to.be.true

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

describe('multiMachine', () => {
  test.skip({
    toState: (state) => {
      const change = getChange(state.context)
      // console.log('change', change)
      // return change.type === 'PACKET'
      return state.matches('stack.actions.enacted')
      // return state.context.selectedChange === 1
      // how to get a packet ?
    },
    dry: true,
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
      maxHeaders(1),
      (state, event) => {
        // console.log('state', longest(state), 'event', event.type)
        // console.log('changeCount', state.context.changes.length)
        // console.log(
        //   'changes',
        //   state.context.changes.map((c) => c.type)
        // )
        return true
      }
    ),
  })
})

// provide a limits object that has a set of predefined fields
// which limit the machine traversal, like number of changes allowed,
// number of defund cycles, number of dispute cycles, etc.

it('can survive multiple dispute rounds')
