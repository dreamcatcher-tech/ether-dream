import { ACCOUNT_MANAGEMENT_EVENTS, machine, options } from './multiMachine.js'
import { logConfig } from '../testFactory.js'
import { createActor, createMachine } from 'xstate'
import equals from 'fast-deep-equal'

export const startLoggingActor = (done, debug) => {
  const loggingOptions = logConfig(options, debug)
  const logging = createMachine(machine.config, loggingOptions)
  const actor = createActor(logging).start()
  const NO_LOG = ['NEXT', 'PREV', ...ACCOUNT_MANAGEMENT_EVENTS]
  actor.subscribe({
    next: (state) => {
      debug('state', state.toStrings())
      debug(
        'nextEvents',
        state.nextEvents.filter(
          (e) => !e.startsWith('BE_') && !NO_LOG.includes(e)
        )
      )
      send.state = state
      send.context = state.context
    },
    error: (error) => {
      done(error)
    },
    complete: () => {
      debug('DONE')
    },
  })

  const send = (...actions) => {
    const script = []
    for (const actionArray of actions) {
      if (!Array.isArray(actionArray)) {
        script.push(actionArray)
      } else {
        script.push(...actionArray)
      }
    }
    for (const action of script) {
      debug('sending', action)
      const { state } = send
      actor.send({ type: action })
      if (state) {
        if (state.matches(send.state.value)) {
          if (equals(state.context, send.state.context)) {
            throw new Error(
              `state did not change after ${action} in state: ${state.toStrings()}`
            )
          }
        }
      }
    }
  }
  return send
}

export const scripts = {
  proposePacket: ['BE_PROPOSER', 'PROPOSE_PACKET'],
  fundEth: ['BE_FUNDER', 'DO_FUNDER', 'FUND_ETH'],
  resolve: ['BE_QA', 'DO_QA', 'QA_RESOLVE'],
  disputeResolve: ['BE_DISPUTER', 'DO_DISPUTER', 'DISPUTE_RESOLVE'],
  uphold: ['BE_SUPER_QA', 'DO_SUPER_QA', 'TICK_TIME', 'DISPUTE_UPHELD'],
  enact: ['BE_DISPUTER', 'DO_DISPUTER', 'TICK_TIME', 'BE_SERVICE', 'ENACT'],
  trade: ['BE_TRADER', 'DO_TRADER', 'TRADE_SOME_FUNDS', 'TRADE_SOME_CONTENT'],
  solve: ['BE_SOLVER', 'PROPOSE_SOLUTION'],
}
