import { hash } from '../utils.js'
import { initializeSut } from './sut.js'
import { expect } from 'chai'

describe('misc', () => {
  it('solving an already solved packet with something better')
  it('modifying the packet header')
  it('packet solving another packet')
  it('check balances of all token types')
  it('fundingNftIdsFor reverts on invalid params', async () => {
    const { fixture } = await initializeSut()
    const { dreamEther, owner, qa } = fixture
    const firstId = 1
    await expect(
      dreamEther.fundingNftIdsFor(ethers.ZeroAddress, firstId)
    ).to.be.revertedWith('Invalid holder')
    await expect(
      dreamEther.fundingNftIdsFor(owner.address, firstId)
    ).to.be.revertedWith('Change does not exist')

    const header = hash('header')
    await dreamEther.proposePacket(header, qa.target)
    const nftIds = await dreamEther.fundingNftIdsFor(owner.address, firstId)
    expect(nftIds).to.deep.equal([])
  })
  it('fundingNftIds reverts on invalid id', async () => {
    const { fixture } = await initializeSut()
    const fakeId = 1
    await expect(fixture.dreamEther.fundingNftIds(fakeId)).to.be.revertedWith(
      'Change does not exist'
    )
  })
  it('contentNftId reverts on invalid id', async () => {
    const { fixture } = await initializeSut()
    const fakeId = 1
    await expect(fixture.dreamEther.contentNftId(fakeId)).to.be.revertedWith(
      'Change does not exist'
    )
  })
  it('getAssetId reverts on invalid id', async () => {
    const { fixture } = await initializeSut()
    const fakeId = 1
    await expect(
      fixture.dreamEther.getAssetId(ethers.ZeroAddress, fakeId)
    ).to.be.revertedWith('Asset does not exist')
  })
  it('isNftHeld reverts on invalid holder', async () => {
    const { fixture } = await initializeSut()
    const fakeId = 1
    await expect(
      fixture.dreamEther.isNftHeld(fakeId, ethers.ZeroAddress)
    ).to.be.revertedWith('Invalid holder')
    await expect(
      fixture.dreamEther.isNftHeld(fakeId, fixture.owner.address)
    ).to.be.revertedWith('Change does not exist')
  })
})
