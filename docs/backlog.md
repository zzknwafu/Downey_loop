# Downey Evals Loop — Development Backlog

Version: v0.1  
Date: 2026-03-16

## 1. What is Backlog

`Backlog` 指的是“待做事项总表”。

它不是单个任务，而是一组按优先级排列的开发事项集合，通常包括：

- 要做什么
- 为什么做
- 先做还是后做
- 可以拆成哪些 issue

在这个项目里，`docs/backlog.md` 的作用是把 BRD、PRD 和架构文档落成可执行开发清单。

## 2. What is Issue

`Issue` 指的是一个可以被跟踪、分配、讨论和关闭的具体工作项。

你可以把它理解成 GitHub 上的一张任务卡。

一个 issue 通常应该满足：

- 目标明确
- 范围清楚
- 有验收标准
- 能被一个开发线程单独推进

关系上可以这样理解：

- `Backlog` 是任务池
- `Issue` 是任务池里的一张具体卡片

## 3. Suggested Workflow

推荐工作方式如下：

1. 先维护 `BRD / PRD / Architecture`
2. 再把需求拆进 `Backlog`
3. 从 Backlog 中挑选高优先级项创建 GitHub issues
4. 按 issue 分配给不同线程或 agent
5. 每个 issue 完成后关闭

## 4. Milestones

建议当前项目按 3 个里程碑推进。

### M1. 文档与骨架完成

目标：

- 文档体系稳定
- 前后端与领域模型骨架可持续扩展

### M2. MVP 可运行

目标：

- 数据集、评估器、实验、trace 四大模块打通
- 支持最小可用评测闭环

### M3. 分层实验闭环

目标：

- 支持 AB 实验
- 支持 root-cause analysis
- 支持端到端到 trace 的问题定位

## 5. Epics

当前 backlog 建议按 8 个 epic 管理。

### Epic A. 文档与信息架构

目标：

- 固化产品文档
- 统一信息架构
- 为并行开发提供单一事实来源

Issue 候选：

#### A1. 建立正式文档体系

- 类型：documentation
- 优先级：P0
- 验收标准：
  - `docs/brd.md`、`docs/prd.md`、`docs/architecture.md`、`docs/prompts.md` 存在
  - 根目录 `PRD.md` 只作为文档入口

#### A2. 建立开发 backlog 文档

- 类型：documentation
- 优先级：P0
- 验收标准：
  - 存在 `docs/backlog.md`
  - 能从文档中直接提取 issue

#### A3. 统一产品模块命名

- 类型：documentation
- 优先级：P1
- 验收标准：
  - `Dataset / Evaluator / Experiment / Trace / Stats` 在文档和 UI 中命名一致
  - `Retrieval / Rerank / Answer / Overall` 命名一致

### Epic B. Targets 模块

目标：

- 提供轻量 PromptVersion / AgentVersion 管理
- 为实验提供可选择的被测对象

Issue 候选：

#### B1. 实现 PromptVersion / AgentVersion 领域模型

- 类型：backend
- 优先级：P0
- 验收标准：
  - 支持 PromptVersion
  - 支持 AgentVersion
  - 支持实验通过 target 引用被测对象

#### B2. 实现 Targets 列表页

- 类型：frontend
- 优先级：P1
- 验收标准：
  - 可查看 prompts 与 agents
  - 可显示名称、版本、说明

#### B3. 实现轻量“新建 Prompt / 新建 Agent”流程

- 类型：frontend
- 优先级：P1
- 验收标准：
  - 不做重型 IDE
  - 可录入最小字段并保存

#### B4. 实现 Prompt template 与 Preview/debug

- 类型：frontend
- 优先级：P0
- 验收标准：
  - Prompt 页面支持编辑 prompt template
  - Prompt 页面支持单次 preview/debug 测试
  - 不强制实现 `common configuration`
  - preview/debug 只服务单次调试，不替代实验

### Epic C. Dataset 模块

目标：

- 支持三类评测集
- 支持 schema 配置和样本承载
- 先完成 `Evaluation set` 主线

Issue 候选：

#### B1. 实现数据集领域模型

- 类型：backend
- 优先级：P0
- 验收标准：
  - 支持 `普通数据集 / Workflow 数据集 / Trace 监控集`
  - 支持 schema 与 cases

#### B2. 实现数据集列表页

- 类型：frontend
- 优先级：P0
- 验收标准：
  - 可查看数据集实体列表
  - 可显示类型、描述、样本数

#### B3. 实现“新建评测集”流程

- 类型：frontend
- 优先级：P0
- 验收标准：
  - 点击新建后可选择 3 类数据集
  - 可编辑基础信息与 schema

#### B4. 实现样本导入能力

- 类型：backend
- 优先级：P1
- 验收标准：
  - 支持本地导入样本
  - 导入数据能映射到 schema

#### B5. 实现 Dataset 页双 tab 结构

- 类型：frontend
- 优先级：P2
- 验收标准：
  - Dataset 页包含 `Evaluation set / 智能合成` 两个 tab
  - `Evaluation set` 与 `智能合成` 不混排

#### B6. 实现智能合成两步向导

- 类型：frontend
- 优先级：P3
- 验收标准：
  - 第一步：`合成场景及来源`
  - 第二步：`合成样本配置`
  - 页面结构贴近 Coze Loop 的两步流程

#### B7. 定义智能合成方向模型

- 类型：backend
- 优先级：P3
- 验收标准：
  - 支持 `generalize`
  - 支持 `augment_failures`
  - 支持 `augment_guardrails`
  - 支持 `align_online_distribution`
  - 合成输入必须包含场景描述、来源、方向、样本数

#### B8. 实现智能合成草稿结果结构

- 类型：backend
- 优先级：P3
- 验收标准：
  - 合成结果先进入草稿区
  - 不直接写入正式 dataset
  - 支持人工确认后并入 `Evaluation set`

#### B9. 实现智能合成双来源接口

- 类型：integration
- 优先级：P3
- 验收标准：
  - 支持 `dataset` 来源
  - 支持 `online` 来源
  - 返回结构能被向导页面直接消费

### Epic H. 智能合成侧线

目标：

- 将 `智能合成` 从主线 MVP 中剥离
- 作为独立 agent/独立验收流推进
- 保持与正式 Dataset 解耦

Issue 候选：

#### H1. 建立智能合成独立需求与接口清单

- 类型：documentation
- 优先级：P2
- 验收标准：
  - 明确 synthesis 输入结构
  - 明确 draft 输出结构
  - 明确并入 Evaluation set 的后续流程

#### H2. 实现 synthesis draft 流转

- 类型：integration
- 优先级：P3
- 验收标准：
  - synthesis 结果不直接进入正式 dataset
  - 可单独预览、确认、放弃

### Epic D. Evaluator 模块

目标：

- 支持模型评估与代码评估
- 按 AI 搜索流程分层管理

Issue 候选：

#### C1. 实现评估器领域模型

- 类型：backend
- 优先级：P0
- 验收标准：
  - 支持 `family`、`layer`、`metric_type`
  - 支持 model/code 两类 evaluator

#### C2. 实现评估器主页面流程视图

- 类型：frontend
- 优先级：P0
- 验收标准：
  - 页面主视图展示 `Retrieval -> Rerank -> Answer -> Overall`
  - 选择层级后可查看该层评估器

#### C3. 实现“新建评估器”分步弹窗

- 类型：frontend
- 优先级：P0
- 验收标准：
  - 第一步先选 `LLM Evaluator` 或 `Code Evaluator`
  - 第二步进入对应配置表单

#### C4. 实现代码评估执行器

- 类型：backend
- 优先级：P0
- 验收标准：
  - 支持精准匹配、正则匹配、模糊匹配、Python 脚本

#### C5. 实现二值指标合法性校验

- 类型：backend
- 优先级：P0
- 验收标准：
  - binary 指标只接受 `0/1`
  - 非法值标记为 `invalid_judgment`

### Epic E. Experiment 模块

目标：

- 支持实验运行与 AB 实验
- 支持端到端与分层结果展示
- 统一承载评测、观测、trace 与统计结果

Issue 候选：

#### D1. 实现 ExperimentRun 对象与状态机

- 类型：backend
- 优先级：P0
- 验收标准：
  - 状态包含 `CREATED / RUNNING / FINISHED / FAILED`
  - 支持关联 dataset、pipeline、evaluators

#### D2. 实现实验运行页面

- 类型：frontend
- 优先级：P0
- 验收标准：
  - 可查看 case 列表
  - 可查看 case 输出与指标结果
  - 可在实验内查看 trace 下钻与统计摘要

#### D3. 实现 AB 实验页面

- 类型：frontend
- 优先级：P0
- 验收标准：
  - 可查看 overall 指标、layer deltas、evidence cases

#### D4. 实现 root-cause analysis 规则引擎

- 类型：backend
- 优先级：P1
- 验收标准：
  - 能根据分层 delta 生成结构化归因摘要

### Epic F. Trace 与统计模块

目标：

- 支持调试、回放和观测下钻

Issue 候选：

#### E1. 实现 TraceRun 结构

- 类型：backend
- 优先级：P0
- 验收标准：
  - 记录 retrieval、rerank、answer、latency、tool_calls

#### E2. 实现 trace 查看页

- 类型：frontend
- 优先级：P0
- 验收标准：
  - 支持从 case 下钻到 trace
  - 能展示链路中间结果

#### E3. 实现统计页

- 类型：frontend
- 优先级：P1
- 验收标准：
  - 可查看 pass rate、average score、latency 指标

### Epic G. Runner 与基础设施

目标：

- 打通最小可运行执行闭环
- 为后续 GPT 和持久化接入做好基础

Issue 候选：

#### F1. 实现 ExperimentRunJob / CaseRunJob

- 类型：backend
- 优先级：P0
- 验收标准：
  - `CaseRun` 是最小执行单元
  - 支持按 case 并发执行

#### F2. 实现最小 Runner

- 类型：backend
- 优先级：P0
- 验收标准：
  - 能遍历 dataset cases
  - 能调用 pipeline
  - 能写入 CaseResult 和 TraceRun

#### F3. 接入本地持久化

- 类型：backend
- 优先级：P1
- 验收标准：
  - 支持 SQLite 或等价本地存储

#### F4. 接入 GPT 调用配置

- 类型：backend
- 优先级：P1
- 验收标准：
  - 支持 `.env` 配置
  - 支持 LLM evaluator 调用

## 6. Suggested First Sprint

如果现在开始并行开发，第一批建议先做这些 issue：

- A3. 统一产品模块命名
- B1. 实现数据集领域模型
- B3. 实现“新建评测集”流程
- C1. 实现评估器领域模型
- C3. 实现“新建评估器”分步弹窗
- D1. 实现 ExperimentRun 对象与状态机
- F1. 实现 ExperimentRunJob / CaseRunJob

这一批的目标不是“全部做完”，而是先把 `数据结构 + 主流程 + 页面入口` 固定下来。

## 7. Suggested Labels

如果你准备放到 GitHub，可以先用这些 labels：

- `type:frontend`
- `type:backend`
- `type:documentation`
- `type:architecture`
- `priority:P0`
- `priority:P1`
- `area:dataset`
- `area:evaluator`
- `area:experiment`
- `area:trace`
- `area:runner`

## 8. Definition of Done

一个 issue 在关闭前，建议至少满足：

- 功能范围完成
- 与文档定义一致
- 有基本验证结果
- 不破坏现有主流程
- 有必要的说明或注释
