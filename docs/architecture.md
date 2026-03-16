# Downey Evals Loop — System Architecture

Version: v0.1  
Stage: Local MVP  
Date: 2026-03-16

## 1. System Overview

系统实现的是一套面向 `AI 搜索链路` 的评测闭环。

核心执行流为：

`Dataset -> Experiment -> Runner -> Evaluator -> Trace / Result`

与通用问答评测不同，本系统将 AI 搜索 pipeline 拆分为分层可观测结构，而不是只存最终输出。

## 2. Core Architectural Principles

- 模块化单体
- 本地优先
- TypeScript 全栈
- 以 case 为最小执行单位
- 以 trace 作为调试与回放基础
- 不在平台内部设计多 agent 协同底座

## 3. Core Entities

### 3.1 Dataset

代表实验输入数据。

最小字段集：

- `id`
- `name`
- `dataset_type`
- `schema`
- `cases`

### 3.2 Evaluator

代表评估逻辑定义。

最小字段集：

- `id`
- `name`
- `family`
- `layer`
- `metric_type`
- `config`

说明：

- `family` 包含 `model` 与 `code`
- `metric_type` 包含 `binary`、`continuous`、`categorical`

### 3.3 SearchPipelineVersion

代表被测 AI 搜索版本。

最小字段集：

- `id`
- `name`
- `version`
- `query_processor`
- `retriever`
- `reranker`
- `answerer`

### 3.4 ExperimentRun

代表一次实验执行。

最小字段集：

- `id`
- `dataset_id`
- `pipeline_version`
- `status`
- `summary`

状态机：

- `CREATED`
- `RUNNING`
- `FINISHED`
- `FAILED`

### 3.5 CaseResult

代表单个 case 的实验结果。

最小字段集：

- `case_id`
- `output`
- `scores`
- `trace_id`

### 3.6 TraceRun

代表一次执行轨迹。

最小字段集：

- `retrieval_results`
- `rerank_results`
- `final_output`
- `latency`
- `tool_calls`

### 3.7 ABExperiment

代表两个实验结果之间的对比对象。

最小字段集：

- `baseline_run_id`
- `candidate_run_id`
- `overall_metrics`
- `layer_deltas`
- `root_cause_summary`
- `evidence_case_ids`

## 4. Entity Relationship

实体关系如下：

`Dataset -> ExperimentRun -> CaseResult -> TraceRun`

补充关系：

- `ExperimentRun` 关联 `SearchPipelineVersion`
- `ExperimentRun` 关联多个 `Evaluator`
- `ABExperiment` 对比两个 `ExperimentRun`

## 5. Layered Pipeline Model

本系统的搜索链路分为四层：

1. `Retrieval`
2. `Rerank`
3. `Answer`
4. `Overall`

各层都应可单独评分、单独查看输出、单独下钻问题。

## 6. Execution Flow

执行流程如下：

1. 用户发起实验
2. 系统创建 `ExperimentRun`
3. Runner 将 dataset 拆成多个 case
4. 每个 case 执行 pipeline
5. Evaluators 对输出进行打分或判定
6. 记录 `CaseResult`
7. 写入 `TraceRun`
8. 汇总生成 experiment summary

## 7. Async Job Model

实验必须异步执行。

作业模型如下：

`ExperimentRunJob -> CaseRunJob`

说明：

- `ExperimentRunJob` 负责初始化一次实验
- `CaseRunJob` 负责执行单个 case
- `CaseRun` 是最小执行单元
- 系统按 case 并发，而不是按平台 agent 并发

## 8. Evaluator Execution Model

评估器执行模型分为两类：

### 8.1 Model Evaluator

由 LLM judge 输出结构化结果。

要求：

- binary 指标严格只允许 `0/1`
- 非法二值结果标记为 `invalid_judgment`

### 8.2 Code Evaluator

由程序规则或脚本执行。

支持：

- exact match
- regex match
- fuzzy match
- Python script

## 9. Trace Model

Trace 用于承载 AI 搜索链路的执行证据。

必须覆盖：

- 输入 query
- retrieval 候选
- rerank 结果
- 最终回答
- 工具调用
- latency
- error 信息

下钻路径定义为：

`overall -> layer -> case -> trace`

## 10. Recommended Repository Structure

建议仓库结构如下：

```text
downey_loop/
├─ backend/
│  ├─ domain/
│  ├─ services/
│  ├─ runner/
│  ├─ infra/
│  └─ api/
├─ frontend/
│  ├─ pages/
│  └─ components/
└─ docs/
```

当前实现仍可先维持在单仓库单体结构中，以上结构作为后续演进方向。

## 11. Technology Stack

Frontend:

- React
- TypeScript

Backend:

- Node.js
- TypeScript

Storage:

- SQLite

Deployment:

- 本地优先
- 后续可采用 PM2

## 12. Architecture Boundaries

本阶段明确不建设：

- 多租户 SaaS
- 模型管理平台
- 分布式大规模算力系统
- 通用 AI 平台层

## 13. Implementation Notes

实现上应优先保证以下一致性：

- 模块命名统一为 `Dataset / Evaluator / Experiment / Trace`
- 分层命名统一为 `Retrieval / Rerank / Answer / Overall`
- 二值评估约束在评估器层和实验汇总层一致执行
- Trace 与 CaseResult 可回链
