/** 总量配额判定：存活 + 已结束，统一计入。maxTotal=0 表示禁止新建（不是不限）。 */

/**
 * @param {{ total: number, maxTotal: number, limitBehavior?: 'ask' | 'deny' }} input
 * @returns {null | { kind: 'ask', reason: string, displayReason: { en: string, zh: string } } | { kind: 'deny', reason: string }}
 */
export function decideQuota(input) {
  const cap = Math.trunc(Number(input?.maxTotal ?? 0))
  if (!Number.isFinite(cap) || cap <= 0) {
    return {
      kind: 'deny',
      reason: '会话子智能体总量上限为 0：已禁止新建子智能体。',
    }
  }
  const used = Math.max(0, Math.trunc(Number(input?.total ?? 0)))
  if (!Number.isFinite(used) || used < cap) return null
  const reason = `会话子智能体总量已达上限 ${cap}（当前 ${used}，含已运行结束的子代理）。`
  if (input?.limitBehavior === 'deny') {
    return {
      kind: 'deny',
      reason,
    }
  }
  return {
    kind: 'ask',
    reason: `${reason}允许本次新建子智能体吗？`,
    displayReason: {
      en: `Subagent session total reached the limit of ${cap} (${used} used, including finished children). Allow creating a new subagent?`,
      zh: `${reason}允许本次新建子智能体吗？`,
    },
  }
}

/** 供 status 展示的剩余额度（maxTotal=0 表示禁止新建，剩余为 0）。 */
export function remainingQuota({ total, maxTotal }) {
  const cap = Math.trunc(Number(maxTotal ?? 0))
  if (!Number.isFinite(cap) || cap <= 0) return 0
  return Math.max(0, cap - Math.max(0, Math.trunc(Number(total ?? 0))))
}
