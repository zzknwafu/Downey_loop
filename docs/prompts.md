# Downey Evals Loop — Agent Prompts

Version: v0.1  
Stage: Parallel Development Prompts  
Date: 2026-03-16

## 1. Architecture Agent

### Goal

设计本地优先 AI 搜索评测系统的系统架构。

### When to use

在需要定义模块边界、对象模型、执行流、异步作业模型时使用。

### Context

当前产品是 `Downey Evals Loop`，核心能力包括：

- AI 搜索分层评测：Retrieval / Rerank / Answer / Overall
- 三类数据集：普通 / Workflow / Trace 监控
- 两类评估器：模型评估 / 代码评估
- 单实验与 AB 实验
- 实验内 Trace 下钻
- 本地优先 + TypeScript 技术栈

### Requirements

- 明确系统模块
- 明确核心领域对象
- 明确执行流与状态机
- 明确 ExperimentRunJob 与 CaseRunJob
- 明确 trace 与结果关系

### Deliverables

- 模块图
- 对象关系
- 执行流
- 异步模型说明
- 技术栈建议

### Constraints

- 不设计多租户 SaaS
- 不设计平台内部多 agent 协同底座
- 不设计模型管理平台
- 不绕过 [sync-rules.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/sync-rules.md) 修改不属于自己的 owner 文件

## 2. Backend Agent

### Goal

实现评测系统的后端骨架。

### When to use

在需要搭建 domain、services、runner、storage、API 基础结构时使用。

### Context

系统需要支持：

- Dataset
- Evaluator
- Experiment
- Runner
- Trace

并服务 AI 搜索 pipeline 的分层评测。

### Requirements

- 使用 TypeScript
- 保持模块化单体
- 保持清晰 domain layer
- 支持 ExperimentRun 与 CaseResult
- 支持 TraceRun 存储

### Deliverables

- 后端目录骨架
- 核心类型定义
- 服务层接口
- 最小执行入口

### Constraints

- 不引入过重基础设施
- 默认本地优先
- 存储默认采用 SQLite 或等价本地方案
- 共享核心文件 `src/domain/types.ts`、`src/domain/evaluators.ts`、`src/domain/comparison.ts` 只能由 Agent 1 修改

## 3. Runner Agent

### Goal

实现实验执行引擎。

### When to use

在需要实现 experiment 异步运行、case 拆分、pipeline 执行和结果落库时使用。

### Context

Runner 需要承接以下流程：

- 迭代 dataset cases
- 调用 AI 搜索 pipeline
- 收集 trace
- 运行 evaluators
- 生成 case results

### Requirements

- 实现 `ExperimentRunJob`
- 实现 `CaseRunJob`
- `CaseRun` 作为最小执行单位
- 支持按 case 并发
- 写入 trace 与评测结果

### Deliverables

- ExperimentRunner
- CaseRunner
- 任务状态流转
- 结果汇总逻辑

### Constraints

- 不将平台设计成多 agent 编排系统
- 不引入分布式复杂调度
- 保持错误可追踪
- 若需要修改共享核心文件，必须回到 Agent 1 收口

## 4. Evaluator Agent

### Goal

实现评估引擎。

### When to use

在需要实现模型评估器、代码评估器、指标约束和结果结构化输出时使用。

### Context

评估器需要支持：

- LLM evaluator
- Code evaluator

代码评估支持：

- exact match
- regex match
- fuzzy match
- Python script

AI 搜索层级包括：

- Retrieval
- Rerank
- Answer
- Overall

### Requirements

- 支持 `binary / continuous / categorical`
- binary 指标严格只允许 `0/1`
- 非法 binary 结果记为 `invalid_judgment`
- 能对分层结果打分
- 能输出结构化结果

### Deliverables

- evaluator 接口
- model evaluator 执行逻辑
- code evaluator 执行逻辑
- 结果结构定义

### Constraints

- 不允许把 binary 模糊成连续值
- 不把 evaluator 实现成只返回自然语言说明
- `src/domain/evaluators.ts` 与 `src/domain/comparison.ts` 只能由 Agent 1 修改

## 5. Frontend Agent

### Goal

实现基础前端 UI。

### When to use

在需要实现 Dataset、Evaluator、Experiment、Trace 相关页面时使用。

### Context

产品要求前端支持：

- Prompt 页面
- 数据集页面
- 评估器页面
- 实验运行页面
- AB 实验页面

页面组织应符合 AI 搜索流程逻辑。

### Requirements

- 使用 React + TypeScript
- 左侧导航清晰
- Prompt 页面保留 `Prompt template + Preview and debug`
- Prompt 页面不强制实现 `common configuration`
- 评估器页以 AI 搜索流程为主视图
- 新建评估器通过弹窗先选择 LLM 或 Code
- 数据集页支持三类评测集
- 实验板块统一承载评测、观测、trace 与统计

### Deliverables

- 主要页面骨架
- 列表与详情视图
- Prompt template / preview-debug 页面
- 创建评测集 / 评估器弹窗
- 实验对比与 trace 下钻页面

### Constraints

- 布局保持稳定，避免 hover 导致抖动
- 不做与产品主线无关的复杂 UI
- 优先保证信息架构清晰
- 只消费共享 contract，不修改 `src/domain/types.ts`、`src/domain/evaluators.ts`、`src/domain/comparison.ts`

## 6. Synthesis Agent

### Goal

将 `智能合成` 作为独立侧线能力推进，不阻塞主线 Dataset / Experiment / Prompt 开发。

### When to use

在需要实现 `智能合成` 的向导、draft 流程、方向性字段、草稿预览和后续并入方案时使用。

### Context

智能合成当前不是主线功能，但保留为后续增强方向。它应遵循：

- 两步向导：
  - `合成场景及来源`
  - `合成样本配置`
- 合成具有明确方向性：
  - `generalize`
  - `augment_failures`
  - `augment_guardrails`
  - `align_online_distribution`
- 合成结果先进入 `draft`
- 不直接写入正式 `Evaluation set`

### Requirements

- 独立实现智能合成流程
- 不阻塞正式 Dataset 管理
- 能输出 draft 结构
- 能描述后续“确认并入 Evaluation set”的流程

### Deliverables

- 智能合成向导
- synthesis draft 结果结构
- 草稿预览页
- 并入正式 dataset 的方案说明

### Constraints

- 不修改 `src/domain/types.ts`
- 不修改 `src/domain/datasets.ts`
- 不修改 `src/domain/comparison.ts`
- 不改变主线 Dataset / Experiment 的验收范围
