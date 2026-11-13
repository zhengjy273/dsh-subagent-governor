/**
 * tools/pre-execute 守卫：按 xmind 逻辑链重新组织。
 *
 * 准备唤起子智能体
 *   → 检查复用行为
 *       enforce      有可复用 → 自动复用（sendMessage），无 → 总量检查
 *       enforce-ask  有可复用 → 弹卡片问是否复用；同意 → 自动复用；不同意 → 总量检查
 *       advise       有可复用 → 只记录/提示，不拦 → 总量检查
 *       off          跳过复用检查 → 总量检查
 *   → 检查是否开启总量限制
 *       否 → 放行（新建）
 *       是 → 上限检查：未达上限 → 放行；达上限 → 按达上限行为
 *             deny → 拒绝新建
 *             ask  → 弹卡片问是否新建：同意 → 放行；拒绝 → 拒绝并提示可复用
 *
 * 纯逻辑，依赖注入，便于单元测试。
 */
import { continuableEntries, rankCandidates } from './candidates.mjs'
import { decideQuota } from './quota.mjs'
import { scoreTexts } from './similarity.mjs'

/**
 * 把 ask 决策交给 userQuestions 真正问用户。
 * @returns {Promise<{allow: boolean, reason?: string} | {fallback: true}>}
 */
async function resolveAsk(decision, exec, deps) {
  const ask = deps.askUser
  if (typeof ask !== 'function') return { fallback: true }
  const result = await ask(exec, { decision })
  if (deps.counters) deps.counters.lastAsk = result?.kind ?? 'unknown'
  if (result?.kind === 'allow') return { allow: true }
  if (result?.kind === 'reject') {
    return { allow: false, reason: `${decision.reason}（你选择了不新建）` }
  }
  if (result?.kind === 'pending') {
    return { allow: false, reason: `${decision.reason}（60 秒内未收到你的选择，本次不新建）` }
  }
  return { fallback: true }
}

/** 读取工具调用里的任务文本：短标签 + 全文提示词。 */
export function taskOf(args) {
  if (!args || typeof args !== 'object') return ''
  const description = typeof args.description === 'string' ? args.description.trim() : ''
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  return [description, prompt].filter(Boolean).join('\n')
}

/** 只取短标签（与旧子代理的 label 同构，相似度主信号）。 */
export function descriptionOf(args) {
  return args && typeof args.description === 'string' ? args.description.trim() : ''
}

function withTimeout(promise, ms) {
  const timeout = Math.trunc(Number(ms ?? 0))
  if (!Number.isFinite(timeout) || timeout <= 0) return promise
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`catalog read timed out after ${timeout}ms`)), timeout)
    if (typeof timer?.unref === 'function') timer.unref()
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** 复用工具名（不在 guardTools 里，但 enforce-ask 也要拦它来问用户）。 */
export const REUSE_TOOL = 'reuse_subagent'

/**
 * 被拒绝后交给主智能体自行判断：复用哪个已有子智能体，或直接自己完成。
 * @param {{subagentId: string, label?: string, score?: number}} [top]
 */
export function refusalGuidance(top) {
  const tail = '若确需新建，请让用户调高 maxTotal 或关闭配额（quotaEnabled=false），不要反复重试。'
  if (top) {
    const label = top.label ?? top.subagentId
    return ` 接下来由你自行判断：① 调用 ${REUSE_TOOL}({ subagent_id: "${top.subagentId}", task: "<把本次要做的任务原文粘到这里>" }) 把任务交给相似子智能体「${label}」；② 不派子代理，直接用当前上下文完成这项工作。${tail}`
  }
  return ` 接下来由你自行判断：不派子代理，直接用当前上下文完成这项工作；${tail}`
}

/** 找一个"值得推荐复用"的候选：必须达到候选阈值，避免推荐毫不相干的子代理。 */
function bestReusable(cfg, catalog, task, description) {
  const candidates = continuableEntries(catalog)
  if (candidates.length === 0) return undefined
  const ranked = rankCandidates(candidates, task, {
    threshold: cfg.candidateThreshold,
    limit: 1,
    description,
  })
  return ranked[0]
}

/** 从 catalog 里挑出"够相似、值得复用"的那一个（达到强制阈值才算）。 */
export function strongCandidate({ cfg, catalog, task, description = '' }) {
  const candidates = continuableEntries(catalog)
  if (candidates.length === 0) return undefined
  const ranked = rankCandidates(candidates, task, {
    threshold: cfg.candidateThreshold,
    limit: cfg.candidateLimit,
    description,
  })
  const top = ranked[0]
  return top && top.score >= cfg.strongThreshold ? top : undefined
}

/**
 * 复用检查（供 advise 记账 / 旧测试用）。返回"建议复用"的候选或 undefined。
 */
export function checkReuse(input) {
  const { cfg, ledger, parentId, catalog, task, description = '' } = input
  const mode = cfg.reuseCheck
  if (mode === 'off') return undefined
  const candidates = continuableEntries(catalog)
  if (candidates.length === 0) return undefined

  const previous = ledger.get(parentId)
  if (previous?.top && previous.top.score >= cfg.strongThreshold && task && scoreTexts(previous.task, task) >= cfg.strongThreshold) {
    ledger.set(parentId, { task, top: previous.top })
    return mode === 'advise' ? undefined : previous.top
  }

  const top = strongCandidate({ cfg, catalog, task, description })
  ledger.set(parentId, { task, top: top ?? null })
  return mode === 'advise' ? undefined : top
}

/** 把复用确认交给 userQuestions（经 deps 注入，便于测试）。 */
async function askReuseDecision(exec, deps, top) {
  const ask = deps.askReuse
  if (typeof ask !== 'function') return 'unavailable'
  try {
    const result = await ask(exec, { top })
    if (deps.counters) deps.counters.lastAsk = result?.kind ?? 'unknown'
    switch (result?.kind) {
      case 'reuse': return 'reuse'
      case 'skip': return 'skip'
      case 'pending': return 'pending'
      case 'aborted': return 'aborted'
      default: return 'unavailable'
    }
  } catch {
    return 'unavailable'
  }
}

/**
 * 「复用子智能体」动作：把本次任务直接发给已运行结束的子智能体，不新建。
 * 成功或失败都返回 deny，避免原工具调用再建一个。
 */
async function reuseNow(exec, top, task, deps) {
  const cfg = deps.cfg
  const score = Number(top?.score ?? 0).toFixed(2)
  const label = top?.label ?? top?.subagentId ?? '未知'
  const reuse = deps.reuse
  if (typeof reuse !== 'function') {
    return {
      kind: 'deny',
      reason: `检测到可复用子智能体 [${top.subagentId}]「${label}」（相似度 ${score}），但当前运行时不能自动发送。请调用 ${REUSE_TOOL}({ subagent_id: "${top.subagentId}", task: "<把本次要做的任务原文粘到这里>" })，不要新建。`,
    }
  }
  try {
    await reuse(exec, top, task)
    if (deps.counters) deps.counters.reused = (deps.counters.reused ?? 0) + 1
    return {
      kind: 'deny',
      reason: `已复用子智能体 [${top.subagentId}]「${label}」（相似度 ${score}）：本次任务已发送给它，结果会异步返回。不要再新建子智能体，也不要重复发送同样的任务。`,
    }
  } catch (error) {
    const message = error?.message ?? String(error)
    deps.warn?.(`subagent-governor: reuse failed: ${message}`)
    if (deps.counters) deps.counters.blocked = (deps.counters.blocked ?? 0) + 1
    return {
      kind: 'deny',
      reason: `复用子智能体 [${top.subagentId}]「${label}」失败：${message}。可调用 ${REUSE_TOOL} 重试，或改写任务后重新派发。`,
    }
  }
}

/**
 * @param {object} exec ToolExecution
 * @param {() => Promise<object>} next
 * @param {{ cfg: object, ledger: object, listChildren: Function, counters?: object, warn?: Function, askUser?: Function, askReuse?: Function, approvedReuse?: object, ensureCapacity?: Function, reuse?: Function }} deps
 */
export async function onPreExecute(exec, next, deps) {
  const { listChildren, counters, warn = () => {} } = deps
  // deps.cfg 是 getter：设置页保存后这里能读到最新值，不要提前解构。
  const cfg = deps.cfg
  const isSpawn = Array.isArray(cfg.guardTools) && cfg.guardTools.includes(exec?.name)
  const isReuseCall = exec?.name === REUSE_TOOL
  if (!isSpawn && !isReuseCall) return next()
  const parent = exec.agent
  if (!parent) return next()

  // 配置可能刚在设置页改过：先把内置活跃上限跟上，再按最新值判限。
  try {
    deps.ensureCapacity?.()
  } catch {
    // 联动失败不影响总量闸与复用检查。
  }

  const mode = cfg.reuseCheck
  const needCatalog = isSpawn && (cfg.quotaEnabled || mode !== 'off') || isReuseCall
  let catalog = []
  if (needCatalog) {
    try {
      catalog = await withTimeout(Promise.resolve().then(() => listChildren(parent.id, exec.signal)), cfg.queryTimeoutMs)
      if (!Array.isArray(catalog)) catalog = []
    } catch (error) {
      warn(`subagent-governor: catalog read failed, allowing this call: ${error?.message ?? error}`)
      return next()
    }
  }

  const task = taskOf(exec.arguments)
  const description = descriptionOf(exec.arguments)

  // 直接调用 reuse_subagent：enforce-ask 下先问用户是否复用（其它模式不打扰）。
  if (isReuseCall) {
    if (mode !== 'enforce-ask') return next()
    const targetId = typeof exec.arguments?.subagent_id === 'string' ? exec.arguments.subagent_id.trim() : ''
    if (targetId && deps.approvedReuse?.take?.(targetId)) return next()
    const entry = (catalog ?? []).find((row) => row && row.id === targetId)
    const top = { subagentId: targetId || 'unknown', label: entry?.label ?? targetId ?? '未知', score: 1 }
    const choice = await askReuseDecision(exec, deps, top)
    if (choice === 'reuse') return next()
    if (choice === 'pending' || choice === 'aborted') {
      counters && (counters.blocked += 1)
      return { kind: 'deny', reason: '60 秒内未收到你的选择，本次复用未执行。' }
    }
    if (choice === 'skip') {
      counters && (counters.blocked += 1)
      return {
        kind: 'deny',
        reason: `你选择不复用子智能体 [${top.subagentId}]。${refusalGuidance()}`,
      }
    }
    // unavailable：弹不出卡片时不要挡住正常复用。
    return next()
  }

  // 1) 检查复用行为
  const top = strongCandidate({ cfg, catalog, task, description })

  if (mode === 'enforce') {
    // 有可复用 → 直接复用，不再新建。
    if (top) return reuseNow(exec, top, task, deps)
  } else if (mode === 'enforce-ask') {
    if (top) {
      counters && (counters.asked += 1)
      const choice = await askReuseDecision(exec, deps, top)
      if (choice === 'reuse') return reuseNow(exec, top, task, deps)
      if (choice === 'pending' || choice === 'aborted') {
        counters && (counters.blocked += 1)
        return { kind: 'deny', reason: '60 秒内未收到你的选择，本次新建未执行。' }
      }
      // skip / unavailable：不同意复用，继续走总量检查。
    }
  } else if (mode === 'advise') {
    // 只记账并给出复用提示，不拦截。
    if (top) {
      deps.ledger?.set?.(parent.id, { task, top })
      counters && (counters.advised = (counters.advised ?? 0) + 1)
    }
  }
  // mode === 'off'：直接进入总量检查。

  // 2) 检查是否开启总量限制
  if (cfg.quotaEnabled) {
    const decision = decideQuota({
      total: catalog.length,
      maxTotal: cfg.maxTotal,
      limitBehavior: cfg.limitBehavior,
    })
    if (decision) {
      if (decision.kind === 'deny') {
        counters && (counters.blocked += 1)
        const best = bestReusable(cfg, catalog, task, description)
        return { kind: 'deny', reason: `${decision.reason}${refusalGuidance(best)}` }
      }
      // ask：弹卡片询问是否新建
      counters && (counters.asked += 1)
      const resolved = await resolveAsk(decision, exec, deps)
      if (resolved.allow === true) return next()
      if (resolved.allow === false) {
        counters && (counters.blocked += 1)
        const best = bestReusable(cfg, catalog, task, description)
        return { kind: 'deny', reason: `${resolved.reason}${refusalGuidance(best)}` }
      }
      // 弹不出卡片：沿用原来的 ask 决策，让宿主决定。
      return decision
    }
  }

  return next()
}
