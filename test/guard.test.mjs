import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeConfig } from '../src/config.mjs'
import { createLedger } from '../src/memory.mjs'
import { onPreExecute } from '../src/guard.mjs'

const FINISHED = { id: 'child-1', createdAt: 1, mode: 'continuable', label: '论文引用核查' }
const ONESHOT = { id: 'child-2', createdAt: 2, mode: 'one-shot', label: '图片压缩' }

function cfg(overrides = {}) {
  return normalizeConfig({ strongThreshold: 0.6, candidateThreshold: 0.35, ...overrides })
}

function call(name, args) {
  return { name, arguments: args, agent: { id: 'parent-1' } }
}

function makeApproved() {
  const set = new Set()
  let lastSet = undefined
  return {
    set(id) { set.add(id); lastSet = id },
    take(id) { const had = set.has(id); set.delete(id); return had },
    lastSet() { return lastSet },
  }
}

function harness({ catalog = [FINISHED], listChildren, overrides = {}, counters = { blocked: 0, asked: 0, reused: 0 }, askUser, askReuse, approvedReuse } = {}) {
  const state = { nextCalls: 0, catalogCalls: 0, reuseAsks: 0, reuseCalls: 0, reuseArgs: undefined }
  const deps = {
    cfg: cfg(overrides),
    ledger: createLedger({ ttlMs: 60_000 }),
    counters,
    warn: () => {},
    askUser,
    askReuse: askReuse && (async (exec, args) => {
      state.reuseAsks += 1
      return askReuse(exec, args)
    }),
    reuse: async (exec, top, task) => {
      state.reuseCalls += 1
      state.reuseArgs = { top, task }
    },
    approvedReuse: approvedReuse ?? makeApproved(),
    listChildren: listChildren ?? (async () => {
      state.catalogCalls += 1
      return catalog
    }),
  }
  const next = async () => {
    state.nextCalls += 1
    return { kind: 'allow' }
  }
  return { deps, state, next, counters }
}

test('ignores tools outside guardTools', async () => {
  const { deps, state, next } = harness({})
  const result = await onPreExecute(call('bash', {}), next, deps)
  assert.equal(result.kind, 'allow')
  assert.equal(state.nextCalls, 1)
  assert.equal(state.catalogCalls, 0)
})

test('enforce reuses the similar finished child automatically', async () => {
  const { deps, state, next } = harness({ overrides: { reuseCheck: 'enforce' } })
  const result = await onPreExecute(
    call('subagent', { description: '论文参考文献核查', prompt: '核对参考文献' }),
    next,
    deps,
  )
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /已复用/)
  assert.match(result.reason, /child-1/)
  assert.equal(state.reuseCalls, 1)
  assert.equal(state.nextCalls, 0)
  assert.equal(deps.counters.reused, 1)
})

test('enforce falls through to quota when nothing is reusable', async () => {
  const { deps, state, next } = harness({ overrides: { reuseCheck: 'enforce' }, catalog: [ONESHOT] })
  const result = await onPreExecute(call('subagent', { description: '图片压缩' }), next, deps)
  assert.equal(result.kind, 'allow')
  assert.equal(state.reuseCalls, 0)
})

test('enforce-ask asks whether to reuse and forwards automatically when approved', async () => {
  const { deps, state, next } = harness({
    overrides: { reuseCheck: 'enforce-ask' },
    askReuse: async () => ({ kind: 'reuse' }),
  })
  const result = await onPreExecute(
    call('subagent_fork', { description: '论文参考文献核查', prompt: '核对参考文献' }),
    next,
    deps,
  )
  assert.equal(state.reuseAsks, 1)
  assert.equal(state.reuseCalls, 1)
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /已复用/)
  assert.match(result.reason, /child-1/)
  assert.equal(state.nextCalls, 0)
})

test('enforce-ask allows creating when the user declines reuse', async () => {
  const { deps, state, next } = harness({
    overrides: { reuseCheck: 'enforce-ask' },
    askReuse: async () => ({ kind: 'skip' }),
  })
  const result = await onPreExecute(
    call('subagent', { description: '论文参考文献核查', prompt: '核对参考文献' }),
    next,
    deps,
  )
  assert.equal(result.kind, 'allow')
  assert.equal(state.nextCalls, 1)
})

test('enforce-ask asks to create only after reuse is declined and the cap is hit', async () => {
  const asked = []
  const { deps, state, next } = harness({
    catalog: [{ id: 'a', createdAt: 1, mode: 'one-shot' }, { id: 'b', createdAt: 2, mode: 'one-shot' }],
    overrides: { reuseCheck: 'enforce-ask', maxTotal: 2, limitBehavior: 'ask' },
    askReuse: async () => ({ kind: 'skip' }),
    askUser: async (exec, args) => {
      asked.push(args.decision.kind)
      return { kind: 'allow' }
    },
  })
  const result = await onPreExecute(call('subagent', { description: '全新任务', prompt: '做点别的' }), next, deps)
  assert.equal(result.kind, 'allow')
  assert.equal(state.nextCalls, 1)
  assert.deepEqual(asked, ['ask'])
  assert.equal(state.reuseAsks, 0)
})

test('enforce-ask denies when the user declines both reuse and creation', async () => {
  const { deps, state, next } = harness({
    catalog: [{ id: 'a', createdAt: 1, mode: 'one-shot' }],
    overrides: { reuseCheck: 'enforce-ask', maxTotal: 1, limitBehavior: 'ask' },
    askReuse: async () => ({ kind: 'skip' }),
    askUser: async () => ({ kind: 'reject', picked: '不新建（放弃）' }),
  })
  const result = await onPreExecute(call('subagent', { description: '全新任务' }), next, deps)
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /你选择了不新建/)
  assert.match(result.reason, /自行判断/)
  assert.match(result.reason, /直接/)
  assert.equal(state.nextCalls, 0)
})

test('quota deny hands the decision back with a reuse hint when a candidate exists', async () => {
  const { deps, next } = harness({
    catalog: [FINISHED, ONESHOT],
    overrides: { maxTotal: 1, limitBehavior: 'deny', reuseCheck: 'off' },
  })
  const result = await onPreExecute(call('subagent', { description: '论文引用核查' }), next, deps)
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /自行判断/)
  assert.match(result.reason, /reuse_subagent/)
  assert.match(result.reason, /child-1/)
})

test('advise records the check but allows the call', async () => {
  const { deps, next } = harness({ overrides: { reuseCheck: 'advise' } })
  const result = await onPreExecute(
    call('subagent', { description: '论文参考文献核查', prompt: '核对参考文献' }),
    next,
    deps,
  )
  assert.equal(result.kind, 'allow')
  assert.equal(deps.ledger.get('parent-1').top.subagentId, 'child-1')
})

test('off skips the catalog entirely when quota is disabled', async () => {
  const { deps, state, next } = harness({ overrides: { reuseCheck: 'off', quotaEnabled: false } })
  const result = await onPreExecute(
    call('subagent', { description: '论文参考文献核查', prompt: '核对参考文献' }),
    next,
    deps,
  )
  assert.equal(result.kind, 'allow')
  assert.equal(state.catalogCalls, 0)
})

test('quota ask triggers at the cap', async () => {
  const { deps, next } = harness({
    catalog: [{ id: 'a', createdAt: 1, mode: 'one-shot' }, { id: 'b', createdAt: 2, mode: 'one-shot' }],
    overrides: { maxTotal: 2, limitBehavior: 'ask', reuseCheck: 'off' },
  })
  const result = await onPreExecute(call('subagent', { description: '新任务', prompt: '做点别的' }), next, deps)
  assert.equal(result.kind, 'ask')
  assert.match(result.reason, /上限 2/)
})

test('quota deny refuses without approval', async () => {
  const { deps, next } = harness({
    catalog: [{ id: 'a', createdAt: 1, mode: 'one-shot' }],
    overrides: { maxTotal: 1, limitBehavior: 'deny', reuseCheck: 'off' },
  })
  const result = await onPreExecute(call('subagent', { description: '新任务' }), next, deps)
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /quotaEnabled=false/)
})

test('a catalog read failure fails open', async () => {
  const { deps, next } = harness({ listChildren: async () => { throw new Error('boom') } })
  const result = await onPreExecute(call('subagent', { description: '论文引用核查' }), next, deps)
  assert.equal(result.kind, 'allow')
})

test('after an explicit check, the same similar task is still blocked', async () => {
  const { deps, next } = harness({ overrides: { reuseCheck: 'enforce' } })
  deps.ledger.set('parent-1', {
    task: '论文引用核查',
    top: { subagentId: 'child-1', label: '论文引用核查', score: 0.9 },
  })
  const result = await onPreExecute(call('subagent', { description: '论文参考文献核查' }), next, deps)
  assert.equal(result.kind, 'deny')
})

test('a changed task after the check is allowed', async () => {
  const { deps, next } = harness({ overrides: { reuseCheck: 'enforce' } })
  deps.ledger.set('parent-1', {
    task: '论文引用核查',
    top: { subagentId: 'child-1', label: '论文引用核查', score: 0.9 },
  })
  const result = await onPreExecute(call('subagent', { description: '部署生产环境' }), next, deps)
  assert.equal(result.kind, 'allow')
})

test('one-shot children are never candidates', async () => {
  const { deps, next } = harness({ catalog: [ONESHOT] })
  const result = await onPreExecute(call('subagent', { description: '图片压缩' }), next, deps)
  assert.equal(result.kind, 'allow')
})

test('quota ask timeout denies', async () => {
  const { deps, next } = harness({
    overrides: { limitBehavior: 'ask', maxTotal: 2, reuseCheck: 'off' },
    catalog: [{ id: 'a', createdAt: 1, mode: 'one-shot' }, { id: 'b', createdAt: 2, mode: 'one-shot' }],
    askUser: async () => ({ kind: 'pending' }),
  })
  const result = await onPreExecute(call('subagent', { description: '新任务' }), next, deps)
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /未收到你的选择|超时/)
})

test('reuse_subagent asks for confirmation in enforce-ask mode', async () => {
  const { deps, state, next } = harness({
    overrides: { reuseCheck: 'enforce-ask' },
    askReuse: async () => ({ kind: 'reuse' }),
  })
  const result = await onPreExecute(
    call('reuse_subagent', { subagent_id: 'child-1', task: '论文参考文献核查' }),
    next,
    deps,
  )
  assert.equal(state.reuseAsks, 1)
  assert.equal(result.kind, 'allow')
  assert.equal(state.nextCalls, 1)
})

test('reuse_subagent is denied when the user declines reuse', async () => {
  const { deps, state, next } = harness({
    overrides: { reuseCheck: 'enforce-ask' },
    askReuse: async () => ({ kind: 'skip' }),
  })
  const result = await onPreExecute(
    call('reuse_subagent', { subagent_id: 'child-1', task: '论文参考文献核查' }),
    next,
    deps,
  )
  assert.equal(result.kind, 'deny')
  assert.match(result.reason, /你选择不复用/)
  assert.equal(state.nextCalls, 0)
})

test('reuse_subagent skips the card when the user already approved reuse at spawn time', async () => {
  const approved = makeApproved()
  approved.set('child-1')
  const { deps, state, next } = harness({
    overrides: { reuseCheck: 'enforce-ask' },
    approvedReuse: approved,
    askReuse: async () => ({ kind: 'skip' }),
  })
  const result = await onPreExecute(
    call('reuse_subagent', { subagent_id: 'child-1', task: '论文参考文献核查' }),
    next,
    deps,
  )
  assert.equal(state.reuseAsks, 0)
  assert.equal(result.kind, 'allow')
  assert.equal(state.nextCalls, 1)
})

test('reuse_subagent is not asked outside enforce-ask mode', async () => {
  const { deps, state, next } = harness({
    overrides: { reuseCheck: 'enforce' },
    askReuse: async () => ({ kind: 'skip' }),
  })
  const result = await onPreExecute(
    call('reuse_subagent', { subagent_id: 'child-1', task: '论文参考文献核查' }),
    next,
    deps,
  )
  assert.equal(state.reuseAsks, 0)
  assert.equal(result.kind, 'allow')
})
