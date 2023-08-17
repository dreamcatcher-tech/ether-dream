import { expect } from 'chai'
import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine, filters, is } from './machine.js'

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
            return is({ funded: false, fundedDai: false })(step.state.context)
          }
        })
      )

    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('QA cannot claim packets', () => {
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
    expect(path).to.be.ok
    it(description(path), async () => {
      await path.test(await initializeSut())
    })
  })

  it.skip('a single NFT can be claimed between two content share holders')
})
