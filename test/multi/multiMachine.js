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

    isHeader: (context, event) => false,

    isResolved: (context, event) => false,

    isHeaderOrSolution: (context, event) => false,
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
    qaDisputeWindowStart: (context, event) => {},

    focusUplink: (context, event) => {},

    tickTime: (context, event) => {},

    enact: (context, event) => {},
  },
}

export const multiMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDswA8AuA6AhgYwwEsB7ZWAYgCEBRAfQBUAlAQQBFrGBtABgF1FQAB2KxCRUgJBpEAdgBMAGhABPRAEZuAVgAcWAGwBmA2r1q1Mg-L0AWAL62lqTLgIkyVOgAVGAeU8+AZQ4efiQQYVFxZElpBHklVQQ1ORt9AzkATm1rGQyNA21te0d0bHwoihpaIMYANQBJAGFqEMkIsTcY2UUVdRM1NINuZO45HT0MmWKQJzLXUkq6AJ8AGVrgvjaRDokw2PjepIM9GTS5bQNNG2NtNSKHGdKXCo9aalZ6+h8uTbD2qK6cR6iTUmgsZxkt3Mlzk01mzzci1oHwCngAqvQNqEhNsAXtugl1DluGdtNxsuTLmY4U9yojXgBFZitP64zr4oGEpInPSkmQ6TTmNQ5GnOOkLV4AMTRADl2D9seE2btQPtgeoZLlSdZtKY9IVjqK5i8qgE0Z4OLQmSycZF2aqCYc7to5GcMtZ0hlNNxIQYjQiJTLqAANeg2pV2lVSR2JPRXLDWDJJ-UZMbWUwZf3i9zeai1cP-e3RzmHGTcXlJrLjUFqAzWNRZ+ZkZ7EABOFBDnwLyuiHOOrpd3CGhU0k3d2i5cmG1iwBUyxNuMgbD3h2dgLfb5E79Gq9RlAHEVi1fradr2HQh+1hB8PtKPcjrJ+WZwbyVpJh7Lo2KhvKmjGDK3aRuexZXje5J3mOj6HHIZiaLOLpWOmGiaNYmjfoiv7kIweY+AA0nQfgcMwXwKlswGAmBU63ve46TiY8GFOco6TCckLoSutJNuu5RthQzCeN4PjrLQREykEzInhGZ6UXoA7URBtHQYkciwbyc4yImejaWh5IYQsWECUJIlESwpFATJfZydeCkjlBE4wSkvJMQadywZpUycWK3FYThtT4YRFridQkmKoWUaxFRQ6KfZXJqBkhjXhcWgWKmQ6avpza8e2WCCK2xARGArbkKwPgWXiF4aHIpzGGMExDi6OgyHF1WnEhVx1poX5ecamHZeuABmACuyAQEVJVlVJ4UgbEVU1ckVwZA1YzaM1Tp5OpmgpJkmTJDqmU8QQfFYLAxAADYAG7jaV5VFrNozzXVS1zk1cWWDO5heho6YvQdv5YAAjjgE23RF6gPbOC31S9q1xfqM45HJYKWF6dV-f1J1DYIRUMsDN1TT2gJzZDT3La9ME6iSeijKmXWpvqho9QGWVHTlGCtjgY3FfjYWExyxO1YtZOw4ciFYJpSZjJYmQJejrPrpAYhtiDBMUfzEOC9DjUiyCOi6KM6RDikKHLiU3k-hjECELAghDRg12TbzauVRrUPPdra0gsSpLktYlKCqbjzm318snUVF2EHgYAq07lku9VJNCzDnt9LcWDVcYOh++Scgen9sAYPgADWWAFWAyDkKDM2IMc7rXixVbxat2STltvJ3IY1h+5oW1LhxZu9QZBfF6X2PIFgEdgAA7idbYYJXqtx6BxhtdorE6P0H5w9wGTi4mtxGOkqFjPnhd4CXZfj5PM+na28+cGoscVcv5ji2vMhxrcGaaXD+rp4mZYhiqVgvtJma4TpnwvmPCehBp6zzvpXOQT87o1xXm-deX94o-ydD3AYucEq5C-rcTMYCfLD3PqPcuMC4G33vgYZBYNLxoMhBgze2CQRWD3pMYUclEy1lPiPS+1Cb5z0rtYBh1cmGvxYR-De39rBxXYv-LIOphTlmOJ5AezN1zkKgVQ4ao1CDICgOQaUco3j0AABJVyJqYAw6cLCjkyHeNeow4qpl0HebaqY8i51uAIihQiDFW2MaY2UrBkTMHqDY-mdiHGXB8S4pa6okhjlnL3OSZIJhLk0UHQezZdGUPHsEoxJizERLgpoGJlU4kZycVWVxKSpyZHrikLaWkbB2FIT+QpQSRohLKeE2g8g1DVOLP0exdTEk6GSU+Mk6SnJ+yTHWWE3TMK9OgSU4xWARqSn6ZABeEiiarXgmCXUYIciCj9gYScU4BhVW0kmbg5Ylq5NXGQyBRSsBbKgN8-ZEAsAAAtzoDJKtQcp1R6DMEYGGRez9YiwV1FgEwP1EZLJuTBcspxqbVTyAfJccYAl6OKf00pfzRqQCBSC0phzyJLwRR3ZFNhO4f3RfRO4yLRgeg-pqIwbyuI9M+X0wx2zgmUrGj8sFEKAhfE8GMhFQxGL8m0qlZiCjMWvweToTIuQPFEq+T88lY0AUStJaE9g5T5WICls5JMTclqmDkEYScaCYQMy0AYL0fo1lDyFZss1vyxUmrAJK+gTQ8IMHqAAWWPEcjkud5AJjvFVBJ8guruMKAmXuFIJg5DQvqoRQNaWsmdsWc4mprzKrjCw2Cxw4YpGUdDGwVhvVaPARsqhQMsAACshrQBpUyWgOFlhrFjXS+F1rhT2P1JCF0QwcVqDimCV03B0zjGON6es-c8naIgYI6BXbe39tCYOnCAApagjRYVxovCA6dzc53llGIup02ldCJgSn7HUVI9AFugbALGONgbMBWCsZE9RUQYmoAEcDAQo0QaCKwK1CBy2nBOdpM5qZax6EnF3XeH8vWXHSJ66wqy20fP3VQgD2NWy4xKhB9EmJaDmksdQFYSG4UoJQ6tNDVbMO1pwzBAOCZjgrzGDqsjO721+qo4B2jOATqApwK2OAxbTwTpQ8kAYXpDB3EVQSwTKk26cvnRoT6hQ-2yZo7jLAKnTqXQOchp1q107Uy9IuCwlhW4NvyOWMzhD7jkcFSPMeoLkOI0mWYNCNY5LJFw0mLAeRM4mH1N6QLUmKMUNCzSh+N7iwRfTlFwUgpYtNIKFTQwvs8jPl-T6gpnzsvbKtjbO20cw2NAjWGmN4WVmFfMHJNSXd1UqTQrvL0Y4yxuS6vqxrvzmu23trZuA50roQHo5BpjARLHQug+Fj+kXhTFZMLBJpo5dDaSMPqCYqlqbbvecFrL5cBlYHm61pb9nVvrcY3QYdqx1h7cSrBQ7MWTuThsLvEwQxDs90KIHe76yGtPbJa9xbdmVuOc44wv2TrEsFHikYLaBDDPWrjK6D0NgNAH1rK2jLD2S6zZe9bBbYAlvdrAAQA5KJvtDuoBeq99QfCAUx5IgrQPosldBzBCYu8LvCjJAS1d+qUcY7y7NAovITjxSyM4zpKdLzJF5PWHVGghz1i6UFhHI9y7lBwAAIzOiz2A4dI5gAAOptiLuNZDtcXwN2TVkSEw2a7khl+c4YPKMiev1ezTmZLgmwHoBzZ7I0g1qekhp+KiUQ9JcTE6neGLEhLl0BLWRdisipmj0nuP-SE9V9Ff88gTA2B0BA2B8pAQnNGAGKR0cRh0y6jjFyD+FYkz8lXVOnjlfY-19GrX6fgaG9N-YNUHwMbaDt878YBMYxI91iu4P0sJgExJl1D6BNoJze08txQmPz34+J-n0alX46uNOq3z33f-eMNchOCSD9kJyRaxRwd4p9ns8BSB7ZkAMAH9k9UBkByhn8S16V1AvR4IP0PwxhawywHJEhJh4J8Fbgd5pclpL94dfUR5b8yVwCoDy5oC69flrcOc1sl8W9QNaBGhBdMQZRr0X9GFnN7FXELgLhPUFo4oDZj87UP4Lgzd+Vg5yCb96CsBqDIC6DH9GD7ZmCWBl9lg18ODuDqBuDO8LhrwlohCjBfFNAuRJhXRKxA8TACMQC6sdFPlKDtllDaCYCyV1DED1NX8CgBDTD-CRCxgrCG1bDV06orgbBQCyUgYo1IAcAzozo3BPDtlkBSBqA0BrYVC09poiZI8Nd5Ad5+R+Q0IcDEA+FEtKwvotBvR4oYjtk4iEikiUjFCRpvC1snMpwSQVEN16xZ0MguRKjqiaie5hgSELd5CS5XDfkmiIBEjkjSBUiGD4CmDG8tC6AY1WBW8BchdVdrV0wqYvU8Uu5PUtAhi15xZvQd5n0Bt-EmYjEBo2wABbHAKILAIgZ4lnIgc+bgXIvmW9OsXQWmaQpqMwd0LkT1bSJlPlJyHhWQ7AR4l4t4twD4wgL4tE8+NQcga2egdEsAOQJzUcF8HIMsLqeQL9YnS8BKexJLTqSCewmneEJE1sV494z474yOIuOQHEhPfEgwJzYQ2cJcY7c4YYXOSEmkxLanMo0cRk+wFcYgMaeAMIWYXgyRAAWglMOA1MhCwGeQNMNINOpCcPVMBG1NwKwGuOeWMHG133kDlgwD4jNL7GFBsmijsgfHKIQBIKSkzl7n5Gp0dOOjygKhECKhdIvA9BXUASGG-WeRyBalIz9IN2SHOHOHSzIJZidJyjFVbEjPy1gn0GGCuH5GMHTAfEUTBCSnOH1CHCuB1EkyzMOhzJ0XR3zKQI03en1NBFi3dHdFyD11rDQhrNYg-GsKZIFRDlbMBhwALNiH6PFhu2plyDFJ1EsNfVQhrN5UuE0i6juynIMgxmoyA3nIqI5VXQmDuASkyB9CpI7hJCYhvKXAKDzicP+lvwjM7K4yiholiidCHGcguDuHfHwT0nfIxkVhzLPMvHmR1A9lhw9EGJwUFBrJOF1FXL1mDJymVw7N8MYX8NnENjkm1zMGGDii7k8RdEQkQjgkzMPOzOOid1bAjijhgt-Jii9LilrF3lfHLK7k7mwvXEBWyLbESHwskSXARh1U9UHLz2QpUh3ldA0gJQznOCJRgup3OyXBPx1y7j10mH1MNMMDyCyCu0sxAjyP5kFFOCmWcRmTcSdE9CqKyB9EsGHAdPfI7SvlgSnnYpGHQTJAbN7iDySEXP-y0ihgyi8pkx8poTnn8r-hYSCpsBCqXWskPh9GFFeQmEnLkPq0ozipnkEGLjAAwHYsFEfOpgaiBK9ETNfR9Bcp0lMBGU0gsuEUZxa3tgqo0GvGqv8J1DqqHO0kN1HyyFrHnBNMmIKsCWgWviBTAE5i-Iksokqr6ptOkLXlQiHNQl3n-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 */
    id: 'next',
    context: {
      selectedChange: undefined,
      changes: [],
      time: 0,
    },
    states: {
      actions: {
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
                    actions: 'proposePacket',
                  },
                },
              },

              funder: {
                description: 'Funds the current Change',
                on: {
                  DO: {
                    target: '#stack.open.funding',
                  },
                },
              },

              solver: {
                description: 'Proposes a Solution to the current Packet',
                on: {
                  DO: {
                    target: '#stack',
                    cond: 'isPacket',
                    actions: 'proposeSolution',
                  },
                },
              },

              qa: {
                description: 'Judges the current Change',
                on: {
                  DO: {
                    target: '#stack.open.qa',
                  },
                },
              },

              superQa: {
                description: 'Judges the current Dispute',
                on: {
                  DO: {
                    target: '#stack.open.superQa',
                    cond: 'isDispute',
                  },
                },
              },

              trader: {
                description: 'Trades any of the NFTs in the current Change',
                on: {
                  DO: {
                    target: '#stack.trading',
                  },
                },
              },

              editor: {
                description: 'Proposes an Edit to the current Change',
                on: {
                  DO: {
                    target: '#stack',
                    cond: 'isHeaderOrSolution',
                    actions: 'proposeEdit',
                  },
                },
              },

              disputer: {
                description: 'Disputes the QA in the current Change',
                on: {
                  DO: {
                    target: '#stack.pending.dispute',
                    cond: 'isDisputable',
                  },
                },
              },

              service: {
                description: 'Enacts the current Change because Ethereum',
                on: {
                  DO: {
                    target: '#stack.enactable.serviceWorker',
                    cond: 'isEnactable',
                    actions: 'enact',
                  },
                },
              },

              history: {
                type: 'history',
                description: 'go back to the last selected account',
              },
            },

            on: {
              EXIT: '.history',
              EXIT_SINGLE: '.history',
              BURN: '.history',
              REVOKE_OPERATOR: '.history',

              APPROVE_OPENSEA: '.history',

              APPROVE_OPERATOR: '.history',
              REVOKE_OPENSEA: '.history',
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
                  view: {
                    description:
                      'View states are informative only. Transitions must start from an account.',
                    initial: 'sort',
                    states: {
                      sort: {
                        always: [
                          {
                            target: 'packet',
                            cond: 'isPacket',
                          },
                          {
                            target: 'dispute',
                            cond: 'isDispute',
                          },
                          {
                            target: 'header',
                            cond: 'isHeader',
                          },
                          {
                            target: 'edit',
                            cond: 'isEdit',
                          },
                          {
                            target: 'solution',
                            cond: 'isSolution',
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
                  funding: {
                    description: 'Manage the funding of the change',
                    initial: 'unFunded',
                    id: 'funding',
                    states: {
                      unFunded: {
                        always: {
                          target: 'funded',
                          cond: 'isFunded',
                        },
                      },
                      funded: {
                        initial: 'holding',
                        states: {
                          holding: {
                            always: {
                              target: 'defunding',
                              cond: 'isDefunding',
                            },
                            on: {
                              DEFUND_START: {
                                target: 'defunding',
                                cond: 'isDefundable',
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
                          },
                          QA_REJECT: {
                            target: 'rejected',
                            actions: {
                              type: 'qaReject',
                              params: {},
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
                      cond: 'isPacketOrDispute',
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
                          cond: 'isResolved',
                        },
                      },
                      resolved: {
                        always: {
                          target: 'rejected',
                          cond: 'isRejected',
                        },
                      },
                      rejected: {},
                    },
                    on: {
                      ALL_DISPUTES_DISMISSED: {
                        target: '#stack.open',
                      },
                      DISPUTE_UPHELD: {
                        target: '#stack.open',
                      },
                    },
                  },
                },
                always: {
                  target: 'pending',
                  cond: 'isNotOpen',
                },
              },
              pending: {
                initial: 'viewing',
                states: {
                  viewing: {},
                  dispute: {
                    initial: 'resolved',
                    states: {
                      resolved: {
                        always: {
                          target: 'rejected',
                          cond: 'isRejected',
                        },
                        on: {
                          DISPUTE_SHARES: {
                            target: '#stack',
                          },
                          DISPUTE_RESOLVE: {
                            target: '#stack',
                          },
                        },
                      },
                      rejected: {
                        on: {
                          DISPUTE_REJECTION: {
                            target: '#stack',
                          },
                        },
                      },
                    },
                    on: {
                      TICK_TIME: {
                        target: '#stack.pending',
                        actions: {
                          type: 'tickTime',
                          params: {},
                        },
                        description:
                          'Move time forwards so dispute resolution is possible',
                      },
                    },
                  },
                },
                always: [
                  {
                    target: 'enacted',
                    cond: 'isPacketOrDispute',
                  },
                  {
                    target: 'disputed',
                    cond: 'isDisputeWindowPassed',
                  },
                ],
              },
              enacted: {},
              disputed: {
                always: {
                  target: 'enactable',
                  cond: 'isUnDisputed',
                },
              },
              enactable: {
                initial: 'viewing',
                states: {
                  viewing: {},
                  serviceWorker: {
                    always: {
                      target: '#stack.enacted',
                      actions: {
                        type: 'enact',
                        params: {},
                      },
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
                          cond: 'isFunded',
                        },
                      },
                      funded: {
                        description: 'Funding is available for trading',
                        always: {
                          target: 'traded',
                          cond: 'isFundsTraded',
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
                          cond: 'isEnacted',
                        },
                      },
                      enacted: {
                        description: 'Content Shares are available for trading',
                        always: {
                          target: 'traded',
                          cond: 'isContentTraded',
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
                          cond: 'isPacket',
                        },
                      },
                      unenacted: {
                        always: {
                          target: 'enacted',
                          cond: 'isEnacted',
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
            },
          },
        },

        on: {
          BE_TRADER: {
            target: '.actors.trader',
            cond: 'isChange',
            internal: true,
          },

          BE_PROPOSER: '.actors.proposer',

          BE_SERVICE: {
            target: '.actors.service',
            cond: 'isChange',
          },

          BE_SOLVER: {
            target: '.actors.solver',
            cond: 'isChange',
          },

          BE_EDITOR: {
            target: '.actors.editor',
            cond: 'isChange',
          },

          BE_DISPUTER: {
            target: '.actors.disputer',
            cond: 'isChange',
          },

          BE_QA: {
            target: '.actors.qa',
            cond: 'isChange',
          },

          BE_FUNDER: {
            target: '.actors.funder',
            cond: 'isChange',
          },

          BE_SUPER_QA: {
            target: '.actors.superQa',
            cond: 'isChange',
          },
          NEXT: {
            target: '.stack',
            cond: 'isNotLast',
          },
          PREV: {
            target: '.stack',
            cond: 'isNotFirst',
          },
        },
      },
      information: {
        description: 'Informational views of the state of the system',
        type: 'parallel',
        states: {
          stack: {
            type: 'parallel',
            states: {
              size: {
                initial: 'empty',
                states: {
                  empty: {},
                },
              },
              position: {},
            },
          },
          time: {
            initial: 'tick0',
            states: {
              tick0: {
                always: {
                  target: 'tick1',
                  cond: 'isTime1',
                },
              },
              tick1: {
                on: {
                  isTime2: {
                    target: 'tick2',
                  },
                },
              },
              tick2: {
                on: {
                  isTime3: {
                    target: 'tick3',
                  },
                },
              },
              tick3: {
                type: 'final',
              },
            },
          },
        },
      },
    },
    type: 'parallel',
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  config
)
