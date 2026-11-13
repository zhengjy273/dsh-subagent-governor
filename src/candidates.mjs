/** 从 durable catalog 里挑出可复用候选并打分排序。 */
import { matchedTokens, scoreTexts } from './similarity.mjs'

/**
 * @typedef {object} RankedCandidate
 * @property {string} subagentId
 * @property {string} label
 * @property {'continuable'} mode
 * @property {number} createdAt
 * @property {number} score
 * @property {string[]} matched
 */

/**
 * @param {Array<{id: string, createdAt: number, mode: string, label?: string}>} catalog
 * @param {string} task
 * @param {{ threshold?: number, limit?: number, description?: string }} [options]
 * @returns {RankedCandidate[]}
 */
export function rankCandidates(catalog, task, options = {}) {
  const threshold = options.threshold ?? 0.35
  const limit = options.limit ?? 5
  const text = String(task ?? '')
  const description = typeof options.description === 'string' ? options.description.trim() : ''
  return (Array.isArray(catalog) ? catalog : [])
    .filter((entry) => entry && entry.mode === 'continuable')
    .map((entry) => {
      const label = typeof entry.label === 'string' ? entry.label : ''
      const taskScore = label ? scoreTexts(label, text) : 0
      const descriptionScore = label && description ? scoreTexts(label, description) : 0
      const score = Math.max(taskScore, descriptionScore)
      const matchedFrom = descriptionScore >= taskScore && description ? description : text
      return {
        subagentId: entry.id,
        label,
        mode: 'continuable',
        createdAt: entry.createdAt ?? 0,
        score,
        matched: label ? matchedTokens(label, matchedFrom) : [],
      }
    })
    .filter((candidate) => candidate.score >= threshold)
    .sort((left, right) => right.score - left.score || left.createdAt - right.createdAt)
    .slice(0, limit)
}

/** 所有可复用（continuable）子代理，无论得分。 */
export function continuableEntries(catalog) {
  return (Array.isArray(catalog) ? catalog : []).filter((entry) => entry && entry.mode === 'continuable')
}
