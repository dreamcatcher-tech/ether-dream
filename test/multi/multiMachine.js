import { assign } from 'xstate'

// use https://stately.ai/viz to visualize the machine

const MAX_TIME_TICKS = 5
const DISPUTE_WINDOW_TICKS = 1
const DEFUND_WINDOW_TICKS = 2
const types = ['HEADER', 'PACKET', 'SOLUTION', 'DISPUTE', 'EDIT']
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
const isDirect = (context, params) => {
  const change = getChange(context)
  return isChange(change, params)
}
const isChange = (change, params) => {
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
  isPacketResolved: ({ context }) => {
    if (!isDirect(context, { type: 'PACKET' })) {
      return false
    }
    for (const solutionIndex of getChange(context).downlinks) {
      const change = context.changes[solutionIndex]
      if (!isChange(change, { type: 'SOLUTION' })) {
        throw new Error('downlink is not a solution')
      }
      if (isChange(change, { qaResolved: true, enacted: true })) {
        return true
      }
    }
    return false
  },
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
    // if no disputes, enough time has passed, then enact
    const change = getChange(context)
    if (!change.qaResolved && !change.qaRejected) {
      // TODO use safe functions
      return false
    }
    // get the current time tick, see if enough time passed
    return !change.disputed
  },
  isNotOpen: not({ qaResolved: false, qaRejected: false }),
  isPacketOrDispute: (opts) => guards.isPacket(opts) || guards.isDispute(opts),
  isDisputable: ({ context }) => {
    const change = getChange(context)
    if (isChange(change, { qaResolved: false, qaRejected: false })) {
      return false
    }
    if (!guards.isDisputeWindowPassed({ context })) {
      return false
    }
    if (isChange(change, { enacted: true })) {
      throw new Error('enacted should not be true')
    }
    return true
  },
  isDisputeWindowPassed: ({ context }) => {
    const change = getChange(context)
    if (change.qaTickStart + DISPUTE_WINDOW_TICKS <= context.time) {
      return true
    }
    return false
  },

  // BUT what about stopping a dispute loop ?
  isUnDisputed: is({ disputed: false }),

  isFundableEth: (context, event) => false,

  isFundableDai: (context, event) => false,

  isFundable1155: (context, event) => false,

  isFundable721: (context, event) => false,

  isDefunding: (context, event) => false,

  isDefundWindowPassed: (context, event) => false,

  isDefundWaiting: (context, event) => false,

  isFundsTraded: (context, event) => false,

  isContentTraded: (context, event) => false,

  isDefundable: (context, event) => false,

  isRejected: (context, event) => false,

  isResolved: (context, event) => false,
  isTimeLeft: ({ context }) => context.time < MAX_TIME_TICKS,
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
      changes: ({ context: { changes, selectedChange } }) => [
        ...changes,
        make({ type: 'SOLUTION', uplink: selectedChange }),
      ],
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
        if (isChange(change, { enacted: true })) {
          throw new Error('already enacted')
        }
        const changes = [...context.changes]
        changes[context.selectedChange] = setDirect(change, { enacted: true })
        if (isChange(change, { qaRejected: true })) {
          return changes
        }
        if (guards.isHeader({ context })) {
          const packet = make({
            type: 'PACKET',
            uplink: context.selectedChange,
          })
          // TODO link the header to the packet
          changes.push(packet)
          const uplink = changes.length - 1
          changes[context.selectedChange] = setDirect(change, { uplink })
          return changes
        }
        if (guards.isSolution({ context })) {
          /**
           * An enacted solution should
           *  - wait for any other open solutions to close
           *  - close the packet if they are the only one
           *
           * If a solution is rejected, then it still might close off
           * the packet if someone else was waiting for it
           */
        }
        throw new Error('cannot enact')
      },
    }),
    // focusUplink: ({ context, event }) => {},
  },
}

import { createMachine } from 'xstate'

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
              DO: {
                target: '#stack',
                actions: ['proposePacket', 'selectLast'],
              },
            },
          },
          funder: {
            description: 'Funds the current Change',
            on: {
              DO: '#stack.actions.open.funding',
            },
          },
          solver: {
            description: 'Proposes a Solution to the current Packet',
            on: {
              DO: {
                target: '#stack',
                guard: 'isPacket',
                actions: ['proposeSolution', 'selectLast'],
              },
            },
          },
          qa: {
            description: 'Judges the current Change',
            on: {
              DO: '#stack.actions.open.qa',
            },
          },
          superQa: {
            description: 'Judges the current Dispute',
            on: {
              DO: {
                target: '#stack.actions.open.superQa',
                guard: 'isDispute',
              },
            },
          },
          trader: {
            description: 'Trades any of the NFTs in the current Change',
            on: {
              DO: '#stack.actions.trading',
            },
          },
          editor: {
            description: 'Proposes an Edit to the current Change',
            on: {
              DO: {
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
                target: '#stack.actions.pending.dispute',
                guard: 'isDisputable',
              },
            },
          },
          service: {
            description: 'Enacts the current Change because Ethereum',
            on: {
              DO: {
                target: '#stack.actions.enactable.serviceWorker',
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
        type: 'parallel',
        description:
          'The stack of all changes can be navigated using the NEXT and PREV events.',
        states: {
          actions: {
            initial: 'open',
            states: {
              open: {
                initial: 'view',
                states: {
                  view: {},
                  funding: {
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
                                target: '#stack.actions.open.funding.unFunded',
                                guard: 'isDefundWindowPassed',
                              },
                              TICK_TIME: {
                                target: 'defunding',
                                guard: 'isDefundWaiting',
                                actions: {
                                  type: 'tickTime',
                                },
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
                        exit: {
                          type: 'qaDisputeWindowStart',
                        },
                        on: {
                          QA_RESOLVE: {
                            target: 'resolved',
                            actions: {
                              type: 'qaResolve',
                            },
                          },
                          QA_REJECT: {
                            target: 'rejected',
                            actions: {
                              type: 'qaReject',
                            },
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
                    exit: {
                      type: 'focusUplink',
                    },
                    initial: 'shares',
                    states: {
                      shares: {
                        always: {
                          target: 'resolved',
                          guard: 'isResolved',
                        },
                      },
                      resolved: {
                        always: {
                          target: 'rejected',
                          guard: 'isRejected',
                        },
                      },
                      rejected: {},
                    },
                    on: {
                      ALL_DISPUTES_DISMISSED: {
                        target: '#stack.actions.open',
                      },
                      DISPUTE_UPHELD: {
                        target: '#stack.actions.open',
                      },
                    },
                  },
                },
                always: {
                  target: 'pending',
                  guard: 'isNotOpen',
                },
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
                        target: '#stack.actions.pending',
                        guard: 'isTimeLeft',
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
                    exit: {
                      type: 'enact',
                    },
                    always: [
                      { target: '#stack.actions.enacted', guard: 'isDispute' },
                      {
                        target: '#stack.actions.enactSolution',
                        guard: 'isSolution',
                      },
                      { target: '#stack.actions.enacted', guard: 'isRejected' },
                      {
                        target: '#stack.actions.enacted',
                        guard: 'isHeader',
                        actions: 'makePacket',
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
                        guard: 'isPacketOpen',
                      },
                      {
                        target: 'closedPacket',
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
                  closedPacket: {
                    always: [
                      {
                        target: 'enacted',
                        guard: 'isResolved',
                        actions: {
                          type: 'mergeShares',
                        },
                      },
                      {
                        target: 'enacted',
                      },
                    ],
                  },
                  closablePacket: {
                    entry: 'pendingPacket',
                    always: [
                      {
                        target: 'enacted',
                        guard: 'isLastSolution',
                        actions: 'enactPacket',
                      },
                      'enacted',
                    ],
                  },
                  rejectedMultiSolution: {
                    always: [
                      {
                        target: 'enacted',
                        guard: 'isLastSolution',
                        actions: {
                          type: 'enactPacket',
                        },
                      },
                      'enacted',
                    ],
                  },
                  enacted: {
                    entry: 'enactChange',
                    type: 'final',
                  },
                },
                onDone: {
                  target: '#stack.actions.enacted',
                },
              },
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
      MANUAL_TICK_TIME: {
        target: '.stack',
        guard: 'isTimeLeft',
        actions: 'tickTime',
      },
    },
  },
  options
)
