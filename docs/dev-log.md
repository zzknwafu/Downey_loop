# Downey Evals Loop — 开发日志

Version: v0.1  
Maintainer: Agent 1 / 主 agent  
Start Date: 2026-03-17

## 1. 目的

这份文档用于按天记录项目推进情况，帮助团队快速回答四个问题：

- 今天做了什么
- 今天卡在哪里
- 明天先做什么
- 预计什么时候能交付主线 MVP

说明：

- 这里记录的是“开发推进日志”，不是复盘文档
- 复盘请看：
  - [retrospective-2026-03-17.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/retrospective-2026-03-17.md)
  - [retrospective-2026-03-18.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/retrospective-2026-03-18.md)

## 2. 当前主线定义

当前主线 MVP 聚焦以下模块：

- Targets
  - Prompts
  - Agents
- Dataset
  - 先完成 `Evaluation set`
- Evaluator
- Experiment
  - 单实验
  - AB 实验
  - trace / stats / root-cause 统一在实验里看

当前不作为主线阻塞项：

- 智能合成
  - 已拆为独立侧线，交由 Agent 4 推进

## 3. 每日记录

### 2026-03-17

#### 今日进展

- 完成文档体系拆分：
  - [brd.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/brd.md)
  - [prd.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/prd.md)
  - [architecture.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/architecture.md)
  - [prompts.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/prompts.md)
- 完成 backlog、issues、agent 协作文档：
  - [backlog.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/backlog.md)
  - [issues.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/issues.md)
  - [agents.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/agents.md)
  - [sync-rules.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/sync-rules.md)
- 锁死 Agent 1 / 2 / 3 的 owner 边界
- 开始收口 domain 主线：
  - 共享 types
  - comparison / root-cause
  - runner / service 骨架
- 本地仓库完成首个 commit，并连接到 GitHub 远端

#### 今日问题

- BRD / PRD 初始边界不清晰
- 多 agent 同时修改共享核心文件
- UI / contract / domain 出现反向驱动
- GitHub push 受网络与认证环境影响失败

#### 当日结论

- 这一天的主要价值不是功能完成，而是把“怎么协作”这件事定清楚
- 如果没有 owner 规则，后续所有模块都会反复返工

### 2026-03-18

#### 今日进展

- Dataset 主线显著推进：
  - 支持三类数据集
  - 支持创建 / 修改数据集
  - schema 校验落到 domain
  - 样本量最小值约束 `>= 10`
  - 样本级 create / update / delete 规则补齐
- `Dataset case` 的可编辑结构正式进入 domain
- `PromptVersion / AgentVersion / target selection` 的实验语义补进 domain
- Prompt 页产品定位收口：
  - `Prompt template`
  - `Preview and debug`
  - 不强制 `common configuration`
- Experiment 信息架构收口：
  - 评测 / 观测 / trace / stats 统一回到实验中看
- 智能合成被重新定义为“方向性补样”，随后从主线中拆出为侧线
- 新增 Agent 4：
  - 专门负责 `智能合成`
  - 不阻塞主线 MVP

#### 今日问题

- `智能合成` 的产品理解最初没有和业务目标拉齐
- Prompt 页面一开始仍然带着 Coze 的重型心智
- 文档一更新，下游 mock / store / test 会立即暴露旧假设
- Agent prompt 需要跟产品定义同步刷新，否则执行偏离

#### 当日结论

- 今天开始，项目从“修冲突”转向“沿主线稳定推进”
- Dataset 基本成为今天的主成果
- 智能合成已不再阻塞主线

#### 收工更新

- 今日进展
  - 主线口径已经收口为 `Targets / Evaluation set / Evaluators / Experiments`
  - `智能合成` 已拆为 Agent 4 的独立侧线
  - 当日工作区状态已通过：
    - `npm test`
    - `npm run build`
- 今日问题
  - 多线程工作区仍然需要持续依赖 owner 规则，避免再次回到共享核心互相覆盖
  - 前端与 integration 仍需继续把今天新增的 domain 规则接起来
- 当日结论
  - 今天可以作为一个“可回放、可继续联调”的收工快照提交
- 明日优先级
  - Targets 最小闭环
  - Evaluation set 前后端联调
  - Experiment 主流程的 target / dataset / evaluator 组合
- 预计时间是否变化
  - 无变化
  - 主线 MVP 可用版仍预计为 `2026-03-21` 到 `2026-03-23`
  - 主线 MVP 稳定版仍预计为 `2026-03-24` 到 `2026-03-26`

## 4. 当前完成度判断

以下判断为主观工程评估，用于排优先级，不代表正式发布承诺。

### 4.1 文档与协作机制

- 完成度：90%
- 状态：基本稳定

已完成：

- 文档体系
- agent owner 规则
- backlog / issue 拆解
- 每日复盘机制

剩余：

- 日常持续维护
- 避免文档与代码再次漂移

### 4.2 Targets

- 完成度：45%
- 状态：domain 语义已开始成型，UI 和 integration 未完全打通

已完成：

- target 语义进入 experiment
- PromptVersion / AgentVersion 已进入产品定义

剩余：

- Targets 列表与创建流程
- Prompt / Agent 的最小 contract
- 实验选择 target 的完整闭环

### 4.3 Dataset

- 完成度：70%
- 状态：domain 主线较完整，UI / API / store 还需同步

已完成：

- 三类数据集
- create / update
- sampleCount 最小值规则
- editable case 结构
- 样本级编辑规则

剩余：

- 前端完整 Evaluation set 页面
- Dataset API/store 对齐
- 真实列表 / 详情 / 编辑联调

### 4.4 Evaluator

- 完成度：45%
- 状态：方向清楚，仍需继续收口主线能力

已完成：

- 模型评估 / 代码评估产品定义
- 四层评估视图思路
- binary 指标严格 0/1 约束

剩余：

- evaluator 配置主流程
- code evaluator 执行与 UI 联动
- experiment 中的 evaluator 选择与持久化

### 4.5 Experiment

- 完成度：50%
- 状态：骨架可用，产品语义继续收口中

已完成：

- experiment run 骨架
- comparison / root-cause 基础能力
- experiment 内统一承载 trace / stats / metrics 的方向

剩余：

- 创建实验主流程
- target + dataset + evaluator 的实际组合校验
- 单实验与 AB 实验页面/contract 联动

## 5. 预计完成时间

以下时间基于 2026-03-18 当前状态推测，前提是假设：

- Agent 2 / Agent 3 / Agent 4 按 owner 边界推进
- 不再发生共享核心大规模冲突
- 本地网络 / GitHub 环境不会继续打断开发节奏

### 5.1 主线 MVP 可用版

预计时间：

- 2026-03-21 到 2026-03-23

可用版定义：

- 可以管理 `Evaluation set`
- 可以管理基础 `Prompt / Agent targets`
- 可以配置并查看 `Evaluators`
- 可以运行单实验
- 可以查看 AB 实验基本对比
- 可以在实验里下钻 trace / stats / root-cause

### 5.2 主线 MVP 稳定版

预计时间：

- 2026-03-24 到 2026-03-26

稳定版定义：

- 前后端 contract 稳定
- 主要页面能持续联调
- 测试和构建稳定
- UI 动线不再大改

### 5.3 智能合成侧线

预计时间：

- 不纳入主线完成时间
- 建议在主线 MVP 可用后再排期

## 6. 明日开工优先级

### P0

- Targets 的最小 domain / contract / UI 闭环
- Evaluation set 的前后端联调
- Experiment 中 target / dataset / evaluator 的组合主流程

### P1

- Prompt template + preview/debug 页面收口
- Experiment 内统一 trace / stats / root-cause 视图

### P2

- 智能合成侧线继续独立推进
- 不影响主线验收

## 7. 维护方式

建议每天收工前补一条记录，格式固定为：

- 今日进展
- 今日问题
- 当日结论
- 明日优先级
- 预计时间是否变化

如果某天出现明显返工、阻塞或计划偏移，也应在这里记录，而不是只写进复盘文档。
