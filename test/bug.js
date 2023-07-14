import { assign } from 'xstate'
import { createTestModel, createTestMachine } from '@xstate/test'

describe('bug', () => {
  const cond = (ctx) => ctx.counter === 0
  const model = createTestModel(
    createTestMachine({
      initial: 'idle',
      context: {
        counter: 0,
      },
      states: {
        idle: {
          on: {
            INC: {
              actions: assign({ counter: (ctx) => ctx.counter + 1 }),
              cond,
            },
          },
        },
      },
    })
  )

  const paths = model.getShortestPaths()
  describe(`shortest ${paths.length} paths`, () => {
    paths.forEach((path) => {
      it(path.description, async () => {
        await path.test({
          events: {
            INC: async ({ state: { context } }) => {
              if (!cond(context)) {
                throw new Error('cond not met but event fired')
              }
            },
          },
        })
      })
    })
  })
})
