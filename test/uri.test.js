import { expect } from 'chai'
import { initializeSut, DISPUTE_WINDOW_SECS } from './sut.js'
import {
  and,
  isCount,
  skipActors,
  skipAccountMgmt,
  skipNavigation,
  skipRejection,
  max,
  skipDefunding,
  skipEvents,
} from './multi/filters.js'
import { hash } from './utils.js'
import { CID } from 'multiformats/cid'
import { equals } from 'uint8arrays/equals'
import test from './testFactory.js'
import Debug from 'debug'

const debug = Debug('test')

describe('uri', () => {
  it('returns edit urls')
  test.only('all packet types', {
    first: true,
    dbg: true,
    toState: and(
      isCount(1, { type: 'HEADER', fundedEth: true, disputed: false }),
      isCount(1, { type: 'PACKET', fundedEth: true, enacted: true }),
      isCount(1, {
        type: 'DISPUTE',
        disputeType: 'resolve',
        disputeUpheld: true,
        fundedEth: true,
      }),
      isCount(1, { type: 'SOLUTION', fundedEth: false })
    ),
    filter: and(
      skipActors('proposer', 'trader', 'editor'),
      skipAccountMgmt(),
      max(1, { type: 'HEADER' }),
      max(0, { type: 'HEADER', disputed: true }),
      max(1, { type: 'SOLUTION' }),
      max(1, { type: 'DISPUTE' }),
      max(4),
      skipRejection(),
      skipNavigation(),
      skipDefunding(),
      skipEvents(
        'FUND_DAI',
        'FUND_1155',
        'FUND_721',
        'ALL_DISPUTES_DISMISSED',
        'DISPUTE_SHARES',
        'DISPUTE_UPHELD_SHARES'
      )
    ),
    verify: async (sut) => {
      const { dreamEther } = sut.fixture
      const changeCount = await dreamEther.changeCount()
      await expect(dreamEther.contentNftId(0)).to.be.reverted
      const hits = {
        PACKET: false,
        DISPUTE: false,
        META: false,
        QA_MEDALLION: false,
        PACKET_FUNDING: false,
        DISPUTE_FUNDING: false,
        META_FUNDING: false,
      }
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
          })
          .catch(() => {})
        for (const nft of nfts) {
          const uri = await dreamEther.uri(nft)
          debug('change %i uri %i %s', i, nft, uri)
          expect(uri.startsWith('ipfs://')).to.be.true
          const last = uri.lastIndexOf('/')
          const string = uri.substring(last + 1)
          hits[string] = true
        }
      }
      for (const key in hits) {
        expect(hits[key], key).to.be.true
      }
    },
  })

  it('returns a uri', async () => {
    const sut = await initializeSut()
    const { dreamEther, qa } = sut.fixture
    const header = hash('test data')
    const digest = Uint8Array.from(
      globalThis.Buffer.from(header.substring(2), 'hex')
    )
    debug('header', header)
    const firstNftId = 1
    await expect(dreamEther.proposePacket(header, qa.target))
      .to.emit(dreamEther, 'ProposedPacket')
      .withArgs(firstNftId, DISPUTE_WINDOW_SECS)
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
