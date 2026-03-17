# Coze Loop OSS assets

Source repo: https://github.com/coze-dev/coze-loop
Local clone: /Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/.cache/coze-loop
Extracted output: /Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/artifacts/coze-loop-oss

## Summary

- Raw copied files: 14
- Evaluator templates: 26
- LLM evaluator templates: 21
- Code evaluator templates: 5

## What is included

- Docker Compose bootstrap/config files related to evaluation, datasets, and prompts under `raw/`
- Parsed evaluator prompt templates in `evaluator-templates.json`
- Machine-readable asset summary in `manifest.json`

## What is not included

- Ready-made business dataset rows exported from production
- Ready-made prompt rows from `prompt_commit` or related tables

The open-source repository exposes schema and bootstrap templates, but the copied SQL files here do not include populated business datasets/prompts.

## LLM evaluator templates

- 相关性
- 简洁性
- 正确性
- 幻觉现象
- 有害性
- 恶意性
- 有益性
- 争议性
- 性别歧视性
- 犯罪性
- 不敏感性
- 深度性
- 创造性
- 细节性
- 工具选择质量
- 工具参数正确性
- Agent 任务完成度
- Agent 轨迹质量
- 参考答案遵从度
- 指令遵从度
- 图片理解

## Code evaluator templates

- 文本包含判断
- 文本正则匹配
- 文本起始子串判断
- JSON格式校验
- 文本等值判断
