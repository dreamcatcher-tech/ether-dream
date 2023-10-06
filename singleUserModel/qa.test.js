import { initializeSut } from './sut.js'
import { expect } from 'chai'
import { filters } from './machine.js'
import { and } from './conditions.js'
import test from './testFactory.js'
import { hash } from './utils.js'

describe('qa', () => {
  it('retrieves the uri of the qa pool', async () => {
    const { fixture } = await initializeSut()
    const unusedId = 7
    const uri = await fixture.qa.getUri(unusedId)
    expect(uri).to.equal('https://dreamcatcher.land')
  })
  it('retrieves the name of the qa pool', async () => {
    const { fixture } = await initializeSut()
    const uri = await fixture.qa.name()
    expect(uri).to.equal('Dreamcatcher Command')
  })
  it('reverts if qa is not a contract', async () => {
    const {
      fixture: { dreamEther, owner },
    } = await initializeSut()

    const header = hash('non contract qa')
    await expect(
      dreamEther.proposePacket(header, owner.address)
    ).to.be.revertedWith('QA must be a contract')
  })
  describe('qa reject header funding', () => {
    test({
      toState: (state) => state.matches('open'),
      filter: and(
        filters.skipTrading,
        filters.skipDefunding,
        filters.skipFunding
      ),
      verify: async (sut) => {
        const { dai, dreamEther, qa } = sut.fixture
        const header = hash('header rejection')
        await expect(dreamEther.proposePacket(header, qa.target)).to.emit(
          dreamEther,
          'ProposedPacket'
        )

        await qa.setRejectOnChange()

        await expect(
          dreamEther.proposePacket(header, qa.target)
        ).to.be.revertedWith('QA: onChange rejected')

        const payments = [{ token: dai.target, tokenId: 0, amount: 13 }]
        await expect(dreamEther.fund(1, payments)).to.emit(
          dreamEther,
          'FundedTransition'
        )

        await qa.setRejectOnFund()

        await expect(dreamEther.fund(1, payments)).to.be.revertedWith(
          'QA: onFund rejected'
        )
      },
    })
  })
  it('can stop an edit')
  it('can stop a dispute')
  it('can stop a solve')
  it('can claim when it is a funder in one nft and qa in another')
  it('only allows a single bigdog')
})
