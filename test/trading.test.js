import { description } from './utils.js'
import { initializeSut } from './sut.js'
import { machine } from './machine.js'
import Debug from 'debug'

describe(`trading`, () => {
  describe('header funding shares can trade', () => {
    const shortestPaths = machine.getShortestPaths({
      toState: (state) =>
        state.event.type === 'TRADE_ONCE' || state.event.type === 'TRADE_TWICE',
      filter: (state) =>
        state.matches('trading') ||
        state.matches('open') ||
        state.matches('idle'),
    })
    shortestPaths.length = 1
    shortestPaths.forEach((path, index) => {
      it(description(path, index), async () => {
        Debug.enable('test:sut')
        await path.test(await initializeSut())
      })
    })
  })
  it.skip('header content shares can trade')
  it.skip('header QA shares can be traded')

  it.skip('content shares can be traded')
  it.skip('funding shares can be traded')
  it.skip('can deny opensea operator access')
  it.skip('no trading before claimin')
  it.skip('unfunded packets are tradeable without claim')
})
