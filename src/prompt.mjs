/** 系统提示段：把当前治理规则讲给模型听（随模式变化）。 */

/**
 * @param {object} cfg
 * @param {{ activeCap?: object, checked?: number }} state
 * @returns {string}
 */
export function buildHint(cfg, state = {}) {
  const lines = ['## 子智能体治理']
  if (cfg.quotaEnabled) {
    lines.push(`- 本会话子智能体总量上限 ${cfg.maxTotal > 0 ? cfg.maxTotal : '0（禁止新建，只可复用）'}（存活 + 已结束都计入）；达上限时按 \`${cfg.limitBehavior}\` 处理。`)
  }
  switch (cfg.reuseCheck) {
    case 'enforce':
      lines.push(`- 派发子代理前系统会自动比对已结束的子代理；命中高相似（≥ ${cfg.strongThreshold}）时**直接复用**该子代理（任务自动转发），本次新建不会执行。收到「已复用」提示后不要重试新建。`)
      break
    case 'enforce-ask':
      lines.push(`- 派发子代理前系统会自动比对已结束的子代理：命中高相似（≥ ${cfg.strongThreshold}）时先弹出卡片问用户是否复用；同意则任务自动转发给旧子代理，不同意且已达总量上限时再问是否新建。用户拒绝复用或新建后，由你自行判断：优先复用相似子智能体（\`${cfg.guardTools?.[0] ?? 'subagent'}\` 被拒时可改调 \`reuse_subagent\`），没有合适的就自己完成，不要反复重试。`)
      lines.push('- 直接调用 `reuse_subagent` 复用时，同样会先向用户确认是否复用。')
      break
    case 'advise':
      lines.push('- 建议先调用 `list_reusable_subagents` 查看可复用子代理；相似则用 `reuse_subagent` 复用（不强制）。')
      break
    case 'off':
      if (cfg.quotaEnabled) lines.push('- 复用检查已关闭，仅限制总量。')
      break
    default:
      break
  }
  if (state.activeCap?.effectiveActiveCap !== undefined && state.activeCap.synced) {
    lines.push(`- 当前并发活跃上限 ${state.activeCap.effectiveActiveCap}（由内置活跃上限联动而来）。`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

/**
 * 注册 systemPrompt 段；返回 disposer。
 * @param {object} ctx
 * @param {{ cfg: object, getState: Function }} deps
 */
export function registerPrompt(ctx, deps) {
  const { cfg, getState } = deps
  const order = typeof ctx.systemPrompt.getSectionOrder === 'function'
    ? ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT')
    : 9000
  return ctx.systemPrompt.section({
    name: 'tool:subagent-governor',
    order,
    text: () => buildHint(cfg, typeof getState === 'function' ? getState() : {}),
  })
}
