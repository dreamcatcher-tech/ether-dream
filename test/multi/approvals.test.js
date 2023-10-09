import test from '../testFactory.js'
import { startLoggingActor, scripts } from './paths.js'
import { expect } from 'chai'
import {
  and,
  isCount,
  withActors,
  skipAccountMgmt,
  skipDefunding,
  skipEvents,
  max,
} from './filters.js'
import Debug from 'debug'
const debug = Debug('test')

globalThis.process.env.MODEL === '1' &&
  describe('basics', () => {
    it('manually trades on opensea', (done) => {
      const actor = startLoggingActor(done, debug)
      const { proposePacket, fundEth, openSeaFunds } = scripts
      actor(proposePacket, fundEth, openSeaFunds)
      expect(isCount(1, { type: 'HEADER', tradedFundsSome: true })(actor.state))
        .to.be.true
      done()
    })
    test('can by default trade on opensea', {
      toState: isCount(1, { type: 'HEADER', tradedFundsSome: true }),
      filter: and(
        withActors('proposer', 'funder', 'openSea'),
        skipAccountMgmt(),
        max(1),
        skipDefunding(),
        skipEvents('FUND_DAI', 'FUND_1155', 'FUND_721')
      ),
      sut: {},
    })
  })
