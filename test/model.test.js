import { description } from '../utils.js'

import { initializeSut } from './sut.js'
import { machine } from './machine.js'
import Debug from 'debug'
const debug = Debug('test:consequences')

describe.skip('model based tests', () => {
  const shortestPaths = machine.getShortestPaths({
    // a bug in @xstate/test requires this
    // https://github.com/statelyai/xstate/issues/4146
    toState: (state) => state.matches('solved'),
  })
  describe(`shortest ${shortestPaths.length} paths`, () => {
    // Debug.enable('test:consequences')

    // shortestPaths.length = 1
    let i = 0
    shortestPaths.forEach((path) => {
      const index = `[${i}] `
      if (i++ !== 8) {
        // return
      }
      it(index + description(path), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('funding', () => {
    it.skip('funding during withdraw lock resets the lock')
    it.skip('funding using locked funds on the same packet undoes the lock')
    it.skip('funders can use multiple tokens including ETH')
    it.skip('funders can use multiple tokens from the same contract')
  })
  describe('e2e', () => {
    it.skip('solving an already solved packet with something better')
    it.skip('modifying the packet header')
    it.skip('packet solving another packet')
    it.skip('check balances of all token types')
  })
  describe('packet closing', () => {
    it.skip('multiple solutions funded within disputeWindow')
    it.skip('defund during disputeWindow is honored if solution rejected')
    it.skip('solve a packet that has already been solved')
    it.skip('wrap a packet in a solution to solve another packet')
  })
  describe('disputes', () => {
    it.skip('disputes cannot be disputed')
    it.skip('cannot dispute a packet')
  })

  describe('trading', () => {
    it.skip('content shares can be traded')
    it.skip('funding shares can be traded')
    it.skip('can deny opensea operator access')
  })
})
