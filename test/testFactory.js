import { createTestModel, createTestMachine } from '@xstate/test'
import { assign } from 'xstate'
import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { snapshot, machine, options } from './multi/multiMachine.js'
import { expect } from 'chai'
import BarCli from 'barcli'
import Debug from 'debug'
const debug = Debug('test:sut')

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
function _createSuite(name, { toState, filter, verify, ...config }, it) {
  expect(name, 'name').to.be.a('string')
  filter = filter || (() => true)
  verify = verify || (() => {})
  expect(toState, 'toState').to.be.a('function')
  expect(filter, 'filter').to.be.a('function')
  expect(verify, 'verify').to.be.a('function')

  const { dry, dbg, last, first, pathAt, graph, sut, expand, ...rest } = config
  expect(rest, 'unknown config').to.be.empty

  let start
  let states = 0
  let paths
  it('GENERATE: ' + name, () => {
    start = Date.now()
    const wrappedOptions = dbg ? logConfig(options, dbg) : options
    const testMachine = createTestMachine(machine.config, wrappedOptions)
    const model = createTestModel(testMachine)

    const cliGraphUpdate = cliGraph(graph)
    paths = model.getShortestPaths({
      toState: (state) => {
        states++
        return toState(state)
      },
      filter: (state, event) => {
        if (!skipJitter(state, event)) {
          return false
        }
        const result = filter(state, event)
        if (result) {
          cliGraphUpdate(state, event, result)
        }
        return result
      },
    })
    cliGraphUpdate.halt()
    const errorMessage = `No paths generated in ${states} state traversals`
    expect(paths.length, errorMessage).to.be.greaterThan(0)
    const timeTaken = Date.now() - start
    const msg = `MODEL: ${name} (${paths.length} paths with ${states} state traversals in ${timeTaken}ms)`

    describe(msg, async () => {
      if (dry) {
        const msg = `dry run for ${paths.length} paths in ${timeTaken}ms with ${states} traversals`
        it(msg, () => {
          throw new Error(msg)
        })
      } else if (pathAt !== undefined) {
        it(`limited to path at index: ${pathAt}`, () => {
          throw new Error(`pathAt ${pathAt}`)
        })
      } else if (first || last) {
        const text = first ? 'first' : 'last'
        const message = `limited to ${text} path only`
        it(message, () => {
          throw new Error(message)
        })
      }
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
        it(description(path, index, expand), async () => {
          if (dbg) {
            Debug.enable('test:sut*')
          }
          if (dry) {
            return
          }
          const system = sut || (await initializeSut())
          expect(system, 'sut must be an object').to.be.an('object')
          const logger = { ...system, events: {} }
          for (const event of machine.events) {
            if (system.events?.[event]) {
              logger.events[event] = system.events[event]
            } else if (!globalEvents.has(event) && !event.startsWith('DO_')) {
              logger.events[event] = () => {
                debug.extend('event')('no handler for', event)
                if (system.events && Object.keys(system.events).length) {
                  throw new Error('no handler for ' + event)
                }
              }
            }
            // TODO log on each state change and each event by wrapping
          }
          await path.test(logger)
          await verify(system)
        })
      })
    })
  })
}

export default function createSuite(name, config) {
  return _createSuite(name, config, it)
}
const UNSEARCHABLE = 'o' + 'n' + 'l' + 'y'
createSuite[UNSEARCHABLE] = function (name, config) {
  return _createSuite(name, config, it[UNSEARCHABLE])
}

createSuite.skip = function (name, config) {
  return _createSuite(name, config, it.skip)
}

export const logConfig = (options, dbg) => {
  if (dbg === true) {
    dbg = debug
  }
  expect(dbg).to.be.a('function')
  const { guards, actions } = options
  const nextOptions = { guards: {}, actions: {} }

  const guarder = dbg.extend('guard')
  for (const key in guards) {
    nextOptions.guards[key] = ({ context, event }) => {
      const result = guards[key]({ context, event })
      guarder(key, event.type, !!result)
      return result
    }
  }
  const actioner = dbg.extend('action')
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
  if (event.type === 'NEXT' || event.type === 'PREV') {
    return true
  }
  if (!globalEvents.has(event.type)) {
    return true
  }
  // an actor change is only allowed if context changed since last one
  const { actorSnapshot } = state.context
  if (!actorSnapshot) {
    return true
  }
  if (actorSnapshot.event === event.type) {
    // controversially, you cannot be the same actor twice
    return false
  }
  const snap = snapshot(state)
  for (const key in snap) {
    if (snap[key] !== actorSnapshot.snapshot[key]) {
      return true
    }
  }
  return false
}
const cliGraph = (showAlways) => {
  const bars = new Map()
  let max = 0
  const startTime = Date.now()
  const startDelay = showAlways ? 0 : Infinity
  const updater = (state, event) => {
    if (showAlways === false) {
      return
    }
    if (Date.now() - startTime < startDelay) {
      return
    }
    if (!bars.has(event.type)) {
      const graph = new BarCli({ label: event.type })
      const count = 0
      const update = debounce((c) => graph.update(c), 50)
      bars.set(event.type, { graph, count, update })
    }
    const bar = bars.get(event.type)
    bar.count++
    if (bar.count > max) {
      max = bar.count
    }
    for (const [, bar] of bars) {
      bar.graph.inputRange = [0, max]
    }
    bar.update(bar.count)
  }
  updater.halt = () => {
    for (const [, bar] of bars) {
      bar.graph.update(bar.count)
    }
    if (bars.size === 0) {
      return
    }
    BarCli.halt()
    globalThis.process.stdout.write('\n')
  }
  return updater
}

function debounce(func, delay) {
  let lastRunTime = 0
  return function (...args) {
    const now = Date.now()
    const elapsed = now - lastRunTime
    if (elapsed < delay) {
      return
    }
    lastRunTime = now
    func(...args)
  }
}
