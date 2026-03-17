# Downey Evals Loop — 2026-03-17 复盘记录

Version: v0.1  
Date: 2026-03-17

## 1. 目的

记录过去一天内，由于 `BRD/PRD 不清晰`、`多 agent 并行开发冲突`、`共享核心文件 owner 不明确` 所导致的问题，并沉淀出后续必须遵守的协作规则。

这份文档不是为了追责，而是为了避免同类问题反复发生。

## 2. 复盘结论

过去一天的主要问题不是“方向错了”，而是：

- 需求边界一开始没有锁死
- 多个 agent 同时修改共享核心
- UI、contract、domain 出现反向驱动
- 文档没有及时成为单一事实来源

一句话总结：

> 产品方向基本正确，但在 BRD/PRD 未完全收口前就开始多线程开发，导致共享核心文件被并行修改，类型、指标名、测试预期不断互相打架。

## 3. 昨天暴露出的具体问题

### 3.1 BRD / PRD 不清晰

表现：

- 一开始产品结构仍然带着较重的 `Prompt 工程 / Playground` 心智
- 但实际需求更接近“轻量 Targets + Datasets + Evaluators + Experiments + Observability”
- 是否需要完整 Prompt 开发器，在早期没有被明确否决
- prompt、agent、search pipeline 三者关系没有第一时间定死

结果：

- 文档和实现一度沿着 Coze Loop 的重型逻辑走
- 后续又回调成“轻量 targets”，产生了二次改造成本
- 导航、页面、对象模型都出现了反复调整

本质问题：

- BRD/PRD 在“被测对象是什么”这个问题上没有先锁死

### 3.2 多 agent 同时修改共享核心

表现：

- 多个 agent 同时触碰了共享核心文件
- `src/domain/types.ts`
- `src/domain/evaluators.ts`
- `src/domain/comparison.ts`
- `tests/search-evals.test.ts`

具体冲突信号：

- `src/domain/evaluators.ts` 一度被删除，但 domain、tests、auto-debug 仍然依赖它
- metric 命名出现漂移
  - `rerank_hit_at_3`
  - `rerank_hit_at_k`
  - `latency_ms`
  - `latency`
- binary / continuous 的约束在部分实现中被改动
- root-cause summary、layer insights、comparison contract 一度不同步

结果：

- 测试和 build 反复失效
- UI 层、shared contract、server adapter 都被连带打断
- 开发精力被消耗在“修漂移”而不是“推进产品”

本质问题：

- 没有对共享核心文件设定单一 owner

### 3.3 UI / Contract / Domain 发生反向驱动

表现：

- 前端为了页面展示方便，容易反向要求 domain 增字段或改名
- contract 层为了接口整洁，容易反向要求 domain 改 shape
- mock data 为了局部跑通，容易临时修改指标名或字段名

结果：

- domain 作为底座的稳定性下降
- contract 变成“事实来源”，而不是“适配层”
- UI 视图细节开始影响业务对象定义

本质问题：

- 没有明确依赖方向

正确方向应当是：

`Agent 1 domain -> Agent 3 contract/api/store -> Agent 2 UI`

而不是：

- `UI -> domain`
- `contract -> domain`
- `mock convenience -> metric rename`

### 3.4 Prompt / Agent / Target 的抽象过晚

表现：

- 系统一开始更像“只测 pipeline”
- 但真实需求其实是：
  - 测多个 prompt
  - 测多个 agent
  - 对它们做实验和 AB

结果：

- `PromptVersion / AgentVersion / TargetRef` 不是第一时间进入领域模型
- 文档和 sample data 先按 pipeline-only 思路推进
- 后面又补 targets 抽象，带来额外同步工作

本质问题：

- 被测对象的定义没有提前成为 BRD/PRD 的核心部分

### 3.5 测试约束和实现没有同步演进

表现：

- 测试里要求的指标和实现里的指标不一致
- 一些 auto-debug 规则依赖历史 token
- comparison / evaluator / shared mock data 之间有契约漂移

结果：

- 看起来像是“小问题”，但会不断制造噪音
- 开发者花时间追修构建，而不是推进功能

本质问题：

- 测试和共享契约没有被当成“同步更新对象”

### 3.6 GitHub Push 失败属于环境问题，不属于代码问题

表现：

- `ssh -T git@github.com`
- `kex_exchange_identification: read: Connection reset by peer`
- `Connection reset by ... port 443`

结论：

- 这是网络/代理/环境链路问题
- 不是仓库代码本身的问题
- 不应用 `force push` 作为处理手段

## 4. 造成这些问题的根因

根因可以归纳为四条：

### 根因 1：在产品边界未锁死前过早并行开发

BRD/PRD 还在变化时就开始多线程推进，实现层自然会来回返工。

### 根因 2：共享核心文件没有单一 owner

任何“大家都能顺手改一下”的核心文件，最后都会演化成冲突源。

### 根因 3：缺少显式 change protocol

以前大家知道“大概谁负责什么”，但没有规则化到“如果文件不归你就不能改”。

### 根因 4：文档没有立刻升级为单一事实来源

PRD、架构、prompt、backlog、agent 说明如果不同步，代码就会自己发明规则。

## 5. 这次已经做出的修正

当前已经落实的修正动作：

### 5.1 文档体系重构

已经拆分并固化：

- `docs/brd.md`
- `docs/prd.md`
- `docs/architecture.md`
- `docs/prompts.md`
- `docs/backlog.md`
- `docs/agents.md`
- `docs/issues.md`

### 5.2 增加协作约束文档

新增：

- `docs/sync-rules.md`

这份文档明确了：

- 单一 owner
- 红区文件
- 依赖方向
- 升级规则
- 每日同步检查

### 5.3 锁死三 agent 边界

已经正式决定：

- Agent 1 只负责领域模型、评估指标、comparison/root-cause
- Agent 3 只负责 contract adapter、API、store
- Agent 2 只消费共享 contract，不改领域定义

### 5.4 Targets 抽象进入主线

已经明确产品不是“重型 Prompt 开发器”，而是：

- `Targets`
  - `Prompts`
  - `Agents`
- `Datasets`
- `Evaluators`
- `Experiments`
- `Observability`

## 6. 后续必须遵守的规则

### 6.1 共享核心单一 owner

以下文件只能由 Agent 1 修改：

- `src/domain/types.ts`
- `src/domain/evaluators.ts`
- `src/domain/comparison.ts`
- `src/domain/root-cause.ts`
- `src/domain/experiment.ts`

### 6.2 禁止跨层越权

禁止：

- Agent 2 为了页面方便改 domain
- Agent 3 为了接口整洁改 domain
- 通过修改 tests 去掩盖越权改动

### 6.3 修改流程固定

以后涉及公共字段、指标名、层级名、实验结果结构时，流程必须是：

1. Agent 1 改 domain
2. 同步文档
3. Agent 3 做 contract / adapter 映射
4. Agent 2 消费变化

### 6.4 每天至少一次总线检查

每天至少做一次：

1. 看 `git status`
2. 看红区文件是否有人越权修改
3. 跑 `npm test`
4. 跑 `npm run build`

## 7. 这次复盘后的明确决策

从本次复盘开始，下面这些决策视为固定结论：

### 决策 1

产品主线以 `AI 搜索评测与观测` 为核心，不再走重型 Coze Prompt IDE 路线。

### 决策 2

MVP 必须有轻量 `Targets`，否则无法测多个 prompt / 多个 agent。

### 决策 3

`src/domain/types.ts`、`src/domain/evaluators.ts`、`src/domain/comparison.ts` 是红区文件，必须单一 owner。

### 决策 4

Agent 2 和 Agent 3 都不能修改领域定义，只能消费或适配。

### 决策 5

构建和测试必须作为多 agent 协作的硬闸门，而不是事后补救。

## 8. 下一轮开发前的检查表

下一轮继续多线程前，必须先确认：

- BRD / PRD / Architecture 已同步
- `docs/sync-rules.md` 已发给所有 agent
- 红区文件 owner 已确认
- 每个 agent 的 in-scope / out-of-scope 已确认
- 当前工作区 `npm test` 通过
- 当前工作区 `npm run build` 通过

如果以上任何一项不成立，不应继续并行扩功能。

## 9. 最后一句话

这次的问题，本质上不是“谁写错了”，而是：

> 在共享核心未锁死、产品边界未完全收口前，就进入了高并发开发模式。

后续只要严格执行单一 owner、依赖方向和同步检查，这类问题会明显下降。
