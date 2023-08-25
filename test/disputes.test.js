// import { is, filters, and } from './machine.js'
// import { expect } from 'chai'
// import test from './testFactory.js'

// describe('disputes', () => {
//   describe('dispute a header', () => {
//     test({
//       toState: (state) =>
//         state.matches('pending') &&
//         is({ defundStarted: true, defundEnded: false })(state.context),
//       filter: and(
//         filters.skipPacketFunding,
//         filters.skipTrading,
//         filters.allowedStates('idle', 'open', 'defund', 'pending'),
//         filters.dai
//       ),
//       verify: (sut) =>
//         expect(sut.tests.defundExitAfterQa).to.have.been.calledOnce &&
//         expect(sut.tests.defundInvalidStart).to.have.been.calledOnce &&
//         expect(sut.tests.defundInvalidStop).to.have.been.calledOnce,
//     })
//   })
//   it.skip('reverts if dispute window has passed')
//   it.skip('disputes cannot be disputed')
//   it.skip('cannot dispute a packet')
// })
