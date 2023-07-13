import equals from 'fast-deep-equal'
import Immutable from 'immutable'
import { description, hash } from '../utils.js'
import {
  createMachine,
  actions,
  assign,
  sendTo,
  sendParent,
  spawn,
} from 'xstate'
import { createTestModel, createTestMachine } from '@xstate/test'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

describe('loops', () => {
  const model = createTestModel(
    createTestMachine({
      id: 'loops',
      initial: 'block',
      context: {
        time: 0,
        transitionsCount: 0,
        headers: Immutable.Map(),
        packets: Immutable.Map(),
        solutions: Immutable.Map(),
        loops: 0,
        cycles: 0,
        cyclesLimit: 0,
      },
      states: {
        block: {
          // each iteration causes a complete loop thru all transitions + 1
          // where + 1 is the guaranteed error,
          // and each operation is possibly done
          on: {
            PROPOSE_PACKET: {
              // tick block time forwards 1 day
              actions: assign({
                time: (ctx) => ctx.time + 1,
                loops: (ctx) => ctx.loops + 1,
                transitionsCount: (ctx) => ctx.transitionsCount + 1,
                headers: ({ headers, transitionsCount }) =>
                  headers.set(transitionsCount, {
                    contents: hash(transitionsCount),
                  }),
              }),
              target: 'cycle',
            },
          },
          always: {
            target: 'exhausted',
            cond: (ctx) => ctx.transitionsCount >= 10 || ctx.loops >= 5,
          },
          exit: assign({
            cycles: 0,
            cyclesLimit: (ctx) => ctx.transitionsCount,
          }),
        },
        cycle: {
          exit: assign({
            cycles: (ctx) => ctx.cycles + 1,
          }),
          // for each propose generation batch, do 5 loops
          // propose in batches of 13, then do 3 loops over each batch
          // this will cover all the time windows, hopefully
          on: {
            NOOP: 'cycle',
            FUND_ETH: 'cycle',
            DEFUND_ETH: 'cycle',
            QA_RESOLVE: {
              target: 'cycle',
              actions: assign((ctx) => {
                const headerId = ctx.cycles
                const header = ctx.headers.get(headerId)
                const next = { ...header, resolved: true }
                const transitionsCount = ctx.transitionsCount + 1
                const packets = ctx.packets.set(transitionsCount, { headerId })
                return {
                  ...ctx,
                  headers: ctx.headers.set(headerId, next),
                  packets,
                }
              }),
            },
            QA_REJECT: 'cycle',
            APPEAL_SHARES: 'cycle',
            APPEAL_RESOLVE: 'cycle',
            APPEAL_REJECTION: 'cycle',
            FINALIZE: 'cycle',
            PROPOSE_SOLUTION: 'cycle',
          },
          always: [
            { target: 'block', cond: (ctx) => ctx.cycles >= ctx.cyclesLimit },
          ],
        },
        exhausted: { type: 'final' },
      },
    })
  )
  const shortestPaths = model.getShortestPaths({
    // stopCondition: (args) => {
    //   const { context } = args
    //   const isStop = context.headers.length === 2
    //   if (isStop) {
    //     console.log('isStop', context)
    //   }
    //   return context.headers.length === 2
    // },
    // toState: (state) => state.matches('exhausted'),
    stopCondition: (state) => state.context.packets.size === 2,
  })
  describe(`shortest ${shortestPaths.length} paths`, () => {
    shortestPaths.forEach((path) => {
      it(description(path), () => {
        path.test()
        // then verify the eth state is what we specified in the path plan
      })
    })
  })
  // const simplePaths = model.getSimplePaths({
  //   toState: (state) => state.matches('exhausted'),
  // })
  // describe(`simple ${simplePaths.length} paths`, () => {
  //   simplePaths.forEach((path) => {
  //     it(description(path), () => {
  //       path.test()
  //     })
  //   })
  // })
})
