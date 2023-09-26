import { assign, createMachine } from 'xstate'

// use https://stately.ai/viz to visualize the machine

const MAX_TIME_TICKS = 5
const DISPUTE_WINDOW_TICKS = 1
const DEFUND_WINDOW_TICKS = 2

export const types = ['HEADER', 'PACKET', 'SOLUTION', 'DISPUTE', 'EDIT']
export const ACCOUNT_MANAGEMENT_EVENTS = [
  'EXIT',
  'EXIT_SINGLE',
  'BURN',
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

const set = (params) =>
  assign({
    changes: ({ context }) => {
      const change = getChange(context)
      const next = setDirect(change, params)
      const changes = [...context.changes]
      changes[context.selectedChange] = next
      return changes
    },
  })
const not =
  (params) =>
  ({ context }) =>
    !isDirect(context, params)
const is =
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
      return isChange(change, { disputeSettled: true })
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
    const change = getChange(context)
    if (Number.isInteger(change.qaTickStart) === false) {
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
  isDisputeWindowOpen: (opts) =>
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
  isFundsTraded: is({ tradedFundsAll: false }),
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
}
const base = Object.freeze({
  type: '',
  uplink: undefined,
  downlinks: Object.freeze([]),
  qaResolved: false,
  qaRejected: false,
  enacted: false,
  disputed: false,
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
  // TODO add rounds limits for super qa
})
export const options = {
  guards,
  actions: {
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
        const next = setDirect(change, { qaTickStart: context.time })
        const changes = [...context.changes]
        changes[context.selectedChange] = next
        return changes
      },
    }),
    disputeShares: assign({
      changes: ({ context: { changes, selectedChange } }) => [
        ...changes,
        make({ type: 'DISPUTE', uplink: selectedChange }),
      ],
    }),
    disputeResolve: assign({
      changes: ({ context: { changes, selectedChange } }) => [
        ...changes,
        make({ type: 'DISPUTE', uplink: selectedChange }),
      ],
    }),
    disputeReject: assign({
      changes: ({ context: { changes, selectedChange } }) => [
        ...changes,
        make({ type: 'DISPUTE', uplink: selectedChange }),
      ],
    }),
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
                guard: 'isDispute',
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
            description: 'Enacts the current Change because Ethereum',
            on: {
              ENACT: {
                target: '#stack.enactable.serviceWorker',
                guard: 'isEnactable',
              },
            },
          },
          exited: {},
          approvalSet: {},
        },
        on: {
          EXIT: { target: '.exited' },
          EXIT_SINGLE: { target: '.exited' },
          BURN: { target: '.exited' },
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
                exit: 'focusUplink',
                on: {
                  ALL_DISPUTES_DISMISSED: {
                    target: '#stack',
                  },
                  DISPUTE_UPHELD: {
                    target: '#stack',
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
                    guard: 'isDisputeWindowOpen',
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
                      guard: 'isFundsTraded',
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
                initial: 'nonExistent',
                states: {
                  nonExistent: {
                    description:
                      'If not a packet, there can never be a medallion',
                    always: {
                      target: 'unenacted',
                      guard: 'isPacket',
                    },
                  },
                  unenacted: {
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
