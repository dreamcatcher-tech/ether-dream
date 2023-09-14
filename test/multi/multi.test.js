import { multiMachine } from './multiMachine.js'
import test from '../testFactory.js'

const skipActors = (...actors) => {
  for (const actor of actors) {
    if (multiMachine.states.actors.states[actor] === undefined) {
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

describe.only('multiMachine', () => {
  test({
    toState: (state) => {
      return state.context.selectedChange === 1
    },
    dry: true,
    filter: skipActors(
      'funder',
      'disputer',
      'trader',
      'service',
      'editor',
      'superQa',
      'qa',
      'solver'
    ),
  })
  // test({
  //   toState: (state) => {
  //     return state.context.selectedChange === 1
  //   },
  //   dry: true,
  // })
})

// provide a limits object that has a set of predefined fields
// which limit the machine traversal, like number of changes allowed,
// number of defund cycles, number of dispute cycles, etc.
