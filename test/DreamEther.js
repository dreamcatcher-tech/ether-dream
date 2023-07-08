const {
  time,
  loadFixture,
} = require('@nomicfoundation/hardhat-toolbox/network-helpers')
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs')
const { expect } = require('chai')

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

  describe('Walkthru Happy Path', () => {
    let fixture
    this.beforeAll(async () => {
      fixture = await loadFixture(deploy)
    })

    it('Deploys', async () => {
      const { dreamEther } = fixture
      expect(dreamEther.target).to.not.equal(0)
    })
    it('Proposes a packet', async () => {
      const { dreamEther, qa } = fixture
      const tx = dreamEther.proposePacket(5, qa.target)
      await expect(tx)
        .to.emit(dreamEther, 'ProposedPacket')
        .withArgs(5, qa.target)
    })
    it('Funds a proposed packet', async () => {
      const { dreamEther, qa, owner, ethers } = fixture
      const fund = dreamEther.fund(5, [], { value: 5 })
      await expect(fund)
        .to.emit(dreamEther, 'FundedTransition')
        .changeEtherBalance(dreamEther, 5)
    })
    it('Passes QA for the header', async () => {
      const { dreamEther, qa, owner, ethers } = fixture
      const pass = qa.passQA(5, dreamEther.target)
      await expect(pass).to.emit(dreamEther, 'QAResolved').withArgs(5)
    })
    it('Finalizes a header after appeal timeout', async () => {
      const { dreamEther, qa, owner, ethers } = fixture
      await time.increase(3600 * 24 * 3)
      const packet = dreamEther.finalizeTransition(5)
      await expect(packet).to.emit(dreamEther, 'PacketCreated').withArgs(1)
      fixture.packetId = 1
    })
    it('Funds a packet with ETH', async () => {
      const { dreamEther, qa, owner, ethers, packetId } = fixture
      const payments = []
      const fund = dreamEther.fund(packetId, payments, { value: 5 })
      await expect(fund)
        .to.emit(dreamEther, 'FundedTransition')
        .changeEtherBalance(dreamEther, 5)
    })
    it('Proposes a solution', async () => {
      fixture.solutionId = 13
      const { dreamEther, qa, owner, packetId, solutionId } = fixture
      const solution = dreamEther.proposeSolution(packetId, solutionId)
      await expect(solution).to.emit(dreamEther, 'SolutionProposed')
    })
    it('Funds a solution', async () => {
      const { dreamEther, qa, owner, ethers, packetId, solutionId } = fixture
      const payments = []
      const fund = dreamEther.fund(solutionId, payments, { value: 500 })
      await expect(fund)
        .to.emit(dreamEther, 'FundedTransition')
        .changeEtherBalance(dreamEther, 500)
    })
    it('Passes QA for the solution', async () => {
      const { dreamEther, qa, owner, ethers, packetId, solutionId } = fixture
      const pass = qa.passQA(solutionId, dreamEther.target)
      await expect(pass).to.emit(dreamEther, 'QAResolved').withArgs(solutionId)
    })
    it('Finalizes a solution after appeal timeout', async () => {
      const { dreamEther, qa, owner, ethers, packetId, solutionId } = fixture
      await time.increase(3600 * 24 * 3)
      const packet = dreamEther.finalizeTransition(solutionId)
      await expect(packet)
        .to.emit(dreamEther, 'SolutionAccepted')
        .withArgs(solutionId)
      await expect(packet)
        .to.emit(dreamEther, 'PacketResolved')
        .withArgs(packetId)
    })
  })

  //       await expect(lock.withdraw()).to.changeEtherBalances(
  //         [owner, lock],
  //         [lockedAmount, -lockedAmount]
  //       );
  //     });
  //   });
  // });
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
})
