import {
  time,
  takeSnapshot,
} from '@nomicfoundation/hardhat-toolbox/network-helpers.js'
import { hash } from './utils.js'
import { expect } from 'chai'
import Debug from 'debug'
const debug = Debug('test:sut')
const SOLVER1_SHARES = 897
const SOLVER2_SHARES = 1000 - SOLVER1_SHARES
const DISPUTER1_SHARES = 787
const DISPUTER2_SHARES = 1000 - DISPUTER1_SHARES
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const DEFUND_WINDOW_MS = 7 * ONE_DAY_MS

export default function createTests(fixture) {
  const { dreamEther, solver1, qa, owner, disputer1, disputer2 } = fixture
  return {
    packetContentUntransferrable: async (context) => {
      const [tx] = await tradeContent(fixture, context)
      await expect(tx).to.be.revertedWith('Untransferrable')
    },
    noFundsToClaim: async (cursorId) => {
      await expect(
        dreamEther.connect(solver1).claim(cursorId)
      ).to.be.revertedWith('No funds to claim')
    },
    noQaFundsToClaim: async (cursorId) => {
      const msg = 'No funds to claim'
      await expect(qa.claimQa(cursorId)).to.be.revertedWith(msg)
    },
    noQaClaimPackets: async (cursorId) => {
      const msg = 'Cannot claim packets'
      await expect(qa.claimQa(cursorId)).to.be.revertedWith(msg)
    },
    qaReClaim: async (cursorId) => {
      const msg = 'Already claimed'
      await expect(qa.claimQa(cursorId)).to.be.revertedWith(msg)
    },
    qaInvalidClaim: async (cursorId) => {
      const notQa = 'Must be transition QA'
      await expect(dreamEther.claimQa(cursorId)).to.be.revertedWith(notQa)
    },
    exitSingle: async (account, debt) => {
      const [tokenAddress, tokenId] = debt
      const assetId = await dreamEther.getAssetId(tokenAddress, tokenId)
      await expect(dreamEther.connect(account).exitSingle(assetId))
        .emit(dreamEther, 'Exit')
        .withArgs(account.address)
    },
    exitBurn: async (account, debt) => {
      const [tokenAddress, tokenId] = debt
      const assetId = await dreamEther.getAssetId(tokenAddress, tokenId)
      await expect(dreamEther.connect(account).exitBurn(assetId))
        .emit(dreamEther, 'ExitBurn')
        .withArgs(account.address, assetId)
    },
    defundExitBeforeStart: async (cursorId) => {
      const msg = 'Defund not started'
      await expect(dreamEther.defund(cursorId)).to.be.revertedWith(msg)
    },
    defundStopBeforeStart: async (cursorId) => {
      const msg = 'Defund not started'
      await expect(dreamEther.defundStop(cursorId)).to.be.revertedWith(msg)
    },
    defundDoubleStart: async (cursorId) => {
      const msg = 'Already started'
      await expect(dreamEther.defundStart(cursorId)).to.be.revertedWith(msg)
    },
    defundDoubleExit: async (cursorId) => {
      const msg = 'Defund not started'
      await expect(dreamEther.defund(cursorId)).to.be.revertedWith(msg)
    },
    defundRestart: async (cursorId) => {
      await expect(dreamEther.defundStart(cursorId))
        .to.emit(dreamEther, 'DefundStarted')
        .withArgs(cursorId, owner.address)
      await expect(dreamEther.defundStop(cursorId))
        .to.emit(dreamEther, 'DefundStopped')
        .withArgs(cursorId, owner.address)
    },
    defundExitAfterQa: async (cursorId) => {
      const snapshot = await takeSnapshot()
      await time.increase(DEFUND_WINDOW_MS)
      const msg = 'Change is not open for defunding'
      await expect(dreamEther.defund(cursorId)).to.be.revertedWith(msg)
      await snapshot.restore()
    },
    defundInvalidStart: async (cursorId) => {
      const msg = 'Change is not open for defunding'
      await expect(dreamEther.defundStart(cursorId)).to.be.revertedWith(msg)
    },
    defundInvalidStop: async (cursorId) => {
      const msg = 'Change is not open for defunding'
      await expect(dreamEther.defundStop(cursorId)).to.be.revertedWith(msg)
    },
    defundEarly: async (cursorId) => {
      const msg = 'Defund timeout not reached'
      await expect(dreamEther.defund(cursorId)).to.be.revertedWith(msg)
    },
    superDismissBeforeResolve: async (changeId) => {
      const reason = hash('dismissed before resolve' + changeId)
      await expect(qa.disputesDismissed(changeId, reason)).to.be.revertedWith(
        'Dispute window not started'
      )
    },
    superDismissEarly: async (changeId) => {
      const reason = hash('dismissed early' + changeId)
      await expect(qa.disputesDismissed(changeId, reason)).to.be.revertedWith(
        'Dispute window still open'
      )
    },
    superDismissAgain: async (changeId) => {
      const reason = hash('dismissed again' + changeId)
      await expect(qa.disputesDismissed(changeId, reason)).to.be.revertedWith(
        'No active disputes'
      )
    },
    superUpholdAfterDismiss: async (changeId) => {
      const addresses = [disputer1.address, disputer2.address]
      const amounts = [DISPUTER1_SHARES, DISPUTER2_SHARES]
      const reason = hash('upheld after dismiss ' + changeId)
      await expect(
        qa.disputeUpheld(changeId, addresses, amounts, reason)
      ).to.be.revertedWith('No active disputes')
    },
    nonQaDismiss: async (changeId) => {
      const reason = hash('nonQaDismiss' + changeId)
      await expect(
        dreamEther.qaDisputesDismissed(changeId, reason)
      ).to.be.revertedWith('Must be the change QA')
    },
    superDismissInvalidHash: async (changeId) => {
      const reason = ethers.hexlify(new Uint8Array(32))
      await expect(qa.disputesDismissed(changeId, reason)).to.be.revertedWith(
        'Invalid reason hash'
      )
    },
  }
}

export const tradeContent = async (fixture, context) => {
  const { dreamEther, noone, solver1, solver2 } = fixture
  const { cursorId } = context
  const { type } = context.transitions.get(cursorId)
  debug('trading content', type, cursorId)
  // TODO add balace of checks pre and post trade

  expect(await dreamEther.isNftHeld(cursorId, solver1.address)).to.be.true
  expect(await dreamEther.isNftHeld(cursorId, solver2.address)).to.be.true
  expect(await dreamEther.isNftHeld(cursorId, noone.address)).to.be.false
  const nftId = await dreamEther.contentNftId(cursorId)
  expect(nftId).to.be.greaterThan(0)

  expect(await dreamEther.totalSupply(nftId)).to.equal(1000)

  const balanceSolver1 = await dreamEther.balanceOf(solver1, nftId)
  debug('balance solver1', nftId, balanceSolver1)
  expect(balanceSolver1).to.equal(SOLVER1_SHARES)
  const balanceSolver2 = await dreamEther.balanceOf(solver2, nftId)
  debug('balance solver2', nftId, balanceSolver2)
  expect(balanceSolver2).to.equal(SOLVER2_SHARES)

  const from = solver1.address
  const to = solver2.address
  const amount = 1

  const tx = dreamEther
    .connect(solver1)
    .safeTransferFrom(from, to, nftId, amount, '0x')
  const args = { from, to, id: nftId, amount }
  return [tx, args]
}
