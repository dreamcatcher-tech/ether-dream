import { createMachine, assign } from 'xstate'

// use https://stately.ai/viz to visualize the machine
const DISPUTE_WINDOW_TICKS = 1
const DEFUND_WINDOW_TICKS = 2
const getChange = ({ changes, selectedChange }) => {
  if (changes.length === 0) {
    return {}
  }
  return changes[selectedChange]
}
function isTime(ticks) {
  return function time({ time }) {
    return time > ticks
  }
}
const make = (params = {}) => {
  const base = {
    type: '',
    uplink: undefined,
    downlinks: [],
    qaResolved: false,
    qaRejected: false,
    enacted: false,
    disputed: false,
    qaTickStart: undefined,
  }
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
    changes: (context) => {
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
const is = (params) => (context) => isDirect(context, params)
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

export const config = {
  guards: {
    isChange: (context) => !!getChange(context).type,
    isNotLast: (context) => context.selectedChange < context.changes.length - 1,
    isNotFirst: (context) => context.selectedChange > 0,
    isHeader: (context) => getChange(context).type === 'HEADER',
    isPacket: (context) => getChange(context).type === 'PACKET',
    isPacketResolved: (context) => {
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
    isNotPacket: (context) => !config.guards.isPacket(context),
    isSolution: (context) => getChange(context).type === 'SOLUTION',
    isDispute: (context) => getChange(context).type === 'DISPUTE',
    isEdit: (context) => getChange(context).type === 'EDIT',
    isMerge: (context) => getChange(context).type === 'MERGE',
    isEditable: (context) => {
      const change = getChange(context)
      if (!change.type) {
        return false
      }
      return change.type !== 'PACKET' && change.type !== 'EDIT'
    },
    isEmpty: (context) => {
      // const change = getChange(context)
      // if (!change.type) {
      //   return true
      // }
      return true
      // check if any asset is in the change at all
    },
    isNotEmpty: (context) => !config.guards.isEmpty(context),
    isFunded: (context) => {
      return false
    },
    isTime0: isTime(0),
    isTime1: isTime(1),
    isTime2: isTime(2),
    isTime3: isTime(3),
    isTime4: isTime(4),
    isTime5: isTime(5),
    isQaResolved: (context) => getChange(context).qaResolved,
    isQaRejected: (context) => getChange(context).qaRejected,
    isQaApplied: (context) =>
      getChange(context).qaResolved || getChange(context).qaRejected,
    isEnacted: (context) => getChange(context).enacted,
    isEnactable: (context) => {
      // if no disputes, enough time has passed, then enact
      const change = getChange(context)
      if (!config.guards.isQaApplied(context)) {
        return false
      }
      // get the current time tick, see if enough time passed
      return !change.disputed
    },
    isDisputed: (context) => getChange(context).disputed,
    isSuperable: (context) => {
      const change = getChange(context)
      if (!config.guards.isDisputed(context)) {
        return false
      }
      // get the current time tick, see if enough time passed

      return true
    },
    isSharesUpholdable: (context) => {
      const change = getChange(context)
      if (!config.guards.isSuperable(context)) {
        return false
      }
      // check if this is a dispute for shares
      return true
    },
    isDisputeUpheld: (context) => !config.guards.isSharesUpholdable(context),
    isResolveable: is({ qaResolved: false, qaRejected: false }),
    isDisputeable: (context) =>
      config.guards.isQaApplied(context) &&
      config.guards.isDisputeWindowOpen(context),
    isDisputeWindowOpen: (context) => {
      const change = getChange(context)
      const { time } = context
      if (!config.guards.isQaApplied(context)) {
        return false
      }
      if (time - change.qaTickStart < DISPUTE_WINDOW_TICKS) {
        return false
      }
      return true
    },
  },
  actions: {
    nextChange: assign({
      selectedChange: ({ selectedChange }) => selectedChange + 1,
    }),
    prevChange: assign({
      selectedChange: ({ selectedChange }) => selectedChange - 1,
    }),
    proposePacket: assign({
      changes: ({ changes }) => [...changes, make({ type: 'HEADER' })],
      selectedChange: (context) => context.changes.length,
    }),
    proposeEdit: assign({
      changes: ({ changes }) => [...changes, make({ type: 'EDIT' })],
      selectedChange: (context) => context.changes.length,
    }),
    proposeSolution: assign({
      changes: ({ changes }) => [...changes, make({ type: 'SOLUTION' })],
      selectedChange: (context) => context.changes.length,
    }),
    tick: assign({
      time: (context) => {
        return context.time + 1
      },
    }),
    qaReject: set({ qaRejected: true }),
    qaResolve: set({ qaResolved: true }),
    qaStartDisputeWindow: assign({
      changes: (context) => {
        const change = getChange(context)
        const next = setDirect(change, { qaTickStart: context.time })
        const changes = [...context.changes]
        changes[context.selectedChange] = next
        return changes
      },
    }),
    dispute: set({ disputed: true }),
    disputeShares: (context) =>
      assign({
        changes: ({ changes }) => [...changes, make({ type: 'DISPUTE' })],
        selectedChange: (context) => context.changes.length,
      }),
    disputeResolve: (context) =>
      assign({
        changes: ({ changes }) => [...changes, make({ type: 'DISPUTE' })],
        selectedChange: (context) => context.changes.length,
      }),
    disputeReject: (context) =>
      assign({
        changes: ({ changes }) => [...changes, make({ type: 'DISPUTE' })],
        selectedChange: (context) => context.changes.length,
      }),
  },
}

export const multiMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFsCuAbALgSwMQBUBJAWQFEB9ABQBkBVAZXIBFD7Lb8KB1QgOSYDyXANoAGALqJQABwD2sbDlkA7KSAAeiACyiA7ADoAHACZRAZgCsANl0BGC-YsWANCACeiW8YC+312ixsfQBDAGNQ2VRlTFwAIQoAMVp+UgAlMUkkEDkFJVUszQRdXVcPBC0dfQtRGtFDKwstYwszXQtffwwcEPDI6LiKegFqADU0jLUcxWwVNULi0sRTKyra0StbQy1bHVsOkADusIiomPjyAEUAQQmsqby5xAX3bQBOV-010VfdQ3NjYxmfaHILHPpnQa0SjjCSTeTTWYFJ4lF4IJwGaq1Yy6Kw-LSvPZ+A5dUG9U4DKipASUAT0GGZGTwh5IooosrGBqfNYWbFWURaQy2XTAkk9E79c74VJXJj0uG5Gb5UDzNmIMyA1a1Kw6Yy2Ww2EWBMXgilXXgATQEvFIt0ZCsRyuRiwQZhMXNqbWMgsMPMN3VCAAtgsoYLBcJQqTS6eQABKkGVyu5MxWPVnO+z4-Q6Kzqsy4mzVLR+oKB4Oh3DWgAa+Ft2WTDo0TtROx5+leLWaPJxdi9xf0pZDcHDqVII1r9xTLOeZVslhWmK8QpzjVnfYHof7KkwACdZOhYPpsMppsF0Lhx-WlY2EFY+UYTIZXdYcY0zOnGhZ9LoObozForKYhi6Hoa5BoOB4RNEu77oex44Ke562Aydb2lehTaqI95ek+NgNFob7NsUmE-DY2KiBY9RmF4oFlnAm5QXuB5HieZ7CMYyETg26F3oYD44S++Hpq0hhtjiuIVIYrzqoYNHgfRO6MbBLHnmYHGXqmOaYbx2E+rhr7piYHxaN2eoEjs+rtESIL9mBG6QQpMHMfBrFaGpqEaaYWGPrpAkETOvEGCR+Y4k0ohCrJdlbtBTFwdgCHCBYbkImhiANFpfE+XhfmeD2Wbdt8DSvNi7YRXRwTSNIu4AG6nvoABWqDQEeUC4COQyjDasJJu5LIAisXzkcBWzvIYzq-AYazbJiWjWISnRGuuZUVdVtUNU1IataQABSpAAMI1l1drJamfXurUFhDfiryjaij4YudvEjXUpUHgAZlEEDNbgST8BePWOggth6OmvxmEYFivDN2I6Q4vhEsosgQHAaggvKx0sgAtK0zpUZqNR6hy6w+hyfZgqcaPMgDxivOmtgfGseq6ASuj-uYpNktE+iVbIORgNuFOTlT-5tjs6x1PyM0OM6HKfpiNRdnyArhVZopk5z73KEj-PdejQsrAS2bixUTi2M6FS2GddR4c0rSWfNRwc5g+iwHuVV8wLXFLMLBti38xtS6ipgTWsJibGY8tFirRpq07ACOwQeylCDGN7ot8n7kum6iV1498vz-IC7Pik7sCoNIfPx4nJ2p4bGcm86TgiQz3zrGYrzPVHDvF-oO7BFrVe9TXvsS-XqLqlolsYbq+rCp3pLd8GbgqGAA96yLtcjwHZSusYueet6vpzzZtHwDrlPXnqzobLvaymPqBJhT4R+LRBUWMav14zWD2mh9+liAVYdMXoPjflvCzawFQpIvXktFJSzkP6FGqBbH+uo-48itkJduolbyvD5FJX8+FoH2VgQGMAfd3Zn0FteJmIk8x-2aGFbUXh0zbAMKA4CHJqY8hJs-WydFiGKVIeQ7c+geZgCvJxJOWwVh0MBAw-U2xjDvhzF+DkuJBTGWuofe2JY+GvwYjBIRWt9AayRhABBiBpH6FkeqJBTClHNgArvPqVhHweg4UQt+hiyHGPLprZqFiEBWJsfI+x75yL6D6nYdU7ZTCiCfjo4+ckBEwWkGEAA1mATAgSTCfiZq4pmv4-x5xBriSJP4hRM0hr+GSvCT4wMUi7dAqBz6SNTD6MG7YqJMwunqNugDmytAMC44m4chTkU8QYg8n1YDSBaSvShnsgmeS6TPAEThcEGWxKomw8SGjrN4pMhyB5ICKECb8ESBTGhhTChdbYBl6jlNvEBaohZI6JJfg0mCyA+YwByWYMGgIKhAtsXmEGQMdm-mpv+Vxhy6lyXKtzGq6BAkQyvu8PG4dHzGV+FYaBiKVroHqo1KAATFlJyBqqIJuMKJ-j1OYAqEz4UbgJbIZFXNxGfRDIE0y6Zvg3w9ABd4+p8XLTZbVPxXKoAhDFW7cx5LUwz1pkzPG9RcECltqKpFErOXNX0NuMAdUwChEwJAHlNggGundEDfCTDJIJOJAtPRJiPpkqOufRBNNHGtHBpDC6ph3gAiBMyuipi9VgGQNITAZR3VUMKLOEBxQAVhR0O8bUVKhTNGsRDf840NnvGgWGkMLrNZmoVb1XBVRGg2B7NfHMAyZy-AnpYP10NvKwzhkAA */

    id: 'The Dreamcatcher',
    type: 'parallel',

    context: {
      selectedChange: undefined,
      changes: [],
      time: 0,
    },
    states: {
      time: {
        on: {
          TIME_PLUS_DISPUTE_WINDOW: { target: '.tick0', actions: 'tick' },
        },
        initial: 'tick0',
        states: {
          tick0: { always: { target: 'tick1', cond: 'isTime0' } },
          tick1: { always: { target: 'tick2', cond: 'isTime1' } },
          tick2: { always: { target: 'tick3', cond: 'isTime2' } },
          // tick3: { always: { target: 'tick4', cond: 'isTime3' } },
          // tick4: { always: { target: 'tick5', cond: 'isTime4' } },
          // tick5: { always: { target: 'tick6', cond: 'isTime5' } },
          tick3: { type: 'final' },
        },
      },
      accounts: {
        type: 'parallel',
        states: {
          actions: {
            description: 'The actions applied to the selected account',
            initial: 'idle',
            on: {
              EXIT: { target: '.exits' },
              EXIT_SINGLE: { target: '.exits' },
              BURN: { target: '.exits' },

              APPROVE_OPENSEA: '.approvals',
              REVOKE_OPENSEA: '.approvals',
              APPROVE_OPERATOR: '.approvals',
              REVOKE_OPERATOR: '.approvals',
            },
            states: {
              idle: {},
              exits: {
                description: 'everything to do with exiting from the account',
                always: 'idle',
              },
              approvals: {
                description:
                  'Approve operators to trade on behalf of the account',
                always: 'idle',
              },
            },
          },
          selected: {
            description: 'The selected account that actions will be applied to',
            initial: 'proposer',
            on: {
              BE_PROPOSER: '.proposer',
              BE_FUNDER: '.funder',
              BE_SOLVER: '.solver',
              BE_QA: '.qa',
              BE_SUPERQA: '.superqa',
              BE_TRADER: '.trader',
              BE_EDITOR: '.editor',
              BE_DISPUTER: '.disputer',
            },
            states: {
              proposer: {
                on: {
                  PROPOSE_PACKET: {
                    target: '#loadChange',
                    actions: 'proposePacket',
                  },
                },
              },
              funder: {
                on: {
                  FUND: { target: '#funding' },
                  DEFUND_START: { target: '#funding' },
                  DEFUND_STOP: { target: '#funding' },
                  DEFUND: { target: '#funding' },
                },
              },
              solver: {
                on: {
                  PROPOSE_SOLUTION: {
                    target: '#loadChange',
                    actions: 'proposeSolution',
                    cond: 'isPacket',
                  },
                },
              },
              qa: {
                on: {
                  QA_RESOLVE: {
                    target: '#quality',
                    cond: 'isResolveable',
                    actions: ['qaDisputeWindowStart', 'qaResolve'],
                  },
                  QA_REJECT: {
                    target: '#quality',
                    cond: 'isResolveable',
                    actions: ['qaDisputeWindowStart', 'qaReject'],
                  },
                  ENACT: {
                    target: '#quality',
                    cond: 'isEnactable',
                    actions: 'enact',
                  },
                },
              },
              superqa: {
                on: {
                  QA_DISPUTES_DISMISSED: {
                    target: '#quality',
                    cond: 'isSuperable',
                  },
                  QA_DISPUTE_UPHELD: {
                    target: '#quality',
                    cond: 'isSuperable',
                  },
                },
              },
              trader: {
                on: {
                  TRADE_CONTENT: {
                    target: '#contentTrading',
                    cond: 'isEnacted',
                  },
                  TRADE_FUNDING: { target: '#fundTrading' },
                  TRADE_QA_MEDALLION: { target: '#qaMedallionTrading' },
                },
              },
              editor: {
                on: {
                  PROPOSE_EDIT: {
                    target: '#loadChange',
                    cond: 'isEditable',
                    actions: 'proposeEdit',
                  },
                },
              },
              disputer: {
                on: {
                  DISPUTE_RESOLVE: {
                    target: '#loadChange',
                    actions: ['dispute', 'disputeResolve'],
                    cond: 'isDisputeable',
                  },
                  DISPUTE_SHARES: {
                    target: '#loadChange',
                    actions: ['dispute', 'disputeShares'],
                    cond: 'isDisputeable',
                  },
                  DISPUTE_REJECT: {
                    target: '#loadChange',
                    actions: ['dispute', 'disputeReject'],
                    cond: 'isDisputeable',
                  },
                },
              },
            },
          },
        },
      },
      changes: {
        description: `The stack of all changes can be navigated using the NEXT and PREV events.`,
        initial: 'loadChange',
        on: {
          NEXT: {
            target: '.loadChange',
            cond: 'isNotLast',
            actions: 'nextChange',
          },
          PREV: {
            target: '.loadChange',
            cond: 'isNotFirst',
            actions: 'prevChange',
          },
        },
        states: {
          loadChange: {
            id: 'loadChange',
            always: { target: '#quality', cond: 'isChange' },
          },
          actions: {
            id: 'actions',
            initial: 'quality',
            states: {
              assets: {
                states: {
                  funding: {
                    id: 'funding',
                    description: 'Funding of the change',
                  },
                  fundTrading: {
                    id: 'fundTrading',
                    description: 'Trading of the funding shares of the change',
                  },
                  contentTrading: {
                    id: 'contentTrading',
                    description: 'Trading of the content shares of the change',
                  },
                  qaMedallionTrading: {
                    id: 'qaMedallionTrading',
                    description:
                      'Trading of the QA medallion of the resolved packet',
                  },
                },
              },
              quality: {
                initial: 'idle',
                states: {
                  idle: {
                    id: 'quality',
                    always: [{ target: 'judging', cond: 'isNotPacket' }],
                  },
                  judging: {
                    always: [
                      { target: 'pending.resolved', cond: 'isQaResolved' },
                      { target: 'pending.rejected', cond: 'isQaRejected' },
                      { target: 'pending.disputed', cond: 'isDisputed' },
                    ],
                  },
                  pending: {
                    always: { target: '#contentTrading', cond: 'isEnacted' },
                    states: {
                      resolved: {},
                      rejected: {},
                      disputed: {},
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  config
)
