# Downey Evals Loop — BRD

Version: v0.1  
Author: Downey  
Date: 2026-03-16

## 1. Background

随着 AI Agent 与 LLM 应用快速增长，系统评估已经从“回答对不对”演变成“整条 AI 流程是否健康”。传统评测方法通常只看最终答案质量，无法解释性能下降的根因，因此在真实 AI 搜索系统中暴露出明显缺口。

典型问题包括：

- 无法判断失败来自 retrieval、rerank 还是 answer
- 缺少可追踪的执行轨迹和调试证据
- 难以比较 prompt、agent 或 pipeline 版本
- 缺少结构化的 root-cause analysis 工具

这些问题在以下场景中尤为突出：

- 外卖搜索
- 商超搜索
- AI 导购
- 会话式推荐

## 2. Problem Statement

现有工具并未针对 `AI 搜索链路` 做产品化设计。

关键缺失能力包括：

- 面向 retrieval / rerank / answer 的分层评测
- 面向 agent / pipeline 版本的实验管理
- 面向调试与回放的 trace 观测
- 面向实验退化解释的 root-cause analysis

## 3. Product Vision

`Downey Evals Loop` 的目标是提供一套 `本地优先` 的 AI 搜索评测闭环系统。

系统应支持开发者：

- 构建业务专用评测集
- 运行搜索链路实验
- 使用多种评估器评测输出结果
- 通过 trace 观察执行过程
- 对比不同 pipeline 版本并定位问题

## 4. Target Users

主要用户包括：

- AI 工程师
- AI 产品经理
- Agent 开发者
- 搭建 AI 搜索系统的小团队

典型使用场景包括：

- prompt 迭代
- agent 回归测试
- retrieval 失败调试
- pipeline 版本对比

## 5. Success Criteria

产品成功的核心标准是让开发者能够回答：

> 为什么这个 AI 系统变差了？

平台必须支持如下下钻路径：

`experiment -> case -> trace`

并进一步支持：

`overall -> layer -> case -> trace`

## 6. Non Goals

MVP 不追求以下能力：

- 多租户 SaaS 平台
- 模型市场
- 企业级协作和权限系统
- 大规模分布式算力平台
- 通用 AI PaaS
