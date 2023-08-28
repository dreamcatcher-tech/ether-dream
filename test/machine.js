import Immutable from 'immutable'
import { hash } from './utils.js'
import { createTestModel, createTestMachine } from '@xstate/test'
import { assign } from 'xstate'
import { change, global, globalIs, not, is, isAny, and } from './conditions.js'

export const types = {
  HEADER: 'HEADER',
  PACKET: 'PACKET',
  SOLUTION: 'SOLUTION',
  DISPUTE: 'DISPUTE',
  EDIT: 'EDIT',
  MERGE: 'MERGE',
}

const Change = Immutable.Record({
  type: types.HEADER,
  contents: undefined,
  qaResolved: false,
  qaRejected: false,
  funded: false,
  fundedEth: false,
  fundedDai: false,
  enacted: false,
  uplink: undefined,
  tradedFunds: false,
  contentTraded: false,
  isQaClaimed: false,
  isClaimed: false,
  exited: false,
  defundStarted: false,
  defundEnded: false,
  defundExited: false,
  disputedResolve: false,
  disputedRejection: false,
  disputedShares: false,
})
const Global = Immutable.Record({
  qaExitable: false,
  qaExited: false,
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
        global: Global(),
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
              actions: change({ fundedEth: true, funded: true }),
              cond: is({ fundedEth: false }),
            },
            FUND_DAI: {
              actions: change({ fundedDai: true, funded: true }),
              cond: is({ fundedDai: false }),
            },
            DEFUND: {
              target: 'defund',
              cond: is({ defundEnded: false, funded: true }),
            },
            QA_RESOLVE: {
              target: 'pending',
              actions: change({ qaResolved: true }),
              cond: not({ type: types.PACKET }, { type: types.DISPUTE }),
            },
            // QA_REJECT
            SOLVE: {
              target: 'proposeSolution',
              cond: is({ type: types.PACKET }),
            },
            TRADE: {
              target: 'tradeFunds',
              actions: change({ tradedFunds: true }),
              cond: is({ tradedFunds: false }),
            },
            SUPER_QA: {
              target: 'superDispute',
              cond: is({ type: types.DISPUTE }),
            },
          },
        },
        defund: {
          on: {
            DEFUND_START: {
              target: 'open',
              cond: is({ defundStarted: false }),
              actions: change({ defundStarted: true }),
            },
            DEFUND_STOP: {
              target: 'open',
              cond: is({ defundStarted: true, defundEnded: false }),
              actions: change({ defundEnded: true }),
            },
            DEFUND_EXIT: {
              target: 'open',
              cond: is({
                defundStarted: true,
                defundEnded: false,
                defundExited: false,
              }),
              actions: change({ defundExited: true, defundEnded: true }),
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
              actions: change({ enacted: true }),
              cond: is({ type: types.HEADER }),
            },
            ENACT_SOLUTION: {
              target: 'enacted',
              actions: change({ enacted: true }),
              cond: is({ type: types.SOLUTION }),
            },
            DISPUTE: {
              target: 'dispute',
              cond: and(
                isAny({
                  disputedResolve: false,
                  // disputedRejection: false,
                  // disputedShares: false,
                }),
                not({ type: types.PACKET }, { type: types.DISPUTE })
              ),
            },
            // try trade contents here while pending
          },
        },
        dispute: {
          on: {
            DISPUTE_RESOLVE: {
              target: 'open',
              actions: [
                change({ disputedResolve: true }),
                'createDispute',
                // second change identifies the dispute type
                change({ disputedResolve: true }),
              ],
              // do doubles by boosting atop an existing dispute DISPUTE_AGAIN
              cond: is({ qaResolved: true, disputedResolve: false }),
            },
            // DISPUTE_SHARES: {
            //   target: 'open',
            //   actions: change({ disputedShares: true }),
            //   cond: is({ qaResolved: true, disputedShares: false }),
            // },
            // DISPUTE_REJECT: {
            //   target: 'open',
            //   actions: change({ disputedRejection: true }),
            //   cond: is({ qaRejected: true, disputedRejection: false }),
            // },
          },
        },
        superDispute: {
          on: {
            DISPUTE_UPHELD: {
              target: 'open',
              actions: [
                change({ qaResolved: true }),
                'focusUplink',
                change({ qaResolved: false, qaRejected: false }),
              ],
              cond: isAny({ disputedResolve: true, disputedRejection: true }),
              // mint the special shares to those who provided content
              // move back to open, but raise a flag to stop it being
              // disputed again, a double flag if this has been disputed twice.
              // use function getDisputeNftId() to get the id of dispute shares
              // if this change has been disputed twice, then the shares are merged
              // then test trading the dispute shares
              // {
              //   target: 'enacted',
              //   actions: 'disputeUpheld',
              //   cond: is({ disputedShares: true }),
              // },

              // if its shares, move to enacted, as we have passed the pending
            },
            DISPUTE_SHARES_UPHELD: {},
            DISPUTE_DISMISSED: {
              // end it, roll back the cursor to the uplink
              // move to enacted as a byproduct
            },
          },
        },
        tradeFunds: {
          on: {
            TRADE_FUNDS: {
              target: 'open',
              cond: is({ funded: true, defundExited: false }),
            },
            // TRADE_FUNDS_AGAIN to test updating existing balance
          },
        },
        enacted: {
          // the meta change is incapable of financially changing any further
          on: {
            QA: {
              target: 'qaClaim',
              actions: change({ isQaClaimed: true }),
              cond: is({ isQaClaimed: false }),
            },
            QA_EXIT: {
              actions: global({ qaExitable: false, qaExited: true }),
              cond: globalIs({ qaExitable: true }),
            },
            OPEN_PACKET: {
              target: 'open',
              actions: 'createPacket',
              cond: is({ type: types.HEADER }),
            },
            SOLVE_PACKET: {
              target: 'solved',
              actions: 'focusUplink',
              cond: is({ type: types.SOLUTION }),
            },
            TRADE: {
              target: 'tradeContent',
              actions: change({ contentTraded: true }),
              cond: is({ contentTraded: false }),
            },
          },
        },
        qaClaim: {
          on: {
            QA_CLAIM: {
              target: 'enacted',
              actions: global({ qaExitable: true }),
              cond: is({ funded: true, defundExited: false }),
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
              cond: isAny({
                isClaimed: true,
                funded: false,
                defundExited: true,
              }),
            },
          },
        },
        solved: {
          on: {
            TRADE: {
              target: 'tradePacketContent',
              actions: change({ contentTraded: true }),
              cond: is({ contentTraded: false }),
            },
            CLAIM: {
              actions: change({ isClaimed: true }),
              cond: is({ isClaimed: false, funded: true, defundExited: false }),
            },
            EXIT: {
              actions: change({ exited: true }),
              cond: is({ isClaimed: true, exited: false }),
            },

            // RE_SOLVE: solve it again
            // modify the header
            // REPEAT: make another header and start all over again
            // MERGE_PACKETS once have two packets, try merge them
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
              Change({
                type: types.HEADER,
                contents: hash(transitionsCount),
              })
            ),
          cursorId: (ctx) => ctx.transitionsCount,
        }),
        createPacket: assign((ctx) => {
          const packetId = ctx.transitionsCount
          const transitionsCount = ctx.transitionsCount + 1
          const packet = Change({
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
          const solution = Change({
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
        focusUplink: assign({
          cursorId: (ctx) => {
            const change = ctx.transitions.get(ctx.cursorId)
            return change.uplink
          },
        }),
        createDispute: assign((ctx) => {
          const disputeId = ctx.transitionsCount
          const transitionsCount = ctx.transitionsCount + 1
          let dispute = Change({
            type: types.DISPUTE,
            uplink: ctx.cursorId,
          })
          return {
            transitionsCount,
            cursorId: disputeId,
            transitions: ctx.transitions.set(disputeId, dispute),
          }
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
  skipPacketFunding: (state, event) => {
    if (is({ type: types.PACKET })(state.context)) {
      if (event.type === 'FUND' || event.type === 'FUND_DAI') {
        return false
      }
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
  dai: (state, event) => {
    if (event.type === 'FUND') {
      return false
    }
    return true
  },
  allowedStates:
    (...states) =>
    (state) =>
      states.includes(state.value),
  skipDefunding: (state, event) => {
    if (event.type === 'DEFUND') {
      return false
    }
    return true
  },
  skipDisputes: (state, event) => {
    if (event.type === 'DISPUTE') {
      return false
    }
    return true
  },
  skipExit: (state, event) => {
    if (event.type === 'EXIT') {
      return false
    }
    return true
  },
}
