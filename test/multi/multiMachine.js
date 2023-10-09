import { assign, createMachine } from 'xstate'

// use https://stately.ai/viz to visualize the machine

const MAX_TIME_TICKS = 5
const DISPUTE_WINDOW_TICKS = 1
const DEFUND_WINDOW_TICKS = 2

export const types = ['HEADER', 'PACKET', 'SOLUTION', 'DISPUTE', 'EDIT']
export const ACCOUNT_MANAGEMENT_EVENTS = [
  'EXIT',
  'CLAIM',
  'REVOKE_OPERATOR',
  'APPROVE_OPENSEA',
  'APPROVE_OPERATOR',
  'REVOKE_OPENSEA',
]
export const getChange = ({ changes, selectedChange }) => {
  if (!Array.isArray(changes) || changes.length === 0) {
    return {}
  }
  return changes[selectedChange]
}
const make = (params) => {
  if (!params) {
    return base
  }
  for (const key of Object.keys(params)) {
    if (!(key in base)) {
      throw new Error(`key ${key} is not in base key set`)
    }
  }
  const result = { ...base, ...params }
  if (result.type && !types.includes(result.type)) {
    throw new Error(`type ${result.type} is not in type set`)
  }
  return result
}

const setDirect = (change, params) => {
  const base = make()
  const next = { ...change, ...params }
  for (const key of Object.keys(next)) {
    if (!(key in base)) {
      throw new Error(`key ${key} is not in base key set`)
    }
    if (key === 'type' && !types.includes(next[key])) {
      throw new Error(`type ${next[key]} is not in type set`)
    }
  }
  return next
}

export const set = (params) =>
  assign({
    changes: ({ context }) => {
      const change = getChange(context)
      const next = setDirect(change, params)
      const changes = [...context.changes]
      changes[context.selectedChange] = next
      return changes
    },
  })
export const not =
  (params) =>
  ({ context }) =>
    !isDirect(context, params)
export const is =
  (params) =>
  ({ context }) =>
    isDirect(context, params)
export const isDirect = (context, params) => {
  const change = getChange(context)
  return isChange(change, params)
}
export const isChange = (change, params) => {
  const base = make()
  for (const key in params) {
    if (!(key in base)) {
      throw new Error(`key ${key} is not in base key set`)
    }
    if (change[key] !== params[key]) {
      return false
    }
  }
  return true
}
export const nand =
  (...functions) =>
  (...args) =>
    functions.some((fn) => !fn(...args))

export const snapshotEquals = (context, snapKey) => {
  if (snapKey !== 'next' && snapKey !== 'prev') {
    throw new Error(`key ${snapKey} is not a snapshot`)
  }
  const snapshot = context[snapKey]
  if (!snapshot) {
    return false
  }
  for (const key in snapshot) {
    if (snapshot[key] !== context[key]) {
      return false
    }
  }
  return true
}

export const snapshot = ({ context }) => {
  const snapshot = { ...context }
  delete snapshot.next
  delete snapshot.prev
  delete snapshot.selectedChange
  delete snapshot.actorSnapshot
  return snapshot
}
const checkIsSolved = (packet, changes) => {
  check(packet, { type: 'PACKET' })
  let firstSolution
  for (const solutionIndex of packet.downlinks) {
    const solution = changes[solutionIndex]
    check(solution, { type: 'SOLUTION' })
    if (isChange(solution, { enacted: true })) {
      firstSolution = solution
      break
    }
  }
  check(firstSolution, { enacted: true })
}
const check = (change, params) => {
  if (!isChange(change, params)) {
    const string = JSON.stringify(change, null, 2)
    throw new Error(`change is not ${JSON.stringify(params)}\n${string}`)
  }
}
const isNotLast = (context) =>
  context.selectedChange < context.changes.length - 1
const isNotFirst = (context) => context.selectedChange > 0
const disputeDismiss = ({ context }) => {
  const change = getChange(context)
  check(change, {
    type: 'DISPUTE',
    disputeUpheld: false,
    disputeDismissed: false,
  })
  const changes = [...context.changes]
  const target = changes[change.uplink]
  if (!target.downlinks.includes(context.selectedChange)) {
    throw new Error('dispute not found in target downlinks')
  }
  const disputes = target.downlinks
  for (const disputeIndex of disputes) {
    const dispute = changes[disputeIndex]
    check(dispute, {
      type: 'DISPUTE',
      disputeUpheld: false,
      disputeDismissed: false,
    })
    changes[disputeIndex] = setDirect(dispute, {
      disputeDismissed: true,
    })
  }
  changes[change.uplink] = setDirect(target, { disputeSettled: true })
  return changes
}
const addDispute =
  (disputeType) =>
  ({ context }) => {
    const { changes, selectedChange } = context
    const change = getChange({ changes, selectedChange })
    if (guards.isPacket({ context }) || guards.isDispute({ context })) {
      throw new Error('cannot dispute a packet or dispute')
    }
    const next = [
      ...changes,
      make({
        type: 'DISPUTE',
        uplink: selectedChange,
        disputeType,
      }),
    ]
    const downlinks = [...change.downlinks, next.length - 1]
    next[selectedChange] = setDirect(change, { disputed: true, downlinks })
    return next
  }
const guards = {
  isChange: ({ context: { changes } }) => changes.length > 0,
  isNextable: ({ context }) =>
    isNotLast(context) && !snapshotEquals(context, 'prev'),
  isPrevable: ({ context }) =>
    isNotFirst(context) && !snapshotEquals(context, 'next'),
  isPacket: is({ type: 'PACKET' }),
  isHeader: is({ type: 'HEADER' }),
  isHeaderOrSolution: ({ context }) =>
    guards.isHeader({ context }) || guards.isSolution({ context }),
  isSolution: is({ type: 'SOLUTION' }),
  isDispute: is({ type: 'DISPUTE' }),
  isEdit: is({ type: 'EDIT' }),
  isDisputed: is({ disputed: true }),

  isEnacted: is({ enacted: true }),
  isEnactable: ({ context }) => {
    // if no disputes outstanding, enough time has passed, then is enactable
    const change = getChange(context)
    if (isChange(change, { enacted: true })) {
      return false
    }
    if (isChange(change, { qaResolved: false, qaRejected: false })) {
      return false
    }
    if (isChange(change, { disputed: true })) {
      if (isChange(change, { disputeSettled: false })) {
        return false
      }
    }
    return guards.isDisputeWindowPassed({ context })
  },
  isNotOpen: not({ qaResolved: false, qaRejected: false }),
  isPacketNotOpen: ({ context }) => {
    // pending if packet not enacted but a solution has passed qa
    // even if that solution may yet be disputed
    const packet = getChange(context)
    if (!isChange(packet, { type: 'PACKET' })) {
      return false
    }
    if (isChange(packet, { enacted: true })) {
      return true
    }
    for (const solutionIndex of packet.downlinks) {
      const solution = context.changes[solutionIndex]
      check(solution, { type: 'SOLUTION' })
      if (isChange(solution, { qaResolved: true })) {
        return true
      }
    }
    return false
  },
  isPacketOrDispute: (opts) => guards.isPacket(opts) || guards.isDispute(opts),
  isDisputable: ({ context }) => {
    const change = getChange(context)
    if (guards.isPacketOrDispute({ context })) {
      return false
    }
    if (isChange(change, { qaResolved: false, qaRejected: false })) {
      return false
    }
    if (guards.isDisputeWindowPassed({ context })) {
      return false
    }
    return true
  },
  isDisputeWindowPassed: ({ context }) => {
    let change = getChange(context)
    if (isChange(change, { type: 'DISPUTE' })) {
      change = context.changes[change.uplink]
    }
    if (!Number.isInteger(change.qaTickStart)) {
      throw new Error('qaTickStart is not an integer')
    }
    if (change.qaTickStart + DISPUTE_WINDOW_TICKS <= context.time) {
      return true
    }
    return false
  },
  isTargetPacketOpen: ({ context }) => {
    const solution = getChange(context)
    check(solution, { type: 'SOLUTION' })
    const packet = context.changes[solution.uplink]
    check(packet, { type: 'PACKET' })
    if (isChange(packet, { enacted: true })) {
      return false
    }
    for (const solutionIndex of packet.downlinks) {
      const change = context.changes[solutionIndex]
      check(change, { type: 'SOLUTION' })
      if (isChange(change, { qaResolved: true, enacted: false })) {
        return false
      }
    }
    return true
  },
  isMultiSolution: ({ context }) => {
    const solution = getChange(context)
    check(solution, { type: 'SOLUTION' })
    const packet = context.changes[solution.uplink]
    check(packet, { type: 'PACKET' })
    let count = 0
    for (const solutionIndex of packet.downlinks) {
      const change = context.changes[solutionIndex]
      check(change, { type: 'SOLUTION' })
      if (isChange(change, { qaResolved: true, enacted: true })) {
        count++
      }
    }
    return count > 1
  },
  isResolved: is({ qaResolved: true }),

  isRejected: is({ qaRejected: true }),

  isLastSolution: ({ context }) => {
    const solution = getChange(context)
    check(solution, { type: 'SOLUTION', enacted: true })
    const packet = context.changes[solution.uplink]
    check(packet, { type: 'PACKET' })
    for (const solutionIndex of packet.downlinks) {
      const change = context.changes[solutionIndex]
      if (change === solution) {
        continue
      }
      check(change, { type: 'SOLUTION' })
      // if the solution is not enacted, then it is possible
      if (isChange(change, { enacted: false })) {
        return false
      }
    }
    return true
  },
  // BUT what about stopping a dispute loop ?
  // TODO needs to handle a settled dispute too
  isUnDisputed: ({ context }) => {
    const change = getChange(context)
    if (isChange(change, { disputed: true })) {
      return isChange(change, { disputeSettled: true })
    }
    return true
  },

  isTimeLeft: ({ context }) => context.time < MAX_TIME_TICKS,
  isDisputeWindowCloseable: (opts) =>
    guards.isTimeLeft(opts) && !guards.isDisputeWindowPassed(opts),
  isFundableEth: is({ fundedEth: false }),
  isFundableDai: is({ fundedDai: false }),
  isFundable1155: is({ funded1155: false }),
  isFundable721: is({ funded721: false }),
  isDefunding: is({ defundStarted: true, defundCompleted: false }),
  isDefundable: is({ defundStarted: false }),
  isDefundWindowPassed: ({ context }) => {
    const change = getChange(context)
    const start = change.defundTickStart
    if (!Number.isInteger(start)) {
      throw new Error('defundTickStart is not an integer')
    }
    if (start + DEFUND_WINDOW_TICKS <= context.time) {
      return true
    }
    return false
  },
  isDefundWaiting: (opts) =>
    guards.isTimeLeft(opts) && !guards.isDefundWindowPassed(opts),
  isContentTraded: is({ tradedContentAll: true }),
  isSomeContentTradable: is({ tradedContentSome: false }),
  isAllFundsTraded: is({ tradedFundsAll: true }),
  isSomeFundsTradable: is({ tradedFundsSome: false }),
  isFunded: ({ context }) => {
    const change = getChange(context)
    const isNoFunding = isChange(change, {
      fundedEth: false,
      fundedDai: false,
      funded1155: false,
      funded721: false,
    })
    const isDefunded = isChange(change, {
      defundCompleted: true,
      defundStopped: false,
    })
    return !isNoFunding && !isDefunded
  },
  isMedallionTraded: is({ tradedMedallion: true }),
  isDisputeSettleable: ({ context }) => {
    if (!guards.isDispute({ context })) {
      return false
    }
    const dispute = getChange(context)
    check(dispute, { type: 'DISPUTE' })
    const target = context.changes[dispute.uplink]
    if (isChange(target, { disputeSettled: true })) {
      // TODO how to model rounds of disputes ?
      // these should be limited by the amount of time in the system
      return false
    }
    return true
  },
  isDisputeShares: is({ disputeType: 'shares' }),
  isNotDisputeShares: (opts) => !guards.isDisputeShares(opts),
}
const base = Object.freeze({
  type: '',
  uplink: undefined,
  downlinks: Object.freeze([]),
  qaResolved: false,
  qaRejected: false,
  enacted: false,
  qaTickStart: undefined,
  fundedEth: false,
  fundedDai: false,
  funded1155: false,
  funded721: false,
  defundStarted: false,
  defundTickStart: undefined,
  defundCompleted: false,
  defundStopped: false,
  tradedFundsSome: false,
  tradedFundsAll: false,
  tradedContentSome: false,
  tradedContentAll: false,
  tradedMedallion: false,
  disputed: false,
  disputeSettled: false,
  disputeDismissed: false,
  disputeUpheld: false,
  disputeType: undefined,
  // TODO add rounds limits for super qa
})
export const options = {
  guards,
  actions: {
    // TODO change share balances

    disputeDismiss: assign({ changes: disputeDismiss }),
    disputeSharesUpheld: set({ disputeUpheld: true }),
    disputeUpheld: assign({
      changes: ({ context }) => {
        const change = getChange(context)
        const next = setDirect(change, {
          disputeUpheld: true,
          disputeDismissed: false,
        })
        const changes = [...context.changes]
        changes[context.selectedChange] = next

        const target = changes[change.uplink]
        check(target, { disputed: true })
        changes[change.uplink] = setDirect(target, {
          disputeSettled: true,
          qaResolved: false,
          qaRejected: false,
          qaTickStart: undefined,
        })
        return changes
      },
    }),
    tradeMedallion: set({ tradedMedallion: true }),
    snapshotActor: assign({
      actorSnapshot: ({ context, event }) => ({
        snapshot: snapshot({ context }),
        event: event.type,
      }),
    }),
    fundEth: set({ fundedEth: true }),
    fundDai: set({ fundedDai: true }),
    fund1155: set({ funded1155: true }),
    fund721: set({ funded721: true }),
    defundStart: assign({
      changes: ({ context }) => {
        const change = getChange(context)
        check(change, { defundStarted: false })
        const changes = [...context.changes]
        changes[context.selectedChange] = setDirect(change, {
          defundStarted: true,
          defundTickStart: context.time,
        })
        return changes
      },
    }),
    defundStop: set({ defundStopped: true, defundCompleted: true }),
    defund: set({ defundCompleted: true }),
    tickDefundTime: assign({
      time: ({ context }) => context.time + DEFUND_WINDOW_TICKS,
    }),
    tradeSomeFunds: set({ tradedFundsSome: true }),
    tradeAllFunds: set({ tradedFundsAll: true }),
    tradeSomeContent: set({ tradedContentSome: true }),
    tradeAllContent: set({ tradedContentAll: true }),
    snapshotNext: assign({
      next: snapshot,
      selectedChange: ({ context: { selectedChange } }) => selectedChange + 1,
      actorSnapshot: () => undefined,
    }),
    snapshotPrev: assign({
      prev: snapshot,
      selectedChange: ({ context: { selectedChange } }) => selectedChange - 1,
      actorSnapshot: () => undefined,
    }),
    selectLast: assign({
      selectedChange: ({ context }) => context.changes.length - 1,
    }),
    proposePacket: assign({
      changes: ({ context: { changes } }) => [
        ...changes,
        make({ type: 'HEADER' }),
      ],
    }),
    proposeEdit: assign({
      changes: ({ context: { changes, selectedChange } }) => [
        ...changes,
        make({ type: 'EDIT', uplink: selectedChange }),
      ],
    }),
    proposeSolution: assign({
      changes: ({ context: { changes, selectedChange } }) => {
        const next = [
          ...changes,
          make({ type: 'SOLUTION', uplink: selectedChange }),
        ]
        const packet = getChange({ changes, selectedChange })
        check(packet, { type: 'PACKET' })
        const downlinks = [...packet.downlinks, next.length - 1]
        const nextPacket = setDirect(packet, { downlinks })
        next[selectedChange] = nextPacket
        return next
      },
    }),
    tickTime: assign({
      time: ({ context }) => context.time + DISPUTE_WINDOW_TICKS,
    }),
    qaReject: set({ qaRejected: true }),
    qaResolve: set({ qaResolved: true }),
    qaDisputeWindowStart: assign({
      changes: ({ context }) => {
        const change = getChange(context)
        check(change, { qaTickStart: undefined })
        const next = setDirect(change, { qaTickStart: context.time })
        const changes = [...context.changes]
        changes[context.selectedChange] = next
        return changes
      },
    }),
    disputeShares: assign({ changes: addDispute('shares') }),
    disputeResolve: assign({ changes: addDispute('resolve') }),
    disputeReject: assign({ changes: addDispute('reject') }),
    enact: assign({
      changes: ({ context }) => {
        const change = getChange(context)
        check(change, { enacted: false })
        const changes = [...context.changes]
        changes[context.selectedChange] = setDirect(change, { enacted: true })
        return changes
      },
    }),
    makePacket: assign({
      changes: ({ context }) => {
        const header = getChange(context)
        check(header, { type: 'HEADER', enacted: true })
        const { selectedChange } = context
        const next = setDirect(header, { uplink: context.changes.length })
        const changes = [
          ...context.changes,
          make({ type: 'PACKET', uplink: selectedChange }),
        ]
        changes[selectedChange] = next
        return changes
      },
    }),
    // TODO ensure there is a limit to the number of solutions we can do
    mergeShares: assign({
      changes: ({ context }) => {
        const solution = getChange(context)
        check(solution, { type: 'SOLUTION', enacted: true })
        // TODO merge in the solution shares
        const changes = [...context.changes]
        const packet = changes[solution.uplink]
        check(packet, { type: 'PACKET' })
        return changes
      },
    }),
    enactPacket: assign({
      changes: ({ context }) => {
        const solution = getChange(context)
        check(solution, { type: 'SOLUTION', enacted: true })
        const changes = [...context.changes]
        const packet = changes[solution.uplink]
        check(packet, { type: 'PACKET', enacted: false })
        checkIsSolved(packet, changes)
        changes[solution.uplink] = setDirect(packet, { enacted: true })
        return changes
      },
    }),
    focusUplink: assign({
      selectedChange: ({ context }) => {
        const change = getChange(context)
        return change.uplink
      },
    }),
  },
}

export const machine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDswA8AuBiAQgUQH0AVAJQEEARPEgbQAYBdRUABwHtYBLDTt5ZkGkQAWAEwAaEAE9EARgDMADgDsAOjqj5ANjoBWAJxbRo-cMUBfc5NSZchAAokA8vacBlavSZIQ7Ljz4BIQQxSRkEFVF1TWEtQ0V9WQT9S2t0bHwCDxIANQBJAGE8LwE-bl5+H2DQ6URdLXlo+WFZXWbRWVEtYVSQGwzCNycAGRzPRlKOcsCqkQlahC0lpt1RM2FlWWFY3v67AjwKPKInWgmfMoDK0Gr58OU4puF9ZS7FWS1leV30-aO3ewAVSI428rCmVyCczCiBeuieYlksg0nQsVj6v0yAEUyCULhCKlCQnc5KJFMImg15LoWqJNsofrZMgAxQEAOSoZzBvgJMxu0IWyOUiieWzanWpWkZAyygPs1AIOLx4P8hNmxJhCCR70pWiRog0ZjRaVsbLwAA0iMqeaq+YIBeEyfp4QYDQp9Ip6lpjRjbI48DlrZc1fyNQt5HQtKpVs1XvJ9IZlMoeuj+qoAIYAYwwbAATrAsBbjkHedd7Qg1lHEsJIx8k2Z9M1NVtEqpRLo6PGk106HRZAzU+kM9m8wWi0Qsnk2QBxYbFc4q6Zl4KV1TV2ufZMJJuCmmyVTKDsfbT9vvx6XDnP53CAkhsku25eIVfrvWbhs78KtfRRdt0DbCtsvYDiaGCXqOWAkAGTgANKEC41BkCcXKTI+RIvlsG71tuwjNt0USHnQyg-kRyK9qIF5ZleBZkPYjhOGMBAIWyHi4guNpLuhsRrphb7YY2uGCnEjR-roujEUYfZrJRI7XrR9GMQh5DIQ+nHqhhNZ8VuAnNsmjSEfImiehGlYydRkHQXBTHyixeBsdywZ2iu3GvnW2mfnIxEUn+dAJMmNbyCBvpgVRo6qCwuZsH4YC5lg9GuB4BD2GQBRwVa7GOU+CAkW24nCqYWgGPGWiasmaj1MY4nHnQCZmWFABmACuyAQDFWAUE4BCshyoKoWpoY5e2SYJLERWGM2-4is8Hr1EBP5KHV+aqLAbAADYAG5tfF7iDCMwJ5E494ZaWRKDXlI2FY240LB2dAHrdwhKI9ijkikg6YOBS0AI7pu1nVKsdaHqmdw0FWNJULAayh3T+7YqPGfYNBR70hbJsDLY1LAxViv0dbK8okIq9l9ZCwMGrloOjVdENfksFLyJ0eqKF0HxiVKKOfejGC5umrWxXjpCUL1+JAwN5NDflVPFZqdIvKo7zMwzWxKMRuiLejkDcHmcXOAlhCHMWgP9eWIOS5d0sLEYFKtEYKi6CoZivOrqgQJwsAsI1GBtXj-xAiCKEi8bwSmxd4OagmIq9r2+h6NNSJqxzoVLbAMXrZwmZgIWbIpelDknWTd0S6H1OasIHa5VHgXki9awpqBy0YFmADWqhRWAyBYKppOhkoHqqAoHQ6B6rSaDTciKP+8uJEkE8Tx8L0XrAjeZi3bcdzQsh56L5a9yKA8fDV7wxmPITdGuCaGPI8aeu67P10vzet1jyCqE1LWcMgUBYN1FAHEQAASXcQzli6NoaMjYOzGBUHER64cNj3UjNsbYxhlaL2XqvZ+r9mqu0-t-dkv8KBkDyEApyz4GhRiKpAskDxTDyAmtsNsnZoavEZmsBO990FP3blg9+uCf4EHjroEhWVQEUIgRoahMC6GCkwqoQqnw4gegjM0b4HMH4ry4S-N+OCv78JYcI9C5DwHUgkdA2hzZNBqCRJ2d4vlTDtjvsFBuj8148J0aoZqzJsGQE7kbbuID6zRkUURQ82xdCyGbEoO6ihtCJDWMmBoeg0EuMwdoj+UA3GQFUAACzWjo9qeB+FuCIGQEgucSbAOCMoxohV6gKEMjHD4Fjy5fBaPqF4ZhvTJI0a4tJn9MkQByXk9Jvit5B0QNUuRbN6kmERpE+BSR6SaXynEbpGDuF9IydorJrVNkFKKScewBj1QRjEOoWIolfIPCIs2Vo3kj7xESeJdhTj1HrK0dg9JAyXZgD2VQH+xye5l30G2QwSRDA1W0EsZsGx4R6n-MmBMcRZDOjWZotxXztmDN2Z83BRBCgwQIP8-BxA8gAFl5xjP8VUjoIpal02MHqBMgkvwdGiTE55bQjCqI4Sk7hP1RkVNIQgbQaxzlMwlAkb0MsiJRDEA4-8l1+xBTTG89FP1VAACtGrQBGTiAgUEhijEpUKkRHpI7vAaKsVYzDmwJiiIjJEzoGjxBVUONVriNXat1bg-VUEABSeACjlMDtS585r1CWupO2OkNzIbx1UPKux7p7ZETRa42AmNsbplUAAd3TOUPFBLSUUsBSA7cqhtCeg6LGxmJ9577gqkmNoh4R48teZwjNWbcw4zzQWnguCy00seFW1YnoJHehZePak6gPhdCWLEus6bMGZqxj2nN3qoAjLIMMYYRK8gAmBHgNw+63BkoPR4CgQ6JkVv3kPI+o9mzVsrYkYC7xEztmXdw1d2atU6q3bg32R6CByn-ngYYv83D-1Kce69Irb0ARemzF4+g7WHgPIYF4XxnRkh2GoztK7u29s3SMoDIIQP2DAxBuDu9+6GQPsPY+MtGb91miiToRE3q8o0c-HR9hm5gGwHBjs9s6ODx-Mid4pVkwV1eLEF6GwGhot4yM4Teg970biGyqTCw7aycrAph47bVWcJU4OzepqiQiY0+J7TETLZiQQcilF3pViyGU+3dxrt3ae0zvi1KJaTWhsqSIHQVjNMouFEsVDN0fzRiMmJR64laUed4Rk7zHsvaqFzHANam0IDtQPX7QY0HDVqdE3eiTvl7PhEbCKEwXxDw6DWAzLjHbH5mfS27TLYBsu5Y2j4sjhBDUjDGOVmzHwqs6a-LWA8NiIGYTYalrz3XfN9ZWgNgrcHHpKHFUkYwJ5OilXJPp+T5IjPLa+RltbOXNVgGzINorwGA1BvxYdcbYnJt2duZ6fuyI2liDqV8NF7cqI+O23c8VDN5UxOZroUusQ1AbGZswx6NVHEmcftdr2W2-EhYQHueEnpEjxlje+zUtT1C9nqIeRFxEfSY40aD7M6YABGq1esp1zGnDOAB1PMTc2pwYUGfWOSxXj0hesoTUUKRQRktQVakwoQfIComzjny1U7pzAPz3MgvYobypfj8SCY1xGciAmf8U6QgtAwwmK+YlaVGBV2r9nnOtd84F0L0QRvhUi4pGLz4dJ+xS4RzHORHRqRIcCn2F3LO3ea+59r3X+vO7yF91lE3IKXgNAtzHbYpUxWHgjEmGqbQr7GfdZw7mvNMXYNgEQHm7jmpYsFcF4VDW6VsL7L2T09QZZ9-lii-8mgaTkiU-hx+Nf3HaIb03uvLUfGCyoAQHde6f5uBoxGeEsRIzOiUTHEkFZifyzEG07o3RY+T40dPhfEA5+1-6a35fu0KVdXwZvvHwr5d3TaGXuk4kisMsyY8IwoDi4oT0bqH0aqt+T+9ejej+Wy3iuOGeRIV8egiaOgcQBgMSh+A+nQlaYg-4SuNU88aKsBGSmYfAXsyAGACBzeqAquD2KBlm6kLwjQkK4k2+hk-4Mu-YRODMjWNYHwCgUBYEMB8+-SVBtB7cdBkhGSzOOOWAL+q+u6BABQh0IIbIIai4YaIq1IRO9spgmE52SYfBxE8sYkyI0WDMm45B8hqg0hNBchiBqgihS+5AK+Qwb+Gh2heA2hNGNUDqRgSQYg3oyqJ8EYhUGGqwOg2gtYZc9hrhThsh9BXy7hLB7eWUDuhhI0JhAE0u4YA8laNIXwigeoDwMSle0B1eDhP0ZKkA6Yq0q0FQaR-SyAfAeAaAbszhbeuh+OJgBg58KKWw4Rr0hRjoYkagL0+eu+-Yeo1R4htRrh9RjRzRrRDhzUGRfRHEehDM5REesQ2w-YCgCQMsUx8sCQVuOg8xCgSR7iqxEATRLRfAbRChTBShKhFKhCu6B0R0qBJyNYd0mwnYzwIBzosCkMbQIKzM1YNaLQmk9xXyjxzxGxrh2xNGQJB4yIzQHSBgNI0ijozwUQhkKgyYk08iceGAbga0nsFQWAEAfAnOjcWWjOLcihNJq0dJfAcGQ0ja4iUCNCkJ4QLQGga4CJnQOBV8noVJnJ3JL8K0uYQmX+WUrQCg6gY+NU2whEKgpckYDqfkgEmwZ+ixziTOHxcpVwy0eYQmFmWRRIapHBmppgsKVyMuKg+4NYHYFy2oHYppaqHJtJVpa8-GK8gmOxmUDpcO58mgsyDMsaMWIpzQv+CxHScSeospQZFQmioZgutpAJoY+28I9qDSnYnQ0MiZIgIedGB8Jgh+LybJbhFpWZfAOZAmQmPurBhZ0ZJZcZ5ZNUepbQbYWwisXKY+mZXJVpqAmYkUuZ4ZvJKKIotOMCyIZIYk7ptuLMF+R4SYE+3G7JzZk52Z05s57Zncdp-RHei590Qpq5feMuAk2Jim8ZkYyu1+B5VElp2ZmYq0HA6uYAc5ypBZIC15y5xhGg95Cwj0SI-c4RHQAUkYE58pjhv5sA-5gF55wFK4oF4kK5EF65UFNYFIIRRkKIYKSFVpt292OOZKjUq0PAX5fAEZ+coYHQfcYFopa58OUFHQagmwD0gErQDOVej8gZR5rZVFzBtF9FnAjF68F5uxAxOFt5+F3FIpJxT5L08YqwLQaIqYbArU8APg-QXZ5YAAtCfGZWclHDZbZX2HXE4knEZZeaqX3K5O+DhKXIZBXL2FXEaNJInGjOFJFNFLmKZVUsKOfAmIeBLMPoSYgPDD5SObnjEhjkOE5ZkmFfaSct6NGPGe8F5NSEcRNBYWsAmAYNDK6I2M7BtptFlS5WgeTKYOKGXPsZWBTp8D5dDCiLDsjPXBlT9OFRMmfIVKPlETSEyhMaSL9n+GXGSLgWJG1mmBlT+uukNSKmfDnmzMaZNvWvtm2NNPRl0Dhs7NPjFOtfLomhfK8J8J2DVJ2JEi9AdR6DQt6NFcJR9BlZrFeBdXSImv2HCKAoFM8NJoXA9LXGSDoB9ajNRC7Ktl7PVYpd-hGG2BUVsAaLGY9CfDns9S9bhjHN0DVR7mAOtRpFhO5NbrND5Tnr3q0KaV9d0Tjutcaf3DhhPGzJ8DSM2DSL+N6YFMKA9A5ctUFemCwBFGwOtE0W4IJszVsKzWOnoF6KErpPGGuL5RsKAvNA2SJSvOtZ0H3IHhLiHrqVBTvu9QYM9KCYke+ZoqTTSL-gKZIuYgsK8PVt6fWNqQzNrTUXyi-GnGALmhdZsCCgPH2C9OprwZDKRImgdgPCgq7V+h8mlnbU9ZQqYkKfFREK0AgkDdHs8InRiv0p4sgaTfhGuGOqct6J2NCoKCrGuAaHoJwU9GlT7T0qkrikgYvhAKTeUfuLUiAUdeUYoBNMsMKEkMiIkD+DSAXZst8rkqtDoqTTHCCv3a1TWkPRYpsNiURBVYFEkGJDPR3d8jisndlT3K1geN6O+v9jwcPbXY9PLFWhCfZTagXYNWfeWh0JGi2CXnEHbHapPOElSKKojNPTbZ6huv+ukj3Y8NVs8L-S9Wpc+J2PCEoPbM8LHKXmIWae8qoBqjlrVZAL9X2NGPbKMU6ibY6BoHxSik6C2hPGYG-TmpJUzR-TSiQ2JO8LEBQ1NRWGqf3DGgYEiM0P2AXatTjD3WXJWq5jWtDHWtzaYOoEYB6LQgoEaGI0RjmvmoWlABdSiPLJOi2kovzU+s0LOjcVdIIX1e1m3d+po3+j6ro2wxMtoBSGXFjVga+sKdOgHgfCivGFY5dp-IBetWXGKa0ItdBaeCfLECJLdEwtXMzNsEE04w1eqLSBwbE+jWSEoO2KXAcUYOEhoHvfvP6aZp5l8v7YHc4yEIZFGMmrdTbIVJqB6QgsRHWP2GsNDTg+FBU-0tjiTTUy0FvYqtDlArk0gwTjJpKfwY7t6B0Ck3DT5llgQ3lkQ0M2xVDtk71ZM0sH3e2G0BVZFjKTbZ1ksz1n1ndswaEztmJn2B6BoKYHffcDEhXABEgl8B8FSes2kz3IkFGF0HSFfAmPPDE+EhSM6H6Z8PLnhvuec75t3TUzalGJ6JECYMHgOQ5gHr5QaFfBKN7UsaJR8f+etTSHLM1e2GRLNJMy5lFXbAkMYERF0jbYof+aoFU9A0i-UI0LvkhiORsJWcfhSPExPMKEwtoFSWy1zjzjrl7ojZGeqIlsWXNUU3oN0JMyolTlJL5AE0ZkLTrS3BQXbTOmnYKVIjLHSFEMzOUURHoEiF8ASz0xQW4g-ovTU28HdCcZVKrEaDLIVPVszAaA2GXN6UiXAS1K618i3iXe667f3JsN6xCS9APt5fUFKjcTWCoGG53ffm8QMno18NvXqHSDtszAPvAqPrbL5IDsDjbc67Pnm2dYi78zvOEiSUrskDQsygPjJjWB0HlAdkNNm44dQakfIaXURGuGFpoEoEsOJDLC8PVhCf5A2u5nWw4SkbQXm1sR8T80jSIpThCnGLO4VLw17VEGQ3s5GL5GA3C865uy4e4hkXo7lQDaKZJJHeELYWoF04ZAzAzBoI6xIckaO1uw4U2xdeg9GKNHO20MzAoHwYowidWjQpCsOyiesa8eO+6-bI0Ka07d4xWERfLE6C9P9ih+h+mA0U8Zh8gHmx0cgF0T0bIaXQzMYlQmYoR+2GY7nvECzORJR9R6iVh64Tu2Ds2-u2gYreoEmDFV065ifAcyi1LuwamkuuuysVR2sS8XRw4c+zU6SfuCCWYP2Lk+1VCfUJcSoKp3PJ8IJ9p2ie4hBwZ1DTxNSGo+dqYOcTSJWi9H5w3ZGEB5wmJfKXrc0PUxNUHpLpQxMsXpfaiFDfEi8BRdmYqRgGF4o4bcHsKDF-Bg8DJ+6M9JpEF0S5+S2S-CGe2XrZzVPNW2VHoHi3qXqJGg89CTTil62SeWwCE+63dYmgBEinOwVO6Y8IVM8M8OCwdh1y-D+X+W7j1y2yuH2OVErOwb2PA0fjtiCnUmfi0GJIhSy4echSw5ANJQxeV3rRGta0ES9IkmYKXPMb560PqT+FbNN02eJ6TUoPyc0CboAduA97lcaX3rO6SZYJYEAA */
    context: {
      time: 0,
      changes: [],
      selectedChange: undefined,
    },
    id: 'next',
    initial: 'actors',
    states: {
      actors: {
        description: 'The selected account that actions will be applied to',
        initial: 'proposer',
        states: {
          proposer: {
            description: 'Proposes new Packets',
            on: {
              PROPOSE_PACKET: {
                target: '#stack',
                actions: ['proposePacket', 'selectLast'],
              },
            },
          },
          funder: {
            description: 'Funds the current Change',
            on: {
              DO_FUNDER: '#stack.open.funding',
            },
          },
          solver: {
            description: 'Proposes a Solution to the current Packet',
            on: {
              PROPOSE_SOLUTION: {
                target: '#stack',
                guard: 'isPacket',
                actions: ['proposeSolution', 'selectLast'],
              },
            },
          },
          qa: {
            description: 'Judges the current Change',
            on: {
              DO_QA: '#stack.open.qa',
            },
          },
          superQa: {
            description: 'Judges the current Dispute',
            on: {
              DO_SUPER_QA: {
                target: '#stack.open.superQa',
                guard: 'isDisputeSettleable',
              },
            },
          },
          trader: {
            description: 'Trades any of the NFTs in the current Change',
            on: {
              DO_TRADER: '#stack.trading',
            },
          },
          editor: {
            description: 'Proposes an Edit to the current Change',
            on: {
              PROPOSE_EDIT: {
                target: '#stack',
                guard: 'isHeaderOrSolution',
                actions: ['proposeEdit', 'selectLast'],
              },
            },
          },
          disputer: {
            description: 'Disputes the QA in the current Change',
            on: {
              DO_DISPUTER: {
                target: '#stack.pending.dispute',
                guard: 'isDisputable',
              },
            },
          },
          service: {
            description:
              'Enacts the current Change because Ethereum cannot do cron jobs',
            on: {
              ENACT: {
                target: '#stack.enactable.serviceWorker',
                guard: 'isEnactable',
              },
            },
          },
          exited: {},
          claimed: {},
          approvalSet: {},
        },
        on: {
          EXIT: { target: '.exited' },
          CLAIM: { target: '.claimed' },
          REVOKE_OPERATOR: { target: '.approvalSet' },
          APPROVE_OPENSEA: { target: '.approvalSet' },
          APPROVE_OPERATOR: { target: '.approvalSet' },
          REVOKE_OPENSEA: { target: '.approvalSet' },
        },
      },
      stack: {
        id: 'stack',
        description:
          'The stack of all changes can be navigated using the NEXT and PREV events.',
        initial: 'open',
        states: {
          open: {
            initial: 'view',
            states: {
              view: {},
              funding: {
                id: 'funding',
                description: 'Manage the funding of the change',
                initial: 'unFunded',
                states: {
                  unFunded: {
                    always: {
                      target: 'funded',
                      guard: 'isFunded',
                    },
                  },
                  funded: {
                    initial: 'holding',
                    states: {
                      holding: {
                        always: {
                          target: 'defunding',
                          guard: 'isDefunding',
                        },
                        on: {
                          DEFUND_START: {
                            target: 'defunding',
                            guard: 'isDefundable',
                            actions: 'defundStart',
                          },
                        },
                      },
                      defunding: {
                        on: {
                          DEFUND_STOP: {
                            target: 'holding',
                            actions: 'defundStop',
                          },
                          DEFUND: {
                            target: '#funding.unFunded',
                            guard: 'isDefundWindowPassed',
                            actions: 'defund',
                          },
                          TICK_DEFUND_TIME: {
                            target: 'defunding',
                            // TODO use isTimeLeft check too
                            guard: 'isDefundWaiting',
                            actions: 'tickDefundTime',
                            description:
                              'Move time forwards so defunding is possible',
                          },
                        },
                      },
                    },
                  },
                },
                on: {
                  FUND_ETH: {
                    target: '.funded',
                    guard: 'isFundableEth',
                    actions: 'fundEth',
                  },
                  FUND_DAI: {
                    target: '.funded',
                    guard: 'isFundableDai',
                    actions: 'fundDai',
                  },
                  FUND_1155: {
                    target: '.funded',
                    guard: 'isFundable1155',
                    actions: 'fund1155',
                  },
                  FUND_721: {
                    target: '.funded',
                    guard: 'isFundable721',
                    actions: 'fund721',
                  },
                },
              },
              qa: {
                initial: 'judging',
                states: {
                  judging: {
                    on: {
                      QA_RESOLVE: {
                        target: 'resolved',
                        actions: ['qaResolve', 'qaDisputeWindowStart'],
                      },
                      QA_REJECT: {
                        target: 'rejected',
                        actions: ['qaReject', 'qaDisputeWindowStart'],
                      },
                    },
                  },
                  resolved: {
                    type: 'final',
                  },
                  rejected: {
                    type: 'final',
                  },
                },
                always: {
                  target: 'view',
                  guard: 'isPacketOrDispute',
                },
              },
              superQa: {
                initial: 'waiting',
                states: {
                  waiting: {
                    always: {
                      target: 'judging',
                      guard: 'isDisputeWindowPassed',
                    },
                    on: {
                      TICK_TIME: {
                        guard: 'isDisputeWindowCloseable',
                        actions: 'tickTime',
                        description:
                          'Move time forwards so dispute resolution is possible',
                      },
                    },
                  },
                  judging: {
                    on: {
                      ALL_DISPUTES_DISMISSED: {
                        target: '#stack',
                        actions: ['disputeDismiss', 'focusUplink'],
                      },
                      DISPUTE_UPHELD_SHARES: {
                        target: '#stack',
                        actions: [
                          'disputeDismiss',
                          'disputeSharesUpheld',
                          'focusUplink',
                        ],
                        guard: 'isDisputeShares',
                      },
                      DISPUTE_UPHELD: {
                        target: '#stack',
                        actions: [
                          'disputeDismiss',
                          'disputeUpheld',
                          'focusUplink',
                        ],
                        guard: 'isNotDisputeShares',
                      },
                    },
                  },
                },
              },
            },
            always: [
              { target: 'pending', guard: 'isNotOpen' },
              { target: 'pendingPacket', guard: 'isPacketNotOpen' },
            ],
          },
          pendingPacket: {
            always: { target: 'enacted', guard: 'isEnacted' },
          },
          pending: {
            initial: 'view',
            states: {
              view: {},
              dispute: {
                initial: 'resolved',
                states: {
                  resolved: {
                    always: {
                      target: 'rejected',
                      guard: 'isRejected',
                    },
                    on: {
                      DISPUTE_SHARES: {
                        target: '#stack',
                        actions: ['disputeShares', 'selectLast'],
                      },
                      DISPUTE_RESOLVE: {
                        target: '#stack',
                        actions: ['disputeResolve', 'selectLast'],
                      },
                    },
                  },
                  rejected: {
                    on: {
                      DISPUTE_REJECTION: {
                        target: '#stack',
                        actions: ['disputeRejection', 'selectLast'],
                      },
                    },
                  },
                },
                on: {
                  TICK_TIME: {
                    target: '#stack.pending',
                    guard: 'isDisputeWindowCloseable',
                    actions: 'tickTime',
                    description:
                      'Move time forwards so dispute resolution is possible',
                  },
                },
              },
            },
            always: [
              { target: 'enacted', guard: 'isDispute' },
              { target: 'disputed', guard: 'isDisputeWindowPassed' },
            ],
          },
          enacted: {
            always: {
              target: '#stack',
              guard: 'isHeader',
              actions: 'selectLast',
              description:
                'Because a header causes a packet to be made, focus the packet immediately.',
            },
          },
          disputed: {
            always: {
              target: 'enactable',
              guard: 'isUnDisputed',
            },
          },
          enactable: {
            initial: 'viewing',
            states: {
              viewing: {},
              serviceWorker: {
                always: [
                  {
                    target: '#stack.enacted',
                    guard: 'isDispute',
                    actions: 'enact',
                  },
                  {
                    target: '#stack.enactSolution',
                    guard: 'isSolution',
                    actions: 'enact',
                  },
                  {
                    target: '#stack.enacted',
                    guard: 'isRejected',
                    actions: 'enact',
                  },
                  {
                    target: '#stack.enacted',
                    guard: 'isHeader',
                    actions: ['enact', 'makePacket'],
                  },
                ],
              },
            },
          },
          trading: {
            description: 'Trading is always available to all changes',
            type: 'parallel',
            states: {
              fundsTrading: {
                initial: 'unfunded',
                states: {
                  unfunded: {
                    description: 'No funding is available for trading',
                    always: {
                      target: 'funded',
                      guard: 'isFunded',
                    },
                  },
                  funded: {
                    description: 'Funding is available for trading',
                    always: {
                      target: 'traded',
                      guard: 'isAllFundsTraded',
                    },
                    on: {
                      TRADE_ALL_FUNDS: {
                        target: 'traded',
                        actions: 'tradeAllFunds',
                      },
                      TRADE_SOME_FUNDS: {
                        actions: 'tradeSomeFunds',
                        guard: 'isSomeFundsTradable',
                      },
                    },
                  },
                  traded: {
                    type: 'final',
                  },
                },
              },
              contentTrading: {
                initial: 'unenacted',
                states: {
                  unenacted: {
                    description:
                      'Nothing to trade until the change is resolved',
                    always: {
                      target: 'enacted',
                      guard: 'isEnacted',
                    },
                  },
                  enacted: {
                    description: 'Content Shares are available for trading',
                    always: {
                      target: 'traded',
                      guard: 'isContentTraded',
                    },
                    on: {
                      TRADE_ALL_CONTENT: {
                        target: 'traded',
                        actions: 'tradeAllContent',
                      },
                      TRADE_SOME_CONTENT: {
                        actions: 'tradeSomeContent',
                        guard: 'isSomeContentTradable',
                      },
                    },
                  },
                  traded: {
                    type: 'final',
                  },
                },
              },
              qaMedallionTrading: {
                initial: 'impossible',
                states: {
                  impossible: {
                    description:
                      'If not a packet, there can never be a medallion',
                    always: {
                      target: 'pending',
                      guard: 'isPacket',
                    },
                  },
                  pending: {
                    always: {
                      target: 'enacted',
                      guard: 'isEnacted',
                    },
                  },
                  enacted: {
                    always: { target: 'traded', guard: 'isMedallionTraded' },
                    on: {
                      TRADE_MEDALLION: {
                        target: 'traded',
                        actions: 'tradeMedallion',
                      },
                    },
                  },
                  traded: {
                    type: 'final',
                  },
                },
              },
            },
          },
          enactSolution: {
            initial: 'sort',
            states: {
              sort: {
                always: [
                  {
                    target: 'openPacket',
                    guard: 'isTargetPacketOpen',
                  },
                  {
                    target: 'necroPacket',
                  },
                ],
              },
              openPacket: {
                always: [
                  {
                    target: 'closablePacket',
                    guard: 'isResolved',
                  },
                  {
                    target: 'rejectedMultiSolution',
                    guard: 'isMultiSolution',
                  },
                  {
                    target: 'enacted',
                  },
                ],
              },
              necroPacket: {
                always: [
                  {
                    target: 'enacted',
                    guard: 'isResolved',
                    actions: 'mergeShares',
                  },
                  'enacted',
                ],
              },
              closablePacket: {
                always: [
                  {
                    target: 'enacted',
                    guard: 'isLastSolution',
                    actions: ['enactPacket'],
                  },
                  'enacted',
                ],
              },
              rejectedMultiSolution: {
                always: [
                  {
                    target: 'enacted',
                    guard: 'isLastSolution',
                    actions: ['enactPacket'],
                  },
                  'enacted',
                ],
              },
              enacted: { type: 'final' },
            },
            onDone: '#stack.enacted',
          },
        },
      },
    },
    on: {
      BE_TRADER: {
        target: '.actors.trader',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      BE_PROPOSER: {
        target: '.actors.proposer',
        actions: 'snapshotActor',
      },
      BE_SERVICE: {
        target: '.actors.service',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      BE_SOLVER: {
        target: '.actors.solver',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      BE_EDITOR: {
        target: '.actors.editor',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      BE_DISPUTER: {
        target: '.actors.disputer',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      BE_QA: {
        target: '.actors.qa',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      BE_FUNDER: {
        target: '.actors.funder',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      BE_SUPER_QA: {
        target: '.actors.superQa',
        guard: 'isChange',
        actions: 'snapshotActor',
      },
      NEXT: {
        target: '.stack',
        guard: 'isNextable',
        actions: 'snapshotNext',
      },
      PREV: {
        target: '.stack',
        guard: 'isPrevable',
        actions: 'snapshotPrev',
      },
    },
  },
  options
)
