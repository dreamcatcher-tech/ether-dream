import { createMachine, assign } from 'xstate'

// use https://stately.ai/viz to visualize the machine

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

export const config = {
  guards: {
    isProposer: (context, event, meta) =>
      meta.state.matches('accounts.selected.proposer') ||
      meta.state.matches('accounts.selected.anyone'),
    isNotLast: (context) => context.selectedChange < context.changes.length - 1,
    isNotFirst: (context) => context.selectedChange > 0,
    isHeader: (context) => getChange(context).type === 'HEADER',
    isPacket: (context) => getChange(context).type === 'PACKET',
    isSolution: (context) => getChange(context).type === 'SOLUTION',
    isDispute: (context) => getChange(context).type === 'DISPUTE',
    isEdit: (context) => getChange(context).type === 'EDIT',
    isMerge: (context) => getChange(context).type === 'MERGE',
    isQa: (context, event, meta) => meta.state.matches('accounts.selected.qa'),
    isFunder: (context, event, meta) =>
      meta.state.matches('accounts.selected.funder') ||
      meta.state.matches('accounts.selected.anyone'),
    isTrader: (context, event, meta) =>
      meta.state.matches('accounts.selected.trader') ||
      meta.state.matches('accounts.selected.anyone'),
    isEditable: (context, event, meta) => {
      const isAnyone = meta.state.matches('accounts.selected.anyone')
      const isEditor = meta.state.matches('accounts.selected.editor')
      if (!isAnyone && !isEditor) {
        return false
      }
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
  },
  actions: {
    proposePacket: assign({
      changes: (context) => {
        return [...context.changes, { type: 'HEADER' }]
      },
      selectedChange: (context) => {
        return context.changes.length
      },
    }),
    nextChange: assign({
      selectedChange: ({ selectedChange }) => selectedChange + 1,
    }),
    prevChange: assign({
      selectedChange: ({ selectedChange }) => selectedChange - 1,
    }),
    proposeEdit: assign({
      changes: (context) => {
        return [...context.changes, { type: 'EDIT' }]
      },
      selectedChange: (context) => {
        return context.changes.length
      },
    }),
    tick: assign({
      time: (context) => {
        return context.time + 1
      },
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
          tick3: { always: { target: 'tick4', cond: 'isTime3' } },
          tick4: { always: { target: 'tick5', cond: 'isTime4' } },
          tick5: { always: { target: 'tick6', cond: 'isTime5' } },
          tick6: { type: 'final' },
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
              BE_ANYONE: '.anyone',
              BE_EDITOR: '.editor',
              BE_OPENSEA: '.opensea',
              BE_OPERATOR: '.operator',
            },
            states: {
              proposer: {},
              funder: {},
              solver: {},
              qa: {},
              superqa: {},
              trader: {},
              anyone: {},
              editor: {},
              opensea: {},
              operator: {},
            },
          },
        },
      },
      changes: {
        description: `The stack of all changes can be navigated using the NEXT and PREV events.`,
        on: {
          PROPOSE_PACKET: {
            target: '.loadFromStack',
            actions: 'proposePacket',
            cond: 'isProposer',
          },
          NEXT: {
            target: '.loadFromStack',
            cond: 'isNotLast',
            actions: 'nextChange',
          },
          PREV: {
            target: '.loadFromStack',
            cond: 'isNotFirst',
            actions: 'prevChange',
          },
          PROPOSE_EDIT: {
            target: '.loadFromStack',
            cond: 'isEditable',
            actions: 'proposeEdit',
          },
        },
        states: {
          loadFromStack: {
            always: {
              target: ['selected.controls.load', 'selected.funding.load'],
            },
          },
          selected: {
            type: 'parallel',
            states: {
              controls: {
                states: {
                  load: {
                    always: [
                      { target: 'header', cond: 'isHeader' },
                      { target: 'packet', cond: 'isPacket' },
                      { target: 'solution', cond: 'isSolution' },
                      { target: 'dispute', cond: 'isDispute' },
                      { target: 'edit', cond: 'isEdit' },
                      { target: 'merge', cond: 'isMerge' },
                    ],
                  },
                  header: {},
                  packet: {},
                  solution: {},
                  dispute: {},
                  edit: {},
                  merge: {},
                },
              },
              quality: {
                initial: 'judging',
                states: {
                  judging: {
                    on: {
                      RESOLVE: { target: 'pending.approved', cond: 'isQa' },
                      REJECT: { target: 'pending.rejected', cond: 'isQa' },
                    },
                  },
                  pending: {
                    states: {
                      approved: {
                        on: {
                          ENACT: { cond: 'isDisputeWindowClosed' },
                        },
                      },
                      rejected: {},
                    },
                  },
                },
              },
              funding: {
                description: 'Funding of the change',
                initial: 'empty',
                on: {
                  FUND: { target: '.funded', cond: 'isFunder' },
                  DEFUND_START: { target: '.funded', cond: 'isFunder' },
                  DEFUND_STOP: { target: '.funded', cond: 'isFunder' },
                  DEFUND: { target: '.empty', cond: 'isFunder' },
                },
                states: {
                  load: {
                    // always: [
                    //   { target: 'empty', cond: 'isHeader' },
                    //   { target: 'funded', cond: 'isEdit' },
                    // ],
                  },
                  empty: {},
                  funded: {},
                },
              },
              fundTrading: {
                description: 'Trading of the funding shares of the change',
                initial: 'untraded',
                on: {
                  TRADE: { target: '.traded', cond: 'isTrader' },
                  TRADE_ALL: { target: '.traded', cond: 'isTrader' },
                },
                states: {
                  untraded: {},
                  traded: {},
                },
              },
              contentTrading: {
                description: 'Trading of the content shares of the change',
                initial: 'untraded',
                on: {
                  TRADE: { target: '.traded', cond: 'isTrader' },
                  TRADE_ALL: { target: '.traded', cond: 'isTrader' },
                },
                states: {
                  untraded: {},
                  traded: {},
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
