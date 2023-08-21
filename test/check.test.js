import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine } from './machine.js'
import { expect } from 'chai'

describe('check', () => {
  const start = Date.now()
  const shortestPaths = machine.getShortestPaths({
    toState: (state) => state.matches('claimed'),
    traversalLimit: 100000,
  })
  const elapsed = Date.now() - start
  expect(elapsed).to.be.lessThan(1000 * 60 * 2)

  it('model generation', async () => {
    expect(shortestPaths.length).to.be.greaterThan(sampleSize + 1)
    expect(shortestPaths.length).to.be.lessThan(10000)
    console.log('\n\n###############')
    console.log('Shortest Paths Count: ', shortestPaths.length)
    console.log('Time Elapsed: ', stop - start, 'ms')
    console.log('###############\n\n')
  })

  it('first: ' + description(shortestPaths[0]), async () => {
    const firstPath = shortestPaths.shift()
    await firstPath.test(await initializeSut())
  })

  const sampleSize = 10
  describe(`testing random ${sampleSize} paths`, () => {
    const randomSubset = shortestPaths
      .sort(() => Math.random() - 0.5)
      .slice(0, sampleSize)
    randomSubset.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
})
