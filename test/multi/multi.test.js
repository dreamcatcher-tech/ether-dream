import { createTestModel } from '@xstate/test'
import { multiMachine } from './multiMachine.js'

describe('multiMachine', () => {
  const model = createTestModel(multiMachine)
  const paths = model.getShortestPaths({
    toState: (state) => {
      return state.context.selectedChange === 1
    },
    // filter,
  })
  paths.forEach((path) => {
    it(path.description, async () => {
      await path.test({})
    })
  })
})
