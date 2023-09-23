import { expect } from 'chai'
import { isChange, ACCOUNT_MANAGEMENT_EVENTS, machine } from './multiMachine.js'

export const skipActors = (...actors) => {
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
export const count = (params) => (state) => {
  let count = 0
  for (const change of state.context.changes) {
    if (isChange(change, params)) {
      count++
    }
  }
  return count
}
export const max = (limit, params) => (state) => {
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
