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

export const description = (path, index, expand = false) => {
  let stateString = path.state.value
  if (typeof stateString !== 'string') {
    if (path.state.matches('actors')) {
      stateString = longest(path.state, 'actors.')
      stateString = stateString.replace('actors.', '')
    }
    if (path.state.matches('stack')) {
      stateString = longest(path.state, 'stack.')
      stateString = stateString.replace('stack.', '')
    }
    if (stateString.startsWith('trading')) {
      stateString = 'trading'
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
  const translated = []
  if (expand) {
    translated.push(...condensed)
  } else {
    const memory = []
    for (const event of condensed) {
      memory.push(event)
      const translation = match(memory)
      if (translation) {
        translated.push(...memory, `*${translation}`)
        memory.length = 0
      }
    }
    translated.push(...memory)
  }

  const prefix = index !== undefined ? `[${index}] ` : ''
  return prefix + `Reaches: '${stateString}' via: ${translated.join(' > ')}`
}
const match = (memory) => {
  for (let i = 0; i < memory.length; i++) {
    const key = memory.slice(i).join(' > ')
    if (maps[key]) {
      memory.length = i
      return maps[key]
    }
  }
}

const maps = {
  // TODO use the same condensations as the multi/paths file uses
  'PROPOSE_PACKET > BE_QA > DO > QA_RESOLVE > BE_DISPUTER > DO > TICK_TIME > BE_SERVICE > ENACT':
    'CREATE_PACKET',
  'BE_SOLVER > PROPOSE_SOLUTION > BE_QA > DO > QA_REJECT': 'REJECT_SOLUTION',
  'BE_SOLVER > PROPOSE_SOLUTION > BE_QA > DO > QA_RESOLVE': 'RESOLVE_SOLUTION',
  'BE_DISPUTER > DO > TICK_TIME > BE_SERVICE > ENACT': 'ENACT',
  'BE_SERVICE > ENACT': 'ENACT',
  'BE_TRADER > DO_TRADER > TRADE_SOME_FUNDS': 'TRADE_SOME_FUNDS',
  'BE_TRADER > DO_TRADER > TRADE_SOME_CONTENT': 'TRADE_SOME_CONTENT',
  'BE_FUNDER > DO_FUNDER > FUND_ETH': 'FUND_ETH',
  'BE_QA > DO_QA > QA_RESOLVE': 'RESOLVE',
  'BE_QA > DO_QA > QA_REJECT': 'REJECT',
  'BE_DISPUTER > DO_DISPUTER > TICK_TIME': 'TICK',
  'BE_TRADER > DO_TRADER > TRADE_ALL_FUNDS': 'TRADE_ALL_FUNDS',
  'BE_TRADER > DO_TRADER > TRADE_ALL_CONTENT': 'TRADE_ALL_CONTENT',
}

export const longest = (state, prefix) => {
  const strings = state.toStrings()
  let longest = ''
  for (const string of strings) {
    if (string.length > longest.length) {
      if (prefix && !string.startsWith(prefix)) {
        continue
      }
      longest = string
    }
  }
  return longest
}
