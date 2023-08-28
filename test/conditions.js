import { assign } from 'xstate'
import Immutable from 'immutable'

export const not =
  (...args) =>
  (ctx) => {
    const record = getRecord(ctx.transitions, ctx.cursorId)
    for (const conditions of args) {
      for (const key in conditions) {
        checkRecord(record, key)
        if (record[key] === conditions[key]) {
          return false
        }
      }
    }
    return true
  }

export const is =
  (...args) =>
  (ctx) => {
    const record = getRecord(ctx.transitions, ctx.cursorId)
    for (const conditions of args) {
      for (const key in conditions) {
        checkRecord(record, key)
        if (record[key] !== conditions[key]) {
          return false
        }
      }
    }
    return true
  }

export const isAny =
  (...args) =>
  (ctx) => {
    const record = getRecord(ctx.transitions, ctx.cursorId)
    for (const conditions of args) {
      for (const key in conditions) {
        checkRecord(record, key)
        if (record[key] === conditions[key]) {
          return true
        }
      }
    }
    return false
  }
export const and =
  (...functions) =>
  (...args) =>
    functions.every((fn) => fn(...args))

export const change = (patch) =>
  assign({
    transitions: (ctx) => {
      const record = ctx.transitions.get(ctx.cursorId)
      const next = merge(record, patch)
      return ctx.transitions.set(ctx.cursorId, next)
    },
  })
export const global = (patch) =>
  assign({
    global: (ctx) => merge(ctx.global, patch),
  })
export const globalIs =
  (...args) =>
  ({ global }) => {
    for (const conditions of args) {
      for (const key in conditions) {
        checkRecord(global, key)
        if (global[key] !== conditions[key]) {
          return false
        }
      }
    }
    return true
  }

const getRecord = (map, key) => {
  const record = map.get(key)
  if (!Immutable.Record.isRecord(record)) {
    throw new Error(`Record for key ${key} is not an Immutable.Record`)
  }
  return record
}
const checkRecord = (record, key) => {
  if (!Immutable.Record.isRecord(record)) {
    throw new Error(`Record is not an Immutable.Record`)
  }
  if (!record.has(key)) {
    throw new Error(`No key ${key} found in record`)
  }
}
const merge = (record, patch) => {
  for (const key in patch) {
    checkRecord(record, key)
  }
  return record.merge(patch)
}
