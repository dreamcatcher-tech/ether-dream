import { description } from '../utils.js'
import { expect } from 'chai'
import { initializeSut } from './sut.js'
import { types, machine, filters, tests } from './machine.js'
import Debug from 'debug'
const debug = Debug('tests')

describe(`claims`, () => {
  // Debug.enable('test:sut')
  describe(`solver can claim funds`, () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) => state.matches('claimed'),
      filter: filters.skipMetaFunding,
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('claim rejects when no funding present', () => {
    const shortestPaths = machine
      .getShortestPaths({
        toState: (state) => state.matches('claimed'),
        filter: filters.skipFunding,
      })
      .filter((path) =>
        path.steps.find((step) => {
          if (step.event.type === 'CLAIM') {
            return (
              tests.isUnfunded(step.state.context) &&
              tests.isUnfundedDai(step.state.context)
            )
          }
        })
      )

    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('QA can claim all the funds', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) => state.matches('claimed'),
      filter: (state, event) => {
        if (state.matches('claimed')) {
          return event.type === 'QA_CLAIM_ERROR'
        }
        return true
      },
    })
    const path = shortestPaths.shift()
    it(description(path), async () => {
      await path.test(await initializeSut())
    })
  })

  it.skip('a single NFT can be claimed between two content share holders')
})
