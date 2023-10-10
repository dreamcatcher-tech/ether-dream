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
const isActor =
  (actor) =>
  ({ context }) => {
    const { event } = context.actorSnapshot
    const bigActor = actor.toUpperCase()
    return event.endsWith(bigActor)
  }
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
  isDisputeWindowCloseable: (opts) => {
    try {
      return !guards.isDisputeWindowPassed(opts)
    } catch (error) {
      if (error.message === 'qaTickStart is not an integer') {
        return false
      }
      throw error
    }
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

  isFundableEth: is({ fundedEth: false }),
  isFundableDai: is({ fundedDai: false }),
  isFundable1155: is({ funded1155: false }),
  isFundable721: is({ funded721: false }),
  isDefunding: is({ defundStarted: true, defundCompleted: false }),
  isDefundable: is({ defundStarted: false }),
  isTimeRemaining: ({ context }) => context.time < MAX_TIME_TICKS,
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
    guards.isDefunding(opts) && !guards.isDefundWindowPassed(opts),
  isContentTraded: is({ tradedContentAll: true }),
  isSomeContentTraded: is({ tradedContentSome: true }),
  isAllFundsTraded: is({ tradedFundsAll: true }),
  isSomeFundsTraded: is({ tradedFundsSome: true }),
  isActorTrader: isActor('trader'),
  isActorOpenSea: isActor('opensea'),
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
    tickDisputeTime: assign({
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
    /** @xstate-layout N4IgpgJg5mDOIC5QDswA8AuBiAQgUQH0AVAJQEEARPEgbQAYBdRUABwHtYBLDTt5ZkGkQAWAEwAaEAE9EAdgBsARgB0ATlHy6sultEBmLYoC+Ryaky5CAeQAKeAHIBlPGXpMkIdlx58BQhGKSMgiq8rJqGqIArIp0ABx6oqrCcSZm6Nj4BDYktlbOtIwCXty8-B7+gdKI8lFxEXVRwoqqslHtaSDmmYQFAGoAkgDCeG7FHKW+FSIS1QjtUQ1xcap0Snotwp3dlgSOVgAyfdRjHiU+5aCVs8Fx8sIRtXry8nHtbXrbGbt4FANEVkK7lYEwufhmQUQsW0j1EinkcNUUQ2XwsWT+jhsAFUiCcimdQWVwQEblDFLI9I9FHFFHp3i9VKiegQAIqufEg7xE6YkyEIRQpUSPKKyOKiZpRNapUxdb5ZABiWPsVCB4y5UyuELmilECkeela+joMUZMp2WUcWLsJFZ7OBnkJGsEWuCtNkqkedz0cWEelFsiZWHseAAGkRTpzJpdnby5hskspEqFVIoohpEnQtmbvjk8H0Iw71dHrnzyQ9ZBTmmLhFoK60mcoAIYAYwwbAATrAsKH-gXztzNQhxfI1AKtMJZMJGhPSwiR6mM7EknFjdL0pgm62O12hgcyAMALJ9x3FxDD0c1yeT6eyWc+5RPPQT1QrAWiBsttudrAkPNWADS1jWmQAKqgSRbEueKaXhOU5vDO2oUosC7imIdCqKEGgflu35kDYORWMcBC2A4zh2mqUaQcII7QeO17wbeiFvA+yJjr6WgJO+2Ybp+25YHhBFESR5CgceEE8lBY5XnBTSMa6CTzsidDPLU8LKWuso8ThXa-n0AFAaRLhiZREnURedEyQh8l3CxSSJHEsjiuKnzcRgm5frAygsO2bBeGA7ZYARNj5IQNhkEMgHhhyhYmYOKx0Mo0T+t6Bj+nJNRTsowjCMkih5fIBiiFx65ubxnbKAAZgArsgED+VgFBWAQirKni9r9k6-jxYlIoOSlHEVqWSQeqsqUtPEl7yNhHnKLAbAADYAG71UFIV7IcOIDFY9jGWCPLdUlfUJAN6UIG8KjZS+YgptE0Qad07nbsoACOjYNU1bK7QOMYHb1FLHWlpaSoso06HCK4Ock01PbAVUsP5LJvY1exWtQtpfZ1iC-clAMOadY5CqNoh4wkqahND5UYO2jZ1QFyOkJQbUUXtcWrD1OOpXjfKig8qy6tlbR0C0U2uY95W+WAyCOGASNNSRThGdFHWnmdbOHf9nODXMGEJXz6giko1J+hTnmQNwHaBbkwXOAQvy9krJ7EtjR2a-jxrhJdFYbD6GEKCbygQJwsAsFVGD1cjGLYriYGRizP1q39-WA9qwtqHQxNRJoejPO0IslWLnmwP5i2cM2YDdvY4VRe1jv7QnHMnXyvVp9EBUUuo8TFZpbmwBgLYANbKBLyBYBjKveq8yi0i0qjZ3lojKfIpYvioePKaKK7kqa+e9wPQ-wyPNCKDX4mDhP9TTxhc86ovpbxmo7oCpObwL0+Da782g-D5VNWB8gUBYBahQW2RAAASY9IJRFCMoKBfpdR+hTKsJeiFs5ZQ3tRBIiR3Tvz7p-feksf61U4P-QBSpgEUH3BAiSUCRywMchSR+SDSxihGhsKB6F7LZRcjvXBX8D6EL-gAoBBA8rtCoYOaI0C6HwMYWsZeGhEw+gUpKZIYhuHd1mrw-ByABHEKEWQggjlFDiJjJI2hs96EIPGsg4IC8irKASBDBedxMzGhwXvb+1UiH-2UDVeUv9ICjwdqfUxlYYHaDhHlY0E5oh8jhC8GB9wRRImNPEAU7i8GeN-nogRkBlAAAsFqCIangYRjgiBkBINXZm31-DDUpLUEUSR2jqFnnExeWUEQGgcjWDhUQMl8IIV4wRuSIAFKKXooJJ9YqmKvixJpSIoF2TibSQmqY3wJFCFArMPCPH8OGTk4ZeS6oHJIVQMpAIbAmP8AYdOyhMzbK3tCX0y8az3PQgueET5FkDO0bonxRyxknOyWc0pZDrmICfC0RKSIwjinTpKGxZ4NAqGzm0VM51RTqF+Vk7xUBRkBzAKcgBRBhj-gIOcgxpKDyjGCTMm55J6iNLMVOSUpJ+QYRHIbKcrSKwShxfw16UyamYwQHSe8DyJzjTnmKOJbwL6SkFN6JEFZ+miw-oMnRr1lAACsqrQEmWyAgv59hHFpdMuOdTkj1DSRoV4mhomnV1BWZQk52LkiUCuF4AqCHar1QakhRrfwACk8BDGqeBelZ5rX3JpHalxjq4mrBUKmTM2cYKyGMOqrR39Ybw3bIjZQAB3RspQSGkoisQQ85qRUqwzpSZ47oEi+mSEkJ11FwhJDWOnF+tJfQ+p0XmhGjZi2lp4CQiFYqioekbaxCG9q4kIgSm6-QeVSa0gHbNOGw7dX6qgJMsgBwDgUoGJiHEeBHAnscAeU9zgKCTonpSS+s8Ng32EHE1KERniRAREuNVuzMn8KHQWkd-r91nNPVHQgVpQF4AOMAxwoDKkXofV6KeE514InBooOJvpUWFVgT6d0s9N3AcLWByZkdz0EBg3B+9dLLWQruBfDYV9X0L3fXMO6KhXjqArOhJE6iHoaq8pLQRNgB5gGwJOyU1Ip4bB0H6VMvokX8nvtO6k8rbn3QyJoveB9ikyaFix2I69lPPGYehV1N1kRuueNi7N+mxOTKPha2piBZMmcU5mpoFmU56kcqsScOh2h0iE7pkTBmcmB2DqHcuFbyXUprZGxjAQRThGnqyp8Sh3TL3hFlRT3okjxOJr8qLPiYshzDsodscAFrLQgA1SD1HEPIccEZuT09vPmdU9SRyDiEFhBSKsS8ZXnMVaDlVsANW6tLUCVR3ExqL2HGOB1rzZnfO9c5YlbKDrDb-R2RoyL438WVbizNuac3GuTvYjanlzwVj6DqCs+IU8NAvigasOo28jtaPK6dyb53as6rAK2ebzXFshrDaS7aa35OmaU5tlZ0LahaESElGs4WNwiclp+QJN2dQPAeT6BYaZYlzF9JKNQj2wjUhym8X5Z2w7XYY+5+YfpFhvEzcsVopNevkhBu6HOPpqSZ1+bj1sjYABG81ptF3bCXMuAB1Ds-d6qTtWUTpo6gwiZ3uOT4IULaGZxN8aDYYXxfIE-NL2Xs1i6lzACr9sauAqudrcSEUUCH7NAFDETMfI3ic4pBoNNBg4GW+tzLuX9vleq-V6INzorNf3O1xoNoLwxBRD5Go+ozHWjKUO8JrREu+5R7twrh3TuXejz0InlWnuRqTjylOWInHXS0lz5EGIeVkipV+VTGmhzf6wCINTEZNVAXCpS2zuyQo6Twjw4vYcAfRRZRWKERIdQoU6ex1ogfIzhkj7H0P2qgSGZUAIIe49QD2us9FZvj0fWPg6mCwVAPYoYFun42mbOMR+-H4BWH1H0H0ANP0a3P16CsBpWajIVvzr2JDDweG400BpEcnQizzmAUHqCnD9E0DoTWC7iLz3n3xPwgCPxAPxUnwfUkSnjxlYn5jWD0ADzpHuTdAXxrGaR3x7j3wAPxWbD4DDmQAwGAPH1QCtzBxZ3gIkh1wcVfhiF9AFgwPbxfBgR7QwnaGOhSH-woOUH4KEMlmEN4OUBLzP3IAvyvwICGG2lxHsAjVjjZ2ziszqCUGtQwi9XxjsRgQ0CaBcPsgDEczwRIJ8T0MEMMJ0JMPALMMgOgKsNsIcDsJilSwMEyixT9GyjEF9DiFLHiGwJeG-U93uArG0JGRCIMJEJyQiKn3sPvwMA9GcM2HX3cNLFTEWHTnuEDzjQnH8IA0HiCPxVegPEgEbHmnmjKHKJ8U4AAFsvAuAo8qjEiZ9EE1AO5HIvQwg6Qm4VxEk1h4RtB2hlJiickBihiRixijD-t5jlYEC+17k6whtbpXglCPMtjM54ghtsohYUxDifFjiIBhjRi+Bxj8VKiICCAaUKEj0todo79x4nwL4CoUg6h3R4hkgm4ERVC1gkIX0s5vj+jGxBi-jTjASjDKiH04Sp4ET5VkSVg28PNUx3khZRFMxiYEgI9WxHAFpQ4ygsAIA+A5c+5qsiC8ES8OT5ouS+BJ1ogNgYELEZFEE5E4xzpaDkx2NDRCCIti9xCMBRTxTB0OxpMYTiQn5KRjRPMOFVVTpvRYhEw-QFMhY0x5U2TtTOSLhZp9TR5j53ceRjSU8zSLE2hLSXCWJajZ5kgHMejjCtSdTXTh4JNP4pNLja5BxGUQY+MJ5kQxRaRs8ciHF4gm8lBogoEnToyyhtE4y1dpNPTp8k9RRUz4E7gMy4QmC4wZCEF7SCoulahiyXTSzYzJNpME8vTkzazlj6ynhMzmzDdN5OlogpwHV3R1Td894RSey+BlBUBmwfJyyEzJSMVXUt8Kwels4-Q+RxU6j0IaR7hdt1DuyxTXSNytz+yPSpCJE9y2gEhDzJxjzAyP9MJHIco6QUhC8NTlyozVydFmx5oOAbcwBtyDSXzTE3yDz-RfQ0VsyvcJRmh08cDgKlzhSwK7zSzILoKo84LnyhzEK6h9yPyULvzs9UwhRmMxQPgnss0IyVzCK1zgdQdmcDwqp5oeASy+BEyQk6kkKaKjy0KWzag1Al0tAaFM17hbzdSZsQcJC+KBLOAhLD4qzqi61xK-RaKpLDcljMIVI7Us0zQ2A6p4APBugKL-AABaVTTOLKDCdyjyzlH7B6MqWyvSo0lQ2iaSG8bPaIKeNMOCHlNSDdUWXyryHyPydsByyFVfDyhc3XQTWkhAF4BKBinKbKckCkAqf2I5JK6s8eSeeg7QWIP3PAoaVfBi0UWncGb0f2S7ZaMq-ynkDMNQKcfQeQVYY0dYp4s6BJBinXXY+FXC0qbSF6RsZKsVe4WyJ8NMOocUGIScqEIC8KxIOnJQV4bBWK2asjea8qhApa1oRpe01oUIZSO+GkHaqUzfPqxcmamafffyBagwbA9y14t8b0bmAqcK9axZA0RyV6gubRaWU6rqs+IWcyOoX3Q2VQPkZMYG18RAv2I6maM2L8L63ULKLedMLtdQLI7UXQdGzOFtTNCGuKpnT6s67qgwRKfaisSJYbdlPKNodGuEBvZ8NqmPMABaySDNSyU6d4YGtMUm1NNYf2dAbgSABazNB4FoJSTMaiQnfGOcYMheJcF8Vcf2SC0tSYxWxmwcZWqeQTHQXbTWu8ZCJSQ0RFLCbGp6RsFgbyNgRaYY6WDAJWgUS2tWm28UfGZE1Q83ELYmWoPOX7AeBanUKi6JHXdPfXEagUSkTyrZYmbQY2AIzVYWyUBKaRBheU3rDah+VpdOUmn-TdEuMAItL6sIR-DYXpHKbOsm2xLncKoamSPrTdYlfOlIGUuBYu6xWceG58YmDCKcRyLHbgvZIZEFfFPxAJCAYWzQQmNMV4Z4X0JCFZCkB8CcFpTZUIb1XOv5YlUZYWzMlidYZMRBcUZhNMVQ5YJcBEHzWevTQDBevFAlQpeaQRK+gam+2kO+loB+rjd2LKb0MUNPZIPIvuxeglYFPFfG90V1V4NHNAmkEUFZBMKmq6IbWnTdV6YW0UFQNJAXMndQVMRdNWFtOoO4JcbomOr+rVUDPdPRK+hMChtoKh3muVOEKeMcV4H0FTf9FhzVOai7erU22GmMDYJQGBXqDCZxJELMrjGkSkAWFId0PY5hoUyR7VbiiQr6+EFQd4dfVRjapNZ4BxZEFw-a-QKcUjbdEDK+40RMRu5tA0a6J1BBazLQJQMQRxV4Fx-NQtEtMtKAYWleBxMITNVW7XAURdaFN1Ag+4dOWWs+3NVx8jDh-+L6xIB4HA0IPrXvBIFJj0NJucDgrJiM-7OChagWIUZTCsVSHKzm19RKYrbQQ8nLcRgx0TFBs2mMGsWee5SK0nIqNMZha02THmHeheUUMbH+2u+ukZ64aBHIzQCcCckaxERYN+zMDphEBnM+-7AOQHMOJpgUchyZhYaZ5hFQsGF-NFF8ZZ85k7S52LarWrdq2RhY0VKsD0YnVldoR57UD7VQ4WByHLC3T5n++m1SnigFq4nkD4p9b2WoFITQUUF7DLXUKUakFw7ykC-CvHVejZpjGyLvAwLffarKltXIhh5kkUTMRnK51FpMmMH-EcLnT7Ndfh-zXmRhQLGk0lvCweEvGChapoEUXq19AM1+WobI+km6+IQCnKsIJ0mC5QNZzhql+YH-LKRobOxyWoTm2ILRrFcUfPQCiGnHLU3V+XRXR3OPTqwF+vYGBVrmppReVOsx8uwwVpAavKXE4WnKRYIuqxJhLjJEDEzMPW2sLQXEgRcggBw19MSkFYD8sQWnFAvkDBtQZERBeEdQhyVNw-IE3xZAQFNeh6nNtItPNSdurGdoHbHQWITlZyAZsl3oowqtgdler69OD2DnRS1oJ8KcAPIBpBRVAarBFoStoAowj6yluRm5aiEcAgjFvNjYuYFYcINHb6gqBedls+vo3QgQso3g-OxRg6g6nF58Ta-kHQXWF4NMURcadOVN0ooQ6tmqCIteqzB9npO4Z95o7m26ZIQLJdbVi9owv9sIkZIDw1wqFQJBYmMGGkJEZolYUcW67Boqae3969-91dsfLl0SyFDMxKIqyOxTHKXrOEI9lxCsNmxZLgz+-tnQ34-4s4iggeykaN2RVTMQcIAuvKUXW5rGiMy9vjok5AatqYmYzgKPfOlMIeyxUTpueVhTDPLhGsCcVNhTgEpT84k7Ed+kjiTt6eg0J8JuNB14ga+KKT-QEz-Ek4sz6t1DjdyFadCk5VTQakF8N4RzuozQFz5NeeD+kTeTzzwk7zijmmKjqNMVXOTx7QByI0OquYdLe5HZlpUREjs+ji3UuOgwbd1PXXDPA3Gju5HQX2NldAh1zUz8bSt09sX2w12kJoFPHKNPPXTPU8hEB4VjX9VjH5UrgilSvs+M7rvz-kAqTnVYdQ9MOV1Tb0KzNFA0IqWIFYXtyVyM9r8C9c0HR8+buOnWLKREsRwCmhuMHLFuVoTYFeLjx1k7ziiCqC2AGCxpnr1oCT72TfF4F+bMhyXM5YfQCGMt5S104x3i-iwS8Cq7wesUByDFJ7FMU89QB4U55YHDvKbLOH0s3zz1yCKFGU5oNNU0hyHH-LTCIa3qGB-wkwIAA */
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
          openSea: {
            description: 'Acts as OpenSea, transferring NFTs as operator',
            on: {
              DO_OPENSEA: '#stack.trading',
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
          time: {
            on: {
              TICK_DEFUND_TIME: {
                guard: 'isDefundWaiting',
                actions: 'tickDefundTime',
                description: 'Move time forwards so defunding is possible',
              },
              TICK_DISPUTE_TIME: {
                guard: 'isDisputeWindowCloseable',
                actions: 'tickDisputeTime',
                description:
                  'Move time forwards so dispute resolution is possible',
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
                        guard: 'isActorTrader',
                      },
                      OPENSEA_TRADE_ALL_FUNDS: {
                        target: 'traded',
                        actions: 'tradeAllFunds',
                        guard: 'isActorOpenSea',
                      },
                    },
                    initial: 'untraded',
                    states: {
                      untraded: {
                        always: {
                          target: 'someTraded',
                          guard: 'isSomeFundsTraded',
                        },
                        on: {
                          TRADE_SOME_FUNDS: {
                            actions: 'tradeSomeFunds',
                            guard: 'isActorTrader',
                          },
                          OPENSEA_TRADE_SOME_FUNDS: {
                            actions: 'tradeSomeFunds',
                            guard: 'isActorOpenSea',
                          },
                        },
                      },
                      someTraded: {},
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
                        guard: 'isActorTrader',
                      },
                      OPENSEA_TRADE_ALL_CONTENT: {
                        target: 'traded',
                        actions: 'tradeAllContent',
                        guard: 'isActorOpenSea',
                      },
                    },
                    initial: 'untraded',
                    states: {
                      untraded: {
                        always: {
                          target: 'someTraded',
                          guard: 'isSomeContentTraded',
                        },
                        on: {
                          TRADE_SOME_CONTENT: {
                            actions: 'tradeSomeContent',
                            guard: 'isActorTrader',
                          },
                          OPENSEA_TRADE_SOME_CONTENT: {
                            actions: 'tradeSomeContent',
                            guard: 'isActorOpenSea',
                          },
                        },
                      },
                      someTraded: {},
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
                        guard: 'isActorTrader',
                      },
                      OPENSEA_TRADE_MEDALLION: {
                        target: 'traded',
                        actions: 'tradeMedallion',
                        guard: 'isActorOpenSea',
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
      BE_OPENSEA: {
        target: '.actors.openSea',
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
      BE_TIME: {
        target: '.actors.time',
        guard: 'isTimeRemaining',
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
