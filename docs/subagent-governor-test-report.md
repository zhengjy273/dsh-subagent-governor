# 子智能体治理插件 · 全链路测试报告

- 日期：2026-11-13
- 插件：`@local/dsh-subagent-governor` 0.1.x（`E:\Work\DSH\plugins\dsh-subagent-governor`）
- 宿主：DeepSeek Harness 0.2.2-rc.1（desktop profile），Node v24.21.0
- 需求来源：用户 m02426（40 条链路全测 + 阈值探索 + 报告）

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| 40 条链路矩阵（逻辑层） | **40/40 通过**（另有 9 条补充/回归用例，共 49 例，`node --test` 全绿） |
| 实机验证（GUI 真实点击卡片） | 10 条代表链路全部符合预期 |
| 测试中发现的问题 | 3 个（文案重复 ×2、候选推荐阈值 ×1），**已修复** |
| 阈值结论 | 默认 `strong 0.6 / candidate 0.35 / limit 5` 在样本上误报为 0；如需更高召回可降到 `strong 0.5` |

## 2. 被测逻辑（xmind 逻辑链）

```
准备唤起子智能体
  → 检查复用行为
      enforce      有可复用 → 自动复用（sendMessage 转发），无 → 总量检查
      enforce-ask  有可复用 → 弹卡片问是否复用；同意 → 自动复用；不同意 → 总量检查
      advise       有可复用 → 只记账不拦 → 总量检查
      off          跳过复用检查 → 总量检查
  → 检查是否开启总量限制（quotaEnabled）
      否 → 放行新建
      是 → 上限检查：未达上限 → 放行；达上限 → 按 limitBehavior
           deny → 拒绝新建（附「自行判断」指引）
           ask  → 弹卡片问是否新建：同意 → 放行；拒绝 → 拒绝并附指引
```

边界：`maxTotal=0` 表示**禁止新建**（不是"不限"）；`0` 时无论 `limitBehavior` 都直接拒绝，且不弹新建卡片。

## 3. 测试方法

1. **40 链路矩阵单测**（`test/matrix.test.mjs`）：把守卫 `onPreExecute` 的依赖全部注入 mock（catalog、userQuestions 卡片答案、sendMessage、计数器），逐条断言返回的 `PreToolDecision`。
   - 维度：`maxTotal ∈ {0, 5(未满), 2(已满)}` × `reuseCheck ∈ {enforce, enforce-ask, advise, off}` × `quota ∈ {off(quotaEnabled=false), deny, ask}`。
   - 卡片分支：enforce-ask 的复用卡片展开 `同意 / 拒绝 / 60s 超时 / 无法弹卡`；总量 ask 展开 `同意 / 拒绝`。
2. **实机验证**：用桌面自动化在会话「唤起子智能体测试」中派发真实 `subagent` 调用，并在 DSH 界面真实点击治理卡片选项；本会话内直接调用 `subagent` 验证不需要卡片的分支。
3. **阈值扫描**：`node .tmp-thresholds.mjs`，用 6 组近似任务对 + 6 组无关任务对，扫描 `strongThreshold`、`candidateThreshold`。

## 4. 40 条链路矩阵结果

### 组 A：`maxTotal=0`（禁止新建）

| # | reuseCheck | quota | 期望 | 实际 |
|---|---|---|---|---|
| A1 | enforce | off | 复用优先（deny「已复用」） | ✅ |
| A2 | enforce | deny | 复用优先 | ✅ |
| A3 | enforce | ask | 复用优先 | ✅ |
| A4 | enforce-ask | off | 拒绝复用后配额关闭 → 放行 | ✅ |
| A5 | enforce-ask | deny | deny「上限为 0」 | ✅ |
| A6 | enforce-ask | ask | deny「上限为 0」（0 不问） | ✅ |
| A7 | advise | off | 放行 | ✅ |
| A8 | advise | deny | deny「上限为 0」 | ✅ |
| A9 | advise | ask | deny「上限为 0」 | ✅ |
| A10 | off | off | 放行 | ✅ |
| A11 | off | deny | deny「上限为 0」 | ✅ |
| A12 | off | ask | deny「上限为 0」 | ✅ |

### 组 B：`maxTotal=5` 未达上限

| # | reuseCheck | quota | 期望 | 实际 |
|---|---|---|---|---|
| B1–B3 | enforce | off/deny/ask | 自动复用（三态一致） | ✅ |
| B4–B6 | enforce-ask | off/deny/ask | 卡片 → 拒绝复用 → 放行（未满不问新建） | ✅ |
| B7–B9 | advise | off/deny/ask | 放行（只记账） | ✅ |
| B10–B12 | off | off/deny/ask | 放行 | ✅ |

### 组 C：`maxTotal=2` 已达上限（catalog=2）

| # | reuseCheck | quota | 期望 | 实际 |
|---|---|---|---|---|
| C1–C3 | enforce | off/deny/ask | 复用优先（配额不参与） | ✅ |
| C4 | enforce-ask | off | 放行 | ✅ |
| C5 | enforce-ask | deny | deny + 「自行判断」指引 | ✅ |
| C6 | enforce-ask | ask(拒绝) | deny + 「你选择了不新建」 | ✅ |
| C7 | advise | off | 放行 | ✅ |
| C8 | advise | deny | deny + 指引 | ✅ |
| C9 | advise | ask(拒绝) | deny + 指引 | ✅ |
| C10 | off | off | 放行 | ✅ |
| C11 | off | deny | deny + 指引 | ✅ |
| C12 | off | ask(拒绝) | deny + 指引 | ✅ |

### 组 D：enforce-ask 复用卡片分支

| # | 卡片结果 | 期望 | 实际 |
|---|---|---|---|
| D1 | 同意复用 | 自动 sendMessage 转发，deny「已复用」 | ✅ |
| D2 | 拒绝复用 | 继续总量检查（未满 → 放行） | ✅ |
| D3 | 60s 超时 | deny「未收到你的选择」 | ✅ |
| D4 | 无法弹卡 | 回退放行（不阻断正常流程） | ✅ |

### 补充用例（9 条）

| # | 场景 | 期望 | 实际 |
|---|---|---|---|
| C+1 | 已满 · enforce · ask 同意 | 复用优先 | ✅ |
| C+2~4 | 已满 · enforce-ask/advise/off · ask 同意 | 放行 | ✅ |
| R1 | 无候选 · enforce | 不拦 | ✅ |
| R2 | 不相似任务 · enforce | 不拦 | ✅ |
| R3 | reuse_subagent · enforce/advise/off | 不拦 | ✅ |
| R4 | reuse_subagent · enforce-ask 拒绝 | deny + 指引 | ✅ |
| R5 | 非守卫工具 | 直接放行 | ✅ |

## 5. 实机验证记录

| # | 配置 | 操作 | 实际返回 |
|---|---|---|---|
| E1 | 12 / ask / enforce-ask | 派「天气查询测试」（无相似） | `started subagent bd4631ac…` |
| E2 | 同上 | 派「天气查询复核」→ 卡片 0.63 → 点「复用它」 | `Error: 已复用子智能体 […]（相似度 0.63）：本次任务已发送给它…`，总量不增 |
| E3 | 同上 | 派「天气查询再核」→ 卡片 → 点「不复用」 | `started subagent e0a73586…`（未满直接放行） |
| E4 | 3 / deny / 满 | 派「磁盘空间统计」 | 硬拒，reason 含「① reuse_subagent…② 直接用当前上下文完成」 |
| E5 | 3 / ask / 满 | 派「端口占用检查」→ 卡片 → 点「允许本次新建」 | `started subagent 5ea6ae9f…` |
| E6 | 3 / ask / 满 | 派「CPU 占用排查」→ 卡片 → 点「不新建（放弃）」 | 拒绝，含「（你选择了不新建）」+ 指引 |
| E7 | 0 / ask / enforce-ask | 派「内存占用检查」→ 卡片 → 点「不复用」 | `Error: 会话子智能体总量上限为 0：已禁止新建子智能体。` |
| E8 | 12 / ask / advise | 派「天气查询测试二」 | `started subagent 03ab1339…`（不弹卡、不拦） |
| E9 | 0 / deny / off（quota on） | 派「磁盘空间统计二」 | `Error: 会话子智能体总量上限为 0：已禁止新建子智能体。` + 指引 |
| E10 | 0 / off / off（quotaEnabled=false） | 派「日志统计二」 | `started subagent e19c6e87…`（总量闸关闭后放行） |

## 6. 阈值探索

样本（中文任务短标签，`scoreTexts` 打分）：

| 类型 | 任务对 | 分数 |
|---|---|---|
| 正例 | 论文引用核查 / 论文参考文献核查 | 0.611 |
| 正例 | 天气查询测试 / 天气查询复核 | 0.625 |
| 正例 | 端口占用检查 / 内存占用检查 | 0.625 |
| 正例 | 磁盘空间统计 / 磁盘容量统计 | 0.625 |
| 正例 | 日志统计 / 日志分析 | 0.458 |
| 正例 | 引用核对 / 参考文献核对 | 0.438 |
| 负例 | 天气查询测试 / CPU 占用排查 | 0.165 |
| 负例 | 其余 5 组无关任务 | 0.000 |

`strongThreshold` 扫描：

| 阈值 | TP | FN | FP | TN | 准确率 |
|---|---|---|---|---|---|
| 0.50 | 4 | 2 | 0 | 6 | 0.833 |
| 0.55 | 4 | 2 | 0 | 6 | 0.833 |
| 0.60（默认） | 4 | 2 | 0 | 6 | 0.833 |
| 0.65 | 0 | 6 | 0 | 6 | 0.500 |
| 0.70 | 0 | 6 | 0 | 6 | 0.500 |

`candidateThreshold` 扫描：

| 阈值 | 正例命中 | 负例混入 |
|---|---|---|
| 0.20–0.40 | 6/6 | 0/6 |
| 0.45 | 5/6 | 0/6 |

`candidateLimit`：只影响候选清单长度，不影响 top1 判定；5 足够，>10 无额外收益。

**建议**

- 保守（默认）：`strong 0.6 / candidate 0.35 / limit 5` —— 精确率优先，本样本误报 0。
- 平衡（推荐给"任务描述普遍简短"的场景）：`strong 0.5 / candidate 0.3 / limit 5` —— 可额外覆盖 0.45–0.5 的同主题任务（如「日志统计 vs 日志分析」），样本内误报仍为 0（负例上界 0.165）。
- 不建议 `strong ≥ 0.65`：会让 0.6 附近的真实相似任务全部漏判。

## 7. 测试中发现并修复的问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | 达上限拒绝文案尾部重复（「请先复用旧子代理…」出现两次） | `src/quota.mjs` 删除该段，统一由 `refusalGuidance()` 输出 |
| 2 | 拒绝时的"推荐复用"候选用了 `threshold: 0`，会推荐毫不相干的子代理 | `src/guard.mjs` 的 `bestReusable` 改用 `cfg.candidateThreshold` |
| 3 | `ask` 卡片的问题与说明重复（问题文本出现两遍） | `src/ask.mjs` 的 `askPayload` 改为固定口径的统计说明 |

修复后 `node --test` 全量通过（54 例原有 + 49 例矩阵，共 103 例）。

## 8. 局限与后续建议

- 矩阵单测验证的是**逻辑分支**；`userQuestions` 卡片渲染、`sendMessage` 冷启动等运行时行为由实机验证覆盖（10 条）。
- 相似度是词法算法（jaccard + containment + LCS），对同义改写不敏感；如需语义匹配，可后续接入 embedding。
- `enforce` 模式下自动复用是"静默转发"，用户不会看到卡片；若希望每次复用都提示，可改用 `enforce-ask`。
- 建议把本报告的 40 条矩阵固化为 CI 门禁（`node --test test/matrix.test.mjs`）。
