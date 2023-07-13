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
const types = {
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
  finalized: false,
  traded: false,
  targetId: undefined,
})

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
          // TODO event this, so we can know when something changed
          transitions: Immutable.Map(),
          cursorId: 0,
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
              FINALIZE: [
                { target: 'open', actions: 'finalizeHeader', cond: 'isHeader' },
                {
                  target: 'solved',
                  actions: 'finalizeSolution',
                  cond: 'isSolution',
                },
              ],
              // APPEAL_RESOLVE: { target: 'appeal', actions: 'appealResolve' },
            },
          },
          appeal: {},
          solved: {
            on: {
              // TRADE: { actions: 'trade', cond: 'isTradeable' },
              WITHDRAW: { actions: () => {} },
              // RE_SOLVE: solve it again
              // trade the solution and header NFTs
              // modify the header
              // REPEAT: make another header and start all over again
              // MERGE_PACKETS once have two packets, try merge them
            },
          },
        },
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
          fund: assign((ctx) => {
            const { cursorId, transitions } = ctx
            const transition = transitions.get(cursorId)
            const next = transition.set('funded', true)
            return { transitions: transitions.set(cursorId, next) }
          }),
          qaResolve: assign((ctx) => {
            const { cursorId } = ctx
            const transition = ctx.transitions.get(cursorId)
            const next = transition.set('qaResolved', true)
            return { transitions: ctx.transitions.set(cursorId, next) }
          }),
          finalizeHeader: assign((ctx) => {
            const transition = ctx.transitions.get(ctx.cursorId)
            const next = transition.set('finalized', true)
            const packetId = ctx.transitionsCount
            const transitionsCount = ctx.transitionsCount + 1
            const packet = Transition({
              type: types.PACKET,
              targetId: ctx.cursorId,
            })
            return {
              transitionsCount,
              cursorId: packetId,
              transitions: ctx.transitions
                .set(ctx.cursorId, next)
                .set(packetId, packet),
            }
          }),
          finalizeSolution: assign((ctx) => {
            // make the NFTs tradeable
            // store the shares from the QA
            // make the packet as finalized as well as the solution
            //
            const transition = ctx.transitions.get(ctx.cursorId)
            const next = transition.set('finalized', true)
            return { transitions: ctx.transitions.set(ctx.cursorId, next) }
          }),
          proposeSolution: assign((ctx) => {
            const solutionId = ctx.transitionsCount
            const packetId = ctx.cursorId
            const solution = Transition({
              type: types.SOLUTION,
              targetId: packetId,
            })
            const transitionsCount = ctx.transitionsCount + 1
            return {
              transitionsCount,
              cursorId: solutionId,
              transitions: ctx.transitions.set(solutionId, solution),
            }
          }),
        },
        guards: {
          isUnfunded: (ctx) => {
            const t = ctx.transitions.get(ctx.cursorId)
            return !t.funded
          },
          isHeader: (ctx) => {
            const transition = ctx.transitions.get(ctx.cursorId)
            return transition.type === types.HEADER
          },
          isFunded: (ctx) => {
            const transition = getTransition(ctx)
            return !transition.qaResolved && transition.funded
          },
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
  async function deploy() {
    // Contracts are deployed using the first signer/account by default
    const [owner, qaAddress] = await ethers.getSigners()

    const DreamEther = await ethers.getContractFactory('DreamEther')
    const dreamEther = await DreamEther.deploy()

    const QA = await ethers.getContractFactory('QA')
    const qa = await QA.deploy()

    const Dai = await ethers.getContractFactory('MockDai')
    const dai = await Dai.deploy()

    return { dreamEther, qa, owner, qaAddress, ethers }
  }

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
      it(description(path), async () => {
        // const fixture = await loadFixture(deploy)
        // const ipfs = fakeIpfsGenerator()
        // let tx
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
