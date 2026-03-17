# Coze Loop Evaluator Mapping

本文档说明：已经从开源 `coze-loop` 仓库提取出的 evaluator prompt / code evaluator 模板，如何映射到当前项目的“外卖 / 商超 AI 搜索”业务评测器。

## 原始资产

- 本地 clone: [`.cache/coze-loop`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/.cache/coze-loop)
- 提取目录: [`artifacts/coze-loop-oss`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/artifacts/coze-loop-oss)
- 模板 JSON: [`artifacts/coze-loop-oss/evaluator-templates.json`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/artifacts/coze-loop-oss/evaluator-templates.json)
- 清单: [`artifacts/coze-loop-oss/manifest.json`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/artifacts/coze-loop-oss/manifest.json)

当前已提取：

- 21 个 LLM evaluator 模板
- 5 个 code evaluator 模板

## 项目接入点

- 评估器定义与 Coze Loop 模板映射在 [`src/domain/evaluators.ts`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/domain/evaluators.ts)
- 根因归因优先级在 [`src/domain/root-cause.ts`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/domain/root-cause.ts)

## 业务映射原则

- 保留 Coze Loop 通用 evaluator 的方法论，如 `正确性 / 简洁性 / 幻觉现象 / 有益性 / Agent 任务完成度`
- 补足外卖和商超搜索特有的业务护栏，如预算、库存、配送时效、答案与 top1 一致性
- 用 `LLM + code` 混合方式表达：
  - `LLM` 偏语义与业务目标判断
  - `code` 偏硬约束与 guardrail

## 指标映射

### Retrieval

- `retrieval_coverage`
  来源模板：`相关性`
- `retrieval_intent_match`
  来源模板：`相关性`、`指令遵从度`
- `hard_constraint_recall`
  来源模板：`指令遵从度`
- `stock_guardrail`
  来源模板：`Agent 任务完成度`
- `noise_rate`
  来源模板：`相关性`
- `evidence_sufficiency`
  来源模板：`深度性`、`细节性`

### Rerank

- `rerank_hit_at_k`
  来源模板：`相关性`
- `rerank_top1_quality`
  来源模板：`有益性`、`Agent 任务完成度`
- `constraint_preservation`
  来源模板：`指令遵从度`
- `budget_guardrail`
  来源模板：`Agent 任务完成度`
- `delivery_eta_guardrail`
  来源模板：`Agent 任务完成度`
- `preference_alignment`
  来源模板：`有益性`、`参考答案遵从度`

### Answer

- `answer_correctness`
  来源模板：`正确性`
- `answer_groundedness`
  来源模板：`幻觉现象`、`参考答案遵从度`
- `answer_trustworthiness`
  来源模板：`正确性`、`幻觉现象`
- `answer_conciseness`
  来源模板：`简洁性`
- `answer_actionability`
  来源模板：`有益性`
- `recommendation_explanation_quality`
  来源模板：`深度性`、`细节性`
- `answer_top_item_consistency`
  来源模板：`参考答案遵从度`
- `clarification_decision`
  来源模板：`Agent 轨迹质量`

### Overall

- `proxy_ctr`
  来源模板：`有益性`
- `proxy_cvr`
  来源模板：`Agent 任务完成度`、`有益性`
- `proxy_dwell_time`
  来源模板：`细节性`
- `proxy_satisfaction`
  来源模板：`有益性`、`正确性`
- `proxy_trust`
  来源模板：`幻觉现象`、`正确性`
- `business_goal_alignment`
  来源模板：`有益性`、`Agent 任务完成度`
- `business_guardrail_pass`
  来源模板：`Agent 任务完成度`
- `latency`
  来源模板：`Agent 轨迹质量`

## 说明

- `coze-loop` 开源仓库没有公开业务数据集行和真实 prompt 行，因此这里映射的是“模板能力”，不是生产数据快照。
- 当前项目里每个 evaluator 的 `config` 已写入 `cozeLoopSourceTemplates` 和 `businessRubric`，可直接用于 UI 展示或后续导出。

## 已落地的专项评测集

- [`dataset_retrieval_intent_001`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/domain/sample-data.ts)
  对应 `retrieval_coverage / retrieval_intent_match / hard_constraint_recall / noise_rate`
- [`dataset_rerank_guardrail_001`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/domain/sample-data.ts)
  对应 `rerank_hit_at_k / constraint_preservation / budget_guardrail / delivery_eta_guardrail / stock_guardrail`
- [`dataset_answer_trust_001`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/domain/sample-data.ts)
  对应 `answer_correctness / answer_groundedness / answer_trustworthiness / answer_top_item_consistency / clarification_decision`
- [`dataset_business_goal_001`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/domain/sample-data.ts)
  对应 `proxy_ctr / proxy_cvr / proxy_dwell_time / proxy_trust / business_goal_alignment / business_guardrail_pass`

## 已迁移的 Prompt 资产

以下 Prompt 已经以 `PromptVersion` 形式接入 [`src/domain/sample-data.ts`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/domain/sample-data.ts)，会出现在默认 seeded prompts 里：

- `prompt_eval_correctness_coze_v1`
- `prompt_eval_hallucination_coze_v1`
- `prompt_eval_conciseness_coze_v1`
- `prompt_eval_helpfulness_coze_v1`
- `prompt_eval_detail_coze_v1`
- `prompt_eval_reference_alignment_coze_v1`
- `prompt_eval_instruction_following_coze_v1`
- `prompt_eval_agent_task_completion_coze_v1`
- `prompt_eval_agent_trajectory_coze_v1`

这批 prompt 不是 `coze-loop` 生产环境的真实业务 prompt 行，而是把开源 evaluator template 的核心 rubric 迁成了当前项目能直接展示和联调的 prompt 资产。
