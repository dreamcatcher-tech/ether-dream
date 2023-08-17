import equals from 'fast-deep-equal'
import { expect } from 'chai'
import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers.js'
import { types, tests } from './machine.js'
import { hash } from '../utils.js'
import Debug from 'debug'
const debug = Debug('test:sut')
const ONE_DAY_MS = 24 * 60 * 60 * 1000

async function deploy() {
  // Contracts are deployed using the first signer/account by default
  const [owner, qaAddress, funder1, funder2] = await ethers.getSigners()

  const LibraryQA = await ethers.getContractFactory('LibraryQA')
  const libraryQA = await LibraryQA.deploy()

  const Base58 = await ethers.getContractFactory('Base58')
  const base58 = await Base58.deploy()

  const LibraryUtils = await ethers.getContractFactory('LibraryUtils', {
    libraries: { Base58: base58.target },
  })
  const libraryUtils = await LibraryUtils.deploy()

  const LibraryState = await ethers.getContractFactory('LibraryState')
  const libraryState = await LibraryState.deploy()

  const DreamEther = await ethers.getContractFactory('DreamEther', {
    libraries: {
      LibraryQA: libraryQA.target,
      LibraryUtils: libraryUtils.target,
      LibraryState: libraryState.target,
    },
  })
  const dreamEther = await DreamEther.deploy()

  const QA = await ethers.getContractFactory('QA')
  const qa = await QA.deploy(dreamEther.target)

  const Dai = await ethers.getContractFactory('MockDai')
  const dai = await Dai.deploy(dreamEther.target)

  return { dreamEther, qa, dai, owner, qaAddress, ethers, funder1, funder2 }
}

export const initializeSut = async () => {
  const fixture = await loadFixture(deploy)
  return {
    fixture,
    states: {
      idle: () => {
        const { dreamEther } = fixture
        expect(dreamEther.target).to.not.equal(0)
      },
      '*': async (state) => {
        debug('state:', state.toStrings().join(' > '))
      },
    },
    events: {
      HEADER: async ({ state: { context } }) => {
        const { cursorId } = context
        const { dreamEther, qa } = fixture
        const header = hash('header' + cursorId)
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
      FUND_DAI: async ({ state: { context } }) => {
        const { cursorId } = context
        const { dreamEther, dai } = fixture
        const payments = [{ token: dai.target, tokenId: 0, amount: 13 }]
        const { type } = context.transitions.get(cursorId)
        debug('funding', type, cursorId)
        await expect(dreamEther.fund(cursorId, payments)).to.emit(
          dreamEther,
          'FundedTransition'
        )
        // TODO check balance of funding and dai has changed
      },
      QA_RESOLVE: async ({ state: { context } }) => {
        const { cursorId } = context
        const { dreamEther, qa } = fixture
        const { type } = context.transitions.get(cursorId)
        debug('qa resolving', type, cursorId)
        await expect(qa.passQA(cursorId))
          .to.emit(dreamEther, 'QAResolved')
          .withArgs(cursorId)
      },
      ENACT: async ({ state: { context } }) => {
        const { transitionsCount, cursorId } = context
        const { dreamEther } = fixture
        const { type, uplink } = context.transitions.get(cursorId)
        const THREE_DAYS_IN_SECONDS = 3 * ONE_DAY_MS
        await time.increase(THREE_DAYS_IN_SECONDS)
        const tx = dreamEther.enact(cursorId)
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
          debug('packet resolved', uplink)
          await expect(tx)
            .to.emit(dreamEther, 'PacketResolved')
            .withArgs(uplink)
        }
      },
      QA_CLAIM: async ({ state: { context } }) => {
        const { dreamEther, qa } = fixture
        const { cursorId } = context
        await expect(qa.claimQa(cursorId))
          .to.emit(dreamEther, 'QAClaimed')
          .withArgs(cursorId)
        const msg = 'Already claimed'
        await expect(qa.claimQa(cursorId)).to.be.revertedWith(msg)
      },
      QA_EMPTY: async ({ state: { context } }) => {
        const { qa } = fixture
        const { cursorId } = context
        expect(tests.isQaClaimable(context)).to.be.false
        const msg = 'No funds to claim'
        await expect(qa.claimQa(cursorId)).to.be.revertedWith(msg)
      },
      QA_CLAIM_ERROR: async ({ state: { context } }) => {
        const { qa } = fixture
        const { cursorId } = context
        expect(tests.isPacket(context)).to.be.true
        const msg = 'Cannot claim packets'
        await expect(qa.claimQa(cursorId)).to.be.revertedWith(msg)
      },
      SOLVE: async ({ state: { context } }) => {
        const { dreamEther } = fixture
        const { cursorId } = context
        const contents = hash('solving ' + cursorId)
        const { type } = context.transitions.get(cursorId)
        debug('solving', type, cursorId)
        await expect(dreamEther.solve(cursorId, contents)).to.emit(
          dreamEther,
          'SolutionProposed'
        )
      },
      CLAIM: async ({ state: { context } }) => {
        const { dreamEther } = fixture
        const { cursorId } = context
        const packet = context.transitions.get(cursorId)
        expect(packet.type).to.equal(types.PACKET)
        if (tests.isPacketClaimable(context)) {
          await expect(dreamEther.claim(cursorId)).to.emit(
            dreamEther,
            'Claimed'
          )
          await expect(dreamEther.claim(cursorId)).to.be.revertedWith(
            'Already claimed'
          )
        } else {
          await expect(dreamEther.claim(cursorId)).to.be.revertedWith(
            'No funds to claim'
          )
        }
      },
      TRADE_ONCE: async ({ state: { context } }) => {
        const { dreamEther, owner, funder1, funder2 } = fixture
        const { cursorId } = context
        const { type } = context.transitions.get(cursorId)
        debug('trading funding', type, cursorId)

        const result = await dreamEther.fundingNftIdsFor(cursorId)
        const nfts = result.toArray()
        expect(nfts.length).to.be.greaterThan(0)
        const addresses = nfts.map(() => owner.address)
        for (const nft of nfts) {
          const balance = await dreamEther.balanceOf(owner.address, nft)
          debug('balance', nft, balance)
          expect(balance).to.be.greaterThan(0)
        }
        debug('addresses', addresses, nfts)
        const balances = await dreamEther.balanceOfBatch(addresses, nfts)
        debug('balances', balances)

        const balance = await dreamEther.balanceOf(owner, cursorId)
        console.log(balance)
        // list the funding nfts for this change
        // trade them all over to another account
        // do a conditional check if we can actually trade or not
      },
      TRADE_TWICE: async ({ state: { context } }) => {
        const { dreamEther } = fixture
        const { cursorId } = context
        const { type } = context.transitions.get(cursorId)
        debug('trading funding', type, cursorId)

        // if
      },
    },
  }
}
