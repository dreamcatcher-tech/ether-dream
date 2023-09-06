import { filters } from './machine.js'
import { is, and } from './conditions.js'
import { expect } from 'chai'
import test from './testFactory.js'

describe('solutions', () => {
  describe('handles simultaneous solutions', () => {
    test({
      toState: (state) =>
        state.matches('enacted') && is({ doubleSolved: true })(state.context),
      filter: and(
        filters.skipDefunding,
        filters.skipDisputes,
        filters.skipFunding,
        filters.skipTrading
      ),
      verify: async (sut) => {
        expect(sut.events.ENACT_DOUBLE_SOLUTION).to.have.been.calledOnce
      },
      debug: true,
    })
  })
  it('removes all solution shares and leaves only packet shares')
  it('merges shares with rounding residue going to first biggest share')
  it('tolerates a second solution being rejected')
  // want a solution that is still in the dispute period when the first solution is enacted
})
