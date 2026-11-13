/** 三个模型侧工具：查候选、复用、看状态。 */
import { rankCandidates } from './candidates.mjs'

// 宿主提供 defineTool（参数 schema 编译 + 执行前校验）。单元测试环境没有宿主包时
// 退回恒等函数：注册的形状不变，只是少了参数校验。
let defineTool = (options) => options
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'))
} catch {
  // 宿主包不可解析（例如离线运行单元测试）：保持恒等定义。
}

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
  }
}

function clampLimit(value, fallback) {
  const number = Math.trunc(Number(value ?? fallback))
  if (!Number.isFinite(number)) return fallback
  return Math.min(20, Math.max(1, number))
}

/**
 * @param {object} ctx
 * @param {{ cfg: object, ledger: object, subagents: object, counters: object, isLive: Function, capacity: object }} deps
 * @returns {() => void} disposer
 */
export function registerTools(ctx, deps) {
  const { ledger, subagents, counters, isLive, capacity } = deps
  const disposers = []

  disposers.push(ctx.tools.register(defineTool({
    name: 'list_reusable_subagents',
    description: 'List direct child subagents of this conversation that have finished and can still receive a follow-up message (mode=continuable), ranked by similarity to the task you are about to delegate. Use it before creating a new subagent when the governor hint says reuse is required or advised.',
    parameters: {
      task: { type: 'string', required: true, description: 'The task text you are about to delegate (prompt and/or short description).' },
      limit: { type: 'number', description: 'Maximum candidates to return (default 5, max 20).' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('list_reusable_subagents requires a calling agent')
      // deps.cfg 是 getter：设置页保存后这里读最新值。
      const cfg = deps.cfg
      const catalog = await subagents.listChildren(parent.id, exec.signal)
      const limit = clampLimit(args.limit, cfg.candidateLimit)
      const task = typeof args.task === 'string' ? args.task : ''
      const candidates = rankCandidates(catalog, task, { threshold: cfg.candidateThreshold, limit })
      ledger.set(parent.id, { task, top: candidates[0] ?? null })
      return JSON.stringify({
        total: catalog.length,
        maxTotal: cfg.maxTotal,
        reuseCheck: cfg.reuseCheck,
        checked: true,
        candidates,
      }, null, 2)
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'reuse_subagent',
    description: 'Send a new task to an already-finished direct child subagent instead of creating a new one. The child resumes from its persisted session and keeps its context. Fails for non-continuable children or subagents that are not direct children of this conversation.',
    parameters: {
      subagent_id: { type: 'string', required: true, description: 'Durable child session id from list_reusable_subagents.' },
      task: { type: 'string', required: true, description: 'The complete task text to send to that child.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('reuse_subagent requires a calling agent')
      const id = typeof args.subagent_id === 'string' ? args.subagent_id.trim() : ''
      const task = typeof args.task === 'string' ? args.task : ''
      if (!id) throw new Error('subagent_id is required')
      if (!task.trim()) throw new Error('task is required')
      const catalog = await subagents.listChildren(parent.id, exec.signal)
      const entry = catalog.find((item) => item.id === id)
      if (!entry) throw new Error(`subagent "${id}" is not a direct child of this conversation`)
      if (entry.mode !== 'continuable') throw new Error(`subagent "${id}" has mode "${entry.mode}" and cannot receive follow-up messages`)
      const messageId = await subagents.sendMessage(parent, entry.id, [{ type: 'text', text: task }], { signal: exec.signal })
      counters.reused += 1
      ledger.clear(parent.id)
      return JSON.stringify({ reused: true, subagentId: entry.id, messageId }, null, 2)
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'subagent_governor_status',
    description: 'Read the current subagent governance state of this conversation: lifecycle total (running + finished), cap, reuse mode, reusable children, synced builtin active cap, and this process counts.',
    parameters: {},
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('subagent_governor_status requires a calling agent')
      try {
        deps.ensureCapacity?.()
      } catch {
        // 联动失败只影响活跃上限读数，不影响状态展示。
      }
      const catalog = await subagents.listChildren(parent.id, exec.signal)
      return renderStatus({ catalog, cfg: deps.cfg, counters, capacity, ledger, parentId: parent.id, isLive })
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'subagent_governor_diagnose',
    description: 'Internal diagnostic: report whether the browser (client) half of this plugin was composed into the Web boot graph, plus the loader rows and manifest fields the composition depends on.',
    parameters: {},
    output: textOutput(),
    isConcurrencySafe: () => true,
    async execute() {
      const out = {}
      try {
        const modules = ctx.get('clientModules')
        out.clientModules = modules ? 'available' : 'missing'
        if (modules && typeof modules.graph === 'function') {
          const graph = modules.graph()
          out.entries = (graph?.entries ?? []).map((entry) => ({
            id: entry.id,
            rev: entry.rev,
            inject: entry.inject ?? null,
            immediately: entry.immediately ?? false,
          }))
          out.ourBundlePath = typeof modules.clientPath === 'function' ? (modules.clientPath('@local/dsh-subagent-governor') ?? null) : null
        }
      } catch (error) {
        out.clientModulesError = String((error && error.message) || error)
      }
      try {
        const loader = ctx.get('loader') ?? (ctx.root && typeof ctx.root.get === 'function' ? ctx.root.get('loader') : undefined)
        if (loader && typeof loader.entries === 'function') {
          out.loaderEntries = loader.entries().map((entry) => entry?.options?.name).filter((name) => typeof name === 'string' && name.includes('governor'))
        } else {
          out.loader = 'missing'
        }
      } catch (error) {
        out.loaderError = String((error && error.message) || error)
      }
      try {
        const settings = ctx.get('settings')
        if (settings && typeof settings.describe === 'function') {
          const rows = await settings.describe()
          out.settingsNamespaces = (rows ?? []).map((row) => row.ns)
        } else {
          out.settings = 'missing'
        }
      } catch (error) {
        out.settingsError = String((error && error.message) || error)
      }
      try {
        const { readFileSync } = await import('node:fs')
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
        out.pkg = { name: pkg.name, exportsClient: pkg.exports?.['./client'] ?? null, dshClient: pkg.dsh?.client ?? null }
      } catch (error) {
        out.pkgError = String((error && error.message) || error)
      }
      return JSON.stringify(out, null, 2)
    },
  })))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 卸载时单个工具注销失败不应阻断其它清理。
      }
    }
  }
}

/** status 文本（同时供工具与测试使用）。 */
export function renderStatus({ catalog, cfg, counters, capacity, ledger, parentId, isLive }) {
  const total = catalog.length
  const ended = catalog.filter((entry) => !isLive(entry.id)).length
  const running = total - ended
  const continuable = catalog.filter((entry) => entry.mode === 'continuable').length
  const last = ledger.get(parentId)
  const lines = [
    '子智能体治理状态',
    `- 会话总量：${total}${cfg.maxTotal > 0 ? ` / ${cfg.maxTotal}` : '（上限 0：禁止新建）'}（运行中 ${running}，已结束 ${ended}）`,
    `- 配额开关：${cfg.quotaEnabled ? '开启' : '关闭'}；达上限行为：${cfg.limitBehavior}`,
    `- 复用检查：${cfg.reuseCheck}（strong ${cfg.strongThreshold}，candidate ${cfg.candidateThreshold}）`,
    `- 可复用子代理（continuable）：${continuable}`,
  ]
  if (capacity?.effectiveActiveCap !== undefined) {
    lines.push(`- 活跃上限：内置 ${capacity.builtinActiveCap} → 生效 ${capacity.effectiveActiveCap}${capacity.synced ? '（联动生效）' : `（${capacity.reason ?? '未联动'}）`}`)
  }
  if (last?.top) {
    lines.push(`- 最近检查：候选 [${last.top.subagentId}]「${last.top.label}」score ${Number(last.top.score ?? 0).toFixed(2)}`)
  }
  lines.push(`- 本进程统计：拦截 ${counters.blocked}，询问 ${counters.asked}，复用 ${counters.reused}${counters.lastAsk ? `，最近询问结果 ${counters.lastAsk}` : ''}`)
  return lines.join('\n')
}
