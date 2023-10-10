import test from '../testFactory.js'
import { expect } from 'chai'
import {
  and,
  isCount,
  withActors,
  skipEvents,
  skipDisputes,
  skipDefunding,
  skipAccountMgmt,
  skipFundPackets,
  max,
  withEth,
} from './filters.js'
import { startLoggingActor, scripts } from './paths.js'
import Debug from 'debug'
const debug = Debug('test')

globalThis.process.env.MODEL === '1' &&
  describe('funding', () => {
    const toState = isCount(1, {
      type: 'HEADER',
      enacted: true,
      fundedEth: true,
      qaResolved: true,
      tradedFundsSome: true,
      tradedContentSome: true,
    })
    it('funds a header', (done) => {
      const actor = startLoggingActor(done, debug)

      const { proposePacket, fundEth, resolve, time, enact, trade } = scripts
      actor(proposePacket, fundEth, resolve, time, enact)
      expect(
        isCount(1, { type: 'HEADER', enacted: true, fundedEth: true })(
          actor.state
        )
      ).to.be.true

      actor('PREV', trade)
      expect(toState(actor.state)).to.be.true
      expect(actor.context.changes.length).to.equal(2)

      done()
    })
    test('funds and trades a header', {
      toState,
      filter: and(
        withActors('funder', 'qa', 'time', 'service', 'trader'),
        withEth(),
        skipAccountMgmt(),
        skipDisputes(),
        skipDefunding(),
        skipFundPackets(),
        skipEvents('TRADE_ALL_CONTENT', 'TRADE_ALL_FUNDS'),
        max(2)
      ),
      sut: {},
    })

    it('can survive multiple dispute rounds')
  })
