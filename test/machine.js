import Immutable from 'immutable'
import { expect } from 'chai'
import { hash } from '../utils.js'
import { createTestModel, createTestMachine } from '@xstate/test'
import { assign } from 'xstate'
export const types = {
  HEADER: 'HEADER',
  PACKET: 'PACKET',
  SOLUTION: 'SOLUTION',
  APPEAL: 'APPEAL',
}

// TODO event this, so we can know when something changed
const Transition = Immutable.Record({
  type: types.HEADER,
  contents: undefined,
  qaResolved: false,
  funded: false,
  fundedDai: false,
  enacted: false,
  traded: false,
  uplink: undefined,
})

export const guards = {
  isUnfunded: (ctx) => {
    const t = ctx.transitions.get(ctx.cursorId)
    return !t.funded
  },
  isUnfundedDai: (ctx) => {
    const t = ctx.transitions.get(ctx.cursorId)
    return !t.fundedDai
  },
  isHeader: (ctx) => {
    const transition = ctx.transitions.get(ctx.cursorId)
    return transition.type === types.HEADER
  },

  isNotPacket: (ctx) => !guards.isPacket(ctx),
  isPacket: (ctx) => {
    const transition = ctx.transitions.get(ctx.cursorId)
    return transition.type === types.PACKET
  },
  isSolution: (ctx) => {
    const transition = ctx.transitions.get(ctx.cursorId)
    return transition.type === types.SOLUTION
  },
  isDispute: (ctx) => {},
  isTradeable: (ctx) => {
    const packet = ctx.packets.get(ctx.cursorId)
    debug('isTradeable', !packet.traded)
    return !packet.traded
  },
  isQaClaimable: (ctx) => {
    const t = ctx.transitions.get(ctx.cursorId)
    return t.type !== types.PACKET && (t.funded || t.fundedDai)
  },
  isNotQaClaimable: (ctx) => !guards.isQaClaimable(ctx),
}
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
            FUND_DAI: { actions: 'fundDai', cond: 'isUnfundedDai' },
            FUND: { actions: 'fund', cond: 'isUnfunded' },
            QA_RESOLVE: {
              target: 'pending',
              actions: 'qaResolve',
              cond: 'isNotPacket',
            },
            SOLVE: { actions: 'proposeSolution', cond: 'isPacket' },
            // TRADE: { actions: 'trade', cond: 'isTradeable' },
            // DEFUND
            // SECOND_SOLVE // handle a competiting solution
            // ? how to do two solves concurrently ?
          },
          // transition is open for funding, trading
          // if packet, open for solving
        },
        // make a state for solved, and check can't defund
        // also check qa thresholds
        pending: {
          on: {
            ENACT: { target: 'qaClaimable', actions: 'enactCursor' },
          },
        },
        qaClaimable: {
          // QA might be able to claim from here
          on: {
            QA_CLAIM: { target: 'enacted', cond: 'isQaClaimable' },
            QA_EMPTY: { target: 'enacted', cond: 'isNotQaClaimable' },
          },
        },
        enacted: {
          // the meta change is incapable of financially changing any further
          on: {
            OPEN_HEADER: {
              target: 'open',
              actions: 'createPacket',
              cond: 'isHeader',
            },
            SOLVE_PACKET: {
              target: 'solved',
              actions: 'focusPacket',
              cond: 'isSolution',
            },
          },
        },
        dispute: {},
        solved: {
          on: {
            // TRADE: { actions: 'trade', cond: 'isTradeable' },
            CLAIM: 'claimed',
            QA_CLAIM_ERROR: 'claimed', // tests QA cannot claim a packet
            // RE_SOLVE: solve it again
            // trade the solution and header NFTs
            // modify the header
            // REPEAT: make another header and start all over again
            // MERGE_PACKETS once have two packets, try merge them
          },
        },
        claimed: {},
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
        }),
        fund: assign({
          transitions: (ctx) => {
            const { cursorId, transitions } = ctx
            const transition = transitions.get(cursorId)
            const next = transition.set('funded', true)
            return transitions.set(cursorId, next)
          },
        }),
        fundDai: assign({
          transitions: (ctx) => {
            const { cursorId, transitions } = ctx
            const transition = transitions.get(cursorId)
            const next = transition.set('fundedDai', true)
            return transitions.set(cursorId, next)
          },
        }),
        qaResolve: assign({
          transitions: (ctx) => {
            const { cursorId } = ctx
            const transition = ctx.transitions.get(cursorId)
            const next = transition.set('qaResolved', true)
            return ctx.transitions.set(cursorId, next)
          },
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
        enactCursor: assign({
          transitions: (ctx) => {
            // make the NFTs tradeable
            // store the shares from the QA
            // make the packet as finalized as well as the solution
            //
            const transition = ctx.transitions.get(ctx.cursorId)
            const next = transition.set('enacted', true)
            return ctx.transitions.set(ctx.cursorId, next)
          },
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
export const tests = {
  isPacketClaimable: (ctx) => {
    const packet = ctx.transitions.get(ctx.cursorId)
    return packet.funded || packet.fundedDai
  },

  ...guards,
}
