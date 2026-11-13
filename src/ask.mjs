import { appendFileSync } from 'node:fs'

export const ASK_TIMEOUT_MS = 60_000

const TRACE_LOG = new URL('../last-ask.log', import.meta.url)
const trace = (payload) => {
  try {
    appendFileSync(TRACE_LOG, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`)
  } catch {
    // 诊断日志写不进去就算了
  }
}

const ALLOW_LABEL = '允许本次新建'
const REJECT_LABEL = '不新建（放弃）'

const TIMED_OUT = Symbol('timed-out')

/** 本地超时：不依赖 askTimed 的 callId（pre-execute 阶段没有可挂的 UI 卡片）。 */
function raceTimeout(promise, ms) {
  const timeout = Math.trunc(Number(ms ?? 0))
  if (!Number.isFinite(timeout) || timeout <= 0) return promise
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeout)
    if (typeof timer?.unref === 'function') timer.unref()
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** 把守卫的 ask 决策翻译成一条用户问题。 */
export function askPayload(decision, extra = {}) {
  const question = decision?.displayReason?.zh || decision?.reason || '是否允许本次新建子智能体？'
  return {
    question,
    detail:
      extra.detail ||
      '统计口径：存活中的子智能体 + 已运行结束的子智能体都计入本会话总量。',
    options: [
      { label: ALLOW_LABEL, description: '放行这次调用，模型可以继续新建子智能体。' },
      { label: REJECT_LABEL, description: '本次不创建；模型应改用 reuse_subagent，或直接完成工作。' },
    ],
  }
}

/**
 * 向用户提问并等待回答。
 * @returns {Promise<{kind:'allow'|'reject'|'pending'|'unavailable'|'aborted', picked?: string, code?: string, message?: string}>}
 */
export async function askUser(ctx, exec, { decision, timeoutMs = ASK_TIMEOUT_MS } = {}) {
  const service = ctx?.get?.('userQuestions')
  if (!service || typeof service.ask !== 'function' || !exec?.agent) {
    trace({ fn: 'askUser', skipped: 'no-service' })
    return { kind: 'unavailable' }
  }

  const payload = askPayload(decision)
  const request = {
    agent: exec.agent,
    signal: exec.signal,
    questions: [
      {
        id: 'subagent-governor-ask',
        question: payload.question,
        header: '子智能体治理',
        detail: payload.detail,
        options: payload.options,
      },
    ],
  }

  const started = Date.now()
  try {
    // 优先用阻塞式 ask：它和 ask_user_question 工具走同一条 UI answerer waterfall，
    // 不依赖工具调用卡片。askTimed 需要可挂的 callId，在 pre-execute 阶段没有。
    const answer = typeof service.ask === 'function'
      ? await raceTimeout(service.ask(request), timeoutMs)
      : await service.askTimed(request, exec.callId, timeoutMs)
    trace({ fn: 'askUser', elapsedMs: Date.now() - started, answer: JSON.stringify(answer)?.slice(0, 600) })
    if (answer === TIMED_OUT || (answer && answer.pending === true)) return { kind: 'pending' }
    const item = answer?.answers?.[0]
    const picked = Array.isArray(item?.selected) ? item.selected[0] ?? '' : ''
    if (picked === ALLOW_LABEL) return { kind: 'allow' }
    if (item?.custom && typeof item.custom === 'string' && item.custom.trim() !== '') {
      return { kind: 'reject', picked: item.custom.trim() }
    }
    return { kind: 'reject', picked: picked || REJECT_LABEL }
  } catch (error) {
    trace({ fn: 'askUser', elapsedMs: Date.now() - started, error: String(error?.code ?? error) })
    if (error?.code === 'ASK_ABORTED') return { kind: 'aborted' }
    // NO_PROVIDER / CALLER_NOT_LIVE / DELEGATED_CALLER 等：让守卫回退到原 ask 决策。
    return { kind: 'unavailable', code: error?.code, message: error?.message }
  }
}

export const REUSE_YES = '复用它'
export const REUSE_NO = '不复用'

/**
 * 复用确认卡片：准备唤起子智能体或直接复用某个子智能体时，先问用户要不要复用。
 * @returns {Promise<{kind:'reuse'|'skip'|'pending'|'unavailable'|'aborted', picked?: string}>}
 */
export async function askReuse(ctx, exec, { top, timeoutMs = ASK_TIMEOUT_MS } = {}) {
  const service = ctx?.get?.('userQuestions')
  if (!service || typeof service.ask !== 'function' || !exec?.agent) {
    trace({ fn: 'askReuse', skipped: 'no-service' })
    return { kind: 'unavailable' }
  }
  const score = Number(top?.score ?? 0).toFixed(2)
  const label = top?.label ?? top?.subagentId ?? '未知'
  const request = {
    agent: exec.agent,
    signal: exec.signal,
    questions: [
      {
        id: 'subagent-governor-reuse',
        question: `检测到可复用的子智能体「${label}」（相似度 ${score}）。要复用它执行这次任务吗？`,
        header: '子智能体治理',
        detail: `复用：把任务发给已存在的子智能体 [${top?.subagentId}]，不新增会话总量。\n不复用：按新建流程继续；如果已达总量上限，会再询问是否新建。\n60 秒内没有选择，则本次调用不执行。`,
        options: [
          { label: REUSE_YES, description: '把任务发给这个已运行结束的子智能体。' },
          { label: REUSE_NO, description: '不复用，继续尝试新建子智能体。' },
        ],
      },
    ],
  }
  const started = Date.now()
  try {
    const answer = await raceTimeout(service.ask(request), timeoutMs)
    trace({ fn: 'askReuse', elapsedMs: Date.now() - started, answer: JSON.stringify(answer)?.slice(0, 600) })
    if (answer === TIMED_OUT || (answer && answer.pending === true)) return { kind: 'pending' }
    const picked = answer?.answers?.[0]?.selected?.[0] ?? ''
    if (picked === REUSE_YES) return { kind: 'reuse', picked }
    return { kind: 'skip', picked: picked || REUSE_NO }
  } catch (error) {
    trace({ fn: 'askReuse', elapsedMs: Date.now() - started, error: String(error?.code ?? error) })
    if (error?.code === 'ASK_ABORTED') return { kind: 'aborted' }
    return { kind: 'unavailable', code: error?.code, message: error?.message }
  }
}
