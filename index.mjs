/**
 * Subagent Session Governor —— 会话子智能体治理插件（Host 侧）。
 *
 * 两条规则：
 * 1. 会话内子智能体生命周期总量（存活 + 已运行结束）不超过 maxTotal；达上限按 limitBehavior 询问或拒绝。
 * 2. 派发新子智能体前，若存在已结束的可复用子代理且任务相似，拦截并要求复用（reuse_subagent）。
 *
 * 配套：maxTotal 低于内置 maxActiveSubagents 时自动下调内置活跃上限（可关、卸载恢复）。
 */
import { normalizeConfig } from './src/config.mjs'
import { Config } from './src/schema.mjs'
import { createLedger } from './src/memory.mjs'
import { onPreExecute } from './src/guard.mjs'
import { askReuse, askUser } from './src/ask.mjs'
import { registerTools } from './src/tools.mjs'
import { registerPrompt } from './src/prompt.mjs'
import { discoverPatchFile, readGovernorConfig } from './src/profile-config.mjs'
import { restoreActiveCap, syncActiveCap, writeActiveCap } from './src/capacity.mjs'
import { appendFileSync } from 'node:fs'

const ERROR_LOG = new URL('./last-error.log', import.meta.url)
const noteError = (stage, error) => {
  try {
    appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${stage}: ${String((error && error.stack) || error)}\n`)
  } catch {
    // 诊断日志写不进去就算了
  }
}

export const name = 'subagent-governor'
export const inject = ['tools', 'systemPrompt']
export { Config }

/**
 * @param {CordisContext} ctx
 * @param {object} rawConfig
 */
export function apply(ctx, rawConfig) {
  // 配置随时可能被设置页改写。设置页的 settings.mutate 只落盘 profile 的 cordis.patch.yml，
  // 既不重启插件、也不更新运行时 Config 实例，所以每次决策直接读那个文件里我们的 config 块。
  // 读不到（文件缺失/尚未落盘）才回退到 settings 服务与 apply 收到的 volatile 盒子。
  const settingsService = ctx.get('settings')
  const ENTRY_IDS = ['include:subagent-governor', 'subagent-governor']
  const patchPath = () => {
    try {
      const document = settingsService?.prepareDocument?.()
      if (typeof document === 'string') return document
      if (document && typeof document.path === 'string') return document.path
    } catch {
      // 忽略：下面按 DSH_HOME 目录探测
    }
    return discoverPatchFile()
  }
  // prepareDocument() 可能指向别的文档（不含本插件条目），所以候选路径逐个尝试，
  // 谁解析出我们的 config 块就用谁；全失败才回退运行时设置。
  const fromFile = () => {
    const candidates = []
    try {
      const primary = patchPath()
      if (primary) candidates.push(primary)
    } catch {
      // 忽略
    }
    try {
      const discovered = discoverPatchFile()
      if (discovered && !candidates.includes(discovered)) candidates.push(discovered)
    } catch {
      // 忽略
    }
    for (const file of candidates) {
      const parsed = readGovernorConfig(file)
      if (parsed) return parsed
    }
    return undefined
  }
  const fromSettings = () => {
    try {
      const rows = settingsService?.describe?.({ redactSecrets: true })
      if (!Array.isArray(rows)) return undefined
      const row = rows.find((candidate) => candidate && ENTRY_IDS.includes(candidate.ns))
      return row?.value && typeof row.value === 'object' ? row.value : undefined
    } catch {
      return undefined
    }
  }
  const readCfg = () => normalizeConfig(fromFile() ?? fromSettings() ?? rawConfig)
  const cfg = readCfg()
  const subagents = ctx.get('subagents')
  if (!subagents || typeof subagents.listChildren !== 'function') {
    ctx.logger?.warn?.('subagent-governor: `subagents` service is unavailable; governance is inert')
    return
  }
  const log = (level, message) => {
    const write = ctx.logger?.[level]
    if (typeof write === 'function') write.call(ctx.logger, message)
  }

  const ledger = createLedger({ ttlMs: cfg.checkTtlMs })
  const counters = { blocked: 0, asked: 0, reused: 0 }

  // "先问复用、再问新建"：用户在新建卡片上批准复用后，模型立刻调 reuse_subagent
  // 不应再问一次，用短期标记放行一次。
  const approvedReuse = new Map()
  const approvedReuseTtlMs = 120_000
  const approvedReuseApi = {
    set(id) {
      if (typeof id === 'string' && id) approvedReuse.set(id, Date.now() + approvedReuseTtlMs)
    },
    take(id) {
      const deadline = approvedReuse.get(id)
      if (deadline === undefined) return false
      approvedReuse.delete(id)
      return deadline >= Date.now()
    },
  }

  const capacity = syncActiveCap({
    subagents,
    maxTotal: cfg.maxTotal,
    syncEnabled: cfg.syncActiveCap,
    log,
  })
  ctx.effect(() => () => restoreActiveCap(subagents, capacity))

  const isLive = (id) => {
    try {
      return ctx.get('agents')?.get(id) !== undefined
    } catch {
      return false
    }
  }

  // 设置页改 maxTotal/syncActiveCap 后，内置活跃上限也要在下次派发前跟上，不必等重载。
  let lastCapTotal = cfg.maxTotal
  let lastSyncEnabled = cfg.syncActiveCap
  const baselineActiveCap = capacity.builtinActiveCap
  const ensureCapacity = () => {
    const next = readCfg()
    if (next.maxTotal === lastCapTotal && next.syncActiveCap === lastSyncEnabled) return
    lastCapTotal = next.maxTotal
    lastSyncEnabled = next.syncActiveCap
    try {
      const restore = !next.syncActiveCap
        || next.maxTotal === 0
        || (typeof baselineActiveCap === 'number' && next.maxTotal >= baselineActiveCap)
      if (restore) {
        if (capacity.synced && typeof baselineActiveCap === 'number') writeActiveCap(subagents, baselineActiveCap)
        Object.assign(capacity, {
          effectiveActiveCap: baselineActiveCap,
          synced: false,
          reason: next.syncActiveCap ? 'restored' : 'disabled',
        })
        return
      }
      Object.assign(capacity, syncActiveCap({ subagents, maxTotal: next.maxTotal, syncEnabled: next.syncActiveCap, log }))
    } catch (error) {
      log('warn', `subagent-governor: live active-cap sync failed: ${String((error && error.message) || error)}`)
    }
  }

  const deps = {
    get cfg() {
      return readCfg()
    },
    ledger,
    subagents,
    counters,
    isLive,
    capacity,
    listChildren: (parentSessionId, signal) => subagents.listChildren(parentSessionId, signal),
    ensureCapacity,
    // ask 决策改走 userQuestions（问答卡片），避免宿主 approval 禁用时静默变成拒绝。
    askUser: (exec, args) => askUser(ctx, exec, args),
    askReuse: (exec, args) => askReuse(ctx, exec, args),
    // 「复用子智能体」动作：enforce / 同意复用后，把任务直接发给已运行结束的子智能体。
    reuse: (exec, top, task) => subagents.sendMessage(
      exec.agent,
      top.subagentId,
      [{ type: 'text', text: String(task || '继续之前的任务') }],
      { signal: exec.signal },
    ),
    approvedReuse: approvedReuseApi,
    warn: (message) => log('warn', message),
  }

  ctx.effect(() => ctx.on('tools/pre-execute', (exec, next) => onPreExecute(exec, next, deps)))
  ctx.effect(() => {
    try {
      return registerTools(ctx, deps)
    } catch (error) {
      noteError('registerTools', error)
      throw error
    }
  })
  if (cfg.injectHint) {
    ctx.effect(() => {
      try {
        return registerPrompt(ctx, { cfg, getState: () => ({ activeCap: capacity }) })
      } catch (error) {
        noteError('registerPrompt', error)
        throw error
      }
    })
  }

  log('info', `subagent-governor ready (maxTotal=${cfg.maxTotal}, limitBehavior=${cfg.limitBehavior}, reuseCheck=${cfg.reuseCheck}, activeCap=${capacity.effectiveActiveCap ?? 'n/a'})`)
}
