# Downey Evals Loop — Evaluators 子 PRD

Version: v0.1  
Stage: Local MVP  
Date: 2026-03-18

## 1. 模块目标

`Evaluators` 用于定义实验如何打分。

一次实验默认绑定多个 evaluators，而不是单个 evaluator。

## 2. Evaluator 分类

当前支持两类：

- `模型评估`
- `代码评估`

### 2.1 模型评估

由 LLM 或模型 judge 输出结构化结果。

### 2.2 代码评估

由程序化规则输出结构化结果。

支持：

- `exact_match`
- `regex_match`
- `fuzzy_match`
- `python_script`

## 3. 当前默认评估视图

虽然 Agent 已经通用化，但当前 evaluator 主视图仍按 AI Search profile 组织：

- `retrieval`
- `rerank`
- `answer`
- `overall`

这是一种 evaluator profile，不是 Agent 的定义本身。

## 4. 指标类型

支持：

- `binary`
- `continuous`
- `categorical`

规则：

- `binary` 只能输出 `0` 或 `1`
- 非法值记为 `invalid_judgment`

## 5. AI Search 默认指标包

### Retrieval

- `retrieval_coverage`
- `hard_constraint_recall`
- `noise_rate`
- `evidence_sufficiency`

### Rerank

- `rerank_hit_at_k`
- `rerank_top1_quality`
- `constraint_preservation`
- `preference_alignment`

### Answer

- `answer_correctness`
- `answer_groundedness`
- `answer_conciseness`
- `answer_actionability`

### Overall

- `proxy_ctr`
- `proxy_cvr`
- `proxy_satisfaction`
- `proxy_trust`
- `latency`

## 6. 与实验的关系

一次实验应绑定一个 evaluator 集合：

- `Experiment = Target + Dataset + EvaluatorSet`

v1 先支持：

- 用户手动选择多个 evaluator

后续可扩展：

- 默认 evaluator pack
- retrieval focus pack
- business proxy pack

## 7. MVP 边界

本阶段必须支持：

- evaluator 列表
- 新建模型评估器
- 新建代码评估器
- 实验中多选 evaluators
- result 中展示多个 evaluator 分数与 reason

本阶段不做：

- module-level eval
- 复杂 evaluator 模板市场
- 大规模 evaluator 预设库
