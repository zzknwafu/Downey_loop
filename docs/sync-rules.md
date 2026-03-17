# Downey Evals Loop — Sync Rules

Version: v0.1  
Date: 2026-03-17

## 1. Purpose

本文件用于锁死三 agent 协作边界，防止共享核心文件被并行修改。

当前阶段的主要风险不是方向错误，而是：

- 多个 agent 同时碰共享核心
- 类型名、指标名、测试预期互相打架
- 为了局部跑通而越权修改不属于自己的层

## 2. Single Owner Rule

共享核心文件必须有单一 owner。

### Agent 1 owns

- `src/domain/types.ts`
- `src/domain/evaluators.ts`
- `src/domain/comparison.ts`
- `src/domain/root-cause.ts`
- `src/domain/experiment.ts`
- `tests/search-evals.test.ts`

### Agent 3 owns

- `src/contracts/api.ts`
- `src/contracts/mock-api.ts`
- `src/server/contract-adapter.ts`
- `src/server/index.ts`
- `src/infra/store.ts`
- `src/infra/config.ts`
- `src/shared/contracts.ts`
- `src/shared/mock-data.ts`
- `tests/local-store.test.ts`
- `tests/runner-infra.test.ts`

### Agent 2 owns

- `src/web/App.tsx`
- `src/web/styles.css`
- `src/web/view-model.ts`
- `src/web/api.ts` 的消费层实现

## 3. Red Zone Files

以下文件是高风险共享核心，除了 owner 外禁止直接修改：

- `src/domain/types.ts`
- `src/domain/evaluators.ts`
- `src/domain/comparison.ts`

原因：

- 它们会同时影响 domain、server adapter、shared contract、frontend view-model、tests
- 一次小的指标名改动，会连锁打断多条线程

## 4. Allowed Direction of Dependency

正确方向必须是：

`Agent 1 domain -> Agent 3 contract/api/store -> Agent 2 UI`

禁止反向驱动：

- `UI -> domain`
- `contract -> domain`
- `mock convenience -> metric rename`

## 5. Change Scenarios

### 5.1 Agent 2 wants a new field

正确做法：

1. 提需求给 Agent 1
2. Agent 1 决定是否进入 domain
3. Agent 3 再同步到 contract
4. Agent 2 最后消费

### 5.2 Agent 3 wants to rename a field for API neatness

正确做法：

1. 保持 domain 名称不动
2. 在 adapter 层映射
3. 不得反向要求 domain 改名

### 5.3 Agent 1 changes metric names or layer structure

正确做法：

1. 先更新 domain
2. 同步更新 `docs/architecture.md` 或 `docs/prd.md`
3. 通知 Agent 3 更新 adapter/contract
4. 通知 Agent 2 更新 UI 消费

## 6. Mandatory Escalation

以下情况必须中止本线程修改并回到主 agent：

- 想修改不属于自己 owner 的文件
- 想新增公共类型
- 想修改指标名
- 想修改层级名
- 想修改实验结果结构
- 想修改 tests 以适配越权改动

## 7. Daily Sync Checklist

每天至少做一次：

1. 看 `git status` 中是否有人改了别人的 owner 文件
2. 看 `src/domain/types.ts`、`src/domain/evaluators.ts`、`src/domain/comparison.ts` 是否出现并行变更
3. 跑一次 `npm test`
4. 跑一次 `npm run build`
5. 如果失败，先判断是 owner 文件冲突还是本层实现问题

## 8. Current Enforcement Decision

从现在开始执行以下强约束：

- Agent 1 只负责领域模型、评估指标、comparison/root-cause
- Agent 3 只负责 contract adapter、API、store
- Agent 2 只消费共享 contract，不改领域定义

本规则优先级高于“为了本地先跑通先改一下”的临时便利。
