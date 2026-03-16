# Downey Evals Loop — Agent Collaboration Guide

Version: v0.1  
Date: 2026-03-17

## 1. Collaboration Model

当前项目建议采用三 agent 并行协作模式：

- Agent 1：Core / Domain
- Agent 2：Frontend
- Agent 3：Infra / Integration

三者都必须遵守同一份事实来源：

- [docs/prd.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/prd.md)
- [docs/architecture.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/architecture.md)
- [docs/backlog.md](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/backlog.md)

## 2. Agent 1 — Core / Domain

### Role

负责产品主线与核心逻辑，不负责最终 UI 展示，也不负责环境缝合层。

### Responsibilities

- 文档主线收口
- 领域模型定义
- evaluator engine
- experiment / runner 主流程
- root-cause analysis
- 二值指标合法性约束
- 分层结果结构定义

### In Scope

- Dataset / Evaluator / Experiment / Trace 核心类型
- AI 搜索四层结构
- evaluator family / metric type 约束
- ExperimentRun / CaseResult / TraceRun / ABExperiment
- ExperimentRunJob / CaseRunJob 规则层

### Out of Scope

- 页面视觉细节
- 弹窗和列表展示
- `.env`、SQLite、启动脚本收口

### Rules

- 不能随意变更已经确认的模块命名
- 不把二值指标改成连续型
- 不把 root-cause analysis 简化成纯自然语言总结

### Current Next Focus

- 固定共享领域模型
- 继续拆 GitHub issues
- 推进 evaluator / experiment / runner 主逻辑

## 3. Agent 2 — Frontend

### Role

负责前端展示层与交互层实现。

### Responsibilities

- 页面结构与导航
- 列表页、详情页、弹窗、抽屉
- 实验运行页
- AB 实验页
- Trace Viewer
- 信息动线与视觉稳定性优化

### In Scope

- 左侧导航
- `实验 -> 实验运行 / AB 实验` 二级菜单
- 评测集页
- 评估器页
- Trace 页
- 统计页
- mock data 驱动页面展示

### Out of Scope

- 修改领域模型
- 发明新的对象或指标
- 修改数据集类型
- 修改评估器类型
- 定义后端接口 shape

### Rules

- 评估器页主视图必须围绕 `Retrieval / Rerank / Answer / Overall`
- 新建评估器先选择 `LLM Evaluator / Code Evaluator`
- 页面布局要稳定，避免 hover 抖动和边框跳动
- 如需新增字段，先回到 Agent 1 确认

### Success Criteria

- 用户可以完整走通：
  - 创建评测集
  - 创建评估器
  - 查看实验运行
  - 查看 AB 实验
  - 下钻到 trace

## 4. Agent 3 — Infra / Integration

### Role

负责基础设施、接口收口、类型对齐与前后端联调。

### Responsibilities

- repo skeleton
- API contract
- mock data
- `.env`
- SQLite / 本地存储
- 前后端联调
- 类型对齐
- 启动脚本

### In Scope

- 共享 types 的收口
- mock API / contract
- 本地存储适配层
- 配置读取层
- 统一 dev/build/start 方式
- 前后端联调说明

### Out of Scope

- 修改产品规则
- 修改页面交互逻辑
- 发明新业务指标
- 擅自扩展领域命名

### Rules

- 所有接口 shape 以共享 types 为准
- mock data 和真实接口 shape 必须一致
- 不能绕开文档自定义命名
- 不能替代 Agent 1 决定业务逻辑

### Success Criteria

- 前后端使用同一套类型
- 本地可稳定启动
- Dataset / Evaluator / Experiment / Trace 能走通最小联调闭环

## 5. Collaboration Rules

### 5.1 Single Source of Truth

产品定义以文档为准，不以页面现状或临时 mock 为准。

### 5.2 Field Ownership

- 领域对象和字段定义归 Agent 1
- 交互与展示归 Agent 2
- API 收口、联调和运行方式归 Agent 3

### 5.3 Escalation Rule

出现以下情况时，应回到主 agent 收口：

- 需要新增对象
- 需要新增公共字段
- 需要修改模块命名
- 需要修改实验结果结构
- 需要修改 evaluator 合法性规则

## 6. Suggested Parallel Start

建议三条线程同步起步：

- Agent 1：先固定共享领域模型与 Experiment 结果结构
- Agent 2：先用 mock data 跑通 Dataset / Evaluator / Experiment / Trace 页面
- Agent 3：先收口共享 types、mock contract、SQLite 与脚本
