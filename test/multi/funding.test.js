import test from '../testFactory.js'
import { expect } from 'chai'
import {
  and,
  isCount,
  skipActors,
  skipEvents,
  skipDisputes,
  skipDefunding,
  skipAccountMgmt,
  skipFundPackets,
  max,
} from './filters.js'
import { startLoggingActor, scripts } from './paths.js'
import Debug from 'debug'
const debug = Debug('test')

globalThis.process.env.MODEL === '1' &&
  describe('funding', () => {
    it('funds a header', (done) => {
      const actor = startLoggingActor(done, debug)

      const { proposePacket, fundEth, resolve, enact, trade } = scripts
      actor(proposePacket, fundEth, resolve, enact)
      expect(
        isCount(1, { type: 'HEADER', enacted: true, fundedEth: true })(
          actor.state
        )
      ).to.be.true

      actor('PREV', trade)
      expect(
        isCount(1, {
          type: 'HEADER',
          enacted: true,
          fundedEth: true,
          tradedFundsSome: true,
          tradedContentSome: true,
        })(actor.state)
      ).to.be.true
      expect(actor.context.changes.length).to.equal(2)

      done()
    })
    test('funds and trades a header', {
      toState: isCount(1, {
        type: 'HEADER',
        enacted: true,
        fundedEth: true,
        qaResolved: true,
        tradedFundsSome: true,
        tradedContentSome: true,
      }),
      filter: and(
        skipActors('proposer', 'solver', 'editor', 'superQa'),
        skipEvents('FUND_DAI', 'FUND_1155', 'FUND_721'),
        skipAccountMgmt(),
        skipDisputes(),
        skipDefunding(),
        skipFundPackets(),
        max(2)
      ),
      sut: {},
    })

    it('can survive multiple dispute rounds')
  })
