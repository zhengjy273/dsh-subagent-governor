import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readActiveCap, restoreActiveCap, syncActiveCap, writeActiveCap } from '../src/capacity.mjs'

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function fakeSubagents(initial = 8) {
  let current = initial
  return {
    config: {
      maxActiveSubagents: {
        get: () => current,
        [VOLATILE_WRITE]: (value) => {
          current = value
        },
      },
    },
    current: () => current,
  }
}

test('reads the builtin active cap', () => {
  const subagents = fakeSubagents(8)
  assert.equal(readActiveCap(subagents), 8)
})

test('lowers the builtin cap when maxTotal is below it', () => {
  const subagents = fakeSubagents(8)
  const result = syncActiveCap({ subagents, maxTotal: 5 })
  assert.equal(result.synced, true)
  assert.equal(result.builtinActiveCap, 8)
  assert.equal(result.effectiveActiveCap, 5)
  assert.equal(subagents.current(), 5)
})

test('never raises the builtin cap', () => {
  const subagents = fakeSubagents(8)
  const result = syncActiveCap({ subagents, maxTotal: 12 })
  assert.equal(result.synced, false)
  assert.equal(result.reason, 'not-below')
  assert.equal(subagents.current(), 8)
})

test('maxTotal=0 (blocked) leaves the builtin cap alone', () => {
  const subagents = fakeSubagents(8)
  const result = syncActiveCap({ subagents, maxTotal: 0 })
  assert.equal(result.synced, false)
  assert.equal(result.reason, 'blocked')
  assert.equal(subagents.current(), 8)
})

test('syncActiveCap=false disables the linkage', () => {
  const subagents = fakeSubagents(8)
  const result = syncActiveCap({ subagents, maxTotal: 2, syncEnabled: false })
  assert.equal(result.synced, false)
  assert.equal(result.reason, 'disabled')
  assert.equal(subagents.current(), 8)
})

test('a write protocol failure degrades without throwing', () => {
  const subagents = { config: { maxActiveSubagents: { get: () => 8 } } }
  const result = syncActiveCap({ subagents, maxTotal: 2 })
  assert.equal(result.synced, false)
  assert.equal(result.reason, 'write-failed')
  assert.ok(result.error)
})

test('restore writes the original cap back', () => {
  const subagents = fakeSubagents(8)
  const result = syncActiveCap({ subagents, maxTotal: 5 })
  assert.equal(subagents.current(), 5)
  restoreActiveCap(subagents, result)
  assert.equal(subagents.current(), 8)
})

test('restore is a no-op when nothing was synced', () => {
  const subagents = fakeSubagents(8)
  restoreActiveCap(subagents, { synced: false, builtinActiveCap: 8 })
  assert.equal(subagents.current(), 8)
})

test('writeActiveCap rejects invalid values', () => {
  const subagents = fakeSubagents(8)
  assert.throws(() => writeActiveCap(subagents, 0))
  assert.throws(() => writeActiveCap(subagents, Number.NaN))
})
