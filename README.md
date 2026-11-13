# dsh-subagent-governor

给 DSH 会话子智能体加两道"闸"：

1. **总量闸** —— 一个会话内子智能体（存活中 + 已运行结束）总数不超过可配置上限；达上限时按配置**询问**或**硬拒绝**。
2. **复用闸** —— 每次准备派新子智能体前，自动检查有没有任务相似、可复用的旧子智能体；相似就要求复用，不相似才放行新建。

不改原生 `subagent` / `subagent_fork` 工具，不复制模型路由。插件只做三件事：拦截决策、提供复用工具、注入一段提示。

## 为什么需要它

DSH 内置的 `@deepseek-ai/dsh-subagent` 只限制**同时存活**数量（`maxActiveSubagents`，默认 8），子代理一结束配额立即释放；达限时直接抛 `subagent limit reached`，没有询问环节；原生工具也只会新建，不会主动复用旧子代理。

本插件补上这三点，同时保留内置能力：内置容量与本插件的总量上限**叠加**生效（谁先到谁先拦）。

## 安装

```text
plugin_manager action=install_bundle target=<本目录绝对路径>
```

安装后在新会话生效。卸载/禁用时插件会把联动改过的内置活跃上限恢复原值。

## 配置

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `maxTotal` | 整数 ≥ 0 | `12` | 会话内子智能体总量上限（存活 + 已结束）。`0` = 禁止新建（只可复用） |
| `limitBehavior` | `ask` \| `deny` | `ask` | 达上限时的行为：审批后允许 / 直接拒绝 |
| `quotaEnabled` | 布尔 | `true` | 只关"总量闸"时设为 `false` |
| `syncActiveCap` | 布尔 | `true` | `maxTotal` 低于内置活跃上限时，自动把内置活跃上限下调为 `maxTotal`（只降不升） |
| `reuseCheck` | `enforce` \| `enforce-ask` \| `advise` \| `off` | `enforce` | 复用检查强度 |
| `strongThreshold` | 0–1 | `0.60` | 判定"高相似"的分数线 |
| `candidateThreshold` | 0–1 | `0.35` | 候选进入清单的分数线 |
| `candidateLimit` | 1–20 | `5` | 候选清单最多条数 |
| `checkTtlMs` | 毫秒 | `900000` | 「本次派发已检查过」标记的有效窗口 |
| `guardTools` | 字符串数组 | `["subagent","subagent_fork"]` | 拦截哪些工具调用 |
| `queryTimeoutMs` | 毫秒 | `1500` | 读取子代理目录的超时；超时放行（宁可不拦，不卡死） |
| `injectHint` | 布尔 | `true` | 是否向系统提示注入使用规范 |

## 四种复用检查模式

| 模式 | 高相似时会怎样 | 适合 |
|---|---|---|
| `enforce`（默认） | **直接自动复用**：任务转发给旧子代理，本次新建不执行 | 日常使用 |
| `enforce-ask` | 先弹卡片问「是否复用」；同意则自动转发，不同意且达上限时再问「是否新建」 | 想保留人工判断 |
| `advise` | 不拦，只记录分数并给提示 | 观察期 |
| `off` | 不检查复用，只保留总量闸 | 只想限总量 |

`enforce-ask` 的询问走 DSH 的 `userQuestions` 问答通道（与 `ask_user_question` 工具同一张卡片），分两级：

1. **复用确认**：准备新建子智能体时，若检测到高相似（≥ `strongThreshold`）的可复用子代理，先问「是否复用它」。选「复用它」→ 任务直接自动转发给旧子代理（与 `enforce` 相同的动作），本次新建不执行，模型收到「已复用…」提示后不要重试新建。选「不复用」→ 继续下一步。
2. **新建确认**：当「没有可复用候选」或「用户拒绝复用」时，若已达总量上限且 `limitBehavior=ask`，再问「是否新建」。选「允许本次新建」→ 放行；选「不新建（放弃）」→ 本次调用不执行，由主智能体自行处理。

直接调 `reuse_subagent` 时也会先问一次「是否复用」（若刚在新建卡片上批准过复用，则免问）。60 秒未回答按"不执行"处理。

这条通道不依赖宿主 approval，所以**审批被禁用的会话也能真正弹卡片**（旧实现返回 `PreToolDecision.ask`，在无审批支持的会话里会被静默降级为拒绝）。

## 四个工具

| 工具 | 用途 |
|---|---|
| `list_reusable_subagents({ task, limit? })` | 查询与 `task` 相似的可复用旧子代理，返回 id / label / 分数 |
| `reuse_subagent({ subagent_id, task })` | 把新任务发给一个已结束（或仍在运行）的可复用子代理 |
| `subagent_governor_status()` | 查看当前总量、上限、模式、活跃上限联动状态、拦截/询问/复用计数 |
| `subagent_governor_diagnose()` | 诊断：client 半是否进入 Web boot graph、settings 命名空间、bundle 路径 |

复用通过 `subagents.sendMessage` 实现：已结束的子代理会自动 cold-resume，仍在运行的则在最近步边界注入消息。

只有 **continuable** 子代理可复用（`one-shot` 子代理没有 label，也不能接收后续消息，只计入总量）。

## 设置页（子智能体管理）

插件带一个 Web 设置页，不用改配置文件也能调参：

1. 安装/更新后**刷新一次 DSH Web 页面**（`Ctrl+R`），让 Web 加载新的 client 半。
2. 打开 **设置 → 子智能体管理**（在「插件」之后、「桥接浏览器」之前）。
3. 页面分三组：
   - **总量与达限**：`maxTotal`、`limitBehavior`、`quotaEnabled`、`syncActiveCap`
   - **复用检查**：`reuseCheck`、`strongThreshold`、`candidateThreshold`、`candidateLimit`
   - **高级**：`injectHint`、`checkTtlMs`、`queryTimeoutMs`、`guardTools`
4. 改动后点「保存」，通过 `configForms` 写回插件 Config，**即时生效**（不改配置，Host 已重载）；达上限与活跃上限联动会在下一次派发时按新值执行。
5. 页面读取不到配置（`configForms` 未就绪）时只显示提示，不会写入。

> 若刷新后仍看不到入口：重启 DSH 桌面应用（client 插件包在 Web 启动时构建）。

## 内置活跃上限联动

- 当 `maxTotal` < 内置 `maxActiveSubagents`（默认 8）时，插件启动时把内置活跃上限写成 `maxTotal`。
- 只降不升：`maxTotal` 大于内置值时不动内置配置。
- `maxTotal=0`（禁止新建）或 `syncActiveCap=false` 时不动。
- 插件卸载/禁用时恢复原值。
- 若宿主没有暴露可写通道，插件只记一条 warn，其余治理照常（`status` 中 `activeCapSynced: false`）。

## 回滚

- 只想关复用：`reuseCheck: "off"`。
- 只想关总量闸：`quotaEnabled: false`。
- 全关但保留插件：`quotaEnabled: false` + `reuseCheck: "off"`（零开销，不读子代理目录）。
- 彻底移除：卸载插件，内置活跃上限自动恢复。

## 限制

- 相似度是本地词法打分（中文按字、拉丁按词），不是语义模型；阈值可调，误判时先切 `advise` 观察。
- 复用候选只来自**当前父会话的直接子代理**（内置 API 的边界），跨会话共享子代理不在范围内。
- `enforce-ask` 的卡片需要客户端有 user-questions answerer；弹不出来时复用确认会被跳过（不会挡住正常派发），配额询问回退到宿主 approval。
- 不拦截 Agent Teams 的 `spawn_teammate`（团队队友不走子代理目录）。

## 开发

```powershell
cd plugins/dsh-subagent-governor
node --test
```

全量 **103 个用例**，覆盖：

| 套件 | 用例数 | 内容 |
|---|---|---|
| `test/similarity.test.mjs` | 9 | 词法相似度打分、归一化、长文本退化 |
| `test/quota.test.mjs` | 5 | 总量闸 ask/deny、`maxTotal=0`、配额关闭 |
| `test/capacity.test.mjs` | 9 | 内置活跃上限联动（写入/不升/禁用/失败降级/恢复） |
| `test/guard.test.mjs` | 19 | 守卫四模式、复用卡片、拒绝指引、fail-open |
| `test/tools.test.mjs` | 7 | 四工具注册、复用转发、错误路径 |
| `test/matrix.test.mjs` | 49 | **40 条链路矩阵** + ask 同意分支 + 回归 |
| `test/profile-config.test.mjs` | 5 | 配置热更新文件解析 |

40 条链路矩阵 = `maxTotal ∈ {0, 未满, 已满}` × `reuseCheck ∈ {enforce, enforce-ask, advise, off}` × `quota ∈ {off, deny, ask}`（其中 enforce-ask 的复用卡片与总量 ask 分别覆盖同意/拒绝/超时）。完整测试报告见仓库 `docs/` 目录。

## 许可证

MIT
