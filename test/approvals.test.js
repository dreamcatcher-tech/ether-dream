import { expect } from 'chai'
import { initializeSut } from './sut.js'
import {
  and,
  isCount,
  withActors,
  skipAccountMgmt,
  max,
  skipDefunding,
  withEth,
} from './multi/filters.js'
import test from './testFactory.js'

describe('approvals', () => {
  it('can add a new operator')
  it('is its own operate by default')
  it('cannot remove self as an operator')

  test('can by default trade on opensea', {
    toState: isCount(1, { type: 'HEADER', tradedFundsSome: true }),
    filter: and(
      withActors('proposer', 'funder', 'openSea'),
      skipAccountMgmt(),
      max(1),
      skipDefunding(),
      withEth()
    ),
    verify: async (sut) => {
      expect(sut.events.TRADE_SOME_FUNDS).to.have.been.calledOnce
      const { dreamEther, openSea, funder1, funder2 } = sut.fixture
      const nftIds = await dreamEther.fundingNftIdsFor(funder1, 1)
      const [nft] = nftIds
      const balance = await dreamEther.balanceOf(funder1, nft)
      expect(balance).to.equal(1)
      expect(await dreamEther.isApprovedForAll(funder1, openSea.address)).to.be
        .true
      expect(await dreamEther.isApprovedForAll(funder1, funder1)).to.be.true
      expect(await dreamEther.isApprovedForAll(funder1, funder2)).to.be.false

      const operator = openSea.address
      const from = funder1.address
      const to = funder2.address
      const id = nft
      const amount = balance
      const data = ethers.randomBytes(0)
      await expect(
        dreamEther.connect(openSea).safeTransferFrom(from, to, id, amount, data)
      )
        .to.emit(dreamEther, 'TransferSingle')
        .withArgs(operator, from, to, id, amount)
      await expect(
        dreamEther.connect(openSea).safeTransferFrom(from, to, id, amount, data)
      ).to.be.revertedWith('Insufficient funds')
    },
  })
  // test('can block opensea from being an operator', {
  //   toState,
  //   filter,
  //   verify: async (sut) => {
  //     const { dreamEther, openSea, funder1, funder2 } = sut.fixture
  //     await dreamEther
  //       .connect(funder1)
  //       .setApprovalForAll(openSea.address, false)
  //     expect(await dreamEther.isApprovedForAll(funder1, openSea.address)).to.be
  //       .false

  //     const nftIds = await dreamEther.fundingNftIdsFor(funder1, 1)
  //     const [nft] = nftIds
  //     const balance = await dreamEther.balanceOf(funder1, nft)

  //     const from = funder1.address
  //     const to = funder2.address
  //     const id = nft
  //     const amount = balance
  //     const data = ethers.randomBytes(0)
  //     await expect(
  //       dreamEther.connect(openSea).safeTransferFrom(from, to, id, amount, data)
  //     ).to.be.revertedWith('Not approved')

  //     await dreamEther.connect(funder1).setApprovalForAll(openSea.address, true)
  //     expect(await dreamEther.isApprovedForAll(funder1, openSea.address)).to.be
  //       .true

  //     await expect(
  //       dreamEther.connect(openSea).safeTransferFrom(from, to, id, amount, data)
  //     ).to.emit(dreamEther, 'TransferSingle')
  //   },
  // })
  it('errors on invalid params', async () => {
    const sut = await initializeSut()
    const { dreamEther, owner } = sut.fixture
    await expect(
      dreamEther.setApprovalForAll(ethers.ZeroAddress, true)
    ).to.be.revertedWith('Invalid operator')
    await expect(
      dreamEther.setApprovalForAll(owner.address, true)
    ).to.be.revertedWith('Setting approval status for self')
  })
})
