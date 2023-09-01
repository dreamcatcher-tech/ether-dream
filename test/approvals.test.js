import { filters } from './machine.js'
import { is, and } from './conditions.js'
import { expect } from 'chai'
import test from './testFactory.js'

const filter = and(
  filters.allowedStates('idle', 'open', 'tradeFunds'),
  filters.skipDefunding,
  filters.skipDisputes,
  filters.dai
)
const toState = (state) =>
  state.matches('open') && is({ tradedFunds: true })(state.context)

describe('approvals', () => {
  it('can add a new operator')
  it('is its own operate by default')
  it('cannot remove self as an operator')

  describe('can by default trade on opensea', () => {
    test({
      toState,
      filter,
      verify: async (sut) => {
        expect(sut.events.TRADE_FUNDS).to.have.been.calledOnce
        const { dreamEther, openSea, funder1, funder2 } = sut.fixture
        const nftIds = await dreamEther.fundingNftIdsFor(funder1, 1)
        const [nft] = nftIds
        const balance = await dreamEther.balanceOf(funder1, nft)
        expect(balance).to.equal(1)
        expect(await dreamEther.isApprovedForAll(funder1, openSea.address)).to
          .be.true
        expect(await dreamEther.isApprovedForAll(funder1, funder1)).to.be.true
        expect(await dreamEther.isApprovedForAll(funder1, funder2)).to.be.false

        const operator = openSea.address
        const from = funder1.address
        const to = funder2.address
        const id = nft
        const amount = balance
        const data = ethers.randomBytes(0)
        await expect(
          dreamEther
            .connect(openSea)
            .safeTransferFrom(from, to, id, amount, data)
        )
          .to.emit(dreamEther, 'TransferSingle')
          .withArgs(operator, from, to, id, amount)
        await expect(
          dreamEther
            .connect(openSea)
            .safeTransferFrom(from, to, id, amount, data)
        ).to.be.revertedWith('Insufficient funds')
      },
    })
  })
  describe('can block opensea from being an operator', () => {
    test({
      toState,
      filter,
      verify: async (sut) => {
        const { dreamEther, openSea, funder1, funder2 } = sut.fixture
        await dreamEther
          .connect(funder1)
          .setApprovalForAll(openSea.address, false)
        expect(await dreamEther.isApprovedForAll(funder1, openSea.address)).to
          .be.false

        const nftIds = await dreamEther.fundingNftIdsFor(funder1, 1)
        const [nft] = nftIds
        const balance = await dreamEther.balanceOf(funder1, nft)

        const from = funder1.address
        const to = funder2.address
        const id = nft
        const amount = balance
        const data = ethers.randomBytes(0)
        await expect(
          dreamEther
            .connect(openSea)
            .safeTransferFrom(from, to, id, amount, data)
        ).to.be.revertedWith('Not approved')

        await dreamEther
          .connect(funder1)
          .setApprovalForAll(openSea.address, true)
        expect(await dreamEther.isApprovedForAll(funder1, openSea.address)).to
          .be.true

        await expect(
          dreamEther
            .connect(openSea)
            .safeTransferFrom(from, to, id, amount, data)
        ).to.emit(dreamEther, 'TransferSingle')
      },
    })
  })
})
