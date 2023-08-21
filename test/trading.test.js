import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine, is, filters } from './machine.js'

describe(`trading`, () => {
  describe('header funding shares can trade', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('open') && is({ tradedFunds: true })(state.context),
      filter: (state) =>
        state.matches('open') ||
        state.matches('idle') ||
        state.matches('tradeFunds'),
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('header content shares can trade', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('enacted') && is({ contentTraded: true })(state.context),
      filter: filters.skipFunding,
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  describe('packet content shares can trade', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.matches('solved') && is({ contentTraded: true })(state.context),
      filter: filters.skipFunding,
    })
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        await path.test(await initializeSut())
      })
    })
  })
  it.skip('header QA shares can be traded')

  it.skip('content shares can be traded')
  it.skip('funding shares can be traded')
  it.skip('can deny opensea operator access')
  it.skip('no trading before claimin')
  it.skip('unfunded packets are tradeable without claim')
})
