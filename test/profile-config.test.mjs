import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGovernorConfig } from '../src/profile-config.mjs'

const SAMPLE = `# profile patch
- insert:
    - id: subagent-governor
      name: "@local/dsh-subagent-governor"
      config:
        maxTotal: 5
        limitBehavior: deny
        quotaEnabled: true
        syncActiveCap: true
        reuseCheck: enforce-ask
        strongThreshold: 0.6
        candidateThreshold: 0.35
        candidateLimit: 5
        checkTtlMs: 900000
        guardTools: [subagent, subagent_fork]
        queryTimeoutMs: 1500
        injectHint: true
- insert:
    - id: other
      name: "other"
      config:
        maxTotal: 99
`

test('解析本插件条目的 config 块', () => {
  const config = parseGovernorConfig(SAMPLE)
  assert.ok(config, 'should parse')
  assert.equal(config.maxTotal, 5)
  assert.equal(config.limitBehavior, 'deny')
  assert.equal(config.quotaEnabled, true)
  assert.equal(config.reuseCheck, 'enforce-ask')
  assert.equal(config.strongThreshold, 0.6)
  assert.deepEqual(config.guardTools, ['subagent', 'subagent_fork'])
})

test('缺失条目返回 undefined', () => {
  assert.equal(parseGovernorConfig('- insert:\n    - id: x\n      config:\n        a: 1\n'), undefined)
  assert.equal(parseGovernorConfig(''), undefined)
  assert.equal(parseGovernorConfig(undefined), undefined)
})

test('到下一个条目为止', () => {
  const config = parseGovernorConfig(SAMPLE)
  assert.equal(config.maxTotal, 5)
  assert.notEqual(config.maxTotal, 99)
})
