import { createMachine, assign } from 'xstate'

// use https://stately.ai/viz to visualize the machine

// const types = ['HEADER', 'PACKET', 'SOLUTION', 'DISPUTE', 'EDIT', 'MERGE']
// const changeBase = {
//   type: '',
// }

const getChange = (context) => {
  if (!isValidChange(context)) {
    return {}
  }
  const index = context.changeId - 1 // contract uses natural numbers
  return context.changes[index]
}
const isValidChange = (context) => {
  if (context.changes.length === 0) {
    return false
  }
  const index = context.changeId - 1 // contract uses natural numbers
  if (index < 0 || index >= context.changes.length) {
    return false
  }
  return true
}

export const config = {
  guards: {
    isProposer: (context, event, meta) =>
      meta.state.matches('account.proposer') ||
      meta.state.matches('account.anyone'),
    isNotLast: (context) => context.changeId < context.changes.length,
    isNotFirst: (context) => context.changeId > 1,
    isHeader: (context) => getChange(context).type === 'HEADER',
    isPacket: (context) => getChange(context).type === 'PACKET',
    isSolution: (context) => getChange(context).type === 'SOLUTION',
    isDispute: (context) => getChange(context).type === 'DISPUTE',
    isEdit: (context) => getChange(context).type === 'EDIT',
    isMerge: (context) => getChange(context).type === 'MERGE',
  },
  actions: {
    proposeHeader: assign({
      changes: (context) => {
        return [...context.changes, { type: 'HEADER' }]
      },
      changeId: (context) => {
        return context.changes.length + 1
      },
    }),
    nextChange: assign({
      changeId: ({ changeId }) => changeId + 1,
    }),
    prevChange: assign({
      changeId: ({ changeId }) => changeId - 1,
    }),
  },
}

export const multiMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFsCuAbALgSwHQEMBjQge1QDtMBiAIQFEB9AMQFUA5AEToCUBtABgC6iUAAcSsbDhLkRIAB6IA7ACYANCACeiAMwAOAKy5+J-gEYAnGf4WDAFh0A2AL7ONaLHiKkK1egwBlAHkAGQA1HgFhJBBxSWlZGMUEVQ1tBDMDM2NTMxU7FUcDCx0dV3cMHAJiMkpaRgBFAEEouTipbBk5ZNStRDsHXDsLEdsdFVL7cpAPKu9av0YAlgAFSKE2iQ6upOV1PoQDc1xRiyVMnXPHOxc3GcqvGt96hhXuIJWggPXosS2E7p7NKIFQ2XBHEzWJRKRx6RwqMxlO6zR4+Or+AAq3CaXD4Gxi7QBuxS+3ShT0OUhOgM9gKhWmKOqaMWDCabAAmkE2HRWgT-p1EqAeqTdIVwaYVFk4QZHNcGQ9cIQABb4cgwWBUN4fL48-F-eICwEk4EIQx2E78RxmWV6PSWFQqJTyzyKlVquBUbkADQxDAAwgAJNkAcV1v1i-J2QqBByUBgpdgMOktlwcMtuFRdytV6s13DoYX9QbYod5+u2goUMfSsuyp0clv4BlBJWdVWz7tguGw5A6+HQVDLEYNUarCDsenNDcyjlUFxpDhNcaMJmh-GhzYGjrbeA76u7vZw-cHZnDhMNxInU-MMrnSYXOhNelUOWhmWbeRsBh3rpzcAPfYDrwKhnpGlbJFeuDTreCL3vYj4HI4FiOOKMJ6Ja+TQnoP57v+PaAYOOigSO4H9JOUE3rOsHUvBJolPwqFIWYSjUvwoJmDhbr7vhR5AXYxEVkakHQVR860QcFh6BYr6ykoFgTnoyZOsiCq4V2PHYMevAGAJRLRuO5EiXeNGLgcdo6KhSj8PoUmWgYyl3OQJAQHAcgopsJFGgAtPkJo+eapiBUFq4-vMvgeYJxK+YhFkQuYKhmhMdiIhm9wumFlC4KIABOJBxGA2URXpY75HWZh2Jajj6GxcImgiDGBVCaHwoioVPJlABmFAuYVfKeVFyUnOVlXVQljgmvoRhxZY1i2A4qWMhlmC4LAJDoAAbgVRUXvppVDRVsqjbVByZNkcXrqMybWkimZzO1y0AI74Nto7JHtVgHVV6FjSaAwWacYwTNSdhtcyK2oKIBVPS9pEIO9w2Hd9x3pEcKhDKM5xJlcNygwsuCYNl+A9TDRrw59R3jQc5LilSC50gtCpLQQ5CaDIYAkwNZXk0jlPpOMSiUmxUpFLKIMqVmXGuX1kW7XYJr2eawwjHYG42HGHHi+2kvqYemnoBz+k6ImFGZM+FjmEoKuJk+s6WWrhQjOMnF-l2SpgETW3S8VySzgLs5mLaOhmMxjoDEuSa4JKaGqCU9kqBYzudllRAANZgJgBtjr7UHnIHweqJbctmVZkf2ecTb2XClqJ-uq3oKgxXnq9iDZ-7ech4XJpIeacYwnGtYFAnmu7truAQNgsCiA37NeztWfQjnAeKfnodF+kFgJbgveqAi5smA4Nf-pAUiZz7C9t8vHdhxJz6lzC8KSfYdoMxLLu4MgBUwKfLfn7nl8F9fdIdpsi9yQlJKO1oHLOCAA */

    id: 'multi',
    type: 'parallel',

    context: {
      changeId: 0,
      changes: [],
    },

    states: {
      account: {
        on: {
          BE_FUNDER: '.funder',
          BE_SOLVER: '.solver',
          BE_QA: '.qa',
          BE_SUPER: '.superqa',
          BE_PROPOSER: '.proposer',
          BE_TRADER: '.trader',
          BE_ANYONE: '.anyone',
        },
        initial: 'proposer',
        states: {
          proposer: {},
          funder: {},
          solver: {},
          qa: {},
          superqa: {},
          trader: {},
          anyone: {},
        },
      },

      changes: {
        on: {
          PROPOSE: {
            target: '.initial',
            actions: 'proposeHeader',
            cond: 'isProposer',
          },
          NEXT_CHANGE: {
            target: '.initial',
            cond: 'isNotLast',
            actions: 'nextChange',
          },

          PREV_CHANGE: {
            target: '.initial',
            cond: 'isNotFirst',
            actions: 'prevChange',
          },
        },
        initial: 'initial',
        states: {
          initial: {
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
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  config
)
