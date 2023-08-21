import { expect } from 'chai'
import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers.js'
import { types, is } from './machine.js'
import { hash } from './utils.js'
import Debug from 'debug'
const debug = Debug('test:sut')
const ONE_DAY_MS = 24 * 60 * 60 * 1000

async function deploy() {
  // Contracts are deployed using the first signer/account by default
  const [owner, qaAddress, funder1, funder2, solver1, solver2] =
    await ethers.getSigners()

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

  return {
    dreamEther,
    qa,
    dai,
    owner,
    qaAddress,
    ethers,
    funder1,
    funder2,
    solver1,
    solver2,
  }
}

export const initializeSut = async () => {
  const fixture = await loadFixture(deploy)
  const sut = {
    fixture,
    states: {
      idle: () => {
        const { dreamEther } = fixture
        expect(dreamEther.target).to.not.equal(0)
      },
      '*': async (state) => {
        debug('state:', state.toStrings().join(' > '))
      },
      qaClaim: async ({ context }) => {
        if (is({ funded: false, fundedDai: false })(context)) {
          const { qa } = fixture
          const { cursorId } = context
          const msg = 'No funds to claim'
          await expect(qa.claimQa(cursorId)).to.be.revertedWith(msg)
        }
      },
      solved: async ({ context }) => {
        const { dreamEther, qa } = fixture
        const { cursorId } = context
        expect(is({ type: types.PACKET })(context)).to.be.true

        await expect(qa.claimQa(cursorId)).to.be.revertedWith(
          'Cannot claim packets'
        )
        if (is({ funded: false, fundedDai: false })(context)) {
          await expect(dreamEther.claim(cursorId)).to.be.revertedWith(
            'No funds to claim'
          )
        }
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
      ENACT_HEADER: async ({ state: { context } }) => {
        const { transitionsCount, cursorId } = context
        const { dreamEther } = fixture
        const { type } = context.transitions.get(cursorId)
        expect(type).to.equal(types.HEADER)

        const THREE_DAYS_IN_SECONDS = 3 * ONE_DAY_MS
        await time.increase(THREE_DAYS_IN_SECONDS)
        debug('enact', type, cursorId)
        await expect(dreamEther.enact(cursorId))
          .to.emit(dreamEther, 'PacketCreated')
          .withArgs(transitionsCount)
      },
      ENACT_SOLUTION: async ({ state: { context } }) => {
        const { cursorId } = context
        const { dreamEther } = fixture
        const { type, uplink } = context.transitions.get(cursorId)
        expect(type).to.equal(types.SOLUTION)

        const THREE_DAYS_IN_SECONDS = 3 * ONE_DAY_MS
        await time.increase(THREE_DAYS_IN_SECONDS)
        debug('enact', type, cursorId)
        const tx = dreamEther.enact(cursorId)
        await expect(tx)
          .to.emit(dreamEther, 'SolutionAccepted')
          .withArgs(cursorId)
        debug('packet resolved', uplink)
        await expect(tx).to.emit(dreamEther, 'PacketResolved').withArgs(uplink)
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
        await expect(dreamEther.claim(cursorId)).to.emit(dreamEther, 'Claimed')
        await expect(dreamEther.claim(cursorId)).to.be.revertedWith(
          'Already claimed'
        )
        // TODO also check the QA address cannot claim or fund anything
      },
      TRADE_FUNDS: async ({ state: { context } }) => {
        const { dreamEther, owner, funder1 } = fixture
        const { cursorId } = context
        const { type } = context.transitions.get(cursorId)
        debug('trading funding', type, cursorId)

        const result = await dreamEther.fundingNftIdsFor(cursorId)
        const nfts = result.toArray()
        expect(nfts.length).to.be.greaterThan(0)
        const addresses = nfts.map(() => owner)
        for (const nft of nfts) {
          const balance = await dreamEther.balanceOf(owner.address, nft)
          debug('balance', nft, balance)
          expect(balance).to.be.greaterThan(0)
        }
        debug('addresses', addresses, nfts)
        const balances = await dreamEther.balanceOfBatch(addresses, nfts)
        debug('balances', balances)
        const operator = owner.address
        const from = owner.address
        const to = funder1.address
        const id = nfts[0]
        const amount = 1
        await expect(dreamEther.safeTransferFrom(from, to, id, amount, '0x'))
          .to.emit(dreamEther, 'TransferSingle')
          .withArgs(operator, from, to, id, amount)
      },
      TRADE_CONTENT: async ({ state: { context } }) => {
        const { dreamEther, owner, solver1 } = fixture
        const { cursorId } = context
        const { type } = context.transitions.get(cursorId)
        debug('trading content', type, cursorId)

        const nftId = await dreamEther.contentNftId(cursorId)
        expect(nftId).to.be.greaterThan(0)

        const balance = await dreamEther.balanceOf(owner.address, nftId)
        debug('balance', nftId, balance)
        expect(balance).to.be.greaterThan(0)

        const operator = owner.address
        const from = owner.address
        const to = solver1.address
        const amount = 1
        await expect(dreamEther.safeTransferFrom(from, to, nftId, amount, '0x'))
          .to.emit(dreamEther, 'TransferSingle')
          .withArgs(operator, from, to, nftId, amount)
      },
    },
  }
  return sut
}
