import equals from 'fast-deep-equal'
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

const { log } = actions
const ONE_DAY_MS = 24 * 60 * 60 * 1000

const exhausted = (ctx) => {
  return ctx.headersCount >= 5
}
const notExhausted = (ctx) => !exhausted(ctx)
const isCycleOpen = (ctx) => {
  return ctx.cycles < ctx.headersCount + ctx.packetsCount
}
const isCycleDone = (ctx) => !isCycleOpen(ctx)

describe('models', () => {
  const model = createTestModel(
    createTestMachine({
      id: 'simple',
      initial: 'idle',
      context: {
        time: { clock: 0, lastContext: {} },
        packetsCount: 0,
        packets: [],
        headersCount: 0,
        headers: [],
        cycles: 0,
        defunded: 0,
        funded: 0,
      },
      states: {
        idle: {
          always: { target: 'funding', cond: exhausted },
          on: {
            // TIME_TICK: {
            //   cond: ({ time, ...rest }) => {
            //     const isTick = !equals(time.lastContext, rest)
            //     return isTick
            //   },
            //   actions: assign({
            //     time: ({ time, ...lastContext }) => {
            //       return { clock: time.clock + 1, lastContext }
            //     },
            //   }),
            //   // TODO sometimes do just a block tick, other times
            //   // a block + time tick.
            // },

            PROPOSE_PACKET: {
              actions: assign({
                headersCount: (ctx) => ctx.headersCount + 1,
                headers: (ctx) => [
                  ...ctx.headers,
                  { contents: hash(ctx.headers.length) },
                ],
              }),
              cond: notExhausted,
              target: 'idle',
            },

            // APPEAL_TRANSITION: 'appeal',
            // FUND: {
            //   // fund the given transition, but stop after N events
            //   // ? how to make it randomize the target transition ?
            // },
          },
        },
        funding: {
          // loop thru every available transition
          // either do not fund it, or do fund it
          entry: assign({ cycles: 0 }),
          on: {
            FUND_ETH: {
              actions: assign({
                cycles: (ctx) => ctx.cycles + 1,
                funded: (ctx) => ctx.funded + 1,
              }),
              cond: isCycleOpen,
            },
            DEFUND_ETH: {
              actions: assign({
                cycles: (ctx) => ctx.cycles + 1,
                defunded: (ctx) => ctx.defunded + 1,
              }),
              cond: isCycleOpen,
            },
            FUND_SKIP: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
          },
          always: { target: 'qualityAssuring', cond: isCycleDone },
        },
        qualityAssuring: {
          entry: assign({ cycles: 0 }),
          on: {
            QA_RESOLVE: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
            QA_REJECT: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
            QA_SKIP: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
          },
          always: { target: 'appealing', cond: isCycleDone },
        },
        appealing: {
          entry: assign({ cycles: 0 }),
          on: {
            APPEAL_SHARES: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
            APPEAL_RESOLVE: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
            APPEAL_REJECTION: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
            APPEAL_SKIP: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
          },
          always: { target: 'finalizing', cond: isCycleDone },
        },
        finalizing: {
          entry: assign({ cycles: 0 }),
          on: {
            FINALIZE: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
            FINALIZE_SKIP: {
              actions: assign({ cycles: (ctx) => ctx.cycles + 1 }),
              cond: isCycleOpen,
            },
          },
          always: { target: 'exhausted', cond: isCycleDone },
        },
        exhausted: { type: 'final' },
        // appeal: {
        //   // here we choose a transition, and then if it is not appealable, take the expected fail path, if appealable take the expected appeal path.
        //   on: {
        //     APPEAL: { target: 'idle', cond: 'isAppealable' },
        //     APPEAL_ERROR: { target: 'idle' },
        //   },
        // },
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
    toState: (state) => state.matches('exhausted'),
  })
  describe(`shortest ${shortestPaths.length} paths`, () => {
    shortestPaths.forEach((path) => {
      it(description(path), () => {
        path.test()
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
