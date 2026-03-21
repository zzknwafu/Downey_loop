# Downey Evals Loop — Dataset 子 PRD

Version: v0.1  
Stage: Local MVP  
Date: 2026-03-18

## 1. 模块目标

`Dataset` 用于存储实验所需样本，并为不同评测场景提供 schema 与 case 管理能力。

当前主线聚焦 `Evaluation set`，`智能合成` 不作为主线阻塞项。

## 1.1 正式评测集边界

在产品语义上，以下两类数据集都属于“正式评测集”，必须可直接进入 `Experiment` 主流程：

- 通过真实 `POST /api/datasets` 创建成功并持久化的数据集
- 当前随产品预置、并实际展示在 Dataset 页中的内置数据集

说明：

- 这批预置 dataset 不再按“seeded mock 展示资产”处理
- 它们在产品语义上与用户创建成功的数据集一致
- 只要出现在正式 Dataset 列表中，就应被视为可用评测集

以下数据不属于正式评测集：

- 仅存在于前端本地状态中的 local mock dataset
- 仅用于页面演示、未经过真实持久化链路的数据

这些 mock 数据可以用于 Dataset 管理页演示，但不能进入真实 Experiment 主流程

## 2. Dataset Types

当前支持三类数据集：

- `ideal_output`
- `workflow`
- `trace_monitor`

### 2.1 ideal_output

适用于：

- prompt 评测
- answer 评测
- 通用理想输出比较

### 2.2 workflow

适用于：

- agent 执行流程
- 多步骤任务
- 过程性评测

### 2.3 trace_monitor

适用于：

- trace 回放
- 线上问题监控
- 轨迹类实验

## 3. 页面结构

Dataset 页面建议包含两个 tab：

- `Evaluation set`
- `智能合成`

其中：

- `Evaluation set` 是当前主线
- `智能合成` 可以保留入口，但不作为本阶段核心验收项

## 4. Evaluation Set 主流程

### 4.1 数据集管理

必须支持：

- 数据集列表
- 新建数据集
- 编辑数据集
- 数据集详情

### 4.2 样本管理

必须支持：

- 样本列表
- 样本详情
- 样本新建
- 样本编辑
- 样本删除

### 4.3 样本录入方式

样本录入采用“主字段 + 高级结构化字段”的方式，不默认要求用户手写整段 JSON。

#### 4.3.1 样本标识

- `id` 由系统默认自动生成
- 用户可以在新建时自定义 `name`，但不强制填写
- `id` 作为主键，必须唯一
- `name` 作为展示名称或辅助标签，不承担主键职责

#### 4.3.2 context 录入

- `context` 不是强制必填
- 不默认要求用户直接手写完整 JSON
- 用户优先填写上方结构化输入项，例如：
  - `domain`
  - `task_type`
  - `query_constraints`
  - `retrieval_candidates`
  - 其他业务补充字段
- 系统根据这些结构化字段自动按约定格式组装写入 `context`

说明：

- `input`、`reference_output` 是主线录入字段
- `context` 属于高级补充信息
- 只有在需要更细的 evaluator、约束校验或 trace 分析时，才建议补充完整 `context`

## 5. 规则约束

### 5.1 样本量下限

每个数据集的 `sampleCount` 不能小于 `10`。

### 5.2 类型切换限制

数据集中如果已经存在 cases，则不允许直接切换 `datasetType`。

### 5.3 样本与 schema 对齐

editable case 必须与 schema 对齐：

- case 使用的字段必须已在 schema 中声明
- schema 缺少该类型要求的核心字段时，应拒绝保存
- `caseId` 必须唯一

## 6. 与实验的关系

实验绑定的必须是“正式评测集”。

可进入 Experiment 的 dataset 包括：

- 内置预置 dataset
- 用户通过真实创建链路保存成功的数据集

不可进入 Experiment 的 dataset 包括：

- 前端 local mock dataset
- 仅用于演示的 seeded/mock 展示数据

只要某个 dataset 已经作为正式条目出现在 Dataset 列表中，就应被视为可绑定实验的数据集。

当前兼容规则：

- `prompt` target 至少兼容 `ideal_output`
- `agent` target 至少兼容：
  - `ideal_output`
  - `workflow`
  - `trace_monitor`

## 7. MVP 边界

本阶段必须支持：

- 数据集列表/详情/编辑
- 三类 dataset 展示
- case CRUD
- schema 管理
- 实验中选择 dataset

本阶段不做：

- 智能合成主流程
- 高级导入导出
- 数据集版本 diff
- 权限与协作
