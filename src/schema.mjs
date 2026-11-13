/** schemastery 配置 schema（仅入口使用；测试不导入本文件，避免依赖宿主包）。
 *
 * 所有字段都标记 volatile：DSH 的 settings 服务只把「含 volatile 字段」的 Config
 * 投影成设置表单（`volatileForm(schema)` 为 undefined 的条目会被 describe() 直接跳过），
 * 而 client 侧的 configForms 也以此为依据。volatile 字段可在运行时原地修改（热生效），
 * 与官方 `@deepseek-ai/dsh-subagent` 的 maxDepth/maxActiveSubagents 做法一致。
 */
import Schema from '@deepseek-ai/schemastery'

export const Config = Schema.object({
  maxTotal: Schema.natural().default(12).volatile(),
  limitBehavior: Schema.union(['ask', 'deny']).default('ask').volatile(),
  quotaEnabled: Schema.boolean().default(true).volatile(),
  syncActiveCap: Schema.boolean().default(true).volatile(),
  reuseCheck: Schema.union(['enforce', 'enforce-ask', 'advise', 'off']).default('enforce').volatile(),
  strongThreshold: Schema.percent().default(0.6).volatile(),
  candidateThreshold: Schema.percent().default(0.35).volatile(),
  candidateLimit: Schema.natural().min(1).max(20).default(5).volatile(),
  checkTtlMs: Schema.natural().default(900000).volatile(),
  guardTools: Schema.array(Schema.string()).default(['subagent', 'subagent_fork']).volatile(),
  queryTimeoutMs: Schema.natural().default(1500).volatile(),
  injectHint: Schema.boolean().default(true).volatile(),
})
