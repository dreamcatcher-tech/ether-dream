import { expect } from 'chai'
import { initializeSut } from './sut.js'
import { hash } from './utils.js'
import { CID } from 'multiformats/cid'
import { equals } from 'uint8arrays/equals'
import Debug from 'debug'

const debug = Debug('tests')

describe('uri', () => {
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
  })
})
