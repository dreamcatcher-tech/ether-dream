import { createMachine, assign } from 'xstate'

// use https://stately.ai/viz to visualize the machine

const DISPUTE_WINDOW_TICKS = 1
const DEFUND_WINDOW_TICKS = 2
const getChange = ({ context: { changes, selectedChange } }) => {
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
    guards.isHeader(context) || guards.isSolution(context),
  isSolution: is({ type: 'SOLUTION' }),
  isDispute: is({ type: 'DISPUTE' }),
  isEdit: is({ type: 'EDIT' }),
  isDisputed: is({ disputed: true }),
  isFunded: is({ funded: true }),
  isEnacted: is({ enacted: true }),
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
      selectedChange: ({ context }) => {
        console.log('selectedChange', context.changes.length)
        return context.changes.length
      },
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
    // qaDisputeWindowStart: ({ context, event }) => {},
    // focusUplink: ({ context, event }) => {},
    // enact: ({ context, event }) => {},
  },
}

export const multiMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDswA8AuBiAQgUQH0AVAJQEEARPEgbQAYBdRUABwHtYBLDTt5ZkGkQAWAEwAaEAE9EogJxyA7ADoAzHQBsARlUBWXQA5hqjXNUBfc5NSZchAAokA8vacBlavSZIQ7Ljz4BIQQxSRkEUUNdNU1ROkVFUVFtRUtrdGx8Ag8SADUASQBhPC8BP25efh9g0OlZLUVVGN05eMUDFtFVYTSQG0zCNycAGVzPRjKOCsDqkQk6iOEDURiNUS06SOE6XQ1e-rsCPAp8oidaCZ9ygKrQGvnw0UU5LVWtbY1hRKX9jMOTtz2ACqRHG3lYUxuQTmYVkTw0b10qnUwlRX1+tiyAEUyKUrpDKtCQg9ZKpnoi2uodj0rH0-lkAGJAgByVAu4N8BJmdxhC2SBgMb2MDQMGgMjQxA2yQPs1AIOLxEP8hNmxNhEQMcmEb1UBi0WkMdDkkqwzLwAA0iIrOcruYJeeE9Ea1PIkapWppUrSDo48LlrdcVTy1QstJqmssXt0EmThFpJcoAIYAYwwbAATrAsBbTgGubd7QhkStlnQ4-EWkokur1O1lPoUvpFFp5AaEym05ns+bTtl8syAOLDEqXJXTAvBYvKUvlxSVxIkostuTKHYaOgbTYabTddupjNZnBAkjMvO2ieIKczjZzhQLmsNFf6Fpi3SaF67PedrMkP1OADShAuNQZBnOykznkSV5xLO87VgsqhdHQq67DsGwtlociil+B5YGQ9iOE4YwEMBzIeLio42uOUGIdOME3nBi6IQYyENjoegNEsWh7N6GRJvuXb4YRxHAeQYFntRqrQWWDF3vBjrIq8a5GphSjtMYOFdr+uQAUBspkXgFEcoGdqTrR14VnJTG6q8bGKMIb7qBoEq8Zg-HfsoLDpmwfhgOmWAUE4ElQqqHTIcIchIVqmHCGKqjqpEawunInxYZF+gGBYrkYO5B7KAAZgArsgEB+QFQWUSZF4IGFygRVFcZanFCVioKTnJIkdAmM5PHpG5HZ5bAbAADYAG5lYFwVBoWtX1eo0VNZlCUOSuiEpboohiO6amabAygAI6JuVU2mYgs2RfNjWxUtfJkqtmgGpSdDUrtyiwIVLB+ViR2TZV+ZEudDUxc1fKatq7VrO88Saq9GDpompX+b9xn-aFb51RdRpXSDjx3qskQpUa3Qpa9kDcBmx1-ZBaPhZjC3XfFfKKGKyWfEs8jOST2W5ZmygQJwsAsIVGATRVKPU8GgOXcDN2PPC+MxvIYi6K9sB+aNnDJmAlPi5Jkvo3NWMy4zjyPclcaYXFug0n1OWwBgKYANbuZUe0+WAyBYCd1WIRsygpZq+oaCYLEmDWcSCjoKUNOoSSigYCb207Lt8G7n3IAVxX88gUBYEyrJHEQAAS3tEgaqivA5iG6hXznGIuyR+yxaymI0ug3jbdJuUnybOx2rvKO7GdFSVnA53nLIUAQFBkPkpequXldIl0mXcfZiEtdobwya0Gncz3fepgPQ+Z6P4-51P+r6PPwaL3Vy812v9cJc2rzN2G25yLozaiAn+8O73FOyA04e1PtnXOF8CCJC0DfQsd8q4r1ruvBuzMVhOXeO3ZmG4Vb-2Tv3VOg905gLHlAZQxUGRZ0gF7Kmes4HPCaHOZ4rRMKih0LoBKAomhrg-mIUUuwcG2zegAw+NwQHDyziQsBkBlAAAsRrgICngSBbgiBkBIFaGhIVgzrDLGoYwWpNryEiMiF+EV6y7E2kYC26JcGAPwcAwhoCR7gKkRAWR8iSHUN1lowsOjwb6LEGIdKJjQbPRQsHS6nwsqCIPkAsRxCc6uL5mAZxniqDKLOPYWBwQkibRQksUwZZNjWxagocJ3EWh6FFJ3foQi8FHwISfVJiTnHSNKs03O6TJ7ZNkA5aI0Nf6aksT1BKCh7raB2L-dSbZbEiOPkQjpST2kSPHkQIo-5iD5AALIjm8dNHJ7pkLbkCUUsw1IWqKHCg9dcLE4jaETsIuJjiM6HS8RBWhOTngImpJlOgpY-nigSuoQUcR5BliqRxXqXc7aPPsfEw6ygABWhVoCeJxAQX8QxRi7PeT4nJD1pzOVdEsZ6GCErGP9goAUywug9RqXxWJcLnkHUTEilFUA0VkAxXgAAUngQoGi9mnQiAS0UiQv4ko3A5IFBsNopVpdsLmMTYUNIcSfd6n10zfTwsMYY098iAhBHgNw+q3BbINR4CgPSIhfPyb8-5ApFAPgrsoBcSgkSSvjLMp56qPpfR+ga4EoICAyiLngYYVrNH7NkLan5wK4gAqdQhTCTRdRf12BsZ8mUHn1NEcyjV-q3oyMTOmOAbz8QS18UU5QbD27tyQrHcOfzwm-z+b7bN3qmW+s1d9ZQpahpjSodapC0RUTFL+RoDarcm2CjXK2zK6wO3KtzQPdOCjrXChWJzF4LwmHulGZ8NQmpOobnFC2HNdjVV7TXZ4mgWghXVU3cobdmFHxmDkDWP52pg4pTJJtYOjRRAXrmQQm9iSNZgAAO6SIwFIT65axx4svNbfpXx4g6CeOKBuChohpuRMzVEphsKdqvZ5D2LiIPQcSbB+Dd6H1QRQ6uNDzZELtESJ+pE04hnR0iKSoDJG81gdIZRmDcHtY0FEPRqSjGyyXJY5h9jfIzAIgFOldu7o4yfgE6u8jkj+aC2FtrNZhQNlrJ2datNrwX2NBMIhXYozMo1uqS0cd65+PLsvYJ3TiT9NCxFn2uAI1xoQACoGo12Qi5qONRu5Y0R7KGK6tuZ6SbwhfHRjsFo+hSUNAEdCupnmdNn1Ib5wzAWB3BdC4a4NmKRhjBi5EV1gS4jdWS+qSV5j1xkjfJ8QwwGnlCb5gLPzYAytBaHVG4VVSViNAclYhylyNA1mRODTUk6OjW0issPrTKBslf86WxFYBUxUIBEGwgv4+UCvyE4U8E3H2xcawllr8Q2sdCUhmhN+p7Jeo8yBhxe3xtSdvkrac7dCl0qNAYNrhguGoVfi2bYuXamMtIx7DsiYABGw0Rtq3TBrLWAB1DMjsyoWZ0f7MULxuIh0S9D2KyUXxdDnAKbbpG4YI0kc42ARB4YuOKq0kL1qwx6mUMkFKLdf0LprO0QULFDBxkdZFLorO83s5cVznnHOWmUJC6QSghAyC6oIBfNww6CbPoywkCK3Ra41hYiodQLntiZQrg5FXA81ec6ztz3nXuSpUL11QbITgdnG8nqbu7RIkgtAt02eyZhhSLYQnOFTmh3xrCYU8d3BDPfa5Kj7rXpCBcIaokhiI5v1xx+t4n6XTcHpGjB9xSd2eHG59IcmPgItkAYE13z1AyAOyA9xdGhAYZGjPueJGLCtz7JtbLLhnY4oCmkub9pnPvvEkd+7x7HvG-SFo+O7r8gQfDd6sKDd0EzJBXD+FV0Fsq5LnGDPWKzQc-g7Th2GYS5+hFUt72m35QLfLvXfQvZQA-EWI-fXYPUPc-K-PAK-YdCuFYeIcFZ-ZyV-BYbYHQbeZIZ6P5L0X7J5AAoAnfXvSRcAofCtD5Uke-FAp-ZsF-JPR0FKB3B6QJAURuP-ZQAAw6LZSARMYaYaSoMgxJZAPgPANAAWYAkvKqMuDobUN7ZyeyBIFiYwGsZeZoMKFiDDJVPLFHVXPfFlPgiAAQoQvgEQ0hYqCgwXSPVUdYTCGtT4MMWlL+Z4dQ2iJySHN7MFAgvQlVAw0A3g-gwQ4Qww6wrAQPQgHZGeXVa7W7IHXxMkWXOcd4bobYFApg5DdQFCFoHQNYL+PUJHBlR5SjbgsTN6DMbAYdSKV4RuThfQDqfQdUL+BETaJQV3N0ZselbuEozgKDMoz6Co9MKo+9G-aqIxWo7QeoqdOcdhUMKVRrAOBQZEOuPrUomjHHSor2STMYqPGo0XKYzKBo5yJohYY9RY1bKlMsL+NYvoyDAYzY4Yr2VQBInJfYuoo4mY048IG8JoNoz4IwKOZmIono5OdY8ooaJ4mgYQV42Qd4w4vQL4uYn4nQV4ePeQrUE5aJPwsEu4zyfMMAgAWxYFgxkNRm0XTTqjDDyMbiUHVB0CWFFwinm3bjjFMFuP6KqiJJJKkC9lGKoLL1dFHWpJMFpJS0QANC6EWIciI2em-g5PuK5LAGJNJIk1hIiEpIVxpO0DpNDF-hXHjzWEdwFBsUINKKVJVN5JoBeN2LsM1JFJbkwnFNH1MBXDaMNDQ3SihWR16M5IJOVJ5K9hhNtIpP0CpL1FFJ1OdJyxUHjyRE1HrV-mxJ9NxL9PPG5NVN0HVKFPDO1KdPpI+EWOOTLFREQm9OKNTMVP9MtK9g0GzPtIjMdN1J+NimiDaIiiMDvBQwVPxPTIDNVMUHrLDK1MjPzNDE+GQnj3snXANE618JTMAXNOrMDJoAMCHOFMbLFPpL1FaIinsmtj1Aim4h7ItJXLkHXNzNHObIlMMBWH+ODnbi6jiHnIrMXLxJ4EJKM3WU2XM1sO0TFG1CRCVz0HWDlWRJEF2FFzfD+TByGTuR7I-JGyEMJIxzYDJMrTeKMFdUnTY1RDvw6HVEciguSyRGeHaE0AQs4E-OUGQtQr5PrKwuBNwq2jDHAoQDWGm2gvFGPQ6HskouotorQrVJDN8Swm1CYqXxYoIswNRFdTfCDk1C1HIuTNfOdnWKoqQqoroutIYvEpwskvwrYrFFqOgtiiSINCwn4s0pQqEuDIFJH3kEYv0vsikrYsaANLfEiDBSMC6G6JhUrO4I0poq0qEqzJEswr0u-gMormkvCF2C4TwJ3N1D1GNH2DYFKngB8H6HCsQAAFpMiEB8q6BdocqNQFD6JLIqwG4NwnwmxkQOg2YZlBEBpeYvIfIOA-JSrthkDLl3QxQyx1gzAEp4qOthc44lgl08sWq9pWl0xSr3QrMNxtwNo2TZzN4EQ2IGqlBrjVYxs5r7LJtZLsFxUFt1wUplp1xRrWhbxIpmZXpDp5rxRXUkg5wOYv8Slbpv4rq1o8iXz+oBI9oC0tVExHrZ1YosINplDMIG4sNRrm5ugGhNhYZedOqDqfZzIKqbr7wlM5xRr2gNgngK5SZ+ZOx5qDZOEXhFL4sTYY1TA4ba5UJdDalprBsDMRZ9rEMR89BU1fYOZOoNhhByVrYrrbzW1g5VZ1ZNYwB5qMaZJKrsbTZ25zFv5Ngthq4QScoWb0BuBIBSq646p5B2hXDTBjEHx5AOt4hmsXhEtXpEwWA2rRoBC3AwAMA9b7IDalAEzmZglw4Og6oHojbZiyxgNSr9QsJQduJWgIcsIX56xSUMoFBtx1B3g-9Q7-0I7wcCNId6SFBK4qVWhCjNg-r-KCtGl05Q7jBR0H5V464N4+RoZKVjbAknQ-L8s-t4lKN5q1wKdqV9ARQ67HgnJ74+aP51xW79D5knEVkoAK7HMEFH5a6G4HJkIo7Es3wHIDRi626fUFlp6yFkAKF-cIBQ7twVgoZ2hdRg54gY6lMtRRckgLoVb+QuCmk96BdQ6lc9EFrg4CaUrhrlh-Y09rjNh3Q-5CCu1d6iskk5FhpwEP7Lkv6Xgf7Ng-6mZ4h-YK4P4LFWKX7IH1cddkkOlSq2i0SEh61txMptAX4vqPhESqdtxcHQEHq0a5CWZz7rYugkgvhnT1htwMZ2jOGsCVLQTS61UiEEVkVUUc4P7uIa1tg5wtouGEhyUWYkhPhvbXx5BGGXlWV+0xtj6WG7CkhXgTBGhT0kiNwaby9mZ77Pg3Ml9wxtGWUAtDtD9iHjG1BnJk7MpyKdAgVEgJ9ooikjFiNwHSNu1-VQ7xQmg2ElgPREdNRP1mwP8piEgzAEcNbt6IHQEgbe1YBi1+0P71ga09A4nnoEmP0EI7l8ZLZSnuy18xGcm-VgbRtB0DHObb8P46purNppzHKm0EQnIbcktK6nHcndGwBXGIDiHUQDTfqzBv4VoBmanf0UM3cGnr1vMZ7DHgxixkJZN58I4PQrH4RkIo4QLjAyQNwuCBsRNpGdnCwViwbH8No-ljmOEvhn13Q3wXcViyQbmtnlA7nSENj5q2SmMXmjnnoTnMTsKxBgTDyIaAWoHgXWngt5r4tAnA51g25pVb6mgf14RUQyKKKNmyMUW7jJEDsjtpmHnJxMXOZsWY4UMOMz73Qqkv47MTBkWKNKWfMhtDN2nS8uaGXJ8XgcW6nRk9ASmd0NN+Qt6J7QNAWAcwWDRXVugMoyyZtnSkCmhWSxA21jHrYeW9MBX9tAs2mwX38ZtNWOpoxw59RVwMFmZGgx9QmcTRHNmoGAcXGaXda6XLxEgVBnptD5AkjXCltaIf0Wg24UqtQuDrCZbIKDmHIoWuo2tmxkJ2oi6jBr6uCAchXZDVRYpHXqaDE0NuhP0AHVNv4x6Uoq4E2B9UxMdscP7DBn13hXS4wxAOY2se3VgarUITbG30cscRtgXiHNhtQdAuoK4Q5rZURodnR34FHOt9AR3m2x23pJbCdidUaOnxjnoERtBwbooe3zrMDdg2pYhv51pg4wGPX27uC98K7sj56a7kFfbZdNBY5z7-myWACNcX2A3R9bzpwKl24kHDECrRTU1P8kRtBJ0uoH2Fyn3APvcLD9736QPqdkIdy+6oOxAYOCMP8WgvhfKkQkQuD0P89MPsOD2o8NwVB1tDABQ-k0JiPD05clKKPuWAPDCgPQC1d-WGO7D2ZXV3hXCUjLkhrk9k3UJF16p+FqPDCSDu8LDQ6fn6w0MdAvauodXxQVxuO+EBQWgUPVKiDVPO9SDDCrCm3aXRPb4GxtPLldPXD9O59inHcsJNhNB8jyyRG0OrPt91Owj7ORPhXb8FjDkCN31rZZ9MDNgTHP9bk-PhGS6gvQC1OQCXFhPC3yTfFnOxKIpv4Fwlg5978Gwfl1gnQFX-CPdDCgiTCQjzDgPHO4EvhBR32kFn4EIDWUmngdhL7MIVPAjExjDTDQjQCxDkAJCpCd9NPkh75q4P3evHQtPvOM0vgtR0usm2dGvxvgizDkBMO7PB98uMKJSsIVAUgw2WwhuGh3DWJUIyRJ0ZTld+OxuJuWuTuwvzv3GY9xR24Y4dEFBBaEIkRnvcjRSCimrH3LOvujupvcuUaLvqCIhDBg32gng2F7vKn1vzbjS1sfn5sFTiHWP6x3QkgQLJSv56TyQ8DDF0n1pUqzT3yxNiHvgDjWL14rnwfwgWJBRoKngxBI60mEKITKjOeAm6jFn8Myxmjm0XdLZg4nCqPvVwTBiWAnYXb5r9RwZEIXq4nvtmjhaIolADEdyuhMnYlNeRsVWQPMGDfcl7Jj04x6SNwVgxk1honTA+kJfBiZEwAEZ93IufZ9e1BDeRe3etB1QEzG6v4sJkhk6bffT7iNiwCSa9f3hI+Xfjf3f5jknzfX5DE44AuMugX2fBiB1hZpoi3dmI-iwjeY-6TlxG76FlDgfy-t6lzK16-fFLkuvqT0IgksICr7vaZru1hIatRzPAvK+0zxwMzwh2vPlIKtSR-5Ax-6T1AGFmTooqeWiTyCTYA6A9fsicslBOuSzx-ugERze+qK4XLSW2fF+bg3otBz+znbxlDVDYp6SNorwMZN8wvrMRU+AVLkrAFEBf8a0P-a-oRnpJTJG6GaUUPYUmqocF+VZdMrAFUAwDL+v-G-vSVbj8MokW-EUMf2wHCA8BcA8iggNDCzFG63DBRubzn4V9e+S-WALoGoExt4B--UMNsG1BjJOuNKRIHx1f5YCOBGgbgVf1oF8CWy7+c3hmmYhHtu+tvPEpAMUDSCCBdAn4ve0bqC8jAuoBsBQI4EGAtBvA8foeX4YKcY2ywVgT33UEn85A5g2QeP0ND8NOugybQHDwwHqVPyxDVXpT2AqACwKD4JSM9HsJrQjAXyKysFRsrEMHsTFHcF0GjBWMZSclENrBSVwv94efgkbBgDP6O8m8dqFytbAFqEUNwcdUlArkdzrBx6afQKtRQwCf8ihfDH5KUPLD89EAkMVcIz3QL6gtGGvd8kFQwDQDWh3yA8h0PKEyUEqTHKsDGFiEYBcB4wkoaiDKEK8FgnMKoRsEiiaALYrPXIcMKaFUCVh7QtYZ0PVCNBZ0pKXdEHC1AHDfBRw-IVwNOGTDzh0wuKpdTwJGgKGLuduJYEsBAA */
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
  options
)
