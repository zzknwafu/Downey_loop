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
- Trace 下钻
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

## 5. Frontend Agent

### Goal

实现基础前端 UI。

### When to use

在需要实现 Dataset、Evaluator、Experiment、Trace 相关页面时使用。

### Context

产品要求前端支持：

- 评测集页面
- 评估器页面
- 实验运行页面
- AB 实验页面
- Trace 查看页面

页面组织应符合 AI 搜索流程逻辑。

### Requirements

- 使用 React + TypeScript
- 左侧导航清晰
- 实验分为“实验运行”和“AB 实验”二级菜单
- 评估器页以 AI 搜索流程为主视图
- 新建评估器通过弹窗先选择 LLM 或 Code
- 数据集页支持三类评测集

### Deliverables

- 主要页面骨架
- 列表与详情视图
- 创建评测集 / 评估器弹窗
- 实验对比与 trace 下钻页面

### Constraints

- 布局保持稳定，避免 hover 导致抖动
- 不做与产品主线无关的复杂 UI
- 优先保证信息架构清晰
