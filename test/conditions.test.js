import { is, not, isAny, and } from './conditions.js'
import { expect } from 'chai'
import Immutable from 'immutable'

describe('conditions', () => {
  it('rejects if key is not part of the immutable record', () => {
    const Test = Immutable.Record({ foo: 'bar' })
    const ctx = { transitions: new Map(), cursorId: 'foo' }

    ctx.transitions.set('foo', Test())
    expect(is({ foo: 'bar' })(ctx)).to.be.true
    expect(is({ foo: 'baz' })(ctx)).to.be.false
    expect(() => is({ bar: 'baz' })(ctx)).to.throw('No key bar found in record')
  })
  it('rejects if value is not an immutable record', () => {
    const ctx = { transitions: new Map(), cursorId: 'cursor0' }
    ctx.transitions.set('cursor0', { foo: 'bar' })
    expect(() => is({ foo: 'bar' })(ctx)).to.throw('not an Immutable.Record')
  })

  const base = { foo: 'bar', baz: 'qux' }
  const Test = Immutable.Record(base)
  const ctx = {
    transitions: new Map(),
    cursorId: 'foo',
    global: Test(),
  }
  ctx.transitions.set('foo', Test())
  const nots = {
    transitions: new Map(),
    cursorId: 'foo',
    global: { ...base },
  }
  nots.transitions.set('foo', { ...base })
  const errNoKey = 'No key bar found in record'
  // const errRec = 'Record is not an Immutable.Record'
  const errKey = 'Record for key foo is not an Immutable.Record'
  it('is', () => {
    expect(is({ foo: 'bar', baz: 'qux' })(ctx)).to.be.true
    expect(is({ foo: 'bar' })(ctx)).to.be.true
    expect(is({ baz: 'qux' })(ctx)).to.be.true
    expect(is({ foo: 'baz' })(ctx)).to.be.false
    expect(() => is({ bar: 'baz' })(ctx)).to.throw(errNoKey)
    expect(() => is({ bar: 'baz' })(nots)).to.throw(errKey)
  })
  it('not', () => {
    expect(not({ foo: 'baz' })(ctx)).to.be.true
    expect(not({ foo: 'bar' })(ctx)).to.be.false
    expect(not({ baz: 'qux' })(ctx)).to.be.false
    expect(not({ foo: 'baz', baz: 'qux' })(ctx)).to.be.false
    expect(() => not({ bar: 'baz' })(ctx)).to.throw(errNoKey)
    expect(() => not({ foo: 'baz' })(nots)).to.throw(errKey)
  })
  it('isAny', () => {
    expect(isAny({ foo: 'baz' }, { foo: 'bar' })(ctx)).to.be.true
    expect(isAny({ foo: 'baz' }, { baz: 'qux' })(ctx)).to.be.true
    expect(isAny({ foo: 'baz' }, { baz: 'baz' })(ctx)).to.be.false
    expect(() => isAny({ foo: 'baz' }, { bar: 'baz' })(ctx)).to.throw(errNoKey)
    expect(() => isAny({ foo: 'baz' })(nots)).to.throw(errKey)
  })
  it('and', () => {
    expect(and(is({ foo: 'bar' }), not({ foo: 'qux' }))(ctx)).to.be.true
    expect(and(is({ foo: 'bar' }), not({ foo: 'bar' }))(ctx)).to.be.false
  })
  it.skip('change')
  it.skip('global')
  it.skip('globalIs')
})
