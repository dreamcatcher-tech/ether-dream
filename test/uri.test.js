import { expect } from 'chai'
import { initializeSut } from './sut.js'
import { filters } from './machine.js'
import { and } from './conditions.js'
import { hash } from './utils.js'
import { CID } from 'multiformats/cid'
import { equals } from 'uint8arrays/equals'
import test from './testFactory.js'
import Debug from 'debug'

const debug = Debug('tests')

describe('uri', () => {
  it('returns edit urls')
  describe('all packet types', () => {
    test({
      toState: (state) => state.matches('solved'),
      filter: and(
        filters.dai,
        filters.skipDefunding,
        filters.skipTrading,
        filters.skipClaims,
        filters.skipExit,
        filters.skipRejections,
        filters.skipUnfunded,
        filters.skipDisputeShares,
        filters.skipUndisputed
      ),
      verify: async (sut) => {
        const { dreamEther } = sut.fixture
        const changeCount = await dreamEther.changeCount()
        await expect(dreamEther.contentNftId(0)).to.be.reverted
        let packetFound = false
        for (let i = 1; i <= changeCount; i++) {
          const nfts = []
          const contentNftId = await dreamEther.contentNftId(i)
          nfts.push(contentNftId)
          const fundingNfts = await dreamEther.fundingNftIds(i)
          nfts.push(...fundingNfts)
          await dreamEther
            .qaMedallionNftId(i)
            .then((id) => {
              nfts.push(id)
              packetFound = true
            })
            .catch(() => {})
          for (const nft of nfts) {
            const uri = await dreamEther.uri(nft)
            debug('change %i uri %i %s', i, nft, uri)
            expect(uri.startsWith('ipfs://')).to.be.true
            const last = uri.lastIndexOf('/')
            const string = uri.substring(last)
            expect(string.length).to.be.greaterThanOrEqual(4)
          }
        }
        expect(packetFound).to.be.true
      },
    })
  })

  it('returns a uri', async () => {
    const sut = await initializeSut()
    const { dreamEther, qa } = sut.fixture
    const header = hash('test data')
    const digest = Uint8Array.from(
      globalThis.Buffer.from(header.substring(2), 'hex')
    )
    debug('header', header)
    await expect(dreamEther.proposePacket(header, qa.target))
      .to.emit(dreamEther, 'ProposedPacket')
      .withArgs(1)
    const uri = await dreamEther.uri(1)
    debug('uri', uri)
    expect(uri.startsWith('ipfs://')).to.be.true
    expect(uri.endsWith('/META')).to.be.true
    const string = uri.substring('ipfs://'.length, uri.length - '/META'.length)
    const cid = CID.parse(string)
    debug('cid', cid)

    expect(equals(digest, cid.multihash.digest)).to.be.true

    const notAnNft = 999
    await expect(dreamEther.uri(notAnNft)).to.be.revertedWith(
      'NFT does not exist'
    )
  })

  it('returns a version', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    const version = await dreamEther.version()
    expect(version).to.equal('0.0.1')
  })
  it('returns an issues url', async () => {
    const sut = await initializeSut()
    const { dreamEther } = sut.fixture
    const issues = await dreamEther.issues()
    expect(issues).to.equal(
      'https://github.com/dreamcatcher-tech/ether-dream/issues'
    )
  })
})
