# 主 Agent 领域模型改造清单

Date: 2026-03-21

## 1. Purpose

本清单只服务主 agent，目标是把领域模型收口成稳定基座，让 Agent 2 / Agent 3 有明确依赖。

## 2. Dataset Versioning

### 必做

- 为 Dataset 引入稳定 `dataset_key`
- 为 Dataset 版本引入不可变快照对象
- 明确 `latest_version`
- 明确 `previous_version_id`
- 明确 `change_summary`
- 明确“保存为新版本”和“另存为新对象”的领域差异

### 需要校验

- 历史版本不可覆盖
- 回退操作会生成新版本
- 实验只能绑定具体 dataset version

## 3. Evaluator Versioning

### 必做

- 继续收口 `evaluator_key`
- 明确 `EvaluatorVersion` 语义
- 明确 `latest_version`
- 明确 `previous_version_id`
- 明确 `change_summary`
- 明确“保存为新版本”和“另存为新评估器”的领域差异

### 需要校验

- 实验绑定 evaluator 时必须带版本
- 评估器 lineage 可查询
- 历史版本不可覆盖

## 4. Prompt-first Experiment

### 必做

- 保持 `Experiment = Target + DatasetVersion + EvaluatorSet + RunConfig + ExperimentRun`
- 明确 Prompt experiment 的领域输入：
  - prompt version binding
  - prompt variable mappings
  - evaluator version bindings
  - run config
  - model config
- 保持 Agent 作为产品 target，但不阻塞 MVP 执行主线

### 需要校验

- experiment configuration snapshot 可复现
- caseRuns 支持多个 evaluator 结果
- summary 与 statistics 边界清晰
- 实验失败不能伪造成功结果

## 5. Prompt Versioning

### 必做

- 明确 Prompt 的版本链语义
- 支持：
  - 另存模板
  - 版本记录
  - 回退生成新版本

### 需要校验

- Prompt 详情页绑定的是具体版本
- 实验绑定的是具体 PromptVersion

## 6. AI Search Evaluator Profile

### 必做

- 保持 evaluator profile 当前仍是：
  - `retrieval`
  - `rerank`
  - `answer`
  - `overall`
- 明确这只是 evaluator taxonomy，不是 Agent 结构

### 需要校验

- experiment 结果按实际选择的 evaluator 集合返回
- 不再默认铺满所有指标

## 7. Main Technical Debts

主 agent 后续还要收掉：

- 代码里旧 `AgentVersion` 固定 AI Search pipeline 结构残留
- experiment 里残留的单 evaluator 假设
- Dataset / Evaluator / Prompt 三类对象的版本语义不一致问题

## 8. Done Definition

主 agent 视角下，版本管理领域改造完成的标志是：

- Dataset / Evaluator / Prompt 都有稳定的对象键和版本键
- 保存与另存的语义稳定
- 回退语义稳定
- Experiment 绑定具体版本
- configuration snapshot 可复现
- Agent 2 / Agent 3 不再需要猜字段和版本规则
