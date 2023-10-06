import { isDirect } from './multiMachine.js'
import test from '../testFactory.js'
import { startLoggingActor, scripts } from './paths.js'
import { expect } from 'chai'
import {
  and,
  isCount,
  skipActors,
  skipAccountMgmt,
  skipNavigation,
  max,
} from './filters.js'
import Debug from 'debug'
const debug = Debug('test')

globalThis.process.env.MODEL === '1' &&
  describe('basics', () => {
    it('gets to enacted packet', (done) => {
      const actor = startLoggingActor(done, debug)
      const { proposePacket, resolve, solve, enact } = scripts
      actor(proposePacket, resolve, enact)
      expect(actor.state.matches('stack.open')).to.be.true
      expect(isDirect(actor.context, { type: 'PACKET' })).to.be.true

      actor(solve, resolve, enact)

      expect(actor.state.matches('stack.enacted')).to.be.true
      expect(isCount(1, { type: 'PACKET', enacted: true })(actor.state)).to.be
        .true

      done()
    })

    test('simple solve packet', {
      toState: isCount(1, { type: 'PACKET', enacted: true }),
      filter: and(
        skipActors('funder', 'trader', 'editor', 'superQa'),
        skipAccountMgmt(),
        max(1, { type: 'HEADER' }),
        max(1, { type: 'SOLUTION' }),
        max(0, { type: 'DISPUTE' }),
        skipNavigation
      ),
      sut: {},
    })

    it('can survive multiple dispute rounds')
  })
