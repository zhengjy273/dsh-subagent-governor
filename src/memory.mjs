/** 每父会话的「最近一次复用检查」记账（内存态，TTL 过期即丢）。 */

/**
 * @param {{ ttlMs?: number, now?: () => number }} [options]
 */
export function createLedger(options = {}) {
  const ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? 900_000))
  const now = options.now ?? (() => Date.now())
  /** @type {Map<string, { task: string, top: object | null, at: number }>} */
  const entries = new Map()

  return {
    get(parentId) {
      const entry = entries.get(parentId)
      if (!entry) return undefined
      if (now() - entry.at > ttlMs) {
        entries.delete(parentId)
        return undefined
      }
      return entry
    },
    set(parentId, value) {
      entries.set(parentId, { task: String(value?.task ?? ''), top: value?.top ?? null, at: now() })
    },
    clear(parentId) {
      entries.delete(parentId)
    },
    get size() {
      return entries.size
    },
    /** 清理过期项，避免长期运行的内存膨胀。 */
    prune() {
      const at = now()
      for (const [key, entry] of entries) {
        if (at - entry.at > ttlMs) entries.delete(key)
      }
    },
  }
}
