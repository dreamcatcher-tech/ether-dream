import test from './testFactory.js'
import { expect } from 'chai'

const tally = (map, obj) => {
  if (map.size === 0) {
    for (const key in obj) {
      map.set(key, false)
    }
  }
  for (const key in obj) {
    if (key.called) {
      map.set(key, true)
    }
  }
}
const allCalled = (map) => {
  for (const [key, value] of map) {
    expect(value, key.name).to.be.true
  }
}
describe('full', () => {
  if (!globalThis.process.env.FULL_TEST) {
    return
  }
  const tests = new Map()
  const states = new Map()
  const events = new Map()

  test({
    toState: (state) => state.matches('solved'),
    filter: () => true,
    verify: (sut) => {
      // TODO tally up all spy calls and verify everything was called
      tally(tests, sut.tests)
      tally(states, sut.states)
      tally(events, sut.events)
    },
  })
  allCalled(tests)
  allCalled(states)
  allCalled(events)
})
