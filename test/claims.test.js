import { expect } from 'chai'
import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine, filters, is, and } from './machine.js'

describe(`claims`, () => {
  describe(`solver can claim funds`, () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) => state.matches('claimed'),
      filter: and(filters.skipMetaFunding, filters.skipTrading),
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('only QA can claim meta funding', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('enacted') && is({ isQaClaimed: true })(state.context),
      filter: and(filters.skipPacketFunding, filters.skipTrading),
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('claim rejects when no funding present', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) => state.matches('solved'),
      filter: and(filters.skipFunding, filters.skipTrading),
    })

    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        const sut = await initializeSut()
        await path.test(sut)
        const { cursorId } = path.state.context
        const { dreamEther } = sut.fixture
        await expect(dreamEther.claim(cursorId)).to.be.revertedWith(
          'No funds to claim'
        )
      })
    })
  })
  describe('QA cannot claim packets', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) => state.matches('solved'),
      filter: and(filters.skipMetaFunding, filters.skipTrading),
    })
    expect(shortestPaths.length).to.be.greaterThan(0)
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        const sut = await initializeSut()
        await path.test(sut)
        const { fixture } = sut
        const { qa } = fixture
        const { cursorId } = path.state.context
        await expect(qa.claimQa(cursorId)).to.be.revertedWith(
          'Cannot claim packets'
        )
      })
    })
  })

  it.skip('a single NFT can be claimed between two content share holders')
})
