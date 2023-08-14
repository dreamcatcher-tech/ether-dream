import Immutable from 'immutable'
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
const guards = {
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
  isClaimable: (ctx) => {
    const transition = ctx.transitions.get(ctx.cursorId)
    if (transition.type !== types.SOLUTION) {
      return false
    }
    if (!transition.enacted) {
      return false
    }
    const packet = ctx.transitions.get(transition.uplink)
    return packet.funded || packet.fundedDai
  },
  isNotClaimable: (ctx) => !guards.isClaimable(ctx),
  isNotPacket: (ctx) => {
    const transition = ctx.transitions.get(ctx.cursorId)
    return transition.type !== types.PACKET
  },
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
            // LIST on opensea
            // TRADE: { actions: 'trade', cond: 'isTradeable' },
            // DEFUND
            // SECOND_SOLVE // handle a competiting solution
            // ? how to do two solves concurrently ?
          },
          // transition is open for funding, trading
          // if packet, open for solving
        },
        pending: {
          on: {
            ENACT: [
              { target: 'open', actions: 'enactHeader', cond: 'isHeader' },
              {
                target: 'solved',
                actions: 'enactSolution',
                cond: 'isSolution',
              },
            ],
            // APPEAL_RESOLVE: { target: 'appeal', actions: 'appealResolve' },
            // APPEAL_SHARES
          },
        },
        dispute: {},
        solved: {
          on: {
            // TRADE: { actions: 'trade', cond: 'isTradeable' },
            CLAIM: { target: 'claimed', cond: 'isClaimable' },
            CLAIM_TWICE: { target: 'claimed', cond: 'isClaimable' },
            CLAIM_EMPTY: { target: 'claimed', cond: 'isNotClaimable' },
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
        enactHeader: assign((ctx) => {
          const transition = ctx.transitions.get(ctx.cursorId)
          const next = transition.set('enacted', true)
          const packetId = ctx.transitionsCount
          const transitionsCount = ctx.transitionsCount + 1
          const packet = Transition({
            type: types.PACKET,
            uplink: ctx.cursorId,
          })
          return {
            transitionsCount,
            cursorId: packetId,
            transitions: ctx.transitions
              .set(ctx.cursorId, next)
              .set(packetId, packet),
          }
        }),
        enactSolution: assign({
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
