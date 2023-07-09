import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers.js'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs.js'
import { expect } from 'chai'
import { createTestMachine, createTestModel } from '@xstate/test'
import { fakeIpfsGenerator } from '../utils.js'

describe('DreamEther', function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
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

  // test arrays for actions ?
  describe('model based testing', () => {
    const machine = createTestMachine({
      id: 'Dreamcatcher Ethereum',
      initial: 'Contract Deployed',
      states: {
        'Contract Deployed': {
          on: {
            PROPOSE_HEADER: 'Header Proposed',
          },
        },
        'Header Proposed': {
          on: {
            FUND_HEADER: 'Header Funded',
            HEADER_PASS_QA: 'Header Passed QA',
          },
        },
        'Header Funded': {
          on: {
            HEADER_PASS_QA: 'Header Passed QA',
          },
        },
        'Header Passed QA': {
          on: {
            HEADER_FINALIZE: 'Header Finalized',
          },
        },
        'Header Finalized': {
          on: {
            FUND_PACKET: 'Packet Funded',
          },
        },
        'Packet Funded': {
          on: {
            PROPOSE_SOLUTION: 'Solution Proposed',
          },
        },
        'Solution Proposed': {
          on: {
            FUND_SOLUTION: 'Solution Funded',
          },
        },
        'Solution Funded': {
          on: {
            SOLUTION_PASS_QA: 'Solution Passed QA',
            SOLUTION_FAIL_QA: 'Solution Failed QA',
          },
        },
        'Solution Passed QA': {
          on: {
            SOLUTION_FINALIZE: 'Packet Resolved',
          },
        },
        'Solution Failed QA': {
          on: {
            SOLUTION_APPEAL_REJECTION: 'Solution Appealing Rejection',
          },
        },
        'Solution Appealing Rejection': {
          on: {
            SOLUTION_APPEAL_REJECTION_WIN: 'Solution Funded',
            SOLUTION_APPEAL_REJECTION_LOSE: 'Dead',
          },
        },
        Dead: {
          type: 'final',
        },
        'Packet Resolved': {},
      },
      predictableActionArguments: true,
      preserveActionOrder: true,
    })
    const model = createTestModel(machine)

    model.getShortestPaths().forEach((path) => {
      it(path.description, async () => {
        const fixture = await loadFixture(deploy)
        const ipfs = fakeIpfsGenerator()
        let tx
        await path.test({
          states: {
            'Contract Deployed': () => {
              const { dreamEther } = fixture
              expect(dreamEther.target).to.not.equal(0)
            },
            'Header Proposed': async () => {
              const { dreamEther, qa } = fixture
              await expect(tx)
                .to.emit(dreamEther, 'ProposedPacket')
                .withArgs(6, qa.target)
            },
            'Header Funded': async () => {
              const { dreamEther } = fixture
              await expect(tx)
                .to.emit(dreamEther, 'FundedTransition')
                .changeEtherBalance(dreamEther, 5)
            },
            'Header Passed QA': async () => {
              const { dreamEther } = fixture
              await expect(tx).to.emit(dreamEther, 'QAResolved').withArgs(6)
            },
            'Header Finalized': async () => {
              const { dreamEther } = fixture
              await expect(tx).to.emit(dreamEther, 'PacketCreated').withArgs(1)
            },
            'Packet Funded': async () => {
              const { dreamEther } = fixture
              await expect(tx)
                .to.emit(dreamEther, 'FundedTransition')
                .changeEtherBalance(dreamEther, 5)
            },
            'Solution Proposed': async () => {
              const { dreamEther } = fixture
              await expect(tx).to.emit(dreamEther, 'SolutionProposed')
            },
            'Solution Funded': async () => {
              // solution is awaiting QA to process it
            },
            'Solution Passed QA': async () => {
              const { dreamEther, solutionId } = fixture
              await expect(tx)
                .to.emit(dreamEther, 'QAResolved')
                .withArgs(solutionId)
            },
            'Packet Resolved': async () => {
              const { dreamEther, packetId, solutionId } = fixture
              await expect(tx)
                .to.emit(dreamEther, 'SolutionAccepted')
                .withArgs(solutionId)
              await expect(tx)
                .to.emit(dreamEther, 'PacketResolved')
                .withArgs(packetId)
            },
            'Solution Failed QA': async () => {
              const { dreamEther, solutionId } = fixture
              await expect(tx)
                .to.emit(dreamEther, 'QARejected')
                .withArgs(solutionId)
            },
            'Solution Appealing Rejection': async () => {
              const { dreamEther, solutionId } = fixture
              await expect(tx)
                .to.emit(dreamEther, 'SolutionAppealed')
                .withArgs(solutionId)
            },
            Dead: () => {},
            '*': async (state, ...rest) => {
              console.log(state, rest)
              if (state.meta?.test) {
                return state.meta.test()
              }
              expect.fail(`Untested state: ${state.value}`)
            },
          },
          events: {
            PROPOSE_HEADER: async () => {
              const { dreamEther, qa } = fixture
              tx = dreamEther.proposePacket(6, qa.target)
            },
            FUND_HEADER: async () => {
              const { dreamEther } = fixture
              tx = dreamEther.fund(6, [], { value: 5 })
            },
            HEADER_PASS_QA: async () => {
              const { dreamEther, qa } = fixture
              tx = qa.passQA(6, dreamEther.target)
            },
            HEADER_FINALIZE: async () => {
              const { dreamEther } = fixture
              await time.increase(3600 * 24 * 3)
              tx = dreamEther.finalizeTransition(6)
              fixture.packetId = 1
            },
            FUND_PACKET: async () => {
              const { dreamEther, packetId } = fixture
              const payments = []
              tx = dreamEther.fund(packetId, payments, { value: 5 })
            },
            PROPOSE_SOLUTION: async () => {
              fixture.solutionId = 13
              const { dreamEther, packetId, solutionId } = fixture
              tx = dreamEther.proposeSolution(packetId, solutionId)
            },
            FUND_SOLUTION: async () => {
              const { dreamEther, solutionId } = fixture
              const payments = []
              tx = dreamEther.fund(solutionId, payments, { value: 500 })
              await expect(tx)
                .to.emit(dreamEther, 'FundedTransition')
                .changeEtherBalance(dreamEther, 500)
            },
            SOLUTION_PASS_QA: async () => {
              const { dreamEther, solutionId, qa } = fixture
              tx = qa.passQA(solutionId, dreamEther.target)
            },
            SOLUTION_FAIL_QA: async () => {
              const { dreamEther, solutionId, qa } = fixture
              const failHash = ipfs()
              tx = qa.failQA(solutionId, failHash, dreamEther.target)
            },
            SOLUTION_FINALIZE: async () => {
              const { dreamEther, solutionId } = fixture
              await time.increase(3600 * 24 * 3)
              tx = dreamEther.finalizeTransition(solutionId)
            },
            SOLUTION_APPEAL_REJECTION: async () => {
              const { dreamEther, solutionId } = fixture
              const reason = ipfs()
              tx = dreamEther.appealRejection(solutionId, reason)
            },
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
    it.skip('multiple solutions funded within appealWindow')
  })
  describe('appeals', () => {
    it.skip('appeals cannot be appealed')
    it.skip('cannot appeal a packet')
  })
})
