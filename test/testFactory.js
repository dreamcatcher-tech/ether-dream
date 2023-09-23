import { createTestModel, createTestMachine } from '@xstate/test'
import { assign } from 'xstate'
import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine, options } from './multi/multiMachine.js'
import { expect } from 'chai'
import BarCli from 'barcli'
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
function _createSuite({ toState, filter, verify, ...config }) {
  filter = filter || (() => true)
  verify = verify || (() => {})
  expect(toState, 'toState').to.be.a('function')
  expect(filter, 'filter').to.be.a('function')
  expect(verify, 'verify').to.be.a('function')

  const { dry, debug, last, first, pathAt, graph } = config

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
  const wrappedOptions = debug ? logConfig(options) : options
  const testMachine = createTestMachine(machine.config, wrappedOptions)
  const model = createTestModel(testMachine)

  const cliGraphUpdate = cliGraph()
  const paths = model.getShortestPaths({
    toState: (state) => {
      states++
      return toState(state)
    },
    filter: (state, event) => {
      if (!skipJitter(state, event)) {
        return false
      }

      const result = filter(state, event)
      if (graph && result) {
        cliGraphUpdate(state, event, result)
      }
      return result
    },
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

export default function createSuite(config) {
  if (isOnly) {
    return
  }
  return _createSuite(config)
}
let isOnly = false
createSuite.only = function (config) {
  isOnly = true
  return _createSuite(config)
}

createSuite.skip = function () {
  return
}

const debug = Debug('tests')
export const logConfig = (options, dbg = debug) => {
  expect(dbg).to.be.a('function')
  const { guards, actions } = options
  const nextOptions = { guards: {}, actions: {} }

  const guarder = debug.extend('guard')
  for (const key in guards) {
    nextOptions.guards[key] = ({ context, event }) => {
      const result = guards[key]({ context, event })
      guarder(key, event.type, !!result)
      return result
    }
  }
  const actioner = debug.extend('action')
  for (const key in actions) {
    const assignAction = actions[key]
    expect(assignAction.type).to.equal('xstate.assign')
    const assignments = {}
    for (const assign in assignAction.assignment) {
      assignments[assign] = (...args) => {
        actioner(key, assign)
        return assignAction.assignment[assign](...args)
      }
    }
    nextOptions.actions[key] = assign(assignments)
  }
  return nextOptions
}

const globalEvents = new Set(Object.keys(machine.config.on))
const skipJitter = (state, event) => {
  const localEvents = state.nextEvents.filter((e) => {
    return !globalEvents.has(e)
  })
  if (!localEvents.length) {
    return true
  }
  return localEvents.includes(event.type)
}
const cliGraph = () => {
  const bars = new Map()
  let max = 0
  return (state, event, result) => {
    if (!bars.has(event.type)) {
      const graph = new BarCli({ label: event.type })
      const count = 0
      bars.set(event.type, { graph, count })
    }
    let { graph, count } = bars.get(event.type)
    count++
    if (count > max) {
      max = count
    }
    for (const [key, value] of bars) {
      value.graph.inputRange = [0, max]
    }
    graph.update(count)
    bars.set(event.type, { graph, count })
  }
}
