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
    /** @xstate-layout N4IgpgJg5mDOIC5QBUAWYAEARATmAhgLYDG+ALsejgHSX4B2MsAxAIoCCA2gAwC6ioAA4B7WAEsyY4fQEgAHogDMAVgBs1booCMAJgAs+5QA49i1QE5VAGhABPRLp1HqqzXu6q9yrQHZzixQBfQJs0TFwCEnJKMBo6RjhmADEAVQA5LABRACUefiQQEXFJaVkFBBV1TV0DLxMzSxt7BF0-ai03LXNzP3M9Hy1g0PRsPCJSCipaVAYmZmRs9izcvlkiiSkZAvLKjW19Q3qLaztEH25nI2VFJ389VqGQMNHIiZi4mYSWAGUcgDUAJIAYUyAH0AOoAeWyAGkcnk1qINqVtko1HsaodTMcmogdIofOobuYjCYDFduIMQk8RhFxtEpvE5t8UgAFHKgjgIgrrEpbUA7dHVA51bGNU4tYkuNwBZQXDpU4bhMZRSaxaazRJYAHfVkpZDw1Y8pF8spoqr7WrGMUnZpaVSKbjSm4DXyeHSqHSPZ501XvDVfajCQRgejMblCE2bM0IUw6HTUa7mZSWVQWSl6XEIeOuDS9FPcSxaK7e2kqt6Mz5MIMh+jUABuYjAAHdqLBhDgyOGjZHitHUbHC07lP0tDcjFpTISfFm6tQfHLJ8ZzNxzv09KXla8GeqmXAa6GG03W+3O+GtPle8j+fJEO4V4nR+PJwTVDOJd4fNQdHLuNxlOcqjKEmm4vPSaofJqsAHnWjYtm2HZdpwOiXoUUYogKd5Do+AzPlOb6zn+36LjcZg-t4XrUj65Y7pBgbBoecEnoh4aKKhvL9phg4PiOuFOC+05ZgByjznoJJAco8buNooG+hWu5VvuDGwceCFnpwejsehN7lPew5Pvx+Hvs0Dp6N+YlGH4-7-moRiyTREEBtWynUAAZgArvQEBiIwyTpFgoKZMgAASEZoX2GG3tmihGBak4LoSHoqFmPipdQVzaBc5wDKoXT2dujl7tBLkeV5PlQH5GSglg7AAmFHGReU+KxRi-QAZ6DrKFmRhONQKj7PG-VaMY+Xgf6RUwW5nneb5qRVVow3KPV2kxs1cVtYlnXdT4lzXGO7WKHoFjKKNfqVlBk2lTNFVzQFPg6Foy0RTpeIxetCUdclErmDo5h9XtYm-fa+IblRZYFeNinFbWU1lYw1CeUk02QN2WnPatnjOAEuU+EdaYTmoWYdHK7TVGoNnnJop3yXRzkw1d5WwxAkDUKgwgADbXcwWS3aC3zIOw2TIE916rcmzg-Q9Fz+A9RjcJm332s6w2uMBlNBGDW5jed9H09NjNXSzbOc+VqOIujA6-cY1CSx0Rgy8W8tZpYX4dNox1GDFI7U7RTlKXrcNQEzLPMwzvk8-5fPIJCrIi6aA6OjtLjjm+1x6CYI7dWmpPaAYkkLkdoNKmBZ0KRdJX6-DhsQNQoeVxVEcZHHnFRQEhYuGoR3nJ793GQ49pEtcMWkroHWUcXcm+xNFeB8HNd14H8zAjCoLIACACymTN41SiGOZ+iHZoGXdQS1BeNopLZT+uU+4VUOTQAjvgZvGhbXFmCTDqJ64HoLQREptXMt0B0f4sqeBOprEuNM-bQ0PE-agAArdy0BTYcFBNkTI3xIQABk-hbx7OFUWltzBKz0F4d0H8xKEwAQ9DQR0AL21qPaT2t9IblxhvApBKDfJoIwQAKUyECYWBCGovWzCQ9QZDO74iAlQ20iBPxn26HLHqOg-CdVYTrOmh5YDuRDDgVgz92DYOwdVHUeoDTfDMd8deOpfhYG3mIj+Tov6rh-rle0fcWi-WcKlP8llriFlUCwyBk877sJ0Xo2IhjubmP1GCNkwVMjYIcSIlaCcgIuLboSbgv9PFEzME6bEqU+hXHxASTRZddaRP0YYtsMw8AsEcatRh84xyEgpNoAkXUJTtJEm7FQnj7Y9DsqEhybDql1l0bU-A1BGkc3rCjZpCd7ROkpCYQCahFB9HkZKBcOdBlvmGTtSptN9y1i5ssrirQswehTOlHxPRkxpmAhrCe4ytHnNDJci85siFcR0LkrQNt0zDX0Cuf8XiHr3ETH4T2-hKie1UKcmB1ALmM28rAQQ7kyBgCXkCFea9N5XKimCrJjobjuCcD1Lxw02gdQGAYH8pgxIoomui+GmLsW4rmXABZKNtS6niXzYKgtMEkqakCkFK4wViT-ABImfgvzEk9unEhYl05svvhyoOXKcVgF5e2dmiyICxKFQadBmCcF4IlXiKVlgZWSTlZComGyHkknTvcSw6dx40i1qXM50EdW1zEFi-Vhr+Wmttd43J-1nmTm6OohWdpUoJgGcWICDokVaousGvVPK8AILAMQXFprBUWLBPwwRa9IRpGjYC2hDrKROohQq3p9ssY+Nyn0HauSc2BnzUstJb8opkLfC4XwYlXSTk0LcycwKALdHtF0YsKhRnvIhp86CoZ8AlvwAAI3Zga2AsRGzEDAOCDsABrWIL8rzx3fkKS0WIGi7KcLQjKQ8GHAWAv26sZAcD4GukzWAyBAPAc8tXO9hCH2ktXMC1ZEkerp3zilUwOd3BdGkpJRUfqoFT3vgBoDBtpqgfAyRryKMFhLDBMY0xt1vjRpfH9MSX8bgOnjE4FKJD-oBFxguD0P4fB-v3ER4DV0yPEarsjU11Gsh80hJvUEDGmOmBY5YAI7GbjxiMGhp0GUzCODIQMcwInoJiYoxAST4mZPQdETGZjSi2NJU47piUFgzIZQMCQpwq5LJmeoBZ+GxBpC4voGQMDUmg6eR3SWodaN-lwYdLCjwpJVw-juc7bozo1Huy6bFALQWg4hfC6GCL5H4axdLfMRY8m6OgiBLWg0aRhEJdg+UBNwKiyOmLAtVKbm7Tyy-AZ4Blkcrrrw2EiZ-6KvFdC2VyLwGqtUdq2CLBSnGstcyC11TPHuvrL6ztLLyqh6xWGs8t5k2PlVJm1F2g83wuLcZstqNw7EsdbEl13KPWJy+CO99bwvHJxpi9q4ZFYzN03dE7N6gT916QHwOzdmmwnvw3oNITIchQ1haQm99rDh5ZmVxkJoegLFBCSVv1VcxI4y-UKzDuHCOkco5hzF+gu7qtMcdH9f8Fk-EH08BTweicafadMxD7WUPzMM-wPDiAiPkfSFR0HF7NWaOgk3jVExAJa1MdsvOICfRriEnihTsybsM2-VXP0DW1J0fM3gAUaikOcB-Pxy0AbiAAC0rgzNu5buUNMtyvy-g8Aw-EK4xKXed5LwNMF-c72zFb1qH0ko9JTRLbofR5aSR+hAjdsfUUuSYgnpx9tFA4Q6BCxlb7s6h48PiPav6JcBqLzDJiakyCl5jNsmFvEq9-hr7OBafUAjebVcPYTLfoHT3b6pQQu6b1d9fu9u8TgK84xt46e4PgvrNC8F+UBxNJ3Ifz1dl3bfGKqUHd3gc5IN+Tt39v3we+FHDUTH+BallckjN9TH1vs+V+8E6AQGsQt+XE9+E6-GbcO+r+FQJIH+f4EieM3cZ+-+M+98xeqkkAEg4Bo66+UBW+8sL+6eCiu+Nsyi+gcsQEOYAWWB8ERqOKLc9md+BBm+T+xBu+pBCAHGSiJIMUY+b4QEdBAc10eBTUAQzg1QG0n03BOMNsgS3S+0bsIhh4Yc0W9ASMlGEA4heI3g6gJmzC9oPQHQyaBO6I2IrghczaqhdY6hc8uh2YqU6gksFwFEGqPQaGf0yYA0P06cmathTMlmRsHMYhK+7u76ZkrhVwNQfQnhEolkURO0S4K44saB4MhegBdh9cc8tcYA6hjhgh-0agf2I4Nw3BfhZ8TeuMbhdKgRT8jhai8YbSPmD0coO04ozQmmj4wSgK1onUzeBeABmBHCsyXCUA5UjRfiLRjgw0fmnRd4Kg34u+WUC46y3gRc5+mRIxcCsy8yxqkAhRq4IkRuY6FwgKvgs46GuWXQnsKYR0PQ6R-qGBESdY8ChaxapaRx+ypxR05xlIXiSY84HoBghIXglInggR0y0S+AUxaibSBIY6yYK4tKzU6UacuSh8JSU+QxLxkybYUSBisysADScAUx+yuEuMDxBYtKBIFe-UhcqcTKf+GRwxrxBJMyEaBxOh4RAeSgxBGgxYY6JgyBBS5BDJngTJnGUJhJdSHxcWPJ96fJFQ2+34JCJCqUkkP4Yp9JackpBc0p0+BGua3ykxvJieJIJ2PhhIeeQEtKcYvGZCuS90f2OJWxbJgYwaTEZpSpieugk4FBnou+k49wWURM3gf0n6HgvOtkLJzxxpnpppnKoa3KYAjhbsIkKg1pFg18badoJR3476qxrguM0erJeJ1YeaKZ4a+xJq6ZFwup2ZtpeZDgmMwJNKXg-RmqRp4SiZs8g6vKRaCp6Zh06gribhzykkiq5wvGaifg7gcoNwAWL2jhmafUZC-paYksuUtyLyfUPi9xyYKBAWg6ipMGypmmCYlKUe-GZCOgc62y7qASbUyY1wy57Oe6h6aZ5pYiC0Zh2YFgw2Pijo-42+JyPZ02+4VWB6R6R4LYPp55fpbQ3g5MMs5M2gweVwo+uSmgHof4-Qbp6BCZ1Y0FX5bYp6Yg56l6OAN6ruP5Dmnoty9Q6UjoD0RyPUEJ9OUWq5gK659wbFOZv8weCYGUvgwyPqKghF5ZxF0Od2Emyujhqa841unsmgKYC4chq4vGZgY+tkPUXFNmXk1mjMkGMmjhHFyluMqlWZGlKUXQByGxhYJIyYBllmxl0m2h6ZgKX4uMmanoPU4knuCAJmDlM6yiLlEFW6gWMO8lMOYmhx9FA4niCYqsb4uFDoHQXi5wupAQjxpkw0rlwWD25W3FiVXEFgzgpgcs2yO0csgMWcFeBmpIvmJSmxRFvZt2wGJWOOyuCM9AK5ZVUUvlZ8MUmgIydVP0zs+yrgfGpkcocsTx+GHVslXVxVvVA1vpv5gKZk-EnoXQ2yf4uyjxzor4h081-4hVc2pWj2cV4GCVm1Dmw1z5gKyiGy-5yJ6J7GlksUFx4OuJMl0ud2jO8uzOSus2q5wSfFm5glO5AC8s6JVsFVKslgl1sOsuTOiu9AvV6O9AmO2OZWillOG5Al25Wgs4P0vGuSaiDolglIqNwNCuLOd2bOHO91iFv5f2H+E4v1Ta3BGxysP1KJ-QcZS1kFgNwGDNoNWNMOG17NDmZCf0hIKYbRwSopH4AZM1luQt909N6NINmNvV8VZ5LB1yzh0q1QFgjoJZFOOVXQO0QMmgU+wQQAA */
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
        description:
          'The stack of all changes can be navigated using the NEXT and PREV events.',
        initial: 'open',
        states: {
          open: {
            id: 'open',
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
                states: {
                  unFunded: {
                    id: 'unFunded',
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
                            target: '#unFunded',
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
                    target: '#open',
                  },
                  DISPUTE_UPHELD: {
                    target: '#open',
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
            id: 'pending',
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
                        target: '#open',
                      },
                      DISPUTE_RESOLVE: {
                        target: '#open',
                      },
                    },
                  },
                  rejected: {
                    on: {
                      DISPUTE_REJECTION: {
                        target: '#open',
                      },
                    },
                  },
                },
                on: {
                  TICK_TIME: {
                    target: '#pending',
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
          enacted: { id: 'enacted' },
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
                  target: '#enacted',
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
        on: {
          QA: {
            target: '.open.qa',
            internal: false,
          },
          FUNDER: {
            target: '.open.funding',
            internal: false,
          },
          TRADER: {
            target: '.trading',
            internal: false,
          },
          SERVICE_WORKER: {
            target: '.enactable.serviceWorker',
            cond: 'isEnactable',
            internal: true,
          },
          SUPER_QA: {
            target: '.open.superQa',
            cond: 'isDispute',
            internal: true,
          },
          DISPUTER: {
            target: '.pending.dispute',
            cond: 'isDisputable',
            internal: true,
          },
        },
      },
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  config
)
