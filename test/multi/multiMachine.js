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
function isPos(index) {
  return function pos({ selectedChange }) {
    return selectedChange === index
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
    isHeader: is({ type: 'HEADER' }),
    isHeaderOrSolution: (context) =>
      config.guards.isHeader(context) || config.guards.isSolution(context),
    isSolution: is({ type: 'SOLUTION' }),
    isDispute: is({ type: 'DISPUTE' }),
    isEdit: is({ type: 'EDIT' }),
    isFunded: (context) => {
      return false
    },
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
    isEnacted: (context) => getChange(context).enacted,
    isEnactable: (context) => {
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
  },
  actions: {
    next: assign({
      selectedChange: ({ selectedChange }) => selectedChange + 1,
    }),
    prev: assign({
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
    tickTime: assign({
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

    enact: (context, event) => {},
  },
}

export const multiMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDswA8AuA6AhgYwwEsB7ZWAYgCEBRAfQBUAlAQQBFrGBtABgF1FQAB2KxCRUgJBpEAdgBMAGhABPRHIAsARgCsWAJzaAzJrndte7uoBs2gL62lqTLgIkyVOgAVGAeU8+AZQ4efiQQYVFxZElpBHklVQRDbkNDfW05PUy5GWTNGSt7R3RsfCiKGlogxgA1AEkAYWoQyQixNxjZRRU1bU0ADnTDOQGZbk0rQytChxAnUtdSCroAnwAZGuC+VpF2iTDY+J6kzSn0uX69XP6rGQL1IrmSl3KPWmpWOvofLm2wtqinTi3USw0MenOegM6iuenU-Ue8xebmWtE+AU8AFV6FtQkJdoCDl0EmorCMhmYrP18np+nI7LMkWUUW8AIrMFr-AkdInAkkIHIaCkaPTGGRaQyI57MpZvABimIAcuxfnjwtz9qBDiC1HSZJDRZZtAzis4Ze5KgFMZ4OLR2Zz8ZEeVricdMslIVZNDosuYpWbFu5FdQABr0B3qp2aqSuxKaUWDDLDbT9SyGfrGf0LV7eag1CMA50xvnHQwyPr6AqpbRUmH9ApZ5FLF7EABOFFDXwLGuivKmciwdJSfR0Rgm-NSMk0WDGF1us+4F0b5tgLfb5E79CqdUVAHE1s0-o69r2XUkyYPTIYR8bjFYJ+o5APTHPLjZjKLl4HV2U2xVMYwirdlGp7Fv2l7Dt6t7jqW6jyDOi71ouc6aNwMhfuUa4UIweY+AA0nQfgcMw3yqjsIFAuBQ7XlBY73qWSZYC+9aaDC8aLg8jLSt+WHkMwnjeD4my0ERipBByR6RielEXtRN50RO2i5AhFzyOWfSipKXEBphv7rvxgnCURLCkcB0l9rJV7yXeE5kuoTGIeK4z9PCJpPDpKK8ThNT4YRNpidQElqoW0axFRVm0TZpbDNOzHTOo6a5GSGGeXpq6CK2xARGArbkKwPhmYSZ6ofkWDGHIXrGqhqZWOoE7jNwla1dwNhKcacgpc2aVYAAZgArsgEA5XlBWSSFoGxCV+rlZVfTcDVdVunqBrJOoxqdWQWFYLAxAADYAG7DflhVFpN4zTSYs3VS1i2gt6aRXJM4q3KcqEzKa2apQQf5YAAjjgI0naFiBTWVl2jtdtX8oK9kGMkIpihKG0-t97bbX1gg5ayAPHWNPZAqDM0Q-NN3Q4anpQb6ejI1tGCtjgQ25bjwX47yhPg1VJNQ26Wi6HDJhmBY1huUyPHdZAYhtoDeMUWz51gxVxMLROIxWE1Iw5PWNjTDT3UQIQsCCH1GBHaNLOy8V8tE5zytumS05w5S1IyLS9K66jq6wDl+2EHgYDS+b5mW6V1tzbbiQinz9zXlCpxrTTsAYPgADWWA+2AADuWAYMomPbW2GDkEDE2IMkGZYPNIw1t6mRjPRiQZIMIpQpMcLXhmCdJ3gqfp1nOd5ztraF5wmiB0VYHzWklc6F6JhXC1-Ipmr5bcNwBijmMWSdynaeEJn2e52A+dD0Xchj6dpeTxXdIzzX8-14g1gQuKULr8YLW1tv3e7-v-dH4Pw9DDn2BkkK+09q5zzrvyWquh6TjAuHoAY150xfx7nvPuh9j7D3UMAkuoDy7gNnrXBexwxhpBXhMCqqYoT9BFtxTCicd69ywONLAYAAC2ggc5FxlkHMC3p9RyHTOCdMGYny3UQFkRqcC0LqDQpYKwi5UE-yzqwjhXDlBF1HuRPhYUBFMWEQmMRGh+SoQMDOGEiCjCTBrP0BE2lPrNkYd-ZhajOHcM4GfHR489GlSERmIxwwTHHBuNOChZCzBPhcso1xPY2HuM0ZwIB3iL4nD8YY0RQSJEIBMFOJiMIrCIJsC7MY6EHFNk2s4tB+83EaKLjglJIDjDpICZk8RpjhjPxhPIbQj4WqjhieglhcT1EeO0Lgyi+j-EiLsVk-kVxBgvyuDIDMNYsiaEGTUkZCSi5WAmX2KZGTZntOOKhMs+SoTCxbqtTZqjtl1M4DIfZZ5mmCKOcY7JJgTAWKuFEuEKQKq3OGSBeJDz+jPP4S0mZHyOl2IueWRBYj3ruUcZUru1S7kgtGYkvQELfFvNacc4JcYdD2RFNSRBFxUxoWUSuLAWUwDIB4Xi0uUx9QrIsHY6Y2tuaginBCU4cMDD0kKWYWlPEGXIF6gNfWyAoDkAVMqd49AAASxcCZUibklbQgtFGnEMBOL5g5+lfOmDcBK4rMKSulYNQgcqFVKlYGiZgdR1Vs01UxbVurxipENfBZIs9DAJXGMaZFosGHooqaua1-VbX2sVU62ibrioepyFMHV5g9W+tLE+AcNVvRPyDXBTiH0o3bUjXSmNMq7XyoTbQeQmhk3FgmHCtNNhvX6pVspANlMazXDKaWulVSy1VrjVALAA05QysgMyxpeD4w6qwEpDMkwBjTBdg-JI4J7KUm9DYWZLkw30M8sOytmMpWxtleOy9kAsAAAs9pXrytQOtAR6DMEYOGXhPi1CKywBMR8UiMjGnFCrRRS7q4wnmncFB5Sh0Voleem1V7kO3ofbtJ9TbYhPi9P+2q2RIkgeyakb0Fdq50loSkDucGeKnsQ4y5DNbUMQCwENS9Nbn2vu+J4LDah0yNXrDqteRgrjwk3TFRqu6dDJjXqkS1nlR0oZvSxtj1b7XsATbxgUs9By0megi6lxG5plX6cGzItV7GDtowhq1SH2NyuY6xsA9n5X0EaHhBgdQACyh4WUCl6fqeEa07ypgAwa0sAxpxyK9LQska94QDpRWWujtmGP-VnVyC2xZMgZEHOWeMfSpzJHCxHClDlMh2Iqu1T8NGI07zPWlnAWAABWfVoAcfZLQHCqwNi+bnUCJ8AwsBUgKLkMxuRcjQ3uPoKEKyCjcvpIl8NJ6bMKaQ-9FrbWoAdeYF16gAApagDQv1+cG4MEbtx35XDLCV3UuG1pzipIol8Jakvwfq-RqVsAMZYwBswNYaw0R1AxNiagAQgcBC88DoIrAtM5bzfluEpgispFso+GcUSEq0iDSs+TzZrXfcxq2bGeVgdYhxLQa0KrqBrFh9+1J8O8saUK6cVHpYxj2XTMK1MxpaTWDx5tAnP3idNdgHenArY4AZePD+gU8Y1YGCXi+DIxH+VkcmKYaw1gC0C+jUhwnv2sCS52gdGdcPrDPkUeCZ6b5jQTjV5SYYCjtesV1ywxlmH6cgPUE-Jdq8nzzxcgUe3KRhvghE8B0VdCPJONW82c9mHtGZd0Y-X3QmA9jCD+JlMnPbcVS0CspRtWVsfcwgnpjvcmN-2l1JWXZZxiDluIrc6tx+iKRamVN8qlW-imj6iz2cfNrl4c5Xhz1eR5+fr9OG48gvQt5WYpWqg5LhGHpCRlqbvh-jtH+O8fXjk917GNPpvc-8it4fHBZfcJ21oWdlpKzdXv50q36xg2RsTbkDcw0DzbmfNabkfCH7ouEGhYLHKcA+HCP+jcNMGhL0rcLcJvh7kxvrIbMbEfMbntIdBAKTiDhTgECqh+mDv-q7EunZHcKJtQvyGtAlGHtjisnBLVDoIgWOq-qgSbEbnAJgTOuiOTnQN1usJsMQXSKQRoOQeKJQccGtJAYKixHPnOMwShige-ugZwabtgVpjdhCMaAlr0vxiIhOC5LoFzrcCGsWtTMXrHqXp5C-koWgRwc1mAAQNwWTqDntodsdnUD4EBF7ngnWAODWKISUvCGvFQbVPZK3BYEYPIDVg-iXk-jxLYSbOoT4QTNrsNg2mvDkI+FrlQcYIMIKsuoUlCH0G7oymUDgAAEa7T-zey+xgAADqbYycw0GhbKM4lw800BPK2Sj41IWAWgxClKM+budMDMTGl6sA9A9MKGA0ymNe40A2VG18UI9IqkZCeg0Mq8iyliqE2RpgCBFhaKVhzYoxSmMqkx0x4x062BTAbAdA-2gOCaAQ5uHej4SkeQdw8YmgmxNYM2lyb4VIqsIxlxDmExUxYxoJ1xn+LA7AVQPgPmtATxLxasbxuQ50-K3xboq8KJr8Ogmu+QuQwJEJ165x4JZxg0ZuKRvIGgrxi2HxGJpieg4GliLEdiPoJgRJKGeApAJsyAGAZJTGA0ZRThyRp2KQjUQmi4kwCUKyOoAoVWFyxR+q66nJTG3JfJjK-JIJ46wpSR0JdxtADxtADQXhOIioJ2-W1Ja0gwHRSUq8vSMI0MxgaQkpqQ8BFwQiqpDm6pvJWpxJbCyAZQM6txsJqwCJJp5p1A5p5uKYumaEUw9pPuGxboFUA4r86Zpwkwlmb21mxxm0pxapPJmpApDmuplJp21pcZdpZgSZ0MqsfxBgNgiCkSXp46-0XmkAOAu0u0bgJZ46yApA1AaABsvp8xrMZ4pgpGTeQiOQhSNw2acYKyDsNCaaKQuSHUhxA+eZq4BZDm7ZnZ3ZvZ2pE6qAgZIpY5WW2GOQfMh6OQBgcIrEpiS5fxeoxW65rZf0OAHZEAXZPZpAfZAZQZNxMJdAPmrADxnh3hp2RgughSURcEMUOQMgT5LsPyYik8a8uO5SRA7CR8PZ7CFRxAF5Ke-mkwFcq8Jg1gLsTJaEVBcIEIrcqQcI5gomfe2chAuFWA+FhFWi0FZFq88CVFLctFxwOqhS-64e+QT44oWgjYOFeFHFPFnifFU8FFGgtwwlyFkhlw04gqyQayuQmQclHFClBFRFSSKl5FglGlNFWlDcuStBxoa8Fg80r2SI8lXFil5lDSB+DONYql1l1FiidliAfQNwElBgQeGQ8g2Z7lJlnlZlRc4ylpE5-lVllFNlwVi8q8EIXOvRQa9e9ijIxAQ08AYQ8wKVxYAAtMSogFVSslZQJU1QJUejHmQJVdhtkhCJYtdqEimBkK1f3lhB1aXKxBBDRKOFFBHKmQ5MYHBBzqxOYbEV1B7CwplNlK2CNQgAlAOPIgVS2lkDcPVN8i+EyaYKJl6O7BgD9Deptb5d7uSHql6BYJOZhdDDVLNYuEvJcnJpuVtCbodHdTLqkmWDujPAUNBn0GtIajoOVoaCMF8kyVdT9P9FtQXhjhVJSguqTG6GQp9UpOWDFvHH9d1AbiLmjUNgokLPNlkLWGTGvHDaKHQUXstZtN1KcTlFteFJBJNTBBHNurNdJloFBnSMjWjBLNdUDbXiDamP0bMiYBVOIeATmkNsxNjiKPQWLauIkZzfdXgsImVE7nXLOPOdDIotIuKW+HsSmFrdtLUX7FzZZDzdBJuhrYLVXI9ktseitZLauHeiOW2IkMDSAlOPZIBkVgmDAcRkmSpBmC2n8qgltZmbBRkVkOKOpV1Qrq-KmLmkmC7LcltR6c+MIj7sjjXCFQKIAT1beOCLSIUl7W1VuS4kMn-IXVytfCMDdFMLQlcAYY1D1aKE5c5Rsn9cOswn-FgoXaKDujfF3VSOYBXcEYOKkM0q-DOYNclpGuPZgoICnGABgFzbOf+irs0gmYYYvBVEARRfkDtYgkChPTrYfQUMfRoKfYoufaJbQo1SAVMNdhve9s3b-JgnemAAzLrcHfrUfXiQlPdO-dDZIbcA2bcFoC2j7vfZghLU-WrNA2-a5doNAjQZKU9i3AMBuazU3RigfAPHtMbEWAsX2FAyfbA3g-yLOOlRxGSKmUtTmY-pQ-QxAwNkhAYhmKXWhOXaw-BEJpmeIhYOWECrUjnFParSXSzrkvyIJjODqgMHYlcOxCPeQ+WkwkMqwrANwIfYgjNs9W6SmMMPMkNlIwlC5IgqDfI3ErAJoOY8uVY+mmIqYrJg2bQqxOIjbaPVvcY243IJ45Y-GNY74yEuBgJTSZPJEWxQA3w244YFEyQ5pPurY6cpjf0S3EyTKQ+f-bmYA5iieNtOoFk0yTEz43k3GMMPqK-GiaYGYPOa4yCrANoLU947k3Kcso1QwaxL-W5d7UcRU8ClU7AFYH0-UwM349eIU0qWWDRfozw3Eek90zIPMzkzY3KV8o1K07TWpGvGU7wyotM1ENtP0Hs7E40yDOmDiY9OCBrgGl0zM3oPcw04c3iSs3YrafNQ3UNSliiEnRKOkZ3WndkbyiDGtMc7NssvSIJuM43YY-EalqBPw82uYM+F6pmj6rdv5pcC+bIj7qhGQ5s5YZi2tgxr3IfacO0VkLSLSI3PNO9aVA9lCKtOtKE9ufSnZmplAEnc1J6umh2guWoHU-oC1PsZYDcJYGi6C4Pnrgxi5ieVOhSRAEndSIMHUxoHNBNr3QxGYExFEpYC1FInI-y7S-jkKywcpoXWhAKvho+GWGEeJv4xYPbPkOYFMNeG7oplcdq-eo+jWoXQ5QBhoEIvcNYCrENqKDXB621Gg7a6nA1hesK45qpmOoXRZkugsvGBVpPGBoMNFtA81BxEG+tjgM60KHUwuiAfyhXYrYFjQqcDzpa6k+Uxm59p+Ztu1nKs6-BI23DN0vGK2+Qea5MOMKxAwdw8tjS321iwOxgWoYXWWPkVrAUCKoYdkprIIhVOmMBi5BMDW41vYY4UkZuw1aMO6bYtQe9eXBpeYD7jCHIj25c5m+jETtjPWxCIrtSEImxFSopMIfmqNlkNkCC5vQK0Ln+6LuLsbiOy08aMByAXPPbiHP0sKnBBMHCBe19sLtjBwQDZAJuzQRVCkPNYdb0th9NLhyrlOIUsq3B3a4LvriR01pLg4SKfmx3kYNFumj7pVAxyZs9cxwR2x2k2WlvlzQwY3g2nHODcS807peHk+DdF6HcAoRXughG3rZRCrkpwjUGqpxOO3LQTCHi3FvftS5Myu9YUgSPgZ2PofFzUpHmk3vdLzJdg+MaDOGEbKRcEmXp655nExuu1gVzZcFoRRbQkIumO3uEeHsODqjtTJ723Jy59vm5+Orx9exR0Z32HF0AQMEmMlwxGRQUTdqzqNuF3l5Fw5jrTqyVy8mV1I4l6kG3rBNYBFU-HNisrFRMxQzlywY-e12BF5xBvCIts9aF7ZEGkuqxAETYi1JYI16wcoWR1wW1wIxZKYLN3SEpAty5Pbk+BXKt1MAUjAhc1s+N4oW-nYYV-x1N2FLMpeBRpQixAYTQa3A6aKGiQcQY2C82GWft9LU0n0N58p+Z32sSwi2kDo2SE463vZ0u452Wq12jQUImGSJqu6EmOBwOK3J8dJ-WKUWeUnFUWAJG7DQlGJf5bfr14kI+LDSj+c0glMFT+UbTyooZwdxOQMMc2JWWNeUHrkbhij1JW8SDw52N3SrqZUdUXba2D7H7I0a2M0VLTi9hhMGkIzy1Mz8N7kaHlzjY3BCsRs5j4rzxLuSK+9yDCmIIgS+s1KzkkYOW7NvWBmEVoSem2Wg78hhccSUnbkAxVPpFormYKYvWGmTQrSIuC1R+WCcebMdceH-WGHkftH05fg6cnzmhSL+VPGan6SceU6073LuKOkSmEq3cHBCQnGEXy-Hq2ucjhj6Nxi05ycZXxX-6RzZD3r6SOCEuteIuLkNXMVoyVSA2U+L0lRiUYH3SsHz6cWdqaKzYGVE3tRQ6TjtDHPCs67NEVRR+ev3yQBUKdT8V0L82kVjv2pMUT7gfymVoExEJs0-xtSOf0WZf8eRD0jZ5JoWIja8J3QPYaBYon-NNKmB-4r97ex5C-n6RQxD9C6D-VMHBDxYax42KZekMf0fD0h7oSNeAZhGD77kfyh5f8pv2r4G9YEbvLNMSwmBjAAW1HOCCKCy7fsEB-pcgb+SPL+kByyAIciOU1Kity4baDNO70YHlgWmSLKEJ0SDT3dl2QfY8jwMoHIAr+p5ICpGx9z9F+MLrWZKvCkGy1yUgeEXo+A-KqC-y6ggATf2H7jlssWgNWHBX6pmBXKhzQvBckuCZ4zBVLW3j32UHcCvyB5KwQBVQHV8siyPbHHYiUhMkqQKFfVjQi0C2UdAsHeSpu1+JNUV4S-KgtIM7yxCF+SOVIfFW4rEBC6ABRqlkJPZ0VQ8elBfsgjsTGVOKGAMxuEJkpMRLg9IAvFjk3Qft9QOjItEIkuRsUPKGADxq0J0EIJOhN9N5tlUQYW8tOsib0I0KPgYBIm4wslB0N6TTCmSVBHRnkPfjzU8gyw7OJk3WHtDfQXQmYaJRMC6AdGxoAmvaWGHxUMANTM4ZMK2Higrh9lFyHkJTBwwcgxwjAL0zeGbDLhOw0StiX2GF4vqlwewPYCAA */
    id: 'next',
    context: {
      selectedChange: undefined,
      changes: [],
      time: 0,
    },
    initial: 'actors',
    states: {
      actors: {
        id: 'actors',
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
                target: '#open.funding',
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
                target: '#open.qa',
              },
            },
          },

          superQa: {
            description: 'Judges the current Dispute',
            on: {
              DO: {
                target: '#open.superQa',
                cond: 'isDispute',
              },
            },
          },

          trader: {
            description: 'Trades any of the NFTs in the current Change',
            on: {
              DO: {
                target: '#trading',
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
                target: '#pending.dispute',
                cond: 'isDisputable',
              },
            },
          },

          service: {
            description: 'Enacts the current Change because Ethereum',
            on: {
              DO: {
                target: '#enactable.serviceWorker',
                cond: 'isEnactable',
                actions: 'enact',
              },
            },
          },

          exited: {},
          approvalSet: {},
        },

        on: {
          EXIT: '.exited',
          EXIT_SINGLE: '.exited',
          BURN: '.exited',
          REVOKE_OPERATOR: '.approvalSet',
          APPROVE_OPENSEA: '.approvalSet',
          APPROVE_OPERATOR: '.approvalSet',
          REVOKE_OPENSEA: '.approvalSet',
        },
      },
      stack: {
        id: 'stack',
        description:
          'The stack of all changes can be navigated using the NEXT and PREV events.',
        type: 'parallel',
        states: {
          actions: {
            initial: 'open',
            states: {
              open: {
                id: 'open',
                initial: 'view',
                states: {
                  view: {},
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
                      },
                      FUND_DAI: {
                        target: '.funded',
                        cond: 'isFundableDai',
                      },
                      FUND_1155: {
                        target: '.funded',
                        cond: 'isFundable1155',
                      },
                      FUND_721: {
                        target: '.funded',
                        cond: 'isFundable721',
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
                            actions: 'qaResolve',
                          },
                          QA_REJECT: {
                            target: 'rejected',
                            actions: 'qaReject',
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
                    exit: 'focusUplink',
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
                  viewing: {
                    initial: 'type',
                    states: {
                      type: {
                        always: [
                          { target: 'resolved', cond: 'isResolved' },
                          { target: 'rejected', cond: 'isRejected' },
                          { target: 'disputed', cond: 'isDisputed' },
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
                        target: '#pending',
                        actions: 'tickTime',
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
              enacted: {
                id: 'enacted',
              },
              disputed: {
                always: {
                  target: 'enactable',
                  cond: 'isUnDisputed',
                },
              },
              enactable: {
                id: 'enactable',
                initial: 'viewing',
                states: {
                  viewing: {},
                  serviceWorker: {
                    always: {
                      target: '#enacted',
                      actions: 'enact',
                    },
                  },
                },
              },
              trading: {
                id: 'trading',
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
          view: {
            type: 'parallel',
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
              position: {
                initial: 'empty',
                states: {
                  empty: {
                    always: [
                      { target: 's0', cond: 'isPos0' },
                      { target: 's1', cond: 'isPos1' },
                      { target: 's2', cond: 'isPos2' },
                      { target: 's3', cond: 'isPos3' },
                      { target: 's4', cond: 'isPos4' },
                      { target: 's5', cond: 'isPos5' },
                      { target: 's6', cond: 'isPos6' },
                      { target: 's7', cond: 'isPos7' },
                      { target: 's8', cond: 'isPos8' },
                      { target: 's9', cond: 'isPos9' },
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
                on: { TICK_TIME: '.limbo' },
                states: {
                  limbo: {
                    always: [
                      { target: 't0', cond: 'isTime0' },
                      { target: 't1', cond: 'isTime1' },
                      { target: 't2', cond: 'isTime2' },
                      { target: 't3', cond: 'isTime3' },
                      { target: 't4', cond: 'isTime4' },
                      { target: 't5', cond: 'isTime5' },
                    ],
                  },
                  t0: {},
                  t1: {},
                  t2: {},
                  t3: {},
                  t4: {},
                  t5: { type: 'final' },
                },
              },
            },
          },
        },
      },
    },

    on: {
      BE_TRADER: {
        target: '#actors.trader',
        cond: 'isChange',
      },

      BE_PROPOSER: '#actors.proposer',

      BE_SERVICE: {
        target: '#actors.service',
        cond: 'isChange',
      },

      BE_SOLVER: {
        target: '#actors.solver',
        cond: 'isChange',
      },

      BE_EDITOR: {
        target: '#actors.editor',
        cond: 'isChange',
      },

      BE_DISPUTER: {
        target: '#actors.disputer',
        cond: 'isChange',
      },

      BE_QA: {
        target: '#actors.qa',
        cond: 'isChange',
      },

      BE_FUNDER: {
        target: '#actors.funder',
        cond: 'isChange',
      },

      BE_SUPER_QA: {
        target: '#actors.superQa',
        cond: 'isChange',
      },
      NEXT: {
        target: '.stack',
        cond: 'isNotLast',
        actions: 'next',
      },
      PREV: {
        target: '.stack',
        cond: 'isNotFirst',
        actions: 'prev',
      },
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  config
)
