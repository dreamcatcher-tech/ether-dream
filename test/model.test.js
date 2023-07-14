import { fakeIpfsGenerator } from '../utils.js'
import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers.js'
import equals from 'fast-deep-equal'
import { expect } from 'chai'
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

describe('model based tests', () => {
  const model = createTestModel(
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
              // APPEAL_SHARES
            },
          },
          dispute: {},
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
          qaResolve: assign({
            transitions: (ctx) => {
              const { cursorId } = ctx
              const transition = ctx.transitions.get(cursorId)
              const next = transition.set('qaResolved', true)
              return ctx.transitions.set(cursorId, next)
            },
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
          finalizeSolution: assign({
            transitions: (ctx) => {
              // make the NFTs tradeable
              // store the shares from the QA
              // make the packet as finalized as well as the solution
              //
              const transition = ctx.transitions.get(ctx.cursorId)
              const next = transition.set('finalized', true)
              return ctx.transitions.set(ctx.cursorId, next)
            },
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
          isDispute: (ctx) => {},
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
    // a bug in @xstate/test requires this
    // https://github.com/statelyai/xstate/issues/4146
    toState: (state) => state.matches('solved'),
  })
  describe(`shortest ${shortestPaths.length} paths`, () => {
    // Debug.enable('test:consequences')

    // shortestPaths.length = 1
    let i = 0
    shortestPaths.forEach((path) => {
      const index = `[${i}] `
      if (i++ !== 8) {
        // return
      }
      it(index + description(path), async () => {
        const fixture = await loadFixture(deploy)
        const ipfs = fakeIpfsGenerator()
        await path.test({
          states: {
            idle: () => {
              const { dreamEther } = fixture
              expect(dreamEther.target).to.not.equal(0)
            },
            '*': async (state) => {
              debug('state:', state.toStrings().join(' -> '))
            },
          },
          events: {
            HEADER: async ({ state: { context } }) => {
              const { cursorId } = context
              const { dreamEther, qa } = fixture
              const header = ipfs()
              debug('header', cursorId)
              await expect(dreamEther.proposePacket(header, qa.target))
                .to.emit(dreamEther, 'ProposedPacket')
                .withArgs(cursorId)
            },
            FUND: async ({ state: { context } }) => {
              const { cursorId } = context
              const { dreamEther } = fixture
              const payments = []
              const value = ethers.parseEther('5')
              const { type } = context.transitions.get(cursorId)
              debug('funding', type, cursorId)
              await expect(dreamEther.fund(cursorId, payments, { value }))
                .to.emit(dreamEther, 'FundedTransition')
                .changeEtherBalance(dreamEther, value)
            },
            QA_RESOLVE: async ({ state: { context } }) => {
              const { cursorId } = context
              const { dreamEther, qa } = fixture
              const { type } = context.transitions.get(cursorId)
              debug('qa resolving', type, cursorId)
              await expect(qa.passQA(cursorId, dreamEther.target))
                .to.emit(dreamEther, 'QAResolved')
                .withArgs(cursorId)
            },
            FINALIZE: async ({ state: { context } }) => {
              const { transitionsCount, cursorId } = context
              const { dreamEther } = fixture
              const { type, targetId } = context.transitions.get(cursorId)
              const THREE_DAYS_IN_SECONDS = 3600 * 24 * 3
              await time.increase(THREE_DAYS_IN_SECONDS)
              const tx = dreamEther.finalize(cursorId)
              expect(type).to.not.equal(types.PACKET)
              debug('finalizing', type, cursorId)
              if (type === types.PACKET) {
                await expect(tx)
                  .to.emit(dreamEther, 'PacketCreated')
                  .withArgs(transitionsCount)
              }
              if (type === types.SOLUTION) {
                await expect(tx)
                  .to.emit(dreamEther, 'SolutionAccepted')
                  .withArgs(cursorId)
                debug('packet resolved', targetId)
                await expect(tx)
                  .to.emit(dreamEther, 'PacketResolved')
                  .withArgs(targetId)
              }
            },
            SOLVE: async ({ state: { context }, ...rest }) => {
              const { dreamEther } = fixture
              const { cursorId } = context
              const contents = ipfs()
              const { type } = context.transitions.get(cursorId)
              debug('solving', type, cursorId)
              await expect(
                dreamEther.proposeSolution(cursorId, contents)
              ).to.emit(dreamEther, 'SolutionProposed')
            },

            // OLD
            // SOLUTION_FAIL_QA: async () => {
            //   const { dreamEther, solutionId, qa } = fixture
            //   const failHash = ipfs()
            //   tx = qa.failQA(solutionId, failHash, dreamEther.target)
            // },
            // SOLUTION_APPEAL_REJECTION: async () => {
            //   const { dreamEther, solutionId } = fixture
            //   const reason = ipfs()
            //   tx = dreamEther.appealRejection(solutionId, reason)
            // },
            // 'Solution Failed QA': async () => {
            //   const { dreamEther, solutionId } = fixture
            //   await expect(tx)
            //     .to.emit(dreamEther, 'QARejected')
            //     .withArgs(solutionId)
            // },
            // 'Solution Appealing Rejection': async () => {
            //   const { dreamEther, solutionId } = fixture
            //   await expect(tx)
            //     .to.emit(dreamEther, 'SolutionAppealed')
            //     .withArgs(solutionId)
            // },
          },
        })
      })
    })
  })
  describe('funding', () => {
    it.skip('funding during withdraw lock resets the lock')
    it.skip('funding using locked funds on the same packet undoes the lock')
    it.skip('funders can use multiple tokens including ETH')
    it.skip('funders can use multiple tokens from the same contract')
  })
  describe('e2e', () => {
    it.skip('solving an already solved packet with something better')
    it.skip('modifying the packet header')
    it.skip('packet solving another packet')
    it.skip('check balances of all token types')
  })
  describe('packet closing', () => {
    it.skip('multiple solutions funded within disputeWindow')
    it.skip('defund during disputeWindow is honored if solution rejected')
    it.skip('solve a packet that has already been solved')
    it.skip('wrap a packet in a solution to solve another packet')
  })
  describe('disputes', () => {
    it.skip('disputes cannot be disputed')
    it.skip('cannot dispute a packet')
  })
})
