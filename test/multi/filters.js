import { expect } from 'chai'
import {
  getChange,
  isChange,
  ACCOUNT_MANAGEMENT_EVENTS,
  machine,
} from './multiMachine.js'
export const and =
  (...functions) =>
  (...args) =>
    !functions.some((fn) => !fn(...args))
export const nand =
  (...functions) =>
  (...args) =>
    functions.some((fn) => !fn(...args))

export const skipActors = (...actors) => {
  for (const actor of actors) {
    if (machine.states.actors.states[actor] === undefined) {
      throw new Error(`Actor ${actor} not found`)
    }
  }
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

export const skipEvents = (...events) => {
  checkEvents(...events)
  return (state, event) => {
    return !events.includes(event.type)
  }
}

const checkEvents = (...events) => {
  for (const event of events) {
    expect(event).to.be.a('string')
    if (!machine.events.includes(event)) {
      throw new Error(`Event ${event} not found`)
    }
  }
}

export const skipDisputes = () => {
  const diputeEvents = [
    'DISPUTE_SHARES',
    'DISPUTE_RESOLVE',
    'DISPUTE_REJECTION',
  ]
  return skipEvents(...diputeEvents)
}
export const skipDefunding = () => {
  const diputeEvents = [
    'DEFUND_START',
    'DEFUND_STOP',
    'DEFUND',
    'TICK_DEFUND_TIME',
  ]
  return skipEvents(...diputeEvents)
}
const fundingEvents = ['FUND_ETH', 'FUND_DAI', 'FUND_1155', 'FUND_721']
export const skipFundPackets = () => {
  checkEvents(...fundingEvents)
  return (state, event) => {
    const change = getChange(state.context)
    if (isChange(change, { type: 'PACKET' })) {
      return !fundingEvents.includes(event.type)
    }
    return true
  }
}

export const skipAccountMgmt = () => {
  const { actors } = machine.states
  expect(ACCOUNT_MANAGEMENT_EVENTS.every((a) => actors.on[a])).to.be.ok
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
      if (c > count) {
        return false
      }
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
        if (count > limit) {
          return false
        }
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
