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
    return ethers.hexlify(hash.digest)
  }
}

export const hash = (value) => {
  const bytes = json.encode(value)
  const hash = sha256.digest(bytes)
  return ethers.hexlify(hash.digest)
}

export const description = (path) => {
  let state = path.state.value
  if (typeof state !== 'string') {
    state = path.state.toStrings().pop()
  }
  const allEvents = path.steps.map((step) => step.event.type)
  const deduped = []
  const counts = []
  for (let i = 0; i < allEvents.length; i++) {
    const event = allEvents[i]
    if (deduped.length === 0 || deduped[deduped.length - 1] !== event) {
      deduped.push(event)
      counts.push(1)
    } else {
      counts[counts.length - 1]++
    }
  }
  const condensed = deduped.map((event, i) => {
    const count = counts[i]
    return count > 1 ? `${event} (x${count})` : event
  })
  return `Reaches: '${state}' via: ${condensed.join(' -> ')}`
}
