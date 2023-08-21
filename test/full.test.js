import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine } from './machine.js'

describe('full', () => {
  if (!globalThis.process.env.FULL_TEST) {
    return
  }
  const shortestPaths = machine.getShortestPaths({
    toState: (state) => state.matches('claimed'),
  })
  shortestPaths.forEach((path, index) => {
    it(description(path, index), async () => {
      await path.test(await initializeSut())
    })
  })
})
