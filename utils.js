import { CID } from 'multiformats/cid'
import * as json from 'multiformats/codecs/json'
import { sha256 } from 'multiformats/hashes/sha2'

export const fakeIpfsGenerator = () => {
  let count = 0
  return () => {
    const value = { count }
    count++
    const bytes = json.encode(value)
    const hash = sha256.digest(bytes)
    const cid = CID.createV1(json.code, hash)
    return cid.toString()
  }
}
