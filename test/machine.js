import Immutable from 'immutable'
import { expect } from 'chai'
import { hash } from './utils.js'
import { createTestModel, createTestMachine } from '@xstate/test'
import { assign } from 'xstate'

export const types = {
  HEADER: 'HEADER',
  PACKET: 'PACKET',
  SOLUTION: 'SOLUTION',
  DISPUTE: 'DISPUTE',
  EDIT: 'EDIT',
  MERGE: 'MERGE',
}

export const not = (conditions) => (ctx) => {
  const t = ctx.transitions.get(ctx.cursorId)
  for (const key in conditions) {
    if (t[key] === conditions[key]) {
      return false
    }
  }
  return true
}

export const is = (conditions) => (ctx) => {
  const t = ctx.transitions.get(ctx.cursorId)
  for (const key in conditions) {
    if (t[key] !== conditions[key]) {
      return false
    }
  }
  return true
}

export const isAny = (conditions) => (ctx) => {
  const t = ctx.transitions.get(ctx.cursorId)
  for (const key in conditions) {
    if (t[key] === conditions[key]) {
      return true
    }
  }
  return false
}
export const and =
  (fn1, fn2, fn3 = () => true) =>
  (...args) =>
    fn1(...args) && fn2(...args) && fn3(...args)

export const patch = (patch) =>
  assign({
    transitions: (ctx) => {
      const transition = ctx.transitions.get(ctx.cursorId)
      const next = transition.merge(patch)
      return ctx.transitions.set(ctx.cursorId, next)
    },
  })
const Transition = Immutable.Record({
  type: types.HEADER,
  contents: undefined,
  qaResolved: false,
  funded: false,
  fundedDai: false,
  enacted: false,
  uplink: undefined,
  tradedFunds: false,
  contentTraded: false,
  isQaClaimed: false,
  isClaimed: false,
})
export const machine = createTestModel(
  createTestMachine(
    {
      id: 'model based tests',
      initial: 'idle',
      context: {
        transitionsCount: 1,
        transitions: Immutable.Map(),
        cursorId: 1,
      },
      states: {
        idle: {
          on: {
            HEADER: {
              actions: 'proposeHeader',
              target: 'open',
            },
          },
        },
        open: {
          on: {
            FUND: {
              actions: patch({ funded: true }),
              cond: is({ funded: false }),
            },
            FUND_DAI: {
              actions: patch({ fundedDai: true }),
              cond: is({ fundedDai: false }),
            },
            QA_RESOLVE: {
              target: 'pending',
              actions: patch({ qaResolved: true }),
              cond: not({ type: types.PACKET }),
            },
            SOLVE: {
              target: 'proposeSolution',
              cond: is({ type: types.PACKET }),
            },
            TRADE: {
              target: 'tradeFunds',
              actions: patch({ tradedFunds: true }),
              cond: is({ tradedFunds: false }),
            },
          },
        },
        proposeSolution: {
          //TODO check can't defund
          // TODO also check qa thresholds
          on: {
            PROPOSE_SOLUTION: {
              actions: 'proposeSolution',
              target: 'open',
            },
          },
        },
        pending: {
          on: {
            ENACT_HEADER: {
              target: 'enacted',
              actions: patch({ enacted: true }),
              cond: is({ type: types.HEADER }),
            },
            ENACT_SOLUTION: {
              target: 'enacted',
              actions: patch({ enacted: true }),
              cond: is({ type: types.SOLUTION }),
            },
            // try trade contents here while pending
          },
        },
        tradeFunds: {
          on: {
            TRADE_FUNDS: {
              target: 'open',
              cond: isAny({ funded: true, fundedDai: true }),
            },
            // TRADE_FUNDS_AGAIN to test updating existing balance
          },
        },
        enacted: {
          // the meta change is incapable of financially changing any further
          on: {
            QA: {
              target: 'qaClaim',
              actions: patch({ isQaClaimed: true }),
              cond: is({ isQaClaimed: false }),
            },
            OPEN_PACKET: {
              target: 'open',
              actions: 'createPacket',
              cond: is({ type: types.HEADER }),
            },
            SOLVE_PACKET: {
              target: 'solved',
              actions: 'focusPacket',
              cond: is({ type: types.SOLUTION }),
            },
            TRADE: {
              target: 'tradeContent',
              actions: patch({ contentTraded: true }),
              cond: is({ contentTraded: false }),
            },
          },
        },
        qaClaim: {
          on: {
            QA_CLAIM: {
              target: 'enacted',
              cond: isAny({ funded: true, fundedDai: true }),
            },
          },
        },
        tradeContent: {
          on: {
            TRADE_CONTENT: {
              target: 'enacted',
              // how to do a trade, then do a claim on something remaining
              // that was indivisible ?
            },
          },
        },
        tradePacketContent: {
          on: {
            TRADE_CONTENT: {
              target: 'solved',
              cond: is({ isClaimed: true }),
            },
          },
        },
        dispute: {},
        solved: {
          on: {
            TRADE: {
              target: 'tradePacketContent',
              actions: patch({ contentTraded: true }),
              cond: is({ contentTraded: false }),
            },
            CLAIM: {
              target: 'claimed',
              actions: patch({ isClaimed: true }),
              cond: and(
                is({ isClaimed: false }),
                isAny({ funded: true, fundedDai: true })
              ),
            },

            // trade content here, with tests for before claim

            // RE_SOLVE: solve it again
            // trade the solution and header NFTs
            // modify the header
            // REPEAT: make another header and start all over again
            // MERGE_PACKETS once have two packets, try merge them
          },
        },
        claimed: {
          // trade content here
          // and trade funds afterwards too
          // ?? can we reuse an action with a different condition ?
        },
      },
      predictableActionArguments: true,
      preserveActionOrder: true,
    },
    {
      actions: {
        proposeHeader: assign({
          transitionsCount: (ctx) => ctx.transitionsCount + 1,
          transitions: ({ transitions, transitionsCount }) =>
            transitions.set(
              transitionsCount,
              Transition({
                type: types.HEADER,
                contents: hash(transitionsCount),
              })
            ),
          cursorId: (ctx) => ctx.transitionsCount,
        }),
        createPacket: assign((ctx) => {
          const packetId = ctx.transitionsCount
          const transitionsCount = ctx.transitionsCount + 1
          const packet = Transition({
            type: types.PACKET,
            uplink: ctx.cursorId,
          })
          return {
            transitionsCount,
            cursorId: packetId,
            transitions: ctx.transitions.set(packetId, packet),
          }
        }),
        proposeSolution: assign((ctx) => {
          const solutionId = ctx.transitionsCount
          const packetId = ctx.cursorId
          const solution = Transition({
            type: types.SOLUTION,
            uplink: packetId,
          })
          const transitionsCount = ctx.transitionsCount + 1
          return {
            transitionsCount,
            cursorId: solutionId,
            transitions: ctx.transitions.set(solutionId, solution),
          }
        }),
        focusPacket: assign({
          cursorId: (ctx) => {
            const solution = ctx.transitions.get(ctx.cursorId)
            expect(solution.type).to.equal(types.SOLUTION)
            return solution.uplink
          },
        }),
      },
    }
  )
)

export const filters = {
  skipMetaFunding: (state, event) => {
    const { context, value } = state
    if (value != 'open') {
      return true
    }
    const change = context.transitions.get(context.cursorId)
    if (change.type !== types.PACKET) {
      if (event.type === 'FUND' || event.type === 'FUND_DAI') {
        return false
      }
    }
    return true
  },
  skipFunding: (state, event) => {
    if (event.type === 'FUND' || event.type === 'FUND_DAI') {
      return false
    }
    return true
  },
  skipTrading: (state, event) => {
    if (event.type === 'TRADE') {
      return false
    }
    return true
  },
  skipFundTrading: (state, event) => {
    if (event.type === 'TRADE_FUNDS') {
      return false
    }
    return true
  },
  skipMetaTrading: (state, event) => {
    if (event.type !== 'TRADE') {
      return true
    }
    const { context } = state
    const change = context.transitions.get(context.cursorId)
    if (change.type === types.PACKET) {
      return true
    }
    if (event.type === 'TRADE') {
      return false
    }
    return true
  },
}
