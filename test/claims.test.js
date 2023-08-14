import { description } from '../utils.js'
import { expect } from 'chai'
import { initializeSut } from './sut.js'
import { types, machine, filters } from './machine.js'
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
    const shortestPaths = machine.getShortestPaths({
      toState: (state) => state.matches('claimed'),
      filter: filters.skipFunding,
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        const lastStep = path.steps[path.steps.length - 1]
        expect(lastStep.event.type).to.equal('CLAIM_EMPTY')
        await path.test(await initializeSut())
      })
    })
  })

  it.skip('a single NFT can be claimed between two content share holders')
  it.skip('QA can claim all the funds')
})
