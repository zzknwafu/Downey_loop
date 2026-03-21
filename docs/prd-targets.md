# Downey Evals Loop — Targets 子 PRD

Version: v0.1  
Stage: Local MVP  
Date: 2026-03-18

## 1. 模块目标

`Targets` 用于定义“实验到底在测谁”。

当前阶段，Targets 只承担被测对象管理职责，不承担完整 IDE、复杂编排或平台化运行能力。

## 2. 目标对象

Targets 一级分为两类：

- `Prompts`
- `Agents`

二者平级，不互相包含。

## 3. PromptVersion

`PromptVersion` 是独立一等 target。

用途：

- prompt 实验
- prompt AB
- preview/debug

最小字段：

- `id`
- `name`
- `version`
- `description`
- `system_prompt`
- `user_template`

## 4. AgentVersion

`AgentVersion` 是通用版本化智能体对象，不再固定为 AI Search pipeline。

v1 最小字段：

- `id`
- `name`
- `version`
- `description`
- `scenario`
- `entry_type`
- `artifact_ref`
- `composition?`

说明：

- `scenario` 用于描述业务场景，如 `ai_search`
- `entry_type` v1 固定枚举：
  - `prompt`
  - `api`
  - `workflow`
- `artifact_ref` 用于引用被测对象
- `composition?` 为可选高级声明，不绑定执行语义

## 5. 页面结构

### 5.1 Targets 首页

建议结构：

- `Prompts`
- `Agents`

两个入口平级展示。

### 5.2 Prompt 页面

Prompt 管理页采用两层架构：

#### 第一层：Prompt List

只做 Prompt 列表与版本入口，不在列表页展开编辑能力。

列表页承担：

- `Prompt 列表`
- 版本摘要
- 当前生效版本摘要
- 新建 Prompt
- 进入 Prompt 详情页

列表页不承担：

- Prompt 内容编辑
- Preview/debug 主交互
- 评测统计展示

#### 第二层：Prompt Detail

点击某个 Prompt 后进入详情编辑页。详情页当前只保留两块核心能力：

- `Prompt template`
- `Preview and debug`

其中：

- `Prompt template` 是主编辑区
- `Preview and debug` 是单次调试区，用于验证当前 Prompt 版本的输入输出
- `Parameter config` 只能作为轻量折叠区或辅助区，不得成为主视觉中心
- 详情页需要提供 `另存模板` 入口，用于把当前 Prompt 内容保存为新的模板或新版本，而不是覆盖式编辑
- 详情页需要提供 `版本管理` 入口，用于查看历史版本、切换版本、回退到历史版本

不要求：

- `common configuration`
- 复杂 playground
- 重型 Prompt IDE
- 评测统计中心
- 多模型选择器

说明：

- 当前模型固定为 `Gemini`
- Prompt 页不做多模型切换
- Prompt 的真实评测、trace、统计、归因统一在 `实验` 中查看
- Prompt 页的目标是“编辑和单次调试”，不是承载完整实验分析

#### 5.2.1 Prompt 版本管理

Prompt 版本管理是 Prompt 页的标准能力。

必须支持：

- 查看版本列表
- 查看每个版本的版本号、更新时间、变更说明
- 从当前内容 `另存模板` 为新版本
- 切换到某个历史版本查看内容
- 将某个历史版本回退为当前生效版本

说明：

- 回退的产品语义是“基于历史版本恢复为当前版本”，而不是直接物理删除中间版本
- 版本记录需要可审计，不允许只保留当前最新内容

### 5.3 Agent 页面

建议页面包括：

- `Agent List`
- `Create Agent`

`Agent List` 推荐字段：

- `Name`
- `Version`
- `Scenario`
- `Description`
- `Composition summary`
- `Last Eval Score`

`Create Agent` 推荐流程：

- Step 1：基础信息
- Step 2：模式选择 `Simple / Advanced`

#### Simple Mode

默认入口，只录入最小字段：

- `name`
- `version`
- `description`
- `scenario`
- `entry_type`
- `artifact_ref`

#### Advanced Mode

可见但选填，允许录入：

- `composition`

当前只做模块声明，不要求执行层与 trace 强绑定。

## 6. 与实验的关系

实验绑定的是通用 `Target`：

- `Target = PromptVersion | AgentVersion`

目标：

- 在实验中明确知道被测对象是谁
- 支持 Prompt 与 Agent 的版本对比
- 不把 Prompt 混入 Agent 内部配置

## 7. MVP 边界

本阶段必须支持：

- PromptVersion 列表
- AgentVersion 列表
- 新建 PromptVersion
- 新建 AgentVersion
- Prompt template
- Preview and debug
- Experiment 中选择 target

本阶段不做：

- 重型 Prompt IDE
- Agent 的模块化执行引擎
- composition 驱动执行
- module-level eval
