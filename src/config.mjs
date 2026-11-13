/** 配置默认值与归一化（纯函数，不依赖 schemastery，便于单元测试）。 */

export const DEFAULTS = Object.freeze({
  maxTotal: 12,
  limitBehavior: 'ask',
  quotaEnabled: true,
  syncActiveCap: true,
  reuseCheck: 'enforce',
  strongThreshold: 0.6,
  candidateThreshold: 0.35,
  candidateLimit: 5,
  checkTtlMs: 900_000,
  guardTools: Object.freeze(['subagent', 'subagent_fork']),
  queryTimeoutMs: 1_500,
  injectHint: true,
})

export const LIMIT_BEHAVIORS = Object.freeze(['ask', 'deny'])
export const REUSE_MODES = Object.freeze(['enforce', 'enforce-ask', 'advise', 'off'])

function asInt(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function asNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function asBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1' || value === 1) return true
  if (value === 'false' || value === '0' || value === 0) return false
  return fallback
}

function asToolList(value) {
  if (!Array.isArray(value)) return [...DEFAULTS.guardTools]
  const tools = [...new Set(value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()))]
  return tools.length > 0 ? tools : [...DEFAULTS.guardTools]
}

function unwrap(value) {
  // schemastery 的 volatile 字段在运行时是一个 { get() } 盒子（见 cosmokit createVolatile），
  // 读配置时必须解包，否则 normalizeConfig 会拿到对象而不是标量。
  return value && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

/**
 * 把任意（可能是旧版/手写/越界的）配置归一化成可用的运行时配置。
 * @param {object} [raw]
 * @returns {typeof DEFAULTS}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const read = (key) => unwrap(source[key])
  const limitBehavior = read('limitBehavior')
  const reuseCheck = read('reuseCheck')
  return {
    maxTotal: asInt(read('maxTotal') ?? DEFAULTS.maxTotal, DEFAULTS.maxTotal, { min: 0 }),
    limitBehavior: LIMIT_BEHAVIORS.includes(limitBehavior) ? limitBehavior : DEFAULTS.limitBehavior,
    quotaEnabled: asBool(read('quotaEnabled'), DEFAULTS.quotaEnabled),
    syncActiveCap: asBool(read('syncActiveCap'), DEFAULTS.syncActiveCap),
    reuseCheck: REUSE_MODES.includes(reuseCheck) ? reuseCheck : DEFAULTS.reuseCheck,
    strongThreshold: asNumber(read('strongThreshold') ?? DEFAULTS.strongThreshold, DEFAULTS.strongThreshold, { min: 0, max: 1 }),
    candidateThreshold: asNumber(read('candidateThreshold') ?? DEFAULTS.candidateThreshold, DEFAULTS.candidateThreshold, { min: 0, max: 1 }),
    candidateLimit: asInt(read('candidateLimit') ?? DEFAULTS.candidateLimit, DEFAULTS.candidateLimit, { min: 1, max: 20 }),
    checkTtlMs: asInt(read('checkTtlMs') ?? DEFAULTS.checkTtlMs, DEFAULTS.checkTtlMs, { min: 0 }),
    guardTools: asToolList(read('guardTools')),
    queryTimeoutMs: asInt(read('queryTimeoutMs') ?? DEFAULTS.queryTimeoutMs, DEFAULTS.queryTimeoutMs, { min: 100 }),
    injectHint: asBool(read('injectHint'), DEFAULTS.injectHint),
  }
}
