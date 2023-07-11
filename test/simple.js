import { createMachine, assign, sendTo, sendParent, spawn } from 'xstate'
import { createTestModel, createTestMachine } from '@xstate/test'
const childMachine = createMachine({
  id: 'child',
  initial: 'chidle',
  context: {},
  states: {
    chidle: {
      entry: assign(() => {
        console.log('child entry')
        return { foo: 'bar' }
      }),
      on: {
        START: {
          target: 'active',
          actions: [
            assign(() => {
              console.log('sending')
              return { foo: 'baz' }
            }),
            sendParent('HELLO'),
          ],
        },
        ACTIVATE: {
          target: 'active',
        },
      },
    },
    active: {
      entry: assign(() => {
        console.log('child active entry')
        return { moo: 'bar' }
      }),
    },
  },
  preserveActionOrder: true,
  predictableActionArguments: true,
})

const parentMachine = createTestMachine({
  id: 'parent',
  initial: 'idle',
  context: {},
  states: {
    idle: {
      on: {
        ACTIVATE: {
          target: 'waiting',
          actions: assign({
            child: (context) => {
              console.log('spawning')
              return spawn(childMachine, { sync: true, autoForward: true })
            },
          }),
        },
      },
    },
    waiting: {
      entry: sendTo((ctx) => ctx.child, 'START'),
      on: {
        HELLO: {
          target: 'end',
          cond: (context) => {
            const snapshot = context.child.getSnapshot()
            console.log('cond', snapshot.context)
            return snapshot.context.moo === 'bar'
          },
        },
      },
    },
    end: {
      type: 'final',
    },
  },
  preserveActionOrder: true,
  predictableActionArguments: true,
})

describe('simple', () => {
  const model = createTestModel(
    createTestMachine({
      id: 'simple',
      initial: 'idle',
      context: { count: 0 },
      states: {
        idle: {
          always: {
            target: 'end',
            cond: (context) => context.count === 5,
          },
          on: {
            INC: {
              actions: assign({ count: (context) => context.count + 1 }),
            },
          },
        },
        end: {
          type: 'final',
        },
      },
    })
  )
  const paths = model.getSimplePaths({ traversalLimit: 100 })
  //   console.log(paths[0].steps[1])
  paths.forEach((path) => {
    it(path.description, () => {
      path.test()
    })
  })
})
