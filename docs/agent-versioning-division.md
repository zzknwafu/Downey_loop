# Dataset / Evaluator 版本管理 — Agent 2 / Agent 3 分工说明

Date: 2026-03-21

## 1. Overall Goal

本轮目标不是做复杂版本系统，而是把：

- 数据集版本管理
- 评估器版本管理
- 实验绑定具体版本

这三件事做成可用主线。

## 2. Agent 2：Frontend

Agent 2 只负责页面结构、交互和展示，不改领域语义，不定义 contract。

### 2.1 Dataset

要做的页面能力：

- 数据集详情页显示当前版本
- 打开版本列表
- 查看历史版本
- `保存为新版本`
- `另存为新数据集`
- `回退到某版本`

必须注意：

- `id` 继续由系统默认生成
- `name` 可选，不强制
- `context` 默认不要求用户写完整 JSON
- 上方结构化字段填写后，自动组装进 `context`

### 2.2 Evaluator

要做的页面能力：

- 评估器详情页显示当前版本
- 打开版本列表
- 查看历史版本
- `保存为新版本`
- `另存为新评估器`
- `回退到某版本`

### 2.3 Experiment

要做的页面能力：

- 选择 dataset 时必须选版本
- 选择 evaluator 时必须选版本
- Experiment configuration 中显示：
  - dataset version
  - evaluator versions

### 2.4 Agent 2 必须检查

- 页面是否仍然只按对象名显示，没有版本选择
- “另存”是否被误做成“覆盖保存”
- 回退是否被误做成“直接改旧版本”
- Experiment 配置页是否仍看不到具体版本

### 2.5 Agent 2 不能做

- 不改 `src/domain/*`
- 不改 `src/contracts/*`
- 不自己定义版本号生成规则
- 不自己决定 lineage 结构

## 3. Agent 3：Infra / Integration

Agent 3 只负责 contract / adapter / API / store，不改产品定义，不改页面结构。

### 3.1 Dataset

要提供的能力：

- dataset 对象读取
- dataset version 列表读取
- 保存为新版本
- 另存为新数据集
- 根据版本读取 dataset 快照

### 3.2 Evaluator

要提供的能力：

- evaluator 对象读取
- evaluator version 列表读取
- 保存为新版本
- 另存为新评估器
- 根据版本读取 evaluator 快照

### 3.3 Experiment

要提供的能力：

- create experiment 时显式传：
  - dataset version
  - evaluator versions
- detail contract 返回配置快照中的版本信息

### 3.4 Agent 3 必须检查

- contract 是否仍然只返回逻辑对象名，不返回版本
- store 是否只能保存 latest，没有保存历史版本
- 另存为新对象是否还在错误复用原 key
- experiment detail 是否不能回读版本快照

### 3.5 Agent 3 不能做

- 不改 `src/domain/*`
- 不自行决定版本语义
- 不把“回退”做成篡改历史版本

## 4. Shared Acceptance Rules

Agent 2 / Agent 3 共同要满足：

- 数据集可保存为新版本
- 数据集可另存为新数据集
- 评估器可保存为新版本
- 评估器可另存为新评估器
- 实验必须绑定具体版本
- 历史版本不可被直接覆盖
- 回退操作必须生成一个新版本
