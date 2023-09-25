import test from './testFactory.js'
import {
  and,
  isCount,
  skipActors,
  skipAccountMgmt,
  skipNavigation,
  max,
} from './multi/filters.js'

describe('packets', () => {
  test.only('simple solve packet', {
    toState: isCount(1, { type: 'PACKET', enacted: true }),
    filter: and(
      skipActors('funder', 'trader', 'editor', 'superQa'),
      skipAccountMgmt(),
      max(1, { type: 'HEADER' }),
      max(1, { type: 'SOLUTION' }),
      max(0, { type: 'DISPUTE' }),
      skipNavigation
    ),
    noCondense: true,
    debug: true,
  })

  it('qa receives a medallion on packet close')
  it('multiple solutions funded within disputeWindow')
  it('defund during disputeWindow is honored if solution rejected')
  it('solve a packet that has already been solved')
  it('wrap a packet in a solution to solve another packet')
  it('marks a packet pending after qa resolves a solution')
})
