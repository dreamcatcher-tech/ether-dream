import { assign } from 'xstate'

// use https://stately.ai/viz to visualize the machine

const DISPUTE_WINDOW_TICKS = 1
const DEFUND_WINDOW_TICKS = 2
const getChange = ({ changes, selectedChange }) => {
  if (!Array.isArray(changes) || changes.length === 0) {
    return {}
  }
  return changes[selectedChange]
}
function isTime(ticks) {
  return function time({ context: { time } }) {
    return time === ticks
  }
}
function isPos(index) {
  return function pos({ context: { selectedChange } }) {
    return selectedChange === index
  }
}
const make = (params = {}) => {
  for (const key of Object.keys(params)) {
    if (!(key in base)) {
      throw new Error(`key ${key} is not in base key set`)
    }
  }
  return { ...base, ...params }
}

const setDirect = (change, params) => {
  const base = make()
  const next = { ...change, ...params }
  for (const key of Object.keys(next)) {
    if (!(key in base)) {
      throw new Error(`key ${key} is not in base key set`)
    }
  }
  return next
}

const set = (params) =>
  assign({
    changes: ({ context }) => {
      // get the currenct change
      // update it with the given params
      const change = getChange(context)
      const next = { ...change, ...params }
      for (const key of Object.keys(next)) {
        if (!(key in next)) {
          throw new Error(`key ${key} is not in change key set`)
        }
      }
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
  return isSingle(change, params)
}
const isSingle = (change, params) => {
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
})

const guards = {
  isChange: ({ context }) => !!getChange(context).type,
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
      if (!isSingle(change, { type: 'SOLUTION' })) {
        throw new Error('downlink is not a solution')
      }
      if (isSingle(change, { qaResolved: true, enacted: true })) {
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

  isPacketOrDispute: (context, event) => false,

  isDisputeWindowPassed: (context, event) => false,

  isUnDisputed: (context, event) => false,

  isDisputable: (context, event) => false,

  isRejected: (context, event) => false,

  isResolved: (context, event) => false,
  isTime0: isTime(0),
  isTime1: isTime(1),
  isTime2: isTime(2),
  isTime3: isTime(3),
  isTime4: isTime(4),
  isTime5: isTime(5),
  isPos0: isPos(0),
  isPos1: isPos(1),
  isPos2: isPos(2),
  isPos3: isPos(3),
  isPos4: isPos(4),
  isPos5: isPos(5),
  isPos6: isPos(6),
  isPos7: isPos(7),
  isPos8: isPos(8),
  isPos9: isPos(9),
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
    proposePacket: assign({
      changes: ({ context: { changes } }) => [
        ...changes,
        make({ type: 'HEADER' }),
      ],
      // TODO make this a standalone action called in sequence
      selectedChange: ({ context }) => context.changes.length,
    }),
    proposeEdit: assign({
      changes: ({ context: { changes } }) => [
        ...changes,
        make({ type: 'EDIT' }),
      ],
      selectedChange: ({ context }) => context.changes.length,
    }),
    proposeSolution: assign({
      changes: ({ context: { changes } }) => [
        ...changes,
        make({ type: 'SOLUTION' }),
      ],
      selectedChange: ({ context }) => context.changes.length,
    }),
    tickTime: assign({
      time: ({ context }) => {
        return context.time + 1
      },
    }),
    qaReject: set({ qaRejected: true }),
    qaResolve: set({ qaResolved: true }),
    qaStartDisputeWindow: assign({
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
      changes: ({ context: { changes } }) => [
        ...changes,
        make({ type: 'DISPUTE' }),
      ],
      selectedChange: ({ context }) => context.changes.length,
    }),
    disputeResolve: assign({
      changes: ({ context: { changes } }) => [
        ...changes,
        make({ type: 'DISPUTE' }),
      ],
      selectedChange: ({ context }) => context.changes.length,
    }),
    disputeReject: assign({
      changes: ({ context: { changes } }) => [
        ...changes,
        make({ type: 'DISPUTE' }),
      ],
      selectedChange: ({ context }) => context.changes.length,
    }),
    // focusUplink: ({ context, event }) => {},
    // enact: ({ context, event }) => {},
  },
}

import { createMachine } from 'xstate'

export const machine = createMachine(
  {
    context: {
      changes: [],
      selectedChange: '',
      time: 0,
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
                target: '#next.stack',
                actions: {
                  type: 'proposePacket',
                  params: {},
                },
                reenter: false,
              },
            },
          },
          funder: {
            description: 'Funds the current Change',
            on: {
              DO: {
                target: '#next.stack.actions.open.funding',
                reenter: false,
              },
            },
          },
          solver: {
            description: 'Proposes a Solution to the current Packet',
            on: {
              DO: {
                target: '#next.stack',
                guard: 'isPacket',
                actions: {
                  type: 'proposeSolution',
                  params: {},
                },
                reenter: false,
              },
            },
          },
          qa: {
            description: 'Judges the current Change',
            on: {
              DO: {
                target: '#next.stack.actions.open.qa',
                reenter: false,
              },
            },
          },
          superQa: {
            description: 'Judges the current Dispute',
            on: {
              DO: {
                target: '#next.stack.actions.open.superQa',
                guard: 'isDispute',
                reenter: false,
              },
            },
          },
          trader: {
            description: 'Trades any of the NFTs in the current Change',
            on: {
              DO: {
                target: '#next.stack.actions.trading',
                reenter: false,
              },
            },
          },
          editor: {
            description: 'Proposes an Edit to the current Change',
            on: {
              DO: {
                target: '#next.stack',
                guard: 'isHeaderOrSolution',
                actions: {
                  type: 'proposeEdit',
                  params: {},
                },
                reenter: false,
              },
            },
          },
          disputer: {
            description: 'Disputes the QA in the current Change',
            on: {
              DO: {
                target: '#next.stack.actions.pending.dispute',
                guard: 'isDisputable',
                reenter: false,
              },
            },
          },
          service: {
            description: 'Enacts the current Change because Ethereum',
            on: {
              DO: {
                target: '#next.stack.actions.enactable.serviceWorker',
                guard: 'isEnactable',
                actions: {
                  type: 'enact',
                  params: {},
                },
                reenter: false,
              },
            },
          },
          exited: {},
          approvalSet: {},
        },
        on: {
          EXIT: {
            target: '.exited',
            reenter: false,
          },
          EXIT_SINGLE: {
            target: '.exited',
            reenter: false,
          },
          BURN: {
            target: '.exited',
            reenter: false,
          },
          REVOKE_OPERATOR: {
            target: '.approvalSet',
            reenter: false,
          },
          APPROVE_OPENSEA: {
            target: '.approvalSet',
            reenter: false,
          },
          APPROVE_OPERATOR: {
            target: '.approvalSet',
            reenter: false,
          },
          REVOKE_OPENSEA: {
            target: '.approvalSet',
            reenter: false,
          },
        },
      },
      stack: {
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
                          reenter: false,
                        },
                      },
                      funded: {
                        initial: 'holding',
                        states: {
                          holding: {
                            always: {
                              target: 'defunding',
                              guard: 'isDefunding',
                              reenter: false,
                            },
                            on: {
                              DEFUND_START: {
                                target: 'defunding',
                                guard: 'isDefundable',
                                reenter: false,
                              },
                            },
                          },
                          defunding: {
                            on: {
                              DEFUND_STOP: {
                                target: 'holding',
                                reenter: false,
                              },
                              DEFUND: {
                                target:
                                  '#next.stack.actions.open.funding.unFunded',
                                guard: 'isDefundWindowPassed',
                                reenter: false,
                              },
                              TICK_TIME: {
                                target: 'defunding',
                                guard: 'isDefundWaiting',
                                description:
                                  'Move time forwards so defunding is possible',
                                reenter: false,
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
                        reenter: false,
                      },
                      FUND_DAI: {
                        target: '.funded',
                        guard: 'isFundableDai',
                        reenter: false,
                      },
                      FUND_1155: {
                        target: '.funded',
                        guard: 'isFundable1155',
                        reenter: false,
                      },
                      FUND_721: {
                        target: '.funded',
                        guard: 'isFundable721',
                        reenter: false,
                      },
                    },
                  },
                  qa: {
                    initial: 'judging',
                    states: {
                      judging: {
                        exit: {
                          type: 'qaDisputeWindowStart',
                          params: {},
                        },
                        on: {
                          QA_RESOLVE: {
                            target: 'resolved',
                            actions: {
                              type: 'qaResolve',
                              params: {},
                            },
                            reenter: false,
                          },
                          QA_REJECT: {
                            target: 'rejected',
                            actions: {
                              type: 'qaReject',
                              params: {},
                            },
                            reenter: false,
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
                      reenter: false,
                    },
                  },
                  superQa: {
                    exit: {
                      type: 'focusUplink',
                      params: {},
                    },
                    initial: 'shares',
                    states: {
                      shares: {
                        always: {
                          target: 'resolved',
                          guard: 'isResolved',
                          reenter: false,
                        },
                      },
                      resolved: {
                        always: {
                          target: 'rejected',
                          guard: 'isRejected',
                          reenter: false,
                        },
                      },
                      rejected: {},
                    },
                    on: {
                      ALL_DISPUTES_DISMISSED: {
                        target: '#next.stack.actions.open',
                        reenter: false,
                      },
                      DISPUTE_UPHELD: {
                        target: '#next.stack.actions.open',
                        reenter: false,
                      },
                    },
                  },
                },
                always: {
                  target: 'pending',
                  guard: 'isNotOpen',
                  reenter: false,
                },
              },
              pending: {
                initial: 'viewing',
                states: {
                  viewing: {
                    initial: 'type',
                    states: {
                      type: {
                        always: [
                          {
                            target: 'resolved',
                            guard: 'isResolved',
                            reenter: false,
                          },
                          {
                            target: 'rejected',
                            guard: 'isRejected',
                            reenter: false,
                          },
                          {
                            target: 'disputed',
                            guard: 'isDisputed',
                            reenter: false,
                          },
                        ],
                      },
                      resolved: {},
                      rejected: {},
                      disputed: {},
                    },
                  },
                  dispute: {
                    initial: 'resolved',
                    states: {
                      resolved: {
                        always: {
                          target: 'rejected',
                          guard: 'isRejected',
                          reenter: false,
                        },
                        on: {
                          DISPUTE_SHARES: {
                            target: '#next.stack',
                            reenter: false,
                          },
                          DISPUTE_RESOLVE: {
                            target: '#next.stack',
                            reenter: false,
                          },
                        },
                      },
                      rejected: {
                        on: {
                          DISPUTE_REJECTION: {
                            target: '#next.stack',
                            reenter: false,
                          },
                        },
                      },
                    },
                    on: {
                      TICK_TIME: {
                        target: '#next.stack.actions.pending',
                        actions: {
                          type: 'tickTime',
                          params: {},
                        },
                        description:
                          'Move time forwards so dispute resolution is possible',
                        reenter: false,
                      },
                    },
                  },
                },
                always: [
                  {
                    target: 'enacted',
                    guard: 'isPacketOrDispute',
                    reenter: false,
                  },
                  {
                    target: 'disputed',
                    guard: 'isDisputeWindowPassed',
                    reenter: false,
                  },
                ],
              },
              enacted: {},
              disputed: {
                always: {
                  target: 'enactable',
                  guard: 'isUnDisputed',
                  reenter: false,
                },
              },
              enactable: {
                initial: 'viewing',
                states: {
                  viewing: {},
                  serviceWorker: {
                    always: {
                      target: '#next.stack.actions.enacted',
                      actions: {
                        type: 'enact',
                        params: {},
                      },
                      reenter: false,
                    },
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
                          reenter: false,
                        },
                      },
                      funded: {
                        description: 'Funding is available for trading',
                        always: {
                          target: 'traded',
                          guard: 'isFundsTraded',
                          reenter: false,
                        },
                        on: {
                          TRADE_ALL_FUNDS: {
                            target: 'traded',
                            reenter: false,
                          },
                          TRADE_SOME_FUNDS: {
                            target: 'traded',
                            reenter: false,
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
                          reenter: false,
                        },
                      },
                      enacted: {
                        description: 'Content Shares are available for trading',
                        always: {
                          target: 'traded',
                          guard: 'isContentTraded',
                          reenter: false,
                        },
                        on: {
                          TRADE_ALL_CONTENT: {
                            target: 'traded',
                            reenter: false,
                          },
                          TRADE_SOME_CONTENT: {
                            target: 'traded',
                            reenter: false,
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
                          reenter: false,
                        },
                      },
                      unenacted: {
                        always: {
                          target: 'enacted',
                          guard: 'isEnacted',
                          reenter: false,
                        },
                      },
                      enacted: {
                        on: {
                          TRADE_MEDALLION: {
                            target: 'traded',
                            reenter: false,
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
            },
          },
          view: {
            description:
              'View states are informative only. Transitions must start from an account.',
            states: {
              type: {
                initial: 'sort',
                states: {
                  sort: {
                    always: [
                      {
                        target: 'packet',
                        guard: 'isPacket',
                        reenter: false,
                      },
                      {
                        target: 'dispute',
                        guard: 'isDispute',
                        reenter: false,
                      },
                      {
                        target: 'header',
                        guard: 'isHeader',
                        reenter: false,
                      },
                      {
                        target: 'edit',
                        guard: 'isEdit',
                        reenter: false,
                      },
                      {
                        target: 'solution',
                        guard: 'isSolution',
                        reenter: false,
                      },
                    ],
                  },
                  packet: {},
                  dispute: {},
                  header: {},
                  edit: {},
                  solution: {},
                },
              },
              position: {
                initial: 'empty',
                states: {
                  empty: {
                    always: [
                      {
                        target: 's0',
                        guard: 'isPos0',
                        reenter: false,
                      },
                      {
                        target: 's1',
                        guard: 'isPos1',
                        reenter: false,
                      },
                      {
                        target: 's2',
                        guard: 'isPos2',
                        reenter: false,
                      },
                      {
                        target: 's3',
                        guard: 'isPos3',
                        reenter: false,
                      },
                      {
                        target: 's4',
                        guard: 'isPos4',
                        reenter: false,
                      },
                      {
                        target: 's5',
                        guard: 'isPos5',
                        reenter: false,
                      },
                      {
                        target: 's6',
                        guard: 'isPos6',
                        reenter: false,
                      },
                      {
                        target: 's7',
                        guard: 'isPos7',
                        reenter: false,
                      },
                      {
                        target: 's8',
                        guard: 'isPos8',
                        reenter: false,
                      },
                      {
                        target: 's9',
                        guard: 'isPos9',
                        reenter: false,
                      },
                    ],
                  },
                  s0: {},
                  s1: {},
                  s2: {},
                  s3: {},
                  s4: {},
                  s5: {},
                  s6: {},
                  s7: {},
                  s8: {},
                  s9: {},
                },
              },
              time: {
                description: 'Informational time position of the system',
                initial: 'limbo',
                states: {
                  limbo: {
                    always: [
                      {
                        target: 't0',
                        guard: 'isTime0',
                        reenter: false,
                      },
                      {
                        target: 't1',
                        guard: 'isTime1',
                        reenter: false,
                      },
                      {
                        target: 't2',
                        guard: 'isTime2',
                        reenter: false,
                      },
                      {
                        target: 't3',
                        guard: 'isTime3',
                        reenter: false,
                      },
                      {
                        target: 't4',
                        guard: 'isTime4',
                        reenter: false,
                      },
                      {
                        target: 't5',
                        guard: 'isTime5',
                        reenter: false,
                      },
                    ],
                  },
                  t0: {},
                  t1: {},
                  t2: {},
                  t3: {},
                  t4: {},
                  t5: {
                    type: 'final',
                  },
                },
                on: {
                  TICK_TIME: {
                    target: '.limbo',
                    reenter: false,
                  },
                },
              },
            },
            type: 'parallel',
          },
        },
        type: 'parallel',
      },
    },
    on: {
      BE_TRADER: {
        target: '.actors.trader',
        guard: 'isChange',
        reenter: true,
      },
      BE_PROPOSER: {
        target: '.actors.proposer',
        reenter: true,
      },
      BE_SERVICE: {
        target: '.actors.service',
        guard: 'isChange',
        reenter: true,
      },
      BE_SOLVER: {
        target: '.actors.solver',
        guard: 'isChange',
        reenter: true,
      },
      BE_EDITOR: {
        target: '.actors.editor',
        guard: 'isChange',
        reenter: true,
      },
      BE_DISPUTER: {
        target: '.actors.disputer',
        guard: 'isChange',
        reenter: true,
      },
      BE_QA: {
        target: '.actors.qa',
        guard: 'isChange',
        reenter: true,
      },
      BE_FUNDER: {
        target: '.actors.funder',
        guard: 'isChange',
        reenter: true,
      },
      BE_SUPER_QA: {
        target: '.actors.superQa',
        guard: 'isChange',
        reenter: true,
      },
      NEXT: {
        target: '.stack',
        guard: 'isNotLast',
        actions: {
          type: 'next',
          params: {},
        },
        reenter: false,
      },
      PREV: {
        target: '.stack',
        guard: 'isNotFirst',
        actions: {
          type: 'prev',
          params: {},
        },
        reenter: false,
      },
    },
  },
  options
)
