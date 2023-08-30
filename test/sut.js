import chai, { expect } from 'chai'
import sinonChai from 'sinon-chai'
import sinon from 'sinon'

import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers.js'
import { types } from './machine.js'
import { is } from './conditions.js'
import { hash } from './utils.js'
import sutTests, { tradeContent } from './sutTests.js'
import Debug from 'debug'
const debug = Debug('test:sut')
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const DEFUND_WINDOW_MS = 14 * ONE_DAY_MS
const DISPUTE_WINDOW_MS = 7 * ONE_DAY_MS
chai.use(sinonChai)
const SOLVER1_SHARES = 897
const SOLVER2_SHARES = 1000 - SOLVER1_SHARES
const DISPUTER1_SHARES = 787
const DISPUTER2_SHARES = 1000 - DISPUTER1_SHARES

async function deploy() {
  // Contracts are deployed using the first signer/account by default
  const [
    owner,
    qaAddress,
    funder1,
    funder2,
    solver1,
    solver2,
    disputer1,
    disputer2,
    noone,
  ] = await ethers.getSigners()

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
    disputer1,
    disputer2,
    noone,
  }
}

export const initializeSut = async () => {
  const fixture = await loadFixture(deploy)
  const tests = sutTests(fixture)
  const {
    dreamEther,
    qa,
    dai,
    owner,
    ethers,
    funder1,
    solver1,
    solver2,
    disputer1,
    disputer2,
  } = fixture

  const sut = {
    fixture,
    tests,
    states: {
      idle: () => {
        expect(dreamEther.target).to.not.equal(0)
      },
      '*': async (state) => {
        debug('state:', state.toStrings().join(' > '))
      },
      qaClaim: async ({ context }) => {
        if (is({ funded: false })(context)) {
          await tests.noQaFundsToClaim(context.cursorId)
        }
      },
      pending: async ({ context }) => {
        await tests.defundExitAfterQa(context.cursorId)
        await tests.defundInvalidStart(context.cursorId)
        await tests.defundInvalidStop(context.cursorId)
      },
      enacted: async ({ context }) => {
        await tests.defundExitAfterQa(context.cursorId)
        await tests.defundInvalidStart(context.cursorId)
        await tests.defundInvalidStop(context.cursorId)
      },
      solved: async ({ context }) => {
        const { cursorId } = context
        expect(is({ type: types.PACKET })(context)).to.be.true

        tests.noQaClaimPackets(cursorId)
        if (is({ funded: false })(context)) {
          await tests.noFundsToClaim(cursorId)
        }
      },
      tradePacketContent: async ({ context }) => {
        expect(is({ type: types.PACKET })(context)).to.be.true
        if (is({ isClaimed: false, funded: true })(context)) {
          await tests.packetContentUntransferrable(context)
        }
      },
    },
    events: {
      HEADER: async ({ state: { context } }) => {
        const { cursorId } = context
        const header = hash('header' + cursorId)
        debug('header', cursorId)
        await expect(dreamEther.proposePacket(header, qa.target))
          .to.emit(dreamEther, 'ProposedPacket')
          .withArgs(cursorId)
      },
      FUND: async ({ state: { context } }) => {
        const { cursorId } = context
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
        const { type } = context.transitions.get(cursorId)
        debug('qa resolving', type, cursorId)
        const addresses = [solver1.address, solver2.address]
        const amounts = [SOLVER1_SHARES, SOLVER2_SHARES]
        await expect(qa.passQA(cursorId, addresses, amounts))
          .to.emit(dreamEther, 'QAResolved')
          .withArgs(cursorId)
      },
      ENACT_HEADER: async ({ state: { context } }) => {
        const { transitionsCount, cursorId } = context
        const { type } = context.transitions.get(cursorId)
        expect(type).to.equal(types.HEADER)

        // TODO confirm error if not enough time has passed

        const THREE_DAYS_IN_SECONDS = 3 * ONE_DAY_MS
        await time.increase(THREE_DAYS_IN_SECONDS)
        debug('enact', type, cursorId)
        await expect(dreamEther.enact(cursorId))
          .to.emit(dreamEther, 'PacketCreated')
          .withArgs(transitionsCount)
      },
      ENACT_SOLUTION: async ({ state: { context } }) => {
        const { cursorId } = context
        const { type, uplink } = context.transitions.get(cursorId)
        expect(type).to.equal(types.SOLUTION)

        // TODO confirm error if not enough time has passed

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
        const { cursorId } = context

        await tests.qaInvalidClaim(cursorId)

        await expect(qa.claimQa(cursorId))
          .to.emit(dreamEther, 'QAClaimed')
          .withArgs(cursorId)
        await tests.qaReClaim(cursorId)
      },
      SOLVE: async ({ state: { context } }) => {
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
        const { cursorId } = context
        const packet = context.transitions.get(cursorId)
        expect(packet.type).to.equal(types.PACKET)
        debug('claiming', cursorId)
        const contentId = await dreamEther.contentNftId(cursorId)
        const solver1Balance = await dreamEther
          .connect(solver1)
          .balanceOf(solver1.address, contentId)
        expect(solver1Balance).to.equal(SOLVER1_SHARES)
        const solver2Balance = await dreamEther
          .connect(solver2)
          .balanceOf(solver2.address, contentId)
        expect(solver2Balance).to.equal(SOLVER2_SHARES)
        const ownerBalance = await dreamEther
          .connect(owner)
          .balanceOf(owner.address, contentId)
        expect(ownerBalance).to.equal(0)

        const actors = [solver1, solver2]
        for (const solver of actors) {
          const c1 = dreamEther.connect(solver).claim(cursorId)
          const c2 = dreamEther.connect(solver).claim(cursorId)
          await expect(c1).to.emit(dreamEther, 'Claimed')
          await expect(c2).to.be.revertedWith('Already claimed')
        }
        await expect(dreamEther.claim(cursorId)).to.be.rejectedWith(
          'Not a holder'
        )

        // TODO also check the QA address cannot claim or fund anything
      },
      TRADE_FUNDS: async ({ state: { context } }) => {
        const { cursorId } = context
        const { type } = context.transitions.get(cursorId)
        debug('trading funding', type, cursorId)

        const allFundingNftIds = await dreamEther.fundingNftIds(cursorId)
        expect(allFundingNftIds.length).to.be.greaterThan(0)

        // TODO add balace of checks pre and post trade

        expect(await dreamEther.isNftHeld(cursorId, owner.address)).to.be.true
        const result = await dreamEther.fundingNftIdsFor(cursorId)
        const nfts = result.toArray()
        expect(nfts.length).to.be.greaterThan(0)
        const addresses = nfts.map(() => owner)
        for (const nft of nfts) {
          const balance = await dreamEther.balanceOf(owner.address, nft)
          debug('balance', nft, balance)
          expect(balance).to.be.greaterThan(0)
          expect(await dreamEther.totalSupply(nft)).to.equal(balance)
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
        const [tx, args] = await tradeContent(fixture, context)
        const { from, to, id, amount } = args
        const operator = from
        await expect(tx)
          .to.emit(dreamEther, 'TransferSingle')
          .withArgs(operator, from, to, id, amount)
      },
      EXIT: async () => {
        const users = [owner, funder1, solver1, solver2]
        // TODO do some actual balance tracking
        for (const user of users) {
          const debts = (await dreamEther.exitList(user)).toArray()
          debug('debts', user.address, debts)
          if (debts.length > 1) {
            if (!tests.exitSingle.called) {
              await tests.exitSingle(user, debts.pop())
            }
            if (!tests.exitBurn.called) {
              await tests.exitBurn(user, debts.pop())
            }
          }
          if (debts.length) {
            await expect(dreamEther.connect(user).exit())
              .to.emit(dreamEther, 'Exit')
              .withArgs(user.address)
          }
          const updated = await dreamEther.exitList(user)
          expect(updated.length).to.equal(0)
        }
      },
      QA_EXIT: async () => {
        const debts = (await dreamEther.exitList(qa.target)).toArray()
        expect(debts.length).to.be.greaterThan(0)
        await expect(qa.exit()).to.emit(dreamEther, 'Exit').withArgs(qa.target)
        const updated = (await dreamEther.exitList(qa.target)).toArray()
        expect(updated.length).to.equal(0)
      },
      DEFUND_START: async ({ state: { context } }) => {
        const { cursorId } = context
        await tests.defundExitBeforeStart(cursorId)
        await tests.defundStopBeforeStart(cursorId)
        await expect(dreamEther.defundStart(cursorId))
          .to.emit(dreamEther, 'DefundStarted')
          .withArgs(cursorId, owner.address)
        await tests.defundDoubleStart(cursorId)
      },
      DEFUND_STOP: async ({ state: { context } }) => {
        const { cursorId } = context
        await expect(dreamEther.defundStop(cursorId))
          .to.emit(dreamEther, 'DefundStopped')
          .withArgs(cursorId, owner.address)
        await tests.defundRestart(cursorId)
      },
      DEFUND_EXIT: async ({ state: { context } }) => {
        await tests.defundEarly(context.cursorId)
        await time.increase(DEFUND_WINDOW_MS)
        const { cursorId } = context
        await expect(dreamEther.defund(cursorId))
          .to.emit(dreamEther, 'Defunded')
          .withArgs(cursorId, owner.address)
        await tests.defundDoubleExit(cursorId)
      },
      DISPUTE_RESOLVE: async ({ state: { context } }) => {
        const { cursorId } = context
        const contents = hash('disputing ' + cursorId)
        await expect(dreamEther.disputeResolve(cursorId, contents))
          .to.emit(dreamEther, 'ChangeDisputed')
          .withArgs(context.cursorId, context.transitionsCount)
        // TODO twice with the same content should fail.
      },
      SUPER_UPHELD: async ({ state: { context } }) => {
        await time.increase(DISPUTE_WINDOW_MS)
        const { cursorId } = context
        const addresses = [disputer1.address, disputer2.address]
        const amounts = [DISPUTER1_SHARES, DISPUTER2_SHARES]
        const reason = hash('upheld ' + cursorId)
        await expect(qa.disputeUpheld(cursorId, addresses, amounts, reason))
          .to.emit(dreamEther, 'DisputesUpheld')
          .withArgs(cursorId)
      },
      SUPER_DISMISSED: async ({ state: { context } }) => {
        await time.increase(DISPUTE_WINDOW_MS)
        const { cursorId } = context
        const dispute = context.transitions.get(cursorId)
        const reason = hash('dismissed ' + dispute.uplink)
        await expect(qa.disputesDismissed(dispute.uplink, reason))
          .to.emit(dreamEther, 'DisputesDismissed')
          .withArgs(dispute.uplink)
      },
    },
  }
  sinon.spy(sut.tests)
  sinon.spy(sut.states)
  sinon.spy(sut.events)
  return sut
}
