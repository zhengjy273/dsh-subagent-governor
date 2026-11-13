/**
 * 内置活跃上限联动：当 maxTotal 低于内置 maxActiveSubagents 时把它下调为 maxTotal。
 * 内置池每次 reserve 都惰性读取 config，所以运行时写入立即生效。
 *
 * 写入走 cosmokit 的 volatile 协议（Symbol.for('cosmokit.volatile.write')），
 * 这是 @deepseek-ai/dsh-subagent 的 config 暴露出来的唯一写通道；失败时降级为 warn。
 */

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** 读取当前内置活跃上限；不可用时返回 undefined。 */
export function readActiveCap(subagents) {
  const ref = subagents?.config?.maxActiveSubagents
  if (ref && typeof ref.get === 'function') {
    try {
      const value = ref.get()
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/** 写入内置活跃上限；协议不可用时抛错，由调用方降级。 */
export function writeActiveCap(subagents, value) {
  const ref = subagents?.config?.maxActiveSubagents
  if (!ref || typeof ref[VOLATILE_WRITE] !== 'function') {
    throw new Error('cosmokit volatile write protocol unavailable on subagents.config.maxActiveSubagents')
  }
  const next = Math.trunc(Number(value))
  if (!Number.isFinite(next) || next < 1) throw new Error(`refusing to write invalid active cap: ${value}`)
  ref[VOLATILE_WRITE](next)
}

/**
 * 计算并同步活跃上限。只降不升；maxTotal=0（禁止新建）或开关关闭时不动。
 * @returns {{ builtinActiveCap?: number, effectiveActiveCap?: number, synced: boolean, reason?: string, error?: string }}
 */
export function syncActiveCap({ subagents, maxTotal, syncEnabled = true, log = () => {} } = {}) {
  const builtin = readActiveCap(subagents)
  if (builtin === undefined) {
    return { synced: false, reason: 'unavailable' }
  }
  const cap = Math.trunc(Number(maxTotal ?? 0))
  if (!syncEnabled || !Number.isFinite(cap) || cap <= 0) {
    return { builtinActiveCap: builtin, effectiveActiveCap: builtin, synced: false, reason: syncEnabled ? 'blocked' : 'disabled' }
  }
  const target = Math.min(cap, builtin)
  if (target >= builtin) {
    return { builtinActiveCap: builtin, effectiveActiveCap: builtin, synced: false, reason: 'not-below' }
  }
  try {
    writeActiveCap(subagents, target)
    log('info', `subagent-governor: builtin maxActiveSubagents ${builtin} -> ${target} (maxTotal=${cap})`)
    return { builtinActiveCap: builtin, effectiveActiveCap: target, synced: true, reason: 'synced' }
  } catch (error) {
    log('warn', `subagent-governor: failed to sync builtin active cap: ${error?.message ?? error}`)
    return { builtinActiveCap: builtin, effectiveActiveCap: builtin, synced: false, reason: 'write-failed', error: String(error?.message ?? error) }
  }
}

/** 插件卸载/禁用时恢复原始值（只在本次确实写过时）。 */
export function restoreActiveCap(subagents, saved) {
  if (!saved || saved.synced !== true || saved.builtinActiveCap === undefined) return
  try {
    writeActiveCap(subagents, saved.builtinActiveCap)
  } catch {
    // 恢复失败不影响卸载：内置值左右不过是一个运行时容量。
  }
}
