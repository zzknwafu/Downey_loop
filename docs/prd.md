# Downey Evals Loop — PRD

Version: v0.1  
Stage: Local MVP  
Date: 2026-03-16

## 1. Product Overview

`Downey Evals Loop` 是一款面向 `AI 搜索 Agent` 的本地优先评测与观测工具。产品核心不只是“给出一个最终分数”，而是帮助开发者从端到端实验结果逐层定位问题，并解释为什么系统变好或变差。

本产品优先服务以下业务场景：

- 外卖商品/商家搜索
- 商超商品搜索与替代推荐
- AI 导购与凑单推荐
- 会话式推荐与问答
- 基于检索、排序、回答组成的 AI 搜索链路

## 2. Product Positioning

产品定位为：

- 本地优先
- AI 搜索专项
- 评测与观测一体化
- 面向小团队的 MVP 工具

与通用 eval 平台相比，本产品强调：

- 按搜索流程拆层
- 通过实验做版本比较
- 通过实验结果中的 trace 做调试和回放
- 通过 root-cause analysis 做可解释归因

## 3. Target Users

目标用户包括：

- AI 工程师
- AI 产品经理
- Agent 开发者
- 做 AI 搜索系统的小团队

他们最常见的问题不是“答案好不好”，而是：

- 问题到底出在 retrieval 还是 rerank
- 新版本为什么 CTR/CVR 代理结果下降
- 某些 case 为什么失败
- 是否是答案质量、排序质量还是召回质量出了问题

## 4. Core Product Modules

MVP 包含以下核心模块：

- Targets
- Dataset
- Evaluator
- Experiment

其中，`Targets` 是轻量被测对象管理层，用于承载多个 `PromptVersion` 与 `AgentVersion`，而不是实现完整的 Prompt IDE。

## 5. AI Search Layered Evaluation Model

产品按 AI 搜索流程拆成四层：

1. Retrieval
2. Rerank
3. Answer
4. Overall

### 5.1 Retrieval

用于判断：

- 应召回候选是否被召回
- 用户硬约束是否在召回阶段保住
- 是否混入过多无关候选
- 是否为后续回答提供了足够证据

### 5.2 Rerank

用于判断：

- 正确候选是否进入 top-k
- 排序第一名是否合理
- rerank 后是否仍保住业务约束
- 排序是否符合用户偏好

### 5.3 Answer

用于判断：

- 回答是否正确
- 是否基于检索与排序结果
- 是否简洁
- 是否可执行
- 推荐解释是否清晰
- 信息不足时是否应主动追问

### 5.4 Overall

用于端到端代理结果评估：

- `proxy_ctr`
- `proxy_cvr`
- `proxy_dwell_time`
- `proxy_satisfaction`
- `proxy_trust`
- `latency`

## 6. Targets Module

### 6.1 Purpose

用于定义“系统正在测谁”，并提供可版本化的被测对象入口。

### 6.2 Target Types

当前阶段支持两类 targets：

#### PromptVersion

用于测单个 prompt 模板的效果。

推荐字段：

- `id`
- `name`
- `version`
- `system_prompt`
- `user_template`
- `description`

#### AgentVersion

用于测完整 AI 搜索 agent 或 search pipeline 的效果。

推荐字段：

- `id`
- `name`
- `version`
- `query_processor`
- `retriever`
- `reranker`
- `answerer`
- `description`

### 6.3 Key Features

- 创建 prompt 版本
- 创建 agent 版本
- 查看 targets 列表
- 在实验中选择某个 prompt 或 agent 作为被测对象
- 后续对不同版本做 AB 对比

### 6.4 Prompt Page

Prompt 页面在 MVP 阶段只保留两块核心能力：

- `Prompt template`
- `Preview and debug`

说明：

- Prompt 页面支持编辑 prompt template
- Prompt 页面支持单次 preview/debug 测试
- Prompt 页面不强制包含 `common configuration`
- 真正的评测、trace、统计与归因统一在 `实验` 中查看

说明：

- MVP 不做重型 Prompt 开发器
- MVP 不要求完整 playground
- 但必须支持“几个 prompt / 几个 agent”可被测、可被比较

## 7. Dataset Module

### 6.1 Purpose

用于存储实验所需的评测样本，并承载不同评测场景下的 schema。

### 6.2 Dataset Types

当前阶段，评测集分为三类。

#### 普通数据集

适合理想输出评测。

推荐字段：

- `input`
- `reference_output`
- `context`

可扩展字段：

- `query_constraints`
- `reference_items`
- `business_labels`
- `expected_top_items`

#### Workflow 数据集

适合 agent / workflow 执行结果评测。

推荐字段：

- `input`
- `workflow_output`
- `expected_steps`

可扩展字段：

- `expected_actions`
- `tool_inputs`
- `tool_outputs`
- `step_constraints`

#### Trace 监控集

适合轨迹回放、线上问题复现和 trace 监控。

推荐字段：

- `trace_id`
- `final_output`
- `trajectory`

可扩展字段：

- `step_records`
- `tool_calls`
- `latency_profile`
- `failure_reason`

### 6.3 Key Features

- 创建评测集
- 选择评测集类型
- 定义或修改 schema
- 添加 / 导入样本
- 浏览和筛选样本
- 通过智能合成定向补样

### 6.4 Dataset Page Structure

数据集页面在 MVP 阶段拆成两个一级 tab：

- `Evaluation set`
- `智能合成`

其中：

- `Evaluation set` 负责管理正式评测集、schema 和样本
- `智能合成` 负责基于种子数据或线上观测，生成有方向性的草稿样本

说明：

- 当前 MVP 主线优先交付 `Evaluation set`
- `智能合成` 作为独立侧线能力推进，不阻塞正式 Dataset 管理、Experiment 和 Prompt 主流程
- 如果智能合成未完成，主线产品仍然应可独立运行

### 6.5 智能合成

智能合成的目标不是“随机补更多数据”，而是为某个明确评测目标定向补样。

当前建议的方向包括：

- `generalize`
- `augment_failures`
- `augment_guardrails`
- `align_online_distribution`

智能合成在流程上遵循以下原则：

- 先定义合成场景、来源和用途
- 再定义要合成哪些列以及生成要求
- 结果先进入 `draft`
- 不直接写入正式 `Evaluation set`

当前阶段说明：

- 智能合成不是主线 MVP 验收项
- 主线验收以 `Evaluation set`、`Targets`、`Evaluators`、`Experiments` 为主

#### 6.5.1 Purpose

智能合成的目的不是随机扩样，而是“带目标地补样本”，用于：

- 补足低覆盖意图
- 放大失败模式
- 增强预算 / 库存 / 时效 / 政策等护栏样本
- 对齐线上 trace 或线上问题分布
- 为 AB 实验补足更有区分度的 case

#### 6.5.2 Interaction Flow

参考 Coze Loop 的交互，智能合成采用两步流程：

1. `合成场景及来源`
2. `合成样本配置`

#### 6.5.3 Step 1: 合成场景及来源

用户必须先明确：

- 合成场景
- 用途描述
- 来源
- 合成方向

来源支持：

- `基于种子数据泛化`
- `基于线上观测补样`

场景描述必须具备方向性，推荐结构：

- 行业领域
- 业务场景
- 目标问题
- 想补齐的失败模式或分布

示例：

- 外卖搜索，补“预算敏感 + 低油 + 双人晚餐”的长尾 query
- 商超搜索，补“缺货替代不合理”的失败样本
- AI 搜索导购，补“推荐解释不足导致转化下降”的样本

#### 6.5.4 Step 2: 合成样本配置

用户配置：

- 需要合成的列
- 每列描述
- 每列生成要求
- 合成样本数

“生成要求”必须体现合成方向，例如：

- 更偏预算冲突
- 更偏库存不足
- 更偏召回噪声过高
- 更偏高购买意图但答案冗长

#### 6.5.5 Direction Types

MVP 先支持以下合成方向：

- `generalize`
  - 基于已有种子数据做泛化扩充
- `augment_failures`
  - 围绕失败模式补样
- `augment_guardrails`
  - 围绕预算、库存、时效、政策等护栏补样
- `align_online_distribution`
  - 更贴近线上 trace / 线上问题分布

#### 6.5.6 Output Rules

- 合成结果先进入草稿区
- 不直接写入正式 `Evaluation set`
- 用户预览、筛选、确认后，才能并入正式数据集
- 合成样本数必须不小于 `10`

## 8. Evaluator Module

### 7.1 Purpose

用于定义系统如何对输出结果进行评分、判定和归因。

### 7.2 Evaluator Types

评估器分为两类：

#### 模型评估

使用 LLM judge 进行结构化评估。

#### 代码评估

使用程序化规则或脚本进行判定。

支持模式：

- 精准匹配
- 正则匹配
- 模糊匹配
- Python 脚本

### 7.3 Metric Types

支持如下指标类型：

- `binary`
- `continuous`
- `categorical`

其中：

- `binary` 只能返回 `0` 或 `1`
- 正确性等指标默认采用 `binary`
- 任意 `0.5` 之类中间值都视为非法
- 非法二值结果必须标记为 `invalid_judgment`

### 7.4 Layer Metrics

#### Retrieval 层指标

- `retrieval_coverage`
- `hard_constraint_recall`
- `noise_rate`
- `evidence_sufficiency`

#### Rerank 层指标

- `rerank_hit_at_k`
- `rerank_top1_quality`
- `constraint_preservation`
- `preference_alignment`

#### Answer 层指标

- `answer_correctness`
- `answer_groundedness`
- `answer_conciseness`
- `answer_actionability`
- `recommendation_explanation_quality`
- `clarification_decision`

#### Overall 层指标

- `proxy_ctr`
- `proxy_cvr`
- `proxy_dwell_time`
- `proxy_satisfaction`
- `proxy_trust`
- `latency`

### 7.5 Product Interaction

评估器页主视图必须围绕 `AI 搜索流程` 展开，而不是常驻显示“模型评估 / 代码评估”切换器。

推荐动线：

1. 先看流程：`Retrieval -> Rerank -> Answer -> Overall`
2. 点击某层，查看该层评估器
3. 点击某个评估器，查看详情并编辑
4. 点击 `新建评估器`
5. 在浮窗中先选择：
   - `LLM Evaluator`
   - `Code Evaluator`
6. 再进入对应配置表单

## 9. Experiment Module

### 8.1 Purpose

用于运行评测实验、比较版本并生成结果总结。

### 8.2 Experiment Types

实验分为两类：

- `实验运行`
- `AB 实验`

### 8.3 实验运行

用户流程：

1. 选择 dataset
2. 选择 target（prompt / agent）
3. 选择 evaluators
4. 运行 experiment

输出包括：

- experiment summary
- case results
- metric scores
- trace links
- layer insights
- root-cause summary
- 统计摘要

说明：

- 评测结果与观测结果统一在实验板块内查看
- trace、统计、归因都作为实验结果下钻能力存在
- 不再单独强调与实验割裂的“观测中心”

### 8.4 AB 实验

AB 实验用于比较 baseline 与 candidate。

核心输出包括：

- overall 指标卡片
- `CTR / CVR / satisfaction / latency` 代理结果
- layer deltas
- attribution drivers
- root-cause summary
- evidence cases

## 10. Root-Cause Analysis

系统必须能够回答“为什么变差”，而不是只给出 delta。

基础规则如下：

- 如果 `retrieval_coverage` 明显下降，优先归因为 retrieval
- 如果 retrieval 持平但 `rerank_hit_at_k` 下降，优先归因为 rerank
- 如果前两层正常但 `groundedness / conciseness / actionability` 下降，优先归因为 answer

输出结构至少包括：

- `headline`
- `driver_positive[]`
- `driver_negative[]`
- `confidence`
- `evidence_case_ids[]`

## 11. Trace In Experiment

### 10.1 Purpose

用于提供实验内的执行可观测性与问题调试能力。

### 10.2 Trace Content

Trace 应记录：

- input
- retrieval results
- rerank results
- final answer
- tool calls
- latency
- errors

### 10.3 Drill-down Path

统一下钻路径为：

`overall -> layer -> case -> trace`

Trace 用于帮助开发者在实验结果下钻时复现 pipeline 失败过程，并判断具体问题所在。

## 12. User Flow

典型流程如下：

创建或选择 target（prompt / agent）  
↓  
创建数据集  
↓  
必要时通过智能合成补样  
↓  
创建评估器  
↓  
运行实验  
↓  
查看结果  
↓  
通过实验内 trace / 统计 / root-cause 调试  
↓  
做 AB 对比与归因

## 13. Page Structure

左侧导航建议为：

- Targets
  - Prompts
  - Agents

- 数据集
- 评估器
- 实验
  - 实验运行
  - AB 实验
  - Trace 下钻
  - 统计视图

说明：

- `Targets` 是轻量版本管理入口
- 不等价于 Coze 的重型 Prompt 工程模块
- `评测集` 内部包含 `Evaluation set / 智能合成` 两个 tab
- Prompt 页面保留 `Prompt template + Preview and debug`
- 评测、观测、trace、统计统一归在实验结果里查看

## 14. MVP Scope

### 14.1 Required

- target creation
- prompt template editing
- prompt preview/debug
- dataset creation
- directional dataset synthesis
- evaluator creation
- experiment run
- AB comparison
- case result view
- trace viewer in experiment
- layered evaluation
- root-cause summary

### 14.2 Not Included

- heavy prompt IDE
- advanced analytics
- enterprise collaboration
- model marketplace
- multi-tenant SaaS
- large-scale distributed compute

## 15. Acceptance Criteria

- 可以创建 PromptVersion
- 可以创建 AgentVersion
- 实验可以绑定某个 prompt 或 agent 作为被测对象
- Prompt 页面支持 `Prompt template + Preview and debug`
- Prompt 页面不强制实现 `common configuration`
- 可以创建三类数据集
- 数据集页包含 `Evaluation set / 智能合成` 两个 tab
- 智能合成采用“场景及来源 -> 样本配置”两步流程
- 智能合成结果先进入草稿区，不直接入正式数据集
- 可以创建模型评估器和代码评估器
- 代码评估支持精准匹配、正则匹配、模糊匹配、Python 脚本
- 可以运行单实验
- 可以查看 AB 实验结果
- 可以按 `Retrieval / Rerank / Answer / Overall` 分层查看结果
- 可以在实验内下钻到 case、trace、统计与 root-cause
- `answer_correctness` 等 binary 指标只能接受 `0/1`

## 16. Non-goals Reminder

当前 MVP 不追求：

- 多租户平台
- 模型管理平台
- 企业协作能力
- 大规模分布式执行系统
