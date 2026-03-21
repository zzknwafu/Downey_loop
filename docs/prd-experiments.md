# Downey Evals Loop — Experiments 子 PRD

Version: v0.1  
Stage: Local MVP  
Date: 2026-03-18

## 1. 模块目标

`Experiment` 是主线中的核心模块，用于把 `Target`、`Dataset`、`EvaluatorSet` 绑定成一次完整评测运行。

实验不是单个 evaluator 测试页，而是完整评测任务。

MVP 阶段采用 `Prompt-first` 策略：

- 当前 `Targets` 产品上同时存在 `PromptVersion` 与 `AgentVersion`
- 但 `Experiment` 的本轮可执行主线只保证 `PromptVersion` 能完整测通
- `AgentVersion` 在实验中保留目标类型与后续扩展位置，不作为当前交付阻塞项

## 1.1 Dataset 入口边界

`Experiment` 主流程只能绑定“正式评测集”。

在当前产品语义中，以下 dataset 都属于正式评测集：

- 通过真实 `POST /api/datasets` 创建成功并持久化的数据集
- 当前随产品预置、并出现在 Dataset 页正式列表中的内置数据集

说明：

- 这批预置 dataset 已升级为正式可用数据集
- 它们不再按 seeded mock 展示资产处理
- 它们与用户创建成功的数据集在 Experiment 入口上拥有相同资格

以下 dataset 不能进入真实 Experiment：

- 仅存在于前端本地状态中的 local mock dataset
- 仅用于页面演示、未经过真实持久化链路的数据

## 2. 基本定义

一次实验定义为：

- `1 个 Target`
- `1 个 Dataset`
- `1 组 Evaluators`
- `1 份 RunConfig`
- `1 次 ExperimentRun`

说明：

- 产品定义上，`Target` 可以是 `PromptVersion` 或 `AgentVersion`
- 一次实验默认使用多个 evaluators
- MVP 运行主线先保证 `PromptVersion`
- `Dataset` 必须来自正式评测集集合，不能来自 local mock 演示数据

## 2.1 MVP 评测对象范围

本轮实验只保证 `PromptVersion` 能完成以下闭环：

- 选择 Prompt 及版本
- 选择评测集及版本
- 选择多个评估器及版本
- 配置运行参数
- 发起实验
- 查看单实验结果
- 发起多实验对比

`AgentVersion` 的处理原则：

- 保留在产品对象模型中
- 保留在实验目标类型中
- 不承诺本轮可执行
- 不阻塞 `PromptVersion` 实验 MVP 上线

## 2.2 Prompt-first 实验定义

当前 MVP 下，一次可执行实验定义为：

- `1 个 PromptVersion`
- `1 个 Dataset`
- `1 组 Evaluators`
- `1 份 RunConfig`
- `1 次 ExperimentRun`

说明：

- Prompt 是本轮唯一保证可执行的实验对象
- Agent 实验会在后续迭代补齐

## 3. 页面结构

Experiment 模块采用三层结构：

### 3.1 Experiment 首页

首页只做实验列表，不展开实验详情。

首页职责：

- 展示 experiment 列表
- 支持搜索、筛选、状态查看
- 支持进入单个 experiment 详情

首页不承担：

- `Basic Information`
- `Data detail`
- `Indicator statistics`
- `Experiment configuration`

### 3.2 Experiment 详情页

实验详情页承载实验运行后的主视图。

详情页顶部必须有：

- `Basic Information`

详情页主内容采用 3 个核心页签：

- `Data detail`
- `Indicator statistics`
- `Experiment configuration`

trace、观测、统计都统一归在 experiment 详情页内部，不再独立成 experiment 外的新中心。

### 3.3 Case Detail Drawer

样本级下钻统一通过 `Case Detail Drawer` 完成。

它不是单独页面，而是从 `Data detail` 进入的 case 级详情视图。

## 3.4 Evaluator Layer Filter

`Evaluator layer filter` 属于 experiment 详情页一级控件。

它用于在 experiment 详情中切换当前查看的 evaluator layer：

- `Retrieval`
- `Rerank`
- `Answer`
- `Overall`

要求：

- `Data detail` 与 `Indicator statistics` 必须共享当前 layer filter 上下文
- 切换 layer 后：
  - `Data detail` 只突出展示该 layer 相关 evaluator 列
  - `Indicator statistics` 只展示该 layer 相关聚合与分布

注意：

- layer filter 是 experiment 详情页的一级视图切换，不属于 case drawer 内部控件
- layer filter 不能改变 `Experiment configuration` 的内容范围，配置页始终展示完整实验快照

## 4. Data detail

作用：

- 逐条查看 case 级结果
- 这是实验最核心的明细页

必须展示：

- `case_id`
- `input`
- `reference_output`
- `actual_output`
- `trajectory / trace` 入口
- 每个 evaluator 的 score
- status
- operation

职责边界：

- `Data detail` 负责“逐条 case 明细”
- 它不负责承载整体聚合图表
- 它可以显示 evaluator 分数，但不负责分布分析

支持操作：

- `Detail`
- `Retry`
- `Batch retry`（可先占位）

### 4.1 Detail 抽屉

点进 detail 后必须展示：

- evaluation set data
- evaluated object output
- trajectory / trace
- evaluator score table
- reasons for scoring

## 5. Indicator statistics

作用：

- 查看实验整体表现
- 查看指标分布

必须展示：

- evaluator aggregated score
- 每个指标的分布图
- latency
- token / cost（无数据可先占位）

职责边界：

- `Indicator statistics` 负责“聚合结果与指标分布”
- 它不负责展示逐条 case 原始内容
- 它可以提供跳转到对应 case cluster 或 case list 的入口，但不替代 `Data detail`

## 6. Experiment configuration

作用：

- 回答“这次实验是怎么跑出来的”
- 它是配置快照页，不是复杂调参页

必须展示：

### 6.1 Evaluation object

- target type
- target name/version
- 对于 MVP，本轮固定支持 `Prompt`
- 若后续存在 `Agent`，也沿用同一结构扩展

### 6.2 Evaluation set

- dataset name/version
- schema / column names
- field mapping

字段映射要求：

- `Prompt` 实验必须支持 prompt 变量与 dataset 字段的映射
- 例如：
  - `query -> input`
  - 其他 prompt variables -> dataset columns
- 若某变量未映射且无默认值，不允许发起实验

### 6.3 Evaluators

- evaluator 列表
- evaluator version
- 每个 evaluator 的 field mapping
- weight multiplier

说明：

- 一次实验默认绑定多个 evaluators
- 每个 evaluator 必须明确使用哪个版本
- 每个 evaluator 的输入字段映射要能追溯到 dataset 字段或 target 实际输出

### 6.4 Run config

- `sample_count`
- `timeout_ms`
- `retry_limit`
- `concurrency`
- `model`
- `temperature`
- `top_p`
- `max_tokens`
- `created_at`
- `created_by`

说明：

- `model / temperature / top_p / max_tokens` 在实验中属于运行参数注入
- 它们是实验配置的一部分，不属于 Prompt 页面中的 `common configuration`

## 7. 结果结构

实验结果至少需要支持：

- case results
- aggregated metrics
- configuration snapshot
- trace / trajectory
- root-cause summary

## 8. 与评估器的关系

一次实验使用的是 evaluator 集合，而不是单个 evaluator。

当前默认 evaluator profile 为 AI Search：

- `retrieval`
- `rerank`
- `answer`
- `overall`

但在 `Prompt-first MVP` 下，评估器使用策略需收紧为：

- 优先保证 `answer` 与 `overall` 相关评估器跑通
- `retrieval / rerank` 可继续存在于评估器体系中
- 但不应阻塞 Prompt 实验主链路

推荐 Prompt MVP 默认评估器集合：

- `answer_correctness`
- `answer_groundedness`
- `answer_conciseness`
- `proxy_satisfaction`

## 9. 与观测/trace 的关系

实验统一承载：

- 评测结果
- 观测结果
- trace 下钻
- 统计摘要
- root-cause

推荐下钻路径：

- `overall -> layer -> case -> trace`

## 10. MVP 边界

本阶段必须支持：

- 创建实验
- 选择 `Prompt` 作为 target
- 选择 dataset
- 选择多个 evaluators
- 选择评测集版本
- 选择 Prompt 版本
- 选择评估器版本
- 配置 prompt variable mappings
- 配置 evaluator field mappings
- 配置运行参数注入
- 查看 `Data detail`
- 查看 `Indicator statistics`
- 查看 `Experiment configuration`
- detail 抽屉查看 trace / reasons
- 发起多实验对比

本阶段不做：

- 复杂调参中心
- 大规模调度平台
- module-level eval
- trace 独立产品中心
- Agent 实验执行主流程
- workflow / tool agent 的实验执行
