import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeConfig } from '../src/config.mjs'
import { createLedger } from '../src/memory.mjs'
import { registerTools, renderStatus } from '../src/tools.mjs'

const FINISHED = { id: 'child-1', createdAt: 1, mode: 'continuable', label: '论文引用核查' }

function harness({ catalog = [FINISHED], sendMessage } = {}) {
  const registered = new Map()
  const ctx = {
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
  }
  const calls = { send: [] }
  const subagents = {
    async listChildren() {
      return catalog
    },
    async sendMessage(...args) {
      calls.send.push(args)
      if (sendMessage) return sendMessage(...args)
      return 'message-1'
    },
  }
  const counters = { blocked: 0, asked: 0, reused: 0 }
  const deps = {
    cfg: normalizeConfig({ candidateThreshold: 0.3 }),
    ledger: createLedger(),
    subagents,
    counters,
    isLive: (id) => id !== 'child-1',
    capacity: { builtinActiveCap: 8, effectiveActiveCap: 8, synced: false, reason: 'not-below' },
  }
  const dispose = registerTools(ctx, deps)
  return { registered, calls, counters, dispose, deps }
}

const exec = { agent: { id: 'parent-1' }, signal: new AbortController().signal }

test('registers four tools and dispose removes them', () => {
  const { registered, dispose } = harness()
  assert.deepEqual(
    [...registered.keys()].sort(),
    ['list_reusable_subagents', 'reuse_subagent', 'subagent_governor_diagnose', 'subagent_governor_status'],
  )
  dispose()
  assert.equal(registered.size, 0)
})

test('list_reusable_subagents ranks candidates and records the check', async () => {
  const { registered, deps } = harness()
  const tool = registered.get('list_reusable_subagents')
  const text = await tool.execute({ task: '论文参考文献核查', limit: 3 }, exec)
  const payload = JSON.parse(text)
  assert.equal(payload.total, 1)
  assert.equal(payload.candidates[0].subagentId, 'child-1')
  assert.ok(payload.candidates[0].score >= 0.3)
  assert.ok(deps.ledger.get('parent-1'))
})

test('reuse_subagent sends a follow-up message to a continuable child', async () => {
  const { registered, calls, counters } = harness()
  const tool = registered.get('reuse_subagent')
  const text = await tool.execute({ subagent_id: 'child-1', task: '继续核对引用' }, exec)
  const payload = JSON.parse(text)
  assert.equal(payload.reused, true)
  assert.equal(payload.messageId, 'message-1')
  assert.equal(calls.send.length, 1)
  assert.deepEqual(calls.send[0][2], [{ type: 'text', text: '继续核对引用' }])
  assert.equal(counters.reused, 1)
})

test('reuse_subagent rejects a non-direct child', async () => {
  const { registered } = harness()
  const tool = registered.get('reuse_subagent')
  await assert.rejects(tool.execute({ subagent_id: 'nope', task: 'x' }, exec), /not a direct child/)
})

test('reuse_subagent rejects a one-shot child', async () => {
  const { registered } = harness({ catalog: [{ id: 'child-2', createdAt: 2, mode: 'one-shot', label: '图片' }] })
  const tool = registered.get('reuse_subagent')
  await assert.rejects(tool.execute({ subagent_id: 'child-2', task: 'x' }, exec), /cannot receive follow-up/)
})

test('status renders totals and counters', async () => {
  const { registered } = harness()
  const tool = registered.get('subagent_governor_status')
  const text = await tool.execute({}, exec)
  assert.match(text, /会话总量：1/)
  assert.match(text, /复用检查：enforce/)
})

test('renderStatus marks a synced active cap', () => {
  const text = renderStatus({
    catalog: [FINISHED],
    cfg: normalizeConfig({}),
    counters: { blocked: 1, asked: 2, reused: 3 },
    capacity: { builtinActiveCap: 8, effectiveActiveCap: 5, synced: true },
    ledger: createLedger(),
    parentId: 'parent-1',
    isLive: () => true,
  })
  assert.match(text, /生效 5（联动生效）/)
  assert.match(text, /拦截 1，询问 2，复用 3/)
})
