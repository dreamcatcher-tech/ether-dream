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
import Debug from 'debug'
const debug = Debug('test:consequences')
Debug.enable('test:consequences')
const log = (string = 'log') => assign(() => debug(string))

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const getTransition = (ctx) => {
  const { cursorId } = ctx
  if (ctx.headers.has(cursorId)) {
    return ctx.headers.get(cursorId)
  }
  if (ctx.packets.has(cursorId)) {
    return ctx.packets.get(cursorId)
  }
  if (ctx.solutions.has(cursorId)) {
    return ctx.solutions.get(cursorId)
  }
  if (ctx.appeals.has(cursorId)) {
    return ctx.appeals.get(cursorId)
  }
}
/**
 * Only transitions that are expected as a consequence of a previous transition
 * are taken, in an effort to reduce the number of paths to explore.
 *
 * So given a target transition, this statechart will transition
 * to the state that represents the transition current state,
 * and then allow only valid transitions
 */
describe('consequences', () => {
  const model = createTestModel(
    createTestMachine(
      {
        id: 'consequences',
        initial: 'idle',
        context: {
          transitionsCount: 0,
          headers: Immutable.Map(),
          packets: Immutable.Map(),
          solutions: Immutable.Map(),
          appeals: Immutable.Map(),
          cursorId: 0,
        },
        states: {
          idle: {
            on: {
              HEADER: {
                actions: 'proposeHeader',
                target: 'header',
              },
            },
          },
          header: {
            on: {
              FUND: { actions: 'fund', cond: 'isUnfunded' },
              QA_RESOLVE: { target: 'pending', actions: 'qaResolve' },
            },
          },
          open: {
            // transition is open for funding, trading
            // if packet, open for solving
          },
          pending: {
            on: {
              APPEAL_RESOLVE: { target: 'appeal', actions: 'appealResolve' },
              FINALIZE: { target: 'packet', actions: 'finalize' },
            },
          },
          appeal: {},
          packet: {
            on: {
              FUND: { actions: 'fund', cond: 'isUnfunded' },
              TRADE: { actions: 'trade', cond: 'isTradeable' },
              SOLVE: { target: 'solution', actions: 'proposeSolution' },
            },
          },
          solution: {
            on: {
              FUND: { actions: 'fund', cond: 'isUnfunded' },
              // QA_RESOLVE: { target: 'pending', actions: 'qaResolve' },
            },
          },
          noop: {
            always: 'idle',
            exit: assign({
              cursorId: (ctx) => ctx.cursorId + 1,
            }),
          },
          op: {
            exit: assign({
              cursorId: (ctx) => ctx.cursorId + 1,
            }),
            initial: 'initial',
            states: {
              initial: {
                always: [
                  { target: 'header', cond: 'isHeader' },
                  { target: 'packet', cond: 'isPacket' },
                  { target: 'solution', cond: 'isSolution' },
                  { target: 'appeal', cond: 'isAppeal' },
                  'done',
                ],
              },
              header: {
                initial: 'initial',
                states: {
                  initial: {
                    always: [
                      { target: 'proposed', cond: 'isUnfunded' },
                      { target: 'funded', cond: 'isFunded' },
                      { target: 'finalizable', cond: 'isFinalizable' },
                      { target: 'done' },
                    ],
                  },
                  proposed: {
                    on: {
                      FUND: { target: 'done', actions: 'fund' },
                      QA_RESOLVE: { target: 'done', actions: 'qaResolve' },
                      QA_REJECT: 'done',
                    },
                  },
                  funded: {
                    on: {
                      // TODO limit by having a balance
                      FUND: { target: 'done', actions: 'fund' },
                      DEFUND: { target: 'done', actions: 'defund' },
                      QA_RESOLVE: { target: 'done', actions: 'qaResolve' },
                      QA_REJECT: 'done',
                    },
                  },
                  finalizable: {
                    on: {
                      FINALIZE: { target: 'done', actions: 'finalize' },
                    },
                  },
                  done: { type: 'final' },
                },
                onDone: { target: 'done' },
              },
              packet: {
                always: 'done',
              },
              solution: {},
              appeal: {},
              done: { type: 'final' },
            },
            onDone: { target: 'idle' },
          },
          done: { type: 'final' },
        },
      },
      {
        actions: {
          proposeHeader: assign({
            transitionsCount: (ctx) => ctx.transitionsCount + 1,
            headers: ({ headers, transitionsCount }) =>
              headers.set(transitionsCount, {
                contents: hash(transitionsCount),
              }),
          }),
          fund: assign((ctx) => {
            const { cursorId } = ctx
            const header = ctx.headers.get(cursorId)
            const next = { ...header, funded: true }
            return { headers: ctx.headers.set(cursorId, next) }
          }),
          qaResolve: assign((ctx) => {
            const { cursorId } = ctx
            const header = ctx.headers.get(cursorId)
            const next = { ...header, qaResolved: true }
            debug('qaResolve')
            return { headers: ctx.headers.set(cursorId, next) }
          }),
          finalize: assign((ctx) => {
            const headerId = ctx.cursorId
            const header = ctx.headers.get(headerId)
            const next = { ...header, finalized: true }
            const packetId = ctx.transitionsCount
            const packets = ctx.packets.set(packetId, { headerId })
            const transitionsCount = ctx.transitionsCount + 1
            debug('finalize')
            return {
              ...ctx,
              headers: ctx.headers.set(headerId, next),
              packets,
              transitionsCount,
              cursorId: packetId,
            }
          }),
          trade: assign((ctx) => {
            const packetId = ctx.cursorId
            const packet = ctx.packets.get(packetId)
            const next = { ...packet, traded: true }
            return { packets: ctx.packets.set(packetId, next) }
          }),
          proposeSolution: assign((ctx) => {
            const packetId = ctx.cursorId
            const packet = ctx.packets.get(packetId)
            const solutionId = ctx.transitionsCount
            const solutions = ctx.solutions.set(solutionId, { packetId })
            const transitionsCount = ctx.transitionsCount + 1
            debug('proposeSolution')
            return {
              solutions,
              transitionsCount,
              cursorId: solutionId,
            }
          }),
        },
        guards: {
          isHeader: (ctx) => {
            return ctx.headers.has(ctx.cursorId)
          },
          isUnfunded: (ctx) => {
            const transition = getTransition(ctx)
            return !transition.qaResolved && !transition.funded
          },
          isFunded: (ctx) => {
            const transition = getTransition(ctx)
            return !transition.qaResolved && transition.funded
          },
          isFinalizable: (ctx) => {
            const { cursorId } = ctx
            const header = ctx.headers.get(cursorId)
            return header.qaResolved && !header.finalized
          },
          isPacket: (ctx) => {
            return ctx.packets.has(ctx.cursorId)
          },
          isSolution: (ctx) => {
            return ctx.solutions.has(ctx.cursorId)
          },
          isAppeal: (ctx) => {
            return ctx.appeals.has(ctx.cursorId)
          },
          isTradeable: (ctx) => {
            const packet = ctx.packets.get(ctx.cursorId)
            debug('isTradeable', !packet.traded)
            return !packet.traded
          },
        },
      }
    )
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
    // traversalLimit: 100000,
    // toState: (state) => state.matches('done'),
    // stopCondition: (state) => {
    //   return state.context.packets.size
    // },
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
