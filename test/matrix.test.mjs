/**
 * 40 链路矩阵测试：
 *   存量上限 {0, >0（满）, >0（未满）}
 *   × 复用行为 {enforce, enforce-ask, advise, off}
 *   × 总量行为 {off(quotaEnabled=false), deny, ask}
 *   + enforce-ask 复用卡片的 4 个分支用例
 *
 * 期望值来自 xmind 逻辑链：
 *   准备唤起子智能体 → 检查复用行为 → 检查是否开启总量限制 → 上限检查 → 达上限行为
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { onPreExecute } from '../src/guard.mjs'
import { normalizeConfig } from '../src/config.mjs'

const CATALOG = [
  { id: 'c1', label: '论文引用核查', mode: 'continuable', createdAt: 1 },
]

const SIM = { description: '论文参考文献核查', prompt: '请复核这条参考文献的格式' }
const FAR = { description: '磁盘空间统计', prompt: '看看 C 盘还剩多少空间' }

function makeCfg(over = {}) {
  return normalizeConfig({
    maxTotal: 5,
    limitBehavior: 'ask',
    quotaEnabled: true,
    reuseCheck: 'enforce-ask',
    strongThreshold: 0.6,
    candidateThreshold: 0.35,
    candidateLimit: 5,
    guardTools: ['subagent', 'subagent_fork'],
    queryTimeoutMs: 1500,
    checkTtlMs: 900000,
    ...over,
  })
}

function makeExec(args = SIM, name = 'subagent') {
  return { name, arguments: args, agent: { id: 'p1' }, signal: undefined }
}

function makeDeps({ cfg, catalog = CATALOG, reuse = { kind: 'skip' }, quota = { kind: 'reject' } }) {
  const reuseCalls = []
  const counters = { blocked: 0, asked: 0, reused: 0, advised: 0 }
  const deps = {
    get cfg() { return cfg },
    ledger: { get() { return undefined }, set() {} },
    listChildren: async () => catalog,
    counters,
    askUser: async () => quota,
    askReuse: async () => reuse,
    approvedReuse: { take() { return false }, set() {} },
    reuse: async (exec, top, task) => { reuseCalls.push({ id: top.subagentId, task }) },
    ensureCapacity() {},
    warn() {},
  }
  return { deps, counters, reuseCalls }
}

const allow = async () => ({ kind: 'allow' })

function expectAllow(decision) {
  assert.equal(decision.kind, 'allow', `expected allow, got ${JSON.stringify(decision)}`)
}

function expectDeny(decision, pattern) {
  assert.equal(decision.kind, 'deny', `expected deny, got ${JSON.stringify(decision)}`)
  if (pattern) assert.match(decision.reason, pattern)
}

// ---------------------------------------------------------------- 组 A：maxTotal=0
const A = [
  { reuse: 'enforce', quota: 'off', expect: 'reuse' },
  { reuse: 'enforce', quota: 'deny', expect: 'reuse' },
  { reuse: 'enforce', quota: 'ask', expect: 'reuse' },
  { reuse: 'enforce-ask', quota: 'off', expect: 'allow' },
  { reuse: 'enforce-ask', quota: 'deny', expect: 'deny-zero' },
  { reuse: 'enforce-ask', quota: 'ask', expect: 'deny-zero' },
  { reuse: 'advise', quota: 'off', expect: 'allow' },
  { reuse: 'advise', quota: 'deny', expect: 'deny-zero' },
  { reuse: 'advise', quota: 'ask', expect: 'deny-zero' },
  { reuse: 'off', quota: 'off', expect: 'allow' },
  { reuse: 'off', quota: 'deny', expect: 'deny-zero' },
  { reuse: 'off', quota: 'ask', expect: 'deny-zero' },
]

for (const [i, row] of A.entries()) {
  test(`A${i + 1} maxTotal=0 · reuse=${row.reuse} · quota=${row.quota} → ${row.expect}`, async () => {
    const cfg = makeCfg({
      maxTotal: 0,
      reuseCheck: row.reuse,
      quotaEnabled: row.quota !== 'off',
      limitBehavior: row.quota === 'off' ? 'ask' : row.quota,
    })
    const { deps, reuseCalls } = makeDeps({ cfg })
    const decision = await onPreExecute(makeExec(), allow, deps)
    if (row.expect === 'reuse') {
      expectDeny(decision, /已复用子智能体/)
      assert.equal(reuseCalls.length, 1)
    } else if (row.expect === 'allow') {
      expectAllow(decision)
    } else {
      expectDeny(decision, /上限为 0/)
    }
  })
}

// ---------------------------------------------------------------- 组 B：maxTotal=5 未满
const B = [
  { reuse: 'enforce', quota: 'off' },
  { reuse: 'enforce', quota: 'deny' },
  { reuse: 'enforce', quota: 'ask' },
  { reuse: 'enforce-ask', quota: 'off' },
  { reuse: 'enforce-ask', quota: 'deny' },
  { reuse: 'enforce-ask', quota: 'ask' },
  { reuse: 'advise', quota: 'off' },
  { reuse: 'advise', quota: 'deny' },
  { reuse: 'advise', quota: 'ask' },
  { reuse: 'off', quota: 'off' },
  { reuse: 'off', quota: 'deny' },
  { reuse: 'off', quota: 'ask' },
]

for (const [i, row] of B.entries()) {
  test(`B${i + 1} maxTotal=5 未满 · reuse=${row.reuse} · quota=${row.quota} → ${row.reuse === 'enforce' ? 'reuse' : 'allow'}`, async () => {
    const cfg = makeCfg({
      maxTotal: 5,
      reuseCheck: row.reuse,
      quotaEnabled: row.quota !== 'off',
      limitBehavior: row.quota === 'off' ? 'ask' : row.quota,
    })
    const { deps, reuseCalls } = makeDeps({ cfg })
    const decision = await onPreExecute(makeExec(), allow, deps)
    if (row.reuse === 'enforce') {
      expectDeny(decision, /已复用子智能体/)
      assert.equal(reuseCalls.length, 1)
    } else {
      expectAllow(decision)
    }
  })
}

// ---------------------------------------------------------------- 组 C：maxTotal=2 已满
const C = [
  { reuse: 'enforce', quota: 'off' },
  { reuse: 'enforce', quota: 'deny' },
  { reuse: 'enforce', quota: 'ask' },
  { reuse: 'enforce-ask', quota: 'off' },
  { reuse: 'enforce-ask', quota: 'deny' },
  { reuse: 'enforce-ask', quota: 'ask' },
  { reuse: 'advise', quota: 'off' },
  { reuse: 'advise', quota: 'deny' },
  { reuse: 'advise', quota: 'ask' },
  { reuse: 'off', quota: 'off' },
  { reuse: 'off', quota: 'deny' },
  { reuse: 'off', quota: 'ask' },
]

// 已满场景的 catalog 要有 2 条（= maxTotal=2）
const FULL_CATALOG = [
  { id: 'c1', label: '论文引用核查', mode: 'continuable', createdAt: 1 },
  { id: 'c2', label: '磁盘空间统计', mode: 'continuable', createdAt: 2 },
]

for (const [i, row] of C.entries()) {
  test(`C${i + 1} maxTotal=2 已满 · reuse=${row.reuse} · quota=${row.quota}`, async () => {
    const cfg = makeCfg({
      maxTotal: 2,
      reuseCheck: row.reuse,
      quotaEnabled: row.quota !== 'off',
      limitBehavior: row.quota === 'off' ? 'ask' : row.quota,
    })
    const { deps, reuseCalls } = makeDeps({ cfg, catalog: FULL_CATALOG })
    const decision = await onPreExecute(makeExec(), allow, deps)
    if (row.reuse === 'enforce') {
      // enforce 优先于配额：先复用。
      expectDeny(decision, /已复用子智能体/)
      assert.equal(reuseCalls.length, 1)
      return
    }
    if (row.quota === 'off') {
      expectAllow(decision)
      return
    }
    if (row.quota === 'deny') {
      expectDeny(decision, /已达上限 2/)
      assert.match(decision.reason, /自行判断/)
      return
    }
    // quota=ask：默认答案 reject → 拒绝并给指引。
    expectDeny(decision, /已达上限 2/)
    assert.match(decision.reason, /你选择了不新建/)
  })
}

// ---------------------------------------------------------------- 组 C+：达上限 + ask 同意
test('C+1 已满 · enforce · quota=ask · 同意新建 → 复用优先（enforce 先复用）', async () => {
  const cfg = makeCfg({ maxTotal: 2, reuseCheck: 'enforce', limitBehavior: 'ask' })
  const { deps, reuseCalls } = makeDeps({ cfg, catalog: FULL_CATALOG, quota: { kind: 'allow' } })
  const decision = await onPreExecute(makeExec(), allow, deps)
  expectDeny(decision, /已复用子智能体/)
  assert.equal(reuseCalls.length, 1)
})

for (const mode of ['enforce-ask', 'advise', 'off']) {
  test(`C+ 已满 · ${mode} · quota=ask · 同意新建 → allow`, async () => {
    const cfg = makeCfg({ maxTotal: 2, reuseCheck: mode, limitBehavior: 'ask' })
    const { deps } = makeDeps({ cfg, catalog: FULL_CATALOG, quota: { kind: 'allow' } })
    expectAllow(await onPreExecute(makeExec(), allow, deps))
  })
}

// ---------------------------------------------------------------- 组 D：enforce-ask 复用卡片分支
const D = [
  { name: 'D1 enforce-ask 复用卡片 · 同意 → 自动复用', reuse: { kind: 'reuse' }, expect: 'reuse', maxTotal: 5 },
  { name: 'D2 enforce-ask 复用卡片 · 拒绝 → 继续总量检查（未满放行）', reuse: { kind: 'skip' }, expect: 'allow', maxTotal: 5 },
  { name: 'D3 enforce-ask 复用卡片 · 60 秒超时 → 拒绝', reuse: { kind: 'pending' }, expect: 'timeout', maxTotal: 5 },
  { name: 'D4 enforce-ask 复用卡片 · 无法弹卡 → 继续总量检查（未满放行）', reuse: { kind: 'unavailable' }, expect: 'allow', maxTotal: 5 },
]

for (const row of D) {
  test(row.name, async () => {
    const cfg = makeCfg({ maxTotal: row.maxTotal, reuseCheck: 'enforce-ask' })
    const { deps, reuseCalls } = makeDeps({ cfg, reuse: row.reuse })
    const decision = await onPreExecute(makeExec(), allow, deps)
    if (row.expect === 'reuse') {
      expectDeny(decision, /已复用子智能体/)
      assert.equal(reuseCalls.length, 1)
    } else if (row.expect === 'allow') {
      expectAllow(decision)
    } else {
      expectDeny(decision, /未收到你的选择/)
    }
  })
}

// ---------------------------------------------------------------- 附：无候选时的回归
test('R1 无候选 · enforce 不拦（catalog 为空）', async () => {
  const cfg = makeCfg({ maxTotal: 5, reuseCheck: 'enforce' })
  const { deps } = makeDeps({ cfg, catalog: [] })
  expectAllow(await onPreExecute(makeExec(), allow, deps))
})

test('R2 不相似任务 · enforce 也不拦（候选存在但分数不足）', async () => {
  const cfg = makeCfg({ maxTotal: 5, reuseCheck: 'enforce' })
  const { deps, reuseCalls } = makeDeps({ cfg })
  expectAllow(await onPreExecute(makeExec(FAR), allow, deps))
  assert.equal(reuseCalls.length, 0)
})

test('R3 reuse_subagent 在非 enforce-ask 下不被拦', async () => {
  for (const mode of ['enforce', 'advise', 'off']) {
    const cfg = makeCfg({ maxTotal: 5, reuseCheck: mode })
    const { deps } = makeDeps({ cfg })
    const exec = makeExec({ subagent_id: 'c1', task: '继续' }, 'reuse_subagent')
    expectAllow(await onPreExecute(exec, allow, deps))
  }
})

test('R4 reuse_subagent 在 enforce-ask 下被拒 → 给自行判断指引', async () => {
  const cfg = makeCfg({ maxTotal: 5, reuseCheck: 'enforce-ask' })
  const { deps } = makeDeps({ cfg, reuse: { kind: 'skip' } })
  const exec = makeExec({ subagent_id: 'c1', task: '继续' }, 'reuse_subagent')
  expectDeny(await onPreExecute(exec, allow, deps), /你选择不复用/)
})

test('R5 非守卫工具直接放行', async () => {
  const cfg = makeCfg({ maxTotal: 0, reuseCheck: 'enforce' })
  const { deps } = makeDeps({ cfg })
  expectAllow(await onPreExecute(makeExec(SIM, 'read'), allow, deps))
})
