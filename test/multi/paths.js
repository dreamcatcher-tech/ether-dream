import { ACCOUNT_MANAGEMENT_EVENTS, machine, options } from './multiMachine.js'
import { logConfig } from '../testFactory.js'
import { createActor, createMachine } from 'xstate'

export const startLoggingActor = (done, debug) => {
  const loggingOptions = logConfig(options)
  const logging = createMachine(machine.config, loggingOptions)
  const actor = createActor(logging).start()
  const NO_LOG = ['NEXT', 'PREV', ...ACCOUNT_MANAGEMENT_EVENTS]
  actor.subscribe({
    next: (state) => {
      debug('state', state.toStrings())
      debug(
        state.nextEvents.filter(
          (e) => !e.startsWith('BE_') && !NO_LOG.includes(e)
        )
      )
      sendBatch.state = state
      sendBatch.context = state.context
    },
    error: (error) => {
      done(error)
    },
    complete: () => {
      debug('DONE')
    },
  })

  const sendBatch = (...actions) => {
    const script = []
    for (const actionArray of actions) {
      if (!Array.isArray(actionArray)) {
        script.push(actionArray)
      } else {
        script.push(...actionArray)
      }
    }
    for (const action of script) {
      actor.send({ type: action })
    }
  }
  return sendBatch
}

export const scripts = {
  proposePacket: ['BE_PROPOSER', 'PROPOSE_PACKET'],
  fundEth: ['BE_FUNDER', 'DO_FUNDER', 'FUND_ETH'],
  resolveChange: [
    'BE_QA',
    'DO_QA',
    'QA_RESOLVE',
    'BE_DISPUTER',
    'DO_DISPUTER',
    'TICK_TIME',
    'BE_SERVICE',
    'ENACT',
  ],
  trade: ['BE_TRADER', 'DO_TRADER', 'TRADE_SOME_FUNDS', 'TRADE_SOME_CONTENT'],
  solve: ['BE_SOLVER', 'PROPOSE_SOLUTION'],
}
