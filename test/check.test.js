import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine } from './machine.js'
import { expect } from 'chai'

describe('check', () => {
  if (!globalThis.process.env.CHECK_MODEL) {
    return
  }
  const sampleSize = 10
  const start = Date.now()
  const shortestPaths = machine.getShortestPaths({
    toState: (state) => state.matches('solved'),
    traversalLimit: 10000000,
  })
  const elapsed = Date.now() - start

  it('model generation', async () => {
    expect(shortestPaths.length).to.be.greaterThan(sampleSize + 1)
    expect(shortestPaths.length).to.be.lessThan(10000)
    console.log('\n\n###############')
    console.log('Shortest Paths Count: ', shortestPaths.length)
    console.log('Time Elapsed: ', elapsed, 'ms')
    console.log('###############\n\n')
    expect(elapsed).to.be.lessThan(1000 * 60 * 2)
  })

  const firstPath = shortestPaths.shift()
  it('first path: ' + description(firstPath), async () => {
    await firstPath.test(await initializeSut())
  })
})
