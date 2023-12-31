import chai, { expect } from 'chai'
import sinonChai from 'sinon-chai'
import sinon from 'sinon'
import {
  time,
  loadFixture,
  setBalance,
} from '@nomicfoundation/hardhat-toolbox/network-helpers.js'
import { hash } from './utils.js'
import sutTests from './sutTests.js'
import { getChange } from './multi/multiMachine.js'
import Debug from 'debug'
const types = {
  HEADER: 'HEADER',
  PACKET: 'PACKET',
  SOLUTION: 'SOLUTION',
  DISPUTE: 'DISPUTE',
  EDIT: 'EDIT',
  MERGE: 'MERGE',
}
const debug = Debug('test:sut')
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_DAY_SECS = 24 * 60 * 60
export const DISPUTE_WINDOW_SECS = 7 * ONE_DAY_SECS
const DISPUTE_WINDOW_MS = 7 * ONE_DAY_MS
chai.use(sinonChai)
const TOTAL_SHARES = 1000
const SOLVER1_SHARES = 897
const SOLVER2_SHARES = TOTAL_SHARES - SOLVER1_SHARES
const DISPUTER1_SHARES = 787
const DISPUTER2_SHARES = TOTAL_SHARES - DISPUTER1_SHARES

const getCursor = (context) => context.selectedChange + 1

async function deploy() {
  // Contracts are deployed using the first signer/account by default
  const [
    owner,
    qaAddress,
    funder1,
    trader,
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

  const LibraryChange = await ethers.getContractFactory('LibraryChange')
  const libraryChange = await LibraryChange.deploy()

  const LibraryFilter = await ethers.getContractFactory('LibraryFilter')
  const libraryFilter = await LibraryFilter.deploy()

  const LibraryState = await ethers.getContractFactory('LibraryState', {
    libraries: {
      LibraryQA: libraryQA.target,
      LibraryChange: libraryChange.target,
      LibraryFilter: libraryFilter.target,
    },
  })
  const libraryState = await LibraryState.deploy()

  const DreamEther = await ethers.getContractFactory('DreamEther', {
    libraries: {
      LibraryQA: libraryQA.target,
      LibraryUtils: libraryUtils.target,
      LibraryState: libraryState.target,
      LibraryFilter: libraryFilter.target,
    },
  })
  const dreamEther = await DreamEther.deploy()

  const QA = await ethers.getContractFactory('QA')
  const qa = await QA.deploy(dreamEther.target)

  const Dai = await ethers.getContractFactory('MockDai')
  const dai = await Dai.deploy(dreamEther.target)

  const openSeaAddress = '0x495f947276749Ce646f68AC8c248420045cb7b5e'
  const openSea = await ethers.getImpersonatedSigner(openSeaAddress)
  await setBalance(openSeaAddress, ethers.parseEther('1'))

  return {
    dreamEther,
    qa,
    dai,
    owner,
    qaAddress,
    ethers,
    funder1,
    trader,
    solver1,
    solver2,
    disputer1,
    disputer2,
    noone,
    openSea,
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
    trader,
    solver1,
    solver2,
    disputer1,
    disputer2,
    noone,
    openSea,
  } = fixture

  // bug in xstate: https://github.com/statelyai/xstate/issues/4310
  let lastState

  const sut = {
    fixture,
    tests,
    states: {
      '*': async (state) => {
        debug('state:', state.toStrings().join(' > '))
        lastState = state
      },

      // WAVE_FRONT
      // qaClaim: async ({ context }) => {
      //   if (is({ funded: false })(context)) {
      //     await tests.noQaFundsToClaim(context.cursorId)
      //   }
      // },
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
      // solved: async ({ context }) => {
      //   const { cursorId } = context
      //   expect(is({ type: types.PACKET })(context)).to.be.true

      //   tests.noQaClaimPackets(cursorId)
      //   if (is({ funded: false })(context)) {
      //     await tests.noFundsToClaim(cursorId)
      //   }
      // },
      // tradePacketContent: async ({ context }) => {
      //   expect(is({ type: types.PACKET })(context)).to.be.true
      //   if (is({ isClaimed: false, funded: true })(context)) {
      //     await tests.packetContentUntransferrable(context)
      //   }
      // },
    },
    events: {
      PROPOSE_PACKET: async ({ state: { context } }) => {
        const cursorId = getCursor(context)
        const header = hash('header' + cursorId)
        debug('PROPOSE_PACKET', cursorId)

        await expect(dreamEther.proposePacket(header, qa.target))
          .to.emit(dreamEther, 'ProposedPacket')
          .withArgs(cursorId, DISPUTE_WINDOW_SECS)
        expect(await dreamEther.getQA(cursorId)).to.equal(qa.target)
      },
      TICK_DISPUTE_TIME: async () => {
        debug('tick time DISPUTE_WINDOW_MS', DISPUTE_WINDOW_MS)
        await time.increase(DISPUTE_WINDOW_SECS)
      },
      QA_RESOLVE: async ({ state: { context } }) => {
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('qa resolve', type, cursorId)
        await tests.superDismissBeforeQa(cursorId)
        await tests.qaResolvePre(cursorId)

        const shares = [
          [solver1.address, SOLVER1_SHARES],
          [solver2.address, SOLVER2_SHARES],
        ]
        await expect(qa.passQA(cursorId, shares))
          .to.emit(dreamEther, 'QAResolved')
          .withArgs(cursorId)
        await tests.disputeInvalidRejection(cursorId)
        await tests.qaResolvePost(cursorId)
      },
      ENACT: async () => {
        // TODO confirm error if not enough time has passed
        // bug in xstate: https://github.com/statelyai/xstate/issues/4310
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('enact', type, cursorId)
        const tx = dreamEther.enact(cursorId)
        switch (type) {
          // TODO split the action based on the type
          case types.HEADER: {
            const packetId = context.changes.length + 1
            await expect(tx)
              .to.emit(dreamEther, 'PacketCreated')
              .withArgs(packetId)
            debug('enact packet created', packetId)
            break
          }
          case types.SOLUTION: {
            await expect(tx)
              .to.emit(dreamEther, 'SolutionAccepted')
              .withArgs(cursorId)
            debug('enact solution accepted', cursorId)
            break
          }
          default:
            throw new Error('unknown type ' + type)
        }
      },
      PROPOSE_SOLUTION: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const contents = hash('solving ' + cursorId)
        const { type } = getChange(context)
        expect(type).to.equal(types.PACKET)
        debug('solving', type, cursorId)
        await expect(dreamEther.proposeSolution(cursorId, contents)).to.emit(
          dreamEther,
          'SolutionProposed'
        )
      },
      FUNDER_TRADE_SOME_FUNDS: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('FUNDER_TRADE_SOME_FUNDS', type, cursorId)
        const isAll = false
        await tradeFunds(fixture, cursorId, funder1, isAll)
      },
      OPENSEA_TRADE_SOME_FUNDS: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('OPENSEA_TRADE_SOME_FUNDS', type, cursorId)
        const isAll = false
        await tradeFunds(fixture, cursorId, openSea, isAll)
      },
      FUNDER_TRADE_ALL_FUNDS: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('FUNDER_TRADE_ALL_FUNDS', type, cursorId)
        const isAll = true
        await tradeFunds(fixture, cursorId, funder1, isAll)
      },
      OPENSEA_TRADE_ALL_FUNDS: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('OPENSEA_TRADE_ALL_FUNDS', type, cursorId)
        const isAll = true
        await tradeFunds(fixture, cursorId, openSea, isAll)
      },
      FUND_ETH: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('FUND_ETH', type, cursorId)

        const payments = []
        const value = ethers.parseEther('59')
        const tx = dreamEther
          .connect(funder1)
          .fund(cursorId, payments, { value })
        await expect(tx).changeEtherBalance(dreamEther, value)
        await expect(tx).to.emit(dreamEther, 'FundedTransition')
      },
      TRADE_SOME_CONTENT: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('TRADE_SOME_CONTENT', type, cursorId)
        // TODO add balace of checks pre and post trade

        expect(await dreamEther.isNftHeld(cursorId, solver1.address)).to.be.true
        expect(await dreamEther.isNftHeld(cursorId, solver2.address)).to.be.true
        expect(await dreamEther.isNftHeld(cursorId, noone.address)).to.be.false
        const nftId = await dreamEther.contentNftId(cursorId)
        expect(nftId).to.be.greaterThan(0)

        expect(await dreamEther.totalSupply(nftId)).to.equal(TOTAL_SHARES)

        const balanceSolver1 = await dreamEther.balanceOf(solver1, nftId)
        debug('balance solver1', nftId, balanceSolver1)
        expect(balanceSolver1).to.equal(SOLVER1_SHARES)
        const balanceSolver2 = await dreamEther.balanceOf(solver2, nftId)
        debug('balance solver2', nftId, balanceSolver2)
        expect(balanceSolver2).to.equal(SOLVER2_SHARES)

        const from = solver1.address
        const to = trader.address
        const amount = 13
        const operator = from
        const tx = dreamEther
          .connect(solver1)
          .safeTransferFrom(from, to, nftId, amount, '0x')
        await expect(tx)
          .to.emit(dreamEther, 'TransferSingle')
          .withArgs(operator, from, to, nftId, amount)
      },
      TRADE_ALL_CONTENT: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('TRADE_ALL_CONTENT', type, cursorId)
        // TODO add balace of checks pre and post trade
        // a "verifyBalances" call would check integrity of everything
        // TODO add a function to get everyones balances from the contract
        // then can compare with afterwards

        const nftId = await dreamEther.contentNftId(cursorId)
        const balanceSolver1 = await dreamEther.balanceOf(solver1, nftId)

        const from = solver1.address
        const to = trader.address
        const amount = balanceSolver1
        const operator = from
        const tx = dreamEther
          .connect(solver1)
          .safeTransferFrom(from, to, nftId, amount, '0x')
        await expect(tx)
          .to.emit(dreamEther, 'TransferSingle')
          .withArgs(operator, from, to, nftId, amount)

        const postBalanceSolver1 = await dreamEther.balanceOf(solver1, nftId)
        expect(postBalanceSolver1).to.equal(0)
      },
      TRADE_MEDALLION: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('TRADE_MEDALLION', type, cursorId)

        const nftId = await dreamEther.qaMedallionNftId(cursorId)
        const balance = await dreamEther.balanceOf(qa, nftId)
        expect(balance).to.equal(1)

        const from = qa.target
        const to = trader.address
        const amount = balance // TODO check transfer multiples or zero
        const operator = openSea.address
        const tx = dreamEther
          .connect(openSea)
          .safeTransferFrom(from, to, nftId, amount, '0x')
        await expect(tx)
          .to.emit(dreamEther, 'TransferSingle')
          .withArgs(operator, from, to, nftId, amount)
        const postBalance = await dreamEther.balanceOf(qa, nftId)
        expect(postBalance).to.equal(0)
      },
      DISPUTE_RESOLVE: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('DISPUTE_RESOLVE', type, cursorId)
        const reason = hash('disputing resolve ' + cursorId)
        const disputeId = context.changes.length + 1
        const tx = dreamEther
          .connect(disputer1)
          .disputeResolve(cursorId, reason)
        await expect(tx)
          .to.emit(dreamEther, 'ChangeDisputed')
          .withArgs(cursorId, disputeId)
        // TODO twice with the same content should fail.
      },
      DISPUTE_UPHELD: async () => {
        const { context } = lastState
        const cursorId = getCursor(context)
        const { type } = getChange(context)
        debug('DISPUTE_UPHELD', type, cursorId)
        const shares = [
          [disputer1.address, DISPUTER1_SHARES],
          [disputer2.address, DISPUTER2_SHARES],
        ]
        const reason = hash('upheld ' + cursorId)
        await expect(qa.disputeUpheld(cursorId, shares, reason))
          .to.emit(dreamEther, 'DisputesUpheld')
          .withArgs(cursorId)
      },
      // WAVE_FRONT
      SUPER_SHARES_UPHELD: async ({ state: { context } }) => {
        const { cursorId } = context
        const shares = [
          [disputer1.address, DISPUTER1_SHARES],
          [disputer2.address, DISPUTER2_SHARES],
        ]
        const reason = hash('shares upheld ' + cursorId)
        await expect(qa.disputeUpheld(cursorId, shares, reason))
          .to.emit(dreamEther, 'DisputesUpheld')
          .withArgs(cursorId)
        const dispute = context.transitions.get(cursorId)
        await tests.ownerHasAllContentShares(dispute.uplink)
        // TODO verify the shares are correct
      },
      SUPER_DISMISSED: async ({ state: { context } }) => {
        const { cursorId } = context
        const dispute = context.transitions.get(cursorId)
        await tests.superDismissInvalidHash(dispute.uplink)
        await tests.superDismissEarly(dispute.uplink)
        const reason = hash('dismissed ' + dispute.uplink)
        await tests.nonQaDismiss(dispute.uplink)
        await expect(qa.disputesDismissed(dispute.uplink, reason))
          .to.emit(dreamEther, 'DisputesDismissed')
          .withArgs(dispute.uplink)
        await tests.superDismissAgain(dispute.uplink)
        await tests.superUpholdAfterDismiss(cursorId)
        // TODO test trying to apply as not QA should reject
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

      QA_REJECT: async ({ state: { context } }) => {
        const { cursorId } = context
        const { type } = context.transitions.get(cursorId)
        debug('qa reject', type, cursorId)
        await tests.superDismissBeforeQa(cursorId)
        await tests.qaRejectPre(cursorId)

        const reason = hash('rejected ' + cursorId)
        await expect(qa.failQA(cursorId, reason))
          .to.emit(dreamEther, 'QARejected')
          .withArgs(cursorId)
        await tests.qaRejectPost(cursorId)
      },
      QA_CLAIM: async ({ state: { context } }) => {
        const { cursorId } = context

        await tests.qaInvalidClaim(cursorId)

        await expect(qa.claimQa(cursorId))
          .to.emit(dreamEther, 'QAClaimed')
          .withArgs(cursorId)
        await tests.qaReClaim(cursorId)
      },

      CLAIM: async ({ state: { context } }) => {
        const { cursorId } = context
        const packet = context.transitions.get(cursorId)
        expect(packet.type).to.equal(types.PACKET)
        debug('claiming', cursorId)
        const contentId = await dreamEther.contentNftId(cursorId)
        const solver1Balance = await dreamEther.balanceOf(
          solver1.address,
          contentId
        )
        expect(solver1Balance).to.equal(SOLVER1_SHARES)
        const solver2Balance = await dreamEther.balanceOf(
          solver2.address,
          contentId
        )
        expect(solver2Balance).to.equal(SOLVER2_SHARES)
        const ownerBalance = await dreamEther.balanceOf(
          owner.address,
          contentId
        )
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
        const { cursorId } = context
        await expect(dreamEther.defund(cursorId))
          .to.emit(dreamEther, 'Defunded')
          .withArgs(cursorId, owner.address)
        await tests.defundDoubleExit(cursorId)
      },

      DISPUTE_SHARES: async ({ state: { context } }) => {
        const { cursorId } = context
        const reason = hash('disputing shares ' + cursorId)
        // check the shares are actually different
        const disputeId = context.transitionsCount
        const shares = [[owner.address, TOTAL_SHARES]]
        await expect(dreamEther.disputeShares(cursorId, reason, shares))
          .to.emit(dreamEther, 'ChangeDisputed')
          .withArgs(context.cursorId, disputeId)
        // TODO twice with the same content should fail.
      },
      DISPUTE_REJECT: async ({ state: { context } }) => {
        const { cursorId } = context
        const reason = hash('disputing rejection ' + cursorId)
        const disputeId = context.transitionsCount
        await expect(dreamEther.disputeReject(cursorId, reason))
          .to.emit(dreamEther, 'ChangeDisputed')
          .withArgs(cursorId, disputeId)
        // TODO twice with the same content should fail.
      },
    },
  }
  sinon.spy(sut.tests)
  sinon.spy(sut.states)
  sinon.spy(sut.events)
  return sut
}

const tradeFunds = async (fixture, cursorId, operator, isAll) => {
  const { dreamEther, funder1, trader } = fixture
  const allFundingNftIds = await dreamEther.fundingNftIds(cursorId)
  expect(allFundingNftIds.length).to.be.greaterThan(0)

  // TODO add balance checks pre and post trade

  expect(await dreamEther.isNftHeld(cursorId, funder1.address)).to.be.true
  const result = await dreamEther.fundingNftIdsFor(funder1, cursorId)
  const nftIds = result.toArray()
  expect(nftIds.length).to.be.greaterThan(0)
  const addresses = nftIds.map(() => funder1)
  const balances = await dreamEther.balanceOfBatch(addresses, nftIds)
  const amounts = balances.toArray()
  const from = funder1.address
  const to = trader.address
  if (isAll) {
    const id = nftIds[0]
    const amount = 7
    const tx = dreamEther
      .connect(operator.address)
      .safeTransferFrom(from, to, id, amount, '0x')
    await expect(tx)
      .to.emit(dreamEther, 'TransferSingle')
      .withArgs(operator, from, to, id, amount)
  } else {
    const tx = dreamEther
      .connect(operator)
      .safeBatchTransferFrom(from, to, nftIds, amounts, '0x')
    await expect(tx)
      .to.emit(dreamEther, 'TransferBatch')
      .withArgs(operator, from, to, nftIds, amounts)
  }
}
