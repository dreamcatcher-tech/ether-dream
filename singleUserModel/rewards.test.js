// import Immutable from 'immutable'
// import { hash } from './utils.js'
// import { createTestModel, createTestMachine } from '@xstate/test'
// import { assign } from 'xstate'
// import { change, global, globalIs, not, is, isAny, and } from './conditions.js'

// /**
//  * When a staked token, such as Lido, is used to fund a packet, then each
//  * day it is held in escrow it will receive rewards from the Lido pool.
//  * These rewards must be distributed to the packet solvers, or back to the
//  * funder upon defunding.
//  *
//  * The method for doing this is to store two balances each fund() call:
//  *  - the amount of tokens deposited
//  *  - the total amount of tokens at the instant of deposit
//  *
//  * This has the side effect of being able to drain any erroneously deposited
//  * fungible tokens of erc20 or erc1155 type, since the last person to withdraw
//  * will get all the residues.
//  */

// // could make a machine to test a range of combinations of events ?

// export const machine = createTestModel(
//   createTestMachine(
//     {
//       id: 'rewards distribution',
//       initial: 'open',
//       context: {
//         actor1: 0,
//         actor2: 0,
//         actor3: 0,
//         contract: 0, // balance of the contract in total
//       },
//       states: {
//         open: {
//           on: {
//             FUND: {
//               // actor puts in 100 tokens
//             },
//             EXIT: {
//               // actor withdraws their total balance
//             },
//             REWARD: {
//               // external contract sends reward tokens
//             },
//           },
//         },
//         end: { type: 'final' },
//         fund: {
//           on: {
//             FUND_1: {
//               // actor 1 puts in 100 tokens
//             },
//             FUND_2: {
//               // actor 2 puts in 100 tokens
//             },
//             FUND_3: {
//               // actor 3 puts in 100 tokens
//             },
//           },
//         },
//         exit: {
//           on: {
//             EXIT_1: {
//               // actor 1 withdraws
//             },
//             EXIT_2: {
//               // actor 2 withdraws
//             },
//             EXIT_3: {
//               // actor 3 withdraws
//             },
//           },
//         },
//       },
//     },
//     {
//       actions: {
//         proposeHeader: assign({
//           transitionsCount: (ctx) => ctx.transitionsCount + 1,
//           transitions: ({ transitions, transitionsCount }) =>
//             transitions.set(
//               transitionsCount,
//               Change({
//                 type: types.HEADER,
//                 contents: hash(transitionsCount),
//               })
//             ),
//           cursorId: (ctx) => ctx.transitionsCount,
//         }),
//         createPacket: assign((ctx) => {
//           const packetId = ctx.transitionsCount
//           const transitionsCount = ctx.transitionsCount + 1
//           const packet = Change({
//             type: types.PACKET,
//             uplink: ctx.cursorId,
//           })
//           return {
//             transitionsCount,
//             cursorId: packetId,
//             transitions: ctx.transitions.set(packetId, packet),
//           }
//         }),
//         proposeSolution: assign((ctx) => {
//           const solutionId = ctx.transitionsCount
//           const packetId = ctx.cursorId
//           const solution = Change({
//             type: types.SOLUTION,
//             uplink: packetId,
//           })
//           const transitionsCount = ctx.transitionsCount + 1
//           return {
//             transitionsCount,
//             cursorId: solutionId,
//             transitions: ctx.transitions.set(solutionId, solution),
//           }
//         }),
//         focusUplink: assign({
//           cursorId: (ctx) => {
//             const change = ctx.transitions.get(ctx.cursorId)
//             return change.uplink
//           },
//         }),
//         createDispute: assign((ctx) => {
//           const disputeId = ctx.transitionsCount
//           const transitionsCount = ctx.transitionsCount + 1
//           let dispute = Change({
//             type: types.DISPUTE,
//             uplink: ctx.cursorId,
//           })
//           return {
//             transitionsCount,
//             cursorId: disputeId,
//             transitions: ctx.transitions.set(disputeId, dispute),
//           }
//         }),
//       },
//     }
//   )
// )
