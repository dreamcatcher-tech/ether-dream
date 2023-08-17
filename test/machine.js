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

// TODO event this, so we can know when something changed
const Transition = Immutable.Record({
  type: types.HEADER,
  contents: undefined,
  qaResolved: false,
  funded: false,
  fundedDai: false,
  enacted: false,
  uplink: undefined,
  traded: false,
  tradedOnce: false,
  tradedAgain: false,
})

export const guards = {}
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
export const and = (fn1, fn2) => (ctx) => fn1(ctx) && fn2(ctx)

export const patch = (patch) =>
  assign({
    transitions: (ctx) => {
      const transition = ctx.transitions.get(ctx.cursorId)
      const next = transition.merge(patch)
      return ctx.transitions.set(ctx.cursorId, next)
    },
  })

export const machine = createTestModel(
  createTestMachine(
    {
      id: 'model based tests',
      initial: 'idle',
      context: {
        transitionsCount: 1,
        // TODO event this, so we can know when something changed
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
              actions: 'proposeSolution',
              cond: is({ type: types.PACKET }),
            },
            TRADE_FUNDING: {
              target: 'trading',
              actions: patch({ traded: true }),
              cond: and(
                is({ traded: false }),
                isAny({ funded: true, fundedDai: true })
              ),
            },
          },
        },
        // make a state for solved, and check can't defund
        // also check qa thresholds
        pending: {
          on: {
            ENACT_HEADER: {
              target: 'qaClaimable',
              actions: patch({ enacted: true }),
              cond: is({ type: types.HEADER }),
            },
            ENACT_SOLUTION: {
              target: 'qaClaimable',
              actions: patch({ enacted: true }),
              cond: is({ type: types.SOLUTION }),
            },
          },
        },
        qaClaimable: {
          // QA might be able to claim from here
          on: {
            QA_CLAIM: {
              target: 'enacted',
              cond: isAny({ funded: true, fundedDai: true }),
            },
            QA_EMPTY: {
              target: 'enacted',
              cond: is({ funded: false, fundedDai: false }),
            },
          },
        },
        enacted: {
          // the meta change is incapable of financially changing any further
          on: {
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
          },
        },
        dispute: {},
        solved: {
          on: {
            // TRADE: { actions: 'trade', cond: 'isTradeable' },
            CLAIM: {
              target: 'claimed',
              cond: isAny({ funded: true, fundedDai: true }),
            },
            CLAIM_EMPTY: {
              target: 'claimed',
              cond: is({ funded: false, fundedDai: false }),
            },
            QA_CLAIM_ERROR: 'claimed', // tests QA cannot claim a packet
            // RE_SOLVE: solve it again
            // trade the solution and header NFTs
            // modify the header
            // REPEAT: make another header and start all over again
            // MERGE_PACKETS once have two packets, try merge them
          },
        },
        claimed: {},
        trading: {
          on: {
            TRADE_ONCE: {
              target: 'open',
              actions: patch({ tradedOnce: true }),
              cond: is({ tradedOnce: false }),
            },
            TRADE_AGAIN: {
              target: 'open',
              actions: patch({ tradedAgain: true }),
              cond: is({ tradedAgain: false }),
            },
          },
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
      guards,
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
}
