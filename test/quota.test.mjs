import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideQuota, remainingQuota } from '../src/quota.mjs'

test('under the cap allows the call', () => {
  assert.equal(decideQuota({ total: 2, maxTotal: 3 }), null)
})

test('maxTotal=0 blocks new subagents', () => {
  const decision = decideQuota({ total: 0, maxTotal: 0 })
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /禁止新建/)
  assert.equal(decideQuota({ total: 5, maxTotal: 0 }).kind, 'deny')
})

test('ask behavior returns bilingual ask decision', () => {
  const decision = decideQuota({ total: 3, maxTotal: 3, limitBehavior: 'ask' })
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /上限 3/)
  assert.equal(typeof decision.displayReason.en, 'string')
  assert.equal(typeof decision.displayReason.zh, 'string')
})

test('deny behavior returns a deny decision without approval', () => {
  const decision = decideQuota({ total: 5, maxTotal: 3, limitBehavior: 'deny' })
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /上限 3/)
  assert.match(decision.reason, /含已运行结束的子代理/)
})

test('remaining quota reports zero at the cap', () => {
  assert.equal(remainingQuota({ total: 3, maxTotal: 3 }), 0)
  assert.equal(remainingQuota({ total: 1, maxTotal: 3 }), 2)
  assert.equal(remainingQuota({ total: 1, maxTotal: 0 }), 0)
})
