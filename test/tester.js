import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine } from './machine.js'
import { expect } from 'chai'

/**
 * Saves reptition when generating tests, and enforces tests such as
 * a verification at the end, and at least one path being generated.
 *
 * Sometimes changes in the machine can cause no paths to be generated,
 * or a SUT function that used to be called to now be skipped.  These are
 * failures in testing and this function avoids many of these by way of
 * enforcing a repeated pattern.
 * @param {*} param0
 */
export default function createSuite({ toState, filter, verify }) {
  expect(toState).to.be.a('function')
  expect(filter).to.be.a('function')
  expect(verify).to.be.a('function')

  const shortestPaths = machine.getShortestPaths({ toState, filter })
  expect(shortestPaths.length, 'No paths generated').to.be.greaterThan(0)
  shortestPaths.forEach((path, index) => {
    it(description(path, index), async () => {
      const sut = await initializeSut()
      await path.test(sut)
      await verify(sut)
    })
  })
}
