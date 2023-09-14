import { createTestModel, createTestMachine } from '@xstate/test'
import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine, options } from './multi/multiMachine.js'
import { expect } from 'chai'
import Debug from 'debug'

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
export default function createSuite({ toState, filter, verify, ...config }) {
  filter = filter || (() => true)
  verify = verify || (() => {})
  expect(toState, 'toState').to.be.a('function')
  expect(filter, 'filter').to.be.a('function')
  expect(verify, 'verify').to.be.a('function')

  const { dry, debug, last, first, pathAt } = config

  if (pathAt !== undefined) {
    it(`pathAt ${pathAt}`, () => {
      throw new Error(`pathAt ${pathAt}`)
    })
  } else if (first || last) {
    const text = first ? 'first' : 'last'
    const message = `${text} run only`
    it(message, () => {
      throw new Error(message)
    })
  }
  const start = Date.now()
  let states = 0
  const testMachine = createTestMachine(machine.config, options)
  const model = createTestModel(testMachine)
  const paths = model.getShortestPaths({
    toState: (state) => {
      states++
      return toState(state)
    },
    filter,
  })
  const time = Date.now() - start
  if (dry) {
    const msg = `dry run for ${paths.length} paths in ${time}ms with ${states} traversals`
    it(msg, () => {
      throw new Error(msg)
    })
  }
  it(`generated ${paths.length} paths in ${time}ms with ${states} traversals`, () => {
    expect(paths.length, 'No paths generated').to.be.greaterThan(0)
  })
  if (pathAt !== undefined) {
    const path = paths[pathAt]
    expect(path).to.be.ok
    paths.length = 1
    paths[0] = path
  }
  if (last === true) {
    paths.reverse()
  }
  if (first || last) {
    paths.length = 1
  }

  paths.forEach((path, index) => {
    it(description(path, index), async () => {
      if (debug) {
        Debug.enable('test:sut')
      }
      if (dry) {
        return
      }
      const sut = await initializeSut()
      await path.test(sut)
      await verify(sut)
    })
  })
}
