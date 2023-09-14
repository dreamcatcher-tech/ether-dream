import { sha256 } from 'multiformats/hashes/sha2'
import * as dagPB from '@ipld/dag-pb'

export const hash = (value) => {
  const bytes = dagPB.encode({
    Data: new TextEncoder().encode(value),
    Links: [],
  })
  const hash = sha256.digest(bytes)
  return ethers.hexlify(hash.digest)
}

export const description = (path, index) => {
  let state = path.state.value
  if (typeof state !== 'string') {
    const strings = path.state.toStrings()
    if (path.state.matches('actors')) {
      state = longest(strings, 'actors.')
      state = state.replace('actors.', '')
    }
    if (path.state.matches('stack.actions')) {
      state = longest(strings, 'stack.actions.')
      state = state.replace('stack.actions.', '')
    }
  }
  const allEvents = path.steps.map((step) => step.event.type)
  const deduped = []
  const counts = []
  for (let i = 0; i < allEvents.length; i++) {
    const event = allEvents[i]
    if (event === 'xstate.init') {
      continue
    }
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
  const prefix = index !== undefined ? `[${index}] ` : ''
  return prefix + `Reaches: '${state}' via: ${condensed.join(' > ')}`
}

const longest = (strings, prefix) => {
  let longest = ''
  for (const string of strings) {
    if (string.startsWith(prefix) && string.length > longest.length) {
      longest = string
    }
  }
  return longest
}
