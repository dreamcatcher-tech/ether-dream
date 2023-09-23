import { assign, createMachine } from 'xstate'

// use https://stately.ai/viz to visualize the machine

const MAX_TIME_TICKS = 5
const DISPUTE_WINDOW_TICKS = 1
const DEFUND_WINDOW_TICKS = 2
const types = ['HEADER', 'PACKET', 'SOLUTION', 'DISPUTE', 'EDIT']
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
const make = (params = {}) => {
  if (!Object.keys(params).length) {
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
  for (const key of Object.keys(params)) {
    if (!(key in base)) {
      throw new Error(`key ${key} is not in base key set`)
    }
    if (change[key] !== params[key]) {
      return false
    }
  }
  return true
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
  funded: false,
  // TODO add rounds limits for super qa
})

const guards = {
  isChange: ({ context: { changes } }) => changes.length > 0,
  isNotLast: ({ context }) =>
    context.selectedChange < context.changes.length - 1,
  isNotFirst: ({ context }) => context.selectedChange > 0,
  isPacket: is({ type: 'PACKET' }),
  isHeader: is({ type: 'HEADER' }),
  isHeaderOrSolution: ({ context }) =>
    guards.isHeader({ context }) || guards.isSolution({ context }),
  isSolution: is({ type: 'SOLUTION' }),
  isDispute: is({ type: 'DISPUTE' }),
  isEdit: is({ type: 'EDIT' }),
  isDisputed: is({ disputed: true }),
  isFunded: is({ funded: true }),
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
  isPacketPending: ({ context }) => {
    // pending if packet not enacted but a solution has passed qa
    // even if that solution may yet be disputed
    const packet = getChange(context)
    if (!isChange(packet, { type: 'PACKET' })) {
      return false
    }
    if (isChange(packet, { enacted: true })) {
      return false
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
}
export const options = {
  guards,
  actions: {
    next: assign({
      selectedChange: ({ context: { selectedChange } }) => selectedChange + 1,
    }),
    prev: assign({
      selectedChange: ({ context: { selectedChange } }) => selectedChange - 1,
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
      time: ({ context }) => context.time + 1,
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
    dispute: set({ disputed: true }),
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
      changes: ({ context: { changes, selectedChange } }) => [
        ...changes,
        make({ type: 'PACKET', uplink: selectedChange }),
      ],
    }),
    // TODO ensure there is a limit to the number of solutions we can do
    mergeShares: assign({
      changes: ({ context }) => {
        const solution = getChange(context)
        check(solution, { type: 'SOLUTION' })
        const changes = [...context.changes]
        const packet = changes[solution.uplink]
        check(packet, { type: 'PACKET' })
        packet.downlinks.push(context.selectedChange)
        changes[solution.uplink] = packet
        return changes
      },
    }),
    enactPacket: assign({
      changes: ({ context }) => {
        const solution = getChange(context)
        check(solution, { type: 'SOLUTION', enacted: true })
        const changes = [...context.changes]
        const packet = changes[solution.uplink]
        check(packet, { type: 'PACKET' })
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

export const machine = createMachine(
  {
    context: {
      time: 0,
      changes: [],
      selectedChange: '',
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
              DO: '#stack.open.funding',
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
              DO: '#stack.open.qa',
            },
          },
          superQa: {
            description: 'Judges the current Dispute',
            on: {
              DO: {
                target: '#stack.open.superQa',
                guard: 'isDispute',
              },
            },
          },
          trader: {
            description: 'Trades any of the NFTs in the current Change',
            on: {
              DO: '#stack.trading',
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
              DO: {
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
                          },
                        },
                      },
                      defunding: {
                        on: {
                          DEFUND_STOP: {
                            target: 'holding',
                          },
                          DEFUND: {
                            target: '#funding.unFunded',
                            guard: 'isDefundWindowPassed',
                          },
                          TICK_TIME: {
                            target: 'defunding',
                            // TODO use isTimeLeft check too
                            guard: 'isDefundWaiting',
                            actions: 'tickTime',
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
                  },
                  FUND_DAI: {
                    target: '.funded',
                    guard: 'isFundableDai',
                  },
                  FUND_1155: {
                    target: '.funded',
                    guard: 'isFundable1155',
                  },
                  FUND_721: {
                    target: '.funded',
                    guard: 'isFundable721',
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
              { target: 'pendingPacket', guard: 'isPacketPending' },
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
                      },
                      TRADE_SOME_FUNDS: {
                        target: 'traded',
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
                      },
                      TRADE_SOME_CONTENT: {
                        target: 'traded',
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
                    on: {
                      TRADE_MEDALLION: {
                        target: 'traded',
                      },
                    },
                  },
                  traded: {
                    type: 'final',
                  },
                },
              },
            },
            type: 'parallel',
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
                    actions: ['enactPacket', 'focusUplink'],
                  },
                  'enacted',
                ],
              },
              rejectedMultiSolution: {
                always: [
                  {
                    target: 'enacted',
                    guard: 'isLastSolution',
                    actions: ['enactPacket', 'focusUplink'],
                  },
                  'enacted',
                ],
              },
              enacted: { type: 'final' },
            },
            onDone: {
              target: '#stack.enacted',
            },
          },
        },
      },
    },
    on: {
      BE_TRADER: {
        target: '.actors.trader',
        guard: 'isChange',
      },
      BE_PROPOSER: {
        target: '.actors.proposer',
      },
      BE_SERVICE: {
        target: '.actors.service',
        guard: 'isChange',
      },
      BE_SOLVER: {
        target: '.actors.solver',
        guard: 'isChange',
      },
      BE_EDITOR: {
        target: '.actors.editor',
        guard: 'isChange',
      },
      BE_DISPUTER: {
        target: '.actors.disputer',
        guard: 'isChange',
      },
      BE_QA: {
        target: '.actors.qa',
        guard: 'isChange',
      },
      BE_FUNDER: {
        target: '.actors.funder',
        guard: 'isChange',
      },
      BE_SUPER_QA: {
        target: '.actors.superQa',
        guard: 'isChange',
      },
      NEXT: {
        target: '.stack',
        guard: 'isNotLast',
        actions: {
          type: 'next',
        },
      },
      PREV: {
        target: '.stack',
        guard: 'isNotFirst',
        actions: 'prev',
      },
    },
  },
  options
)
