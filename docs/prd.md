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
- 通过 trace 做调试和回放
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
- Trace
- Stats

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
2. 选择 pipeline / agent 版本
3. 选择 evaluators
4. 运行 experiment

输出包括：

- experiment summary
- case results
- metric scores
- trace links

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

## 11. Trace Module

### 10.1 Purpose

用于提供执行可观测性与问题调试能力。

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

Trace 用于帮助开发者复现 pipeline 失败过程，并判断具体问题所在。

## 12. User Flow

典型流程如下：

创建或选择 target（prompt / agent）  
↓  
创建数据集  
↓  
创建评估器  
↓  
运行实验  
↓  
查看结果  
↓  
通过 trace 调试  
↓  
做 AB 对比与归因

## 13. Page Structure

左侧导航建议为：

- Targets
  - Prompts
  - Agents

- 评测
  - 评测集
  - 评估器
  - 实验
    - 实验运行
    - AB 实验

- 观测
  - Trace
  - 统计
  - 自动化任务

说明：

- `Targets` 是轻量版本管理入口
- 不等价于 Coze 的重型 Prompt 工程模块

## 14. MVP Scope

### 14.1 Required

- target creation
- dataset creation
- evaluator creation
- experiment run
- AB comparison
- case result view
- trace viewer
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
- 可以创建三类数据集
- 可以创建模型评估器和代码评估器
- 代码评估支持精准匹配、正则匹配、模糊匹配、Python 脚本
- 可以运行单实验
- 可以查看 AB 实验结果
- 可以按 `Retrieval / Rerank / Answer / Overall` 分层查看结果
- 可以下钻到 case 和 trace
- `answer_correctness` 等 binary 指标只能接受 `0/1`

## 16. Non-goals Reminder

当前 MVP 不追求：

- 多租户平台
- 模型管理平台
- 企业协作能力
- 大规模分布式执行系统
