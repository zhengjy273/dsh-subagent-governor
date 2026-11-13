/**
 * 轻量文本相似度：中文字符集 Jaccard + 包含系数 + 字符级 LCS 比率。
 * 目标场景是子代理的短 label（3-10 个字），所以按"字"而不是按分词打分。
 * 纯函数、零依赖。
 */

const CJK_RANGES = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const LATIN_WORD = /[a-z0-9][a-z0-9_.+-]*/g

/** 归一化：小写、全角转半角 ASCII、标点折叠为空格。 */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** 紧凑串（去掉所有空白），用于 LCS。 */
function compact(text) {
  return normalizeText(text).replace(/\s+/g, '')
}

/** 词元集合：拉丁词整体入集，其余（中文等）按单字入集。 */
function tokenSet(text) {
  const normalized = normalizeText(text)
  const tokens = new Set()
  for (const word of normalized.match(LATIN_WORD) ?? []) {
    if (word.length >= 2) tokens.add(`w:${word}`)
  }
  const rest = normalized.replace(LATIN_WORD, ' ')
  for (const char of rest) {
    if (/\S/u.test(char)) tokens.add(`c:${char}`)
  }
  return tokens
}

/** 最长公共子序列 / min(len(a), len(b))。 */
function lcsRatio(a, b) {
  const n = a.length
  const m = b.length
  if (!n || !m) return 0
  if (n * m > 40_000) {
    // 超长文本退化为前缀包含判断，避免守卫线程被卡住。
    return a.includes(b) || b.includes(a) ? Math.min(n, m) / Math.min(n, m) : 0
  }
  let previous = new Uint16Array(m + 1)
  let current = new Uint16Array(m + 1)
  for (let i = 1; i <= n; i++) {
    const code = a.charCodeAt(i - 1)
    for (let j = 1; j <= m; j++) {
      current[j] = code === b.charCodeAt(j - 1)
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1])
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[m] / Math.min(n, m)
}

/**
 * 两段文本的相似度，0..1。
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function scoreTexts(left, right) {
  const a = compact(left)
  const b = compact(right)
  if (!a || !b) return 0
  if (a === b) return 1
  const tokensA = tokenSet(left)
  const tokensB = tokenSet(right)
  if (!tokensA.size || !tokensB.size) return 0
  let intersection = 0
  for (const token of tokensA) if (tokensB.has(token)) intersection += 1
  const union = tokensA.size + tokensB.size - intersection
  const jaccard = union > 0 ? intersection / union : 0
  const contain = intersection / Math.min(tokensA.size, tokensB.size)
  const lcs = lcsRatio(a, b)
  return Math.min(1, 0.25 * jaccard + 0.45 * contain + 0.3 * lcs)
}

/** 命中词元数量，供工具输出解释打分来源。 */
export function matchedTokens(left, right) {
  const tokensA = tokenSet(left)
  const tokensB = tokenSet(right)
  const matched = []
  for (const token of tokensA) {
    if (tokensB.has(token)) matched.push(token.slice(2))
  }
  return matched.slice(0, 12)
}

export { CJK_RANGES }
