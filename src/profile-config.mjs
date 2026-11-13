/**
 * 从 profile 的 cordis.patch.yml 里读取本插件的 config。
 *
 * 为什么需要它：设置页保存只写这个文件，不触发插件重载，也不更新运行时 Config 实例。
 * 守卫在每次决策前读一次文件即可拿到最新值（文件很小，解析是逐行扫描）。
 * 只解析本插件这一条 insert 的 config 块，标量/布尔/数字/行内数组足够覆盖全部字段。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let cachedFile

const ID_LINE = /^\s*-\s*id:\s*['"]?([\w@/.-]+)['"]?\s*$/
const KEY_LINE = /^\s+([\w-]+):\s*(.*?)\s*$/
const CONFIG_LINE = /^\s+config:\s*$/

function parseScalar(raw) {
  const value = String(raw ?? '').trim()
  if (value === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  const quoted = /^['"](.*)['"]$/.exec(value)
  if (quoted) return quoted[1]
  const array = /^\[(.*)\]$/.exec(value)
  if (array) {
    const items = array[1].split(',')
    const parsed = []
    for (const item of items) {
      const single = parseScalar(item)
      if (single !== undefined) parsed.push(single)
    }
    return parsed
  }
  const num = Number(value)
  if (!Number.isNaN(num)) return num
  return value
}

/**
 * @param {string} text cordis.patch.yml 内容
 * @param {string} entryId 本插件 patch 行的 id（默认 subagent-governor）
 * @returns {object | undefined} 该条目的 config 对象；找不到条目/无 config 时 undefined
 */
export function parseGovernorConfig(text, entryId = 'subagent-governor') {
  if (typeof text !== 'string' || !text) return undefined
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const match = ID_LINE.exec(lines[index])
    if (match && match[1] === entryId) {
      start = index
      break
    }
  }
  if (start < 0) return undefined

  const config = Object.create(null)
  let inConfig = false
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (ID_LINE.test(line)) break
    if (!inConfig) {
      if (CONFIG_LINE.test(line)) inConfig = true
      else if (line.trim() !== '' && !/^\s/.test(line)) break
      continue
    }
    if (line.trim() === '') continue
    if (!/^\s/.test(line)) break
    const match = KEY_LINE.exec(line)
    if (!match) continue
    if (match[2] === '') {
      // 块风格列表：guardTools:\n      - subagent\n      - subagent_fork
      const items = []
      for (let next = index + 1; next < lines.length; next += 1) {
        const item = /^\s*-\s+(.*?)\s*$/.exec(lines[next])
        if (!item) break
        const parsed = parseScalar(item[1])
        if (parsed !== undefined) items.push(parsed)
        index = next
      }
      if (items.length > 0) config[match[1]] = items
      continue
    }
    const value = parseScalar(match[2])
    if (value !== undefined) config[match[1]] = value
  }
  const keys = Object.keys(config)
  return keys.length > 0 ? { ...config } : undefined
}

/**
 * @param {string} file cordis.patch.yml 绝对路径
 * @param {string} entryId
 */
export function readGovernorConfig(file, entryId = 'subagent-governor') {
  try {
    return parseGovernorConfig(readFileSync(file, 'utf8'), entryId)
  } catch {
    return undefined
  }
}

/**
 * 在 DSH_HOME/profiles 下找第一个包含本插件条目的 cordis.patch.yml。
 * settings.prepareDocument() 在部分宿主里拿不到路径，这里按目录探测兜底；
 * 结果缓存，文件被删后下次重新探测。
 */
export function discoverPatchFile(entryId = 'subagent-governor') {
  if (cachedFile && existsSync(cachedFile)) return cachedFile
  cachedFile = undefined
  const roots = []
  if (process.env.DSH_HOME) roots.push(process.env.DSH_HOME)
  roots.push(join(homedir(), '.dsh'))
  for (const root of roots) {
    const profiles = join(root, 'profiles')
    let names = []
    try {
      names = readdirSync(profiles)
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(profiles, name, 'cordis.patch.yml')
      try {
        if (readFileSync(file, 'utf8').includes(entryId)) {
          cachedFile = file
          return file
        }
      } catch {
        // 单个 profile 读不了就跳过
      }
    }
  }
  return undefined
}
