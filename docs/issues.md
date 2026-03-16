# Downey Evals Loop — GitHub Issue Drafts

Version: v0.1  
Date: 2026-03-17

本文件用于提供第一批可直接复制到 GitHub 的 issue 草稿。

建议默认 labels：

- `priority:P0`
- `type:frontend`
- `type:backend`
- `type:documentation`
- `area:dataset`
- `area:evaluator`
- `area:experiment`
- `area:trace`
- `area:runner`

## Issue 1

### Title

`[P0][backend][dataset] 实现数据集领域模型`

### Body

#### 背景

当前产品已经明确支持三类评测集：

- 普通数据集
- Workflow 数据集
- Trace 监控集

需要先在领域层固定数据集结构，作为后续前端、联调和实验执行的基础。

#### 目标

实现 Dataset 领域模型与最小字段集，支持 schema 与 cases 表达。

#### 范围

- 定义 Dataset 最小类型
- 支持 `dataset_type`
- 支持 `schema`
- 支持 `cases`

#### 不包括

- 页面展示
- 文件导入 UI
- 复杂权限和版本管理

#### 验收标准

- 支持三类数据集
- 支持最小字段：`id / name / dataset_type / schema / cases`
- 类型定义可被实验模块直接消费

## Issue 2

### Title

`[P0][frontend][dataset] 实现“新建评测集”流程`

### Body

#### 背景

PRD 已确认评测集分为三类，且数据集页应以“数据集实体列表 + 新建流程”为主。

#### 目标

实现“新建评测集”主流程，支持先选择数据集类型，再进入 schema 配置。

#### 范围

- 数据集列表页入口
- 新建评测集按钮
- 类型选择界面
- schema 配置页

#### 不包括

- 后端持久化
- 批量导入
- 高级筛选排序

#### 验收标准

- 点击新建后可选择：
  - 普通数据集
  - Workflow 数据集
  - Trace 监控集
- 可编辑基础信息与 schema
- 页面不抖动，布局稳定

## Issue 3

### Title

`[P0][backend][evaluator] 实现评估器领域模型`

### Body

#### 背景

评估器是实验系统的核心输入之一，必须先固定 family、layer、metric_type 等公共契约。

#### 目标

实现 Evaluator 领域模型，支持模型评估与代码评估两类 evaluator。

#### 范围

- 支持 `family`
- 支持 `layer`
- 支持 `metric_type`
- 支持 `config`

#### 不包括

- evaluator 页面 UI
- LLM 实际调用
- Python 脚本沙箱

#### 验收标准

- 支持 `model / code`
- 支持 `binary / continuous / categorical`
- 支持 `Retrieval / Rerank / Answer / Overall`

## Issue 4

### Title

`[P0][frontend][evaluator] 实现“新建评估器”分步弹窗`

### Body

#### 背景

评估器页主视图要围绕 AI 搜索流程，新建时再分支到 LLM 或 Code evaluator。

#### 目标

实现“新建评估器”两步弹窗流程。

#### 范围

- 新建评估器按钮
- 第一步类型选择
- 第二步配置表单

#### 不包括

- evaluator 执行逻辑
- 最终持久化

#### 验收标准

- 第一步必须先选：
  - `LLM Evaluator`
  - `Code Evaluator`
- 第二步进入对应表单
- 页面不应出现重复类型选择器

## Issue 5

### Title

`[P0][backend][evaluator] 实现二值指标合法性校验`

### Body

#### 背景

PRD 已明确正确性等二值指标必须严格 `0/1`，不允许 0.5 等模糊值。

#### 目标

实现 binary evaluator 的合法性约束，并定义非法结果处理方式。

#### 范围

- binary 结果校验
- `invalid_judgment` 标记
- 汇总层过滤非法结果

#### 不包括

- 前端可视化细节
- LLM prompt 优化

#### 验收标准

- binary 指标只接受 `0` 或 `1`
- `0.5` 等值标记为 `invalid_judgment`
- 非法结果不混入正常 binary 汇总

## Issue 6

### Title

`[P0][backend][experiment] 实现 ExperimentRun 对象与状态机`

### Body

#### 背景

实验是整个评测闭环的执行中心，必须先固定对象结构和状态机。

#### 目标

实现 ExperimentRun 领域对象与状态流转。

#### 范围

- 定义 ExperimentRun 类型
- 定义状态机
- 关联 dataset、pipeline、evaluators

#### 不包括

- 完整 runner 执行逻辑
- AB comparison 视图

#### 验收标准

- 状态至少包括：
  - `CREATED`
  - `RUNNING`
  - `FINISHED`
  - `FAILED`
- 支持与 Dataset / Evaluator / SearchPipelineVersion 关联

## Issue 7

### Title

`[P0][backend][runner] 实现 ExperimentRunJob / CaseRunJob`

### Body

#### 背景

架构文档已明确实验必须异步执行，且 `CaseRun` 是最小执行单元。

#### 目标

实现最小作业模型，为后续 runner 和 trace 打基础。

#### 范围

- `ExperimentRunJob`
- `CaseRunJob`
- case 级拆分逻辑

#### 不包括

- 分布式调度
- 大规模任务系统

#### 验收标准

- 能从一个 experiment 初始化多个 case run
- `CaseRun` 是最小执行单元
- 支持按 case 并发

## Issue 8

### Title

`[P0][backend][integration] 建立共享 types 与 mock contract`

### Body

#### 背景

前端、后端和联调层必须使用统一的对象结构，否则并行开发会快速失控。

#### 目标

建立共享 types，并提供与之对齐的 mock contract。

#### 范围

- Dataset types
- Evaluator types
- Experiment types
- Trace types
- mock payloads

#### 不包括

- 完整 API 网关
- 真实网络鉴权

#### 验收标准

- 前后端消费同一套类型
- mock data 和真实 contract shape 一致
- 可支撑页面先用 mock 数据联调
