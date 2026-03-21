# Downey Evals Loop — 版本管理补充 PRD

Version: v0.1  
Stage: Local MVP  
Date: 2026-03-21

## 1. Purpose

本补充 PRD 只定义两类对象的版本管理：

- `Dataset`
- `Evaluator`

目标不是做复杂的 Git-like 分支系统，而是保证：

- 历史版本可追溯
- 实验可复现
- 支持继续演进
- 支持另存为新对象

## 2. Core Principle

所有需要进入实验绑定的对象，都采用：

- `对象本体`
- `不可变版本快照`

实验绑定的必须是“具体版本”，不是逻辑名。

也就是说：

- 实验不绑定“外卖 AI 搜理想输出集”
- 实验绑定“外卖 AI 搜理想输出集 v0.3.0”

同理：

- 实验不绑定“answer_correctness”
- 实验绑定“answer_correctness v0.1.2”

## 3. Dataset Versioning

### 3.1 Object Model

#### Dataset

表示一个长期存在的数据集对象。

建议字段：

- `dataset_key`
- `name`
- `description`
- `dataset_type`
- `latest_version`
- `created_at`
- `created_by`

#### DatasetVersion

表示某次保存后的不可变快照。

建议字段：

- `id`
- `dataset_key`
- `version`
- `change_summary`
- `schema`
- `cases`
- `sample_count`
- `created_at`
- `created_by`
- `previous_version_id`

### 3.2 Supported Operations

#### 保存为新版本

适用场景：

- 修正样本
- 增加样本
- 调整 schema
- 修改 reference output
- 调整 context 自动组装规则

行为：

- 原对象不变
- 生成新的 `DatasetVersion`
- 版本链继续向前

#### 另存为新数据集

适用场景：

- 从现有数据集派生一个新专题集
- 从通用集拆出业务专项集
- 不希望继续沿用原数据集 lineage

行为：

- 新建一个新的 `dataset_key`
- 初始版本从 `0.1.0` 开始

#### 回退版本

回退不是“直接把当前版本改回旧版本”，而是：

- 选择一个历史版本
- 基于该版本恢复为一个新版本

例如：

- 当前 `v0.4.0`
- 回退到 `v0.2.0`
- 系统生成新的 `v0.5.0`
- 内容等同 `v0.2.0`

这样版本链可审计。

## 4. Evaluator Versioning

### 4.1 Object Model

#### Evaluator

表示一个长期存在的评估器对象。

建议字段：

- `evaluator_key`
- `name`
- `family`
- `layer`
- `description`
- `latest_version`
- `created_at`
- `created_by`

#### EvaluatorVersion

表示一次规则保存后的不可变快照。

建议字段：

- `id`
- `evaluator_key`
- `version`
- `change_summary`
- `metric_type`
- `config`
- `prompt_template` 或 `code_config`
- `created_at`
- `created_by`
- `previous_version_id`

### 4.2 Supported Operations

#### 保存为新版本

适用场景：

- 修改 rubric
- 修改 prompt evaluator 模板
- 修改 code evaluator 规则
- 修改 binary / continuous 策略
- 调整字段映射模板

#### 另存为新评估器

适用场景：

- 从通用正确性评估器派生出业务正确性评估器
- 从外卖评估器复制出商超评估器
- 从一个规则模板衍生出新评估器

#### 回退版本

与数据集一致：

- 回退操作产生新的当前版本
- 不直接修改历史版本

## 5. Experiment Binding Rules

### 5.1 Dataset

创建实验时，必须显式绑定：

- `dataset_key`
- `dataset_version`

### 5.2 Evaluator

创建实验时，必须显式绑定：

- `evaluator_key`
- `evaluator_version`

一次实验通常会绑定多个 evaluator 版本。

### 5.3 Snapshot

Experiment configuration snapshot 里必须持久化保存：

- dataset version
- evaluator versions
- field mappings
- run config

否则旧实验不可复现。

## 6. UI Requirements

### 6.1 Dataset Detail

数据集详情页应支持：

- `保存为新版本`
- `另存为新数据集`
- `版本记录`
- `查看历史版本`
- `回退到某版本`

### 6.2 Evaluator Detail

评估器详情页应支持：

- `保存为新版本`
- `另存为新评估器`
- `版本记录`
- `查看历史版本`
- `回退到某版本`

## 7. MVP Scope

本轮必须完成：

- Dataset 版本列表
- Dataset 保存为新版本
- Dataset 另存为新数据集
- Evaluator 版本列表
- Evaluator 保存为新版本
- Evaluator 另存为新评估器
- Experiment 绑定具体 dataset/evaluator 版本

本轮不做：

- 版本 diff 可视化
- 分支管理
- 版本合并
- 审批流

## 8. Product Rules

一句话规则：

> 数据集和评估器都采用“对象本体 + 不可变版本快照”的版本管理方式；编辑产生新版本，另存产生新对象，实验必须绑定具体版本。
