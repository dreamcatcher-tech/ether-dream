import { expect } from 'chai'
import { isChange, ACCOUNT_MANAGEMENT_EVENTS, machine } from './multiMachine.js'

export const skipActors = (...actors) => {
  for (const actor of actors) {
    if (machine.states.actors.states[actor] === undefined) {
      throw new Error(`Actor ${actor} not found`)
    }
  }
  // map to the events that would transition into these states
  const events = actors.map((actor) => {
    for (const [event, value] of Object.entries(machine.config.on)) {
      if (value.target === '.actors.' + actor) {
        return event
      }
    }
    throw new Error(`Actor ${actor} transition not found`)
  })

  return (state, event) => !events.includes(event.type)
}

export const skipAccountMgmt = () => {
  const accounts = machine.states.actors
  expect(ACCOUNT_MANAGEMENT_EVENTS.every((a) => accounts.on[a])).to.be.ok
  return (state, event) => {
    if (ACCOUNT_MANAGEMENT_EVENTS.includes(event.type)) {
      return false
    }
    return true
  }
}
export const skipNavigation = (state, event) => {
  if (event.type === 'NEXT' || event.type === 'PREV') {
    return false
  }
  return true
}
export const isCount = (count, params) => (state) => {
  expect(count).to.be.greaterThanOrEqual(0)
  let c = 0
  for (const change of state.context.changes) {
    if (isChange(change, params)) {
      c++
    }
    if (c > count) {
      return false
    }
  }
  return c === count
}
export const count = (params) => (state) => {
  let count = 0
  for (const change of state.context.changes) {
    if (isChange(change, params)) {
      count++
    }
  }
  return count
}
export const max =
  (limit, params = {}) =>
  (state) => {
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

const NO_LOG = ['NEXT', 'PREV', ...ACCOUNT_MANAGEMENT_EVENTS]

export const log = (debug) => (state, event) => {
  debug('state %o', state.toStrings())
  debug('event', event.type)
  debug(
    'nextEvents %o',
    state.nextEvents.filter((e) => !e.startsWith('BE_') && !NO_LOG.includes(e))
  )

  return true
}
