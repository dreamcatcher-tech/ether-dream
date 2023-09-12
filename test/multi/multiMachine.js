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
const not = (params) => (context) => !isDirect(context, params)
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
    isPacket: is({ type: 'PACKET' }),
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
    isEdit: is({ type: 'EDIT' }),
    isMerge: (context) => getChange(context).type === 'MERGE',
    isEditable: (context) =>
      config.guards.isChange(context) &&
      !config.guards.isPacket(context) &&
      !config.guards.isEdit(context),
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
    isExitable: (context) => {
      // get the current balance of the account, see if we can exit anything
      return false
    },
    isNotOpen: not({ qaResolved: false, qaRejected: false }),
    isFundableEth: (context, event) => false,

    isFundableDai: (context, event) => false,

    isFundable1155: (context, event) => false,

    isFundable721: (context, event) => false,

    isDefunding: (context, event) => false,

    isNotDefundStopLoop: (context, event) => false,

    isDefundWindowPassed: (context, event) => false,

    isDefundWaiting: (context, event) => false,

    isDefundedOnce: (context, event) => false,
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
    /** @xstate-layout N4IgpgJg5mDOIC5QBUAWYAEARATmAhgLYDG+ALsejgHSX4B2MsAxAIoCCA2gAwC6ioAA4B7WAEsyY4fQEgAHogCcAdgA0IAJ6IAjAFYAbN2q6AzNoBMugL5X1aTLgIlylMDTqM4zAGIBVAHJYAKIASjz8SCAi4pLSsgoIKupaiYr61AAcyta2IPbYeESkFFS0qAxMzMgh7MFhfLLRElIykQlJmjoZuhnU+lk5dugFTsWu7uWesNRkOPgQYozUAGYArvQQsMhzC0vraxuQzOGNos1xbYgmGQAs2tSKJso3iuZP3Ia6usmIyoo31Asgzyw0cRRcpQ8TBmO0WUBW60223mcIRhwgVRqwQA+uwADJ4k6RJqxVqgBI3czmIzmZQmSmKLIfbhfH4IDIWPqWGxDByFZwlNxlCpwGEopYHJGwiWIo7VWpBbEAZQA8gBZIJEoRnUnxRCU6nUWn08yM5TM1mdBDKfTmQHc3L5MEC8bCqZi3bwyVbaVe2UYrVRHUtPUIA00ukMpmfb5W5TadJAnkgvmjCFCqGi2bi+HEaRkMD0MjIz3UdaF-DEAsBhrE4MXclXDImRSAxSmbg3aMs2MpbQsoy24FO-ljSGTaHZ0t5ouF4u+j0EABGABswJiFbiCYGSSHLmHacpjN1XmaLb2dB9W0nHaDR+mJiLplPUTOC0WS6ip8u1xucaqNR3esyXkfVD2PXRT27S0+24bReiHZMRzTQVH3dF8ljfOdPyWb98FXdcgJiPdGwPZQjx6SDTWgi9EmUO1ENvVNwVQt1oWEQRC2OWttWIhtQIQMxzHuG5+meN5zRjNkTBk4wkLvFDXUzaYOK4zhtAiXjzhAhITHA7QuyjSSezZbpdEybJ5OYl1xyfahVPoNFPR8AIsGxIJkAACSI7TQwseMHg+Sw2UUOCuWHBSWKUidRQcpy4RcwJsSwdgAEkfN1fd-PuUKhxC3Q7RvXkRii2z3TiyUEr8JLtD0XQMpIgTssCvKrX7bgGIdYrnTHDMYpUzjHMqxhErc+jtAa-iEma3LgralkTHtCLrN6tD2MG+K9nobx-W4zSgz4nSdFMAFhO4R5sjZWq6Qs5aSpsvq7IqxFUUlSBqHoYQyCwMBhqgZhgmqtylWQdgQmQSajoQbRQoBDk5tg55qHou6eofNjYo2v6nPez7vt+l6RshvzYcyIErqBI0upTe7VoxgbC02v10WoCACY2BLAdc5VkBVAAFYmstJ+HaP7cxTup5DSse8qscJ5m2YgVn2ecrnAkF0jzH0XQARuILRb0+5GO6+9WOU+y5Y5mUWbZv6qlSgBhABpbFkFSwCeIO3z9ypG44cu+aXluqzafR83nqthX3tt+W9tOQ7Q0sbIjW11qUkUdtqE7BN9FzvO85DtGzf6i3GYAR3wOO6wTn2M-M65zBFq6DDtZQRcL03oqejaK+oAArVZoASjhsRCIJVTxAA1TVPd3KadDSe5tHjAYrq7I3Jcih61sx8v8H7weoGH9hR6CAApIIHYh2fgJJ-Ql5XgO+0+LOhNRzuyuhQbnI1gTm16Nu5MrTCXfopT+opv6ojwLAYQK4ABuRxf4JF0P2Yw3BAEI0QAVO0m8VphxLpApYeA+5gCrIgm+NdSJ6DUFaDIpojSgOljvaYhD4QLFgIIVY1Y2AnywKlJUfNfDIHHslfhap+FKiCFgJBiB-7IybnGZORUaZFy7u6VhrMxAcK4UcEeSpPJgxEb4Pmnkgh4mkRQ72pE5EYNonQ8yxsVEfxll-QspZ2GcO4SPYxpjzEyPZNceRQCUhZETA6XIn02bwEiFLbe8crFNTZAAWnFh3MBLi4DxMyqRF4bJ9CLUYdvemHo4RZMarpSk6QgovAkueNkOsl64NDsXOyGEFY+hzGU+egkdaLUMiYfQdJjIwUQLaBCTTVHgOfAub0OF4T7H9F0qGJhIIiVuAMoZdTFFGGUbEum5s2lOQ6aWN6EAlmhhbG3YwbwjJbJSORHZEznHMJKdbKUOZFxnOrgkik1xegZFysvd4Uk4z32oE8Qp+yS6HKwh+X05z9z0iRtU14wKTK0O6EtNJTDikwvzNhBc5Z6CVmrAi0iKyqRZ1tDUtFIzoYdXSI4vZ+DWkLlhfOD5eECJkoEpc1ss1KS0tFgy8K2KikHLZfiuFnKdiQB5RSG4PRwUWBpcM4Vy9g5MWaWo9ahZ5U6GXuZWatF+iFSeekl5cU4FiDAAAd1Kd87JvKLC9AMrcaiarm5gu4G-MVULu6Mz+vq6GVJFrGrZDaVsTKt7+tloG+WZZtqLMdeUnQes7SQQhRTTO7ZmwyXzQWv1LK41DQTac4NCZGSAjgi3WioUKJ3Hzk2-QRaWklqZjjJWeMfpBpTd05eolq16DTpeeiyNzU4vDpbE5-pla9q0k6hINyjUZDod0D4okVAmApgMzVJsLXFIjjOm20gwDBtpNrcFa7gmXnQcjRQOdm251bTq3ejkK4Vr+ACZe8En46BbN+id4qS5xV7gPIejAK3usBI-UWBUAQZxuH8R9edlAvqmaXd9+9iGkNJX2qGobzLXV-aLfQetkb0ghehjJDMsPUGgbAhBXyF2poQIRwEP7V5tRQUePS7ctWTJo9QVhFbzpshuDJajLyNEMfgXK-DFyH1oNsfUw0kLi2uMjvRsAJCyHMa9ou0ZOsgmYIQAVIw6m22afcVozx8mWPdMbrrdZf7rQmAs1J4pGiPE6KVg5JUqxOI4GDTJKN7Y36mXgp5823nbO+eoLAQLbglRgDIGQNc+m57LL0tQfprnQlyQE88rzbjUQVirPhNcIW7hZ10OghRKRdB-BsDYIAA */
    id: 'The Dreamcatcher',
    type: 'parallel',

    context: {
      selectedChange: undefined,
      changes: [],
      time: 0,
    },
    states: {
      // time: {
      //   on: {
      //     TIME_PLUS_DISPUTE_WINDOW: { target: '.tick0', actions: 'tick' },
      //   },
      //   initial: 'tick0',
      //   states: {
      //     tick0: { always: { target: 'tick1', cond: 'isTime0' } },
      //     tick1: { always: { target: 'tick2', cond: 'isTime1' } },
      //     tick2: { always: { target: 'tick3', cond: 'isTime2' } },
      //     // tick3: { always: { target: 'tick4', cond: 'isTime3' } },
      //     // tick4: { always: { target: 'tick5', cond: 'isTime4' } },
      //     // tick5: { always: { target: 'tick6', cond: 'isTime5' } },
      //     tick3: { type: 'final' },
      //   },
      // },
      // accounts: {
      //   type: 'parallel',
      //   states: {
      //     actions: {
      //       description: 'The actions applied to the selected account',
      //       initial: 'idle',
      //       on: {
      //         MANAGE_EXITS: { target: '.exits', cond: 'isExitable' },
      //         MANAGE_APPROVALS: { target: '.approvals' },
      //       },
      //       states: {
      //         idle: {},
      //         exits: {
      //           description: 'everything to do with exiting from the account',
      //           on: {
      //             EXIT: { target: 'idle' },
      //             EXIT_SINGLE: { target: 'idle' },
      //             BURN: { target: 'idle' },
      //           },
      //         },
      //         approvals: {
      //           description:
      //             'Approve operators to trade on behalf of the account',
      //           on: {
      //             APPROVE_OPENSEA: 'idle',
      //             REVOKE_OPENSEA: 'idle',
      //             APPROVE_OPERATOR: 'idle',
      //             REVOKE_OPERATOR: 'idle',
      //           },
      //         },
      //       },
      //     },
      //     selected: {
      //       description: 'The selected account that actions will be applied to',
      //       initial: 'proposer',
      //       on: {
      //         BE_PROPOSER: { target: '.proposer' },
      //         BE_FUNDER: { target: '.funder', cond: 'isChange' },
      //         BE_SOLVER: { target: '.solver', cond: 'isChange' },
      //         BE_QA: { target: '.qa', cond: 'isChange' },
      //         BE_SUPERQA: { target: '.superqa', cond: 'isChange' },
      //         BE_TRADER: { target: '.trader', cond: 'isChange' },
      //         BE_EDITOR: { target: '.editor', cond: 'isEditable' },
      //         BE_DISPUTER: { target: '.disputer', cond: 'isChange' },
      //         BE_SERVICE_WORKER: { target: '.serviceWorker', cond: 'isChange' },
      //       },
      //       states: {
      //         proposer: {
      //           on: {
      //             PROPOSE_PACKET: {
      //               target: '#quality',
      //               actions: 'proposePacket',
      //             },
      //           },
      //         },
      //         funder: {
      //           on: {
      //             MANAGE_FUNDING: { target: '#funding' },
      //           },
      //         },
      //         solver: {
      //           on: {
      //             PROPOSE_SOLUTION: {
      //               target: '#quality',
      //               actions: 'proposeSolution',
      //               cond: 'isPacket',
      //             },
      //           },
      //         },
      //         qa: {
      //           on: {
      //             MANAGE_QA: { target: '#qa' },
      //           },
      //         },
      //         superqa: {
      //           on: {
      //             MANAGE_SUPER_QA: { target: '#super' },
      //           },
      //         },
      //         trader: {
      //           on: {
      //             MANAGE_TRADING: { target: '#trading' },
      //           },
      //         },
      //         editor: {
      //           on: {
      //             PROPOSE_EDIT: {
      //               target: '#quality',
      //               actions: 'proposeEdit',
      //             },
      //           },
      //         },
      //         disputer: {
      //           on: {
      //             MANAGE_DISPUTES: { target: '#disputes' },
      //           },
      //         },
      //         serviceWorker: {
      //           on: {
      //             ENACT: {
      //               target: '#quality',
      //               cond: 'isEnactable',
      //               actions: 'enact',
      //             },
      //           },
      //         },
      //       },
      //     },
      //   },
      // },
      changes: {
        description: `The stack of all changes can be navigated using the NEXT and PREV events.`,
        initial: 'open',
        on: {
          // NEXT: {
          //   target: '#quality',
          //   cond: 'isNotLast',
          //   actions: 'nextChange',
          // },
          // PREV: {
          //   target: '#quality',
          //   cond: 'isNotFirst',
          //   actions: 'prevChange',
          // },
          QA: '#qa',
          FUNDER: { target: '#funding' },
          TRADER: { target: '#trading' },
        },
        states: {
          trading: {
            id: 'trading',
            type: 'parallel',
            on: {
              // TRADE_CONTENT: {
              //   target: '#contentTrading',
              //   cond: 'isEnacted',
              // },
              // TRADE_FUNDING: { target: '#fundTrading' },
              // TRADE_QA_MEDALLION: { target: '#qaMedallionTrading' },
            },
            states: {
              fundsTrading: {
                initial: 'unfunded',
                states: {
                  unfunded: {
                    description: `No funding is available for trading`,
                    always: { target: 'funded', cond: 'isFunded' },
                  },

                  funded: {
                    description: `Funding is available for trading`,
                    always: { target: 'traded', cond: 'isFundsTraded' },
                    on: {
                      TRADE_ALL: 'traded',
                      TRADE_SOME: 'traded',
                    },
                  },

                  traded: {
                    type: 'final',
                  },
                },
              },
              contentTrading: {
                states: {
                  unenacted: {
                    description: `Nothing to trade until the change is resolved`,

                    always: {
                      target: 'tradeable',
                      cond: 'isEnacted',
                    },
                  },

                  tradeable: {
                    on: {
                      TRADE_ALL: 'traded',
                      TRADE_SOME: 'traded',
                    },

                    always: {
                      target: 'traded',
                      cond: 'isContentTraded',
                    },

                    description: `Content Shares are available for trading`,
                  },

                  traded: {
                    type: 'final',
                  },
                },

                initial: 'unenacted',
              },
            },
          },
          open: {
            id: 'quality',
            initial: 'viewing',
            always: [
              { target: '#pending', cond: 'isPending' },
              { target: '#trading', cond: 'isPacket' },
            ],
            states: {
              viewing: {
                // show what type of change this is
                // hold the focus of the statechart
                // always: { target: 'qa', cond: 'isQaActed'}
              },

              funding: {
                id: 'funding',
                description: 'Manage the funding of the change',
                initial: 'unFunded',
                states: {
                  unFunded: {
                    always: {
                      target: 'funded',
                      cond: 'isFunded',
                      description: '(state restoration)',
                    },
                  },
                  funded: {
                    initial: 'notDefunding',
                    states: {
                      notDefunding: {
                        always: {
                          target: 'defunding',
                          cond: 'isDefunding',
                          description: '(state restoration)',
                        },
                        on: {
                          DEFUND_START: {
                            target: 'defunding',
                          },
                        },
                      },
                      defunding: {
                        always: {
                          target: 'done',
                          cond: 'isDefundedOnce',
                          description: 'Prevent infinite loops',
                        },
                        on: {
                          DEFUND_STOP: {
                            target: 'notDefunding',
                            cond: 'isNotDefundStopLoop',
                          },
                          DEFUND: {
                            target: '#funding.unFunded',
                            cond: 'isDefundWindowPassed',
                          },
                          TICK_TIME: {
                            cond: 'isDefundWaiting',
                            description:
                              'Move time forwards so defunding is possible',
                            internal: true,
                          },
                        },
                      },
                      done: {
                        type: 'final',
                      },
                    },
                  },
                },
                on: {
                  FUND_ETH: {
                    target: '.funded',
                    cond: 'isFundableEth',
                    internal: true,
                  },
                  FUND_DAI: {
                    target: '.funded',
                    cond: 'isFundableDai',
                    internal: true,
                  },
                  FUND_1155: {
                    target: '.funded',
                    cond: 'isFundable1155',
                    internal: true,
                  },
                  FUND_721: {
                    target: '.funded',
                    cond: 'isFundable721',
                    internal: true,
                  },
                },
              },

              qa: {
                id: 'qa',
                always: { target: 'viewing', cond: 'isPacket' },
                states: {
                  judging: {
                    on: {
                      QA_RESOLVE: {
                        target: 'resolved',
                        cond: 'isResolveable',
                        actions: ['qaDisputeWindowStart', 'qaResolve'],
                      },
                      QA_REJECT: {
                        target: 'rejected',
                        cond: 'isResolveable',
                        actions: ['qaDisputeWindowStart', 'qaReject'],
                      },
                    },
                  },
                  rejected: { type: 'final' },
                  resolved: { type: 'final' },
                },

                initial: 'judging',
              },
            },
          },
          pending: {
            id: 'pending',
            initial: 'resolved',

            states: {
              resolved: {
                always: { target: 'rejected', cond: 'isRejected' },
              },
              rejected: {
                always: { target: 'disputed', cond: 'isDisputed' },
              },
              disputed: {
                id: 'super',
                on: {
                  QA_DISPUTES_DISMISSED: {
                    target: '#quality',
                    cond: 'isSuperable',
                  },
                  QA_SHARES_UPHELD: {
                    target: '#quality',
                    cond: 'isShareDispute',
                  },
                  QA_UPHELD: {
                    target: '#quality',
                    cond: 'isNotShareDispute',
                  },
                },
                states: {
                  openSuper: {},
                  superSettled: {},
                },
              },
              enactable: {
                // once enacted, can trigger different actions
              },
            },
            always: { target: '#trading', cond: 'isEnacted' },
          },
        },
      },
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  config
)
