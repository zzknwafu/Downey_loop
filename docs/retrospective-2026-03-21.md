# Downey Evals Loop — Retrospective 2026-03-21

Date: 2026-03-21

## 1. 今日背景

今天的工作重点从“继续扩产品定义”转向“验证真实 Prompt Experiment 链路是否可跑通”，并开始系统性收口：

- Prompt-first Experiment MVP
- Dataset / Evaluator 版本管理
- Gemini 调用链路
- Experiment 的真实创建与详情展示

## 2. 今日暴露出的主要问题

### 2.1 Experiment 前端仍在 fallback mock 模式

当前前端在创建实验失败后，会退回到本地 baseline/mock 结果，这直接造成：

- 不同数据集看起来分数一样
- 样本数一样
- 详情结果也像复用了同一份实验结果

这不是实验真的算出了一样的结果，而是前端把失败场景伪装成了“本地创建成功”。

### 2.2 真实 Prompt Experiment 还没有完全打通

虽然 API Key 已配置，模型也切到 Gemini，但真实实验仍未形成稳定闭环：

- UI 仍有 mock/fallback 兜底
- API create 链路尚未完全稳定
- 详情与统计仍有部分依赖 mock / baseline 的地方

### 2.3 Gemini 调用层存在真实阻塞 bug

通过真实请求定位到一个明确问题：

- `model` 被错误塞进了 Gemini 的 `generationConfig`
- 导致报错：
  - `Unknown name "model" at 'generation_config'`

该问题今天已经在调用层修复。

### 2.4 前后端 contract / 调用样例仍有不一致

在真实发起实验时，还暴露了 create experiment payload 不完全对齐的问题，例如：

- 服务端要求 `field_mapping`
- 调用样例却仍沿用 `field_mappings`

说明：

- 文档
- contract
- 前端调用
- 真实 API

之间仍存在局部漂移。

### 2.5 实验详情页存在“固定指标模板列”问题

当前实验详情页里，即使只选择了部分 evaluator，很多视图仍按一套固定 AI Search 指标模板铺列，导致：

- 用户会误以为所有指标都参与了实验
- Data detail / statistics 的显示边界变得混乱

### 2.6 Prompt / Dataset / Evaluator 的版本管理此前只停留在想法层

今天明确收口后发现：

- Prompt 需要版本管理、另存模板、回退
- Dataset 需要保存为新版本、另存为新数据集
- Evaluator 需要保存为新版本、另存为新评估器

这说明此前“对象本体”和“版本快照”还没有被产品规则彻底锁死。

## 3. 今日沉淀下来的经验

### 3.1 实验失败可以失败，但不能伪造成功结果

这是今天最重要的一条经验。

如果实验创建失败：

- 可以返回失败
- 可以提示重试
- 可以展示错误详情

但不能用 baseline/mock 结果伪装成真实实验成功。

### 3.2 UI mock 只能服务开发，不能混进真实主流程

mock 数据可以帮助搭页面，但一旦进入：

- 创建实验
- 查看真实结果
- 查看统计
- 查看详情

就必须明确区分：

- real
- mock

不能混用。

### 3.3 Coze 只能参考动线，不能反向决定我们的字段语义

今天继续验证了一个原则：

- Coze 的步骤、页签、详情结构、对比方式值得学
- 但字段、对象模型、版本语义必须由我们自己的 PRD / domain 决定

### 3.4 多 agent 并行前，必须先把定义定死

今天效率提高的核心原因仍然是：

- Prompt 页定义收口
- Experiment 三层结构收口
- Prompt-first MVP 范围收口
- 版本管理语义收口

结论是：

> 多线程开发的前提不是“多开几个 agent”，而是“先把边界和对象定义锁死”。

### 3.5 版本管理必须采用“对象本体 + 不可变版本快照”

今天已确认：

- Dataset
- Evaluator
- Prompt

都不能只靠一个对象反复覆盖式编辑。

实验若要可复现，必须绑定具体版本。

### 3.6 Prompt-first MVP 是正确方向

当前最合理的 MVP 取舍是：

- 产品层保留 `Prompt / Agent`
- 实验执行主线先只保证 `Prompt`
- `Agent` 先不阻塞交付

### 3.7 “数据看起来乱”往往不是后端算错，而是缺少展示语义层

今天实验详情页的案例说明：

- 值本身不一定错
- 但如果 contract 太原始、前端又直接平铺，用户就会感觉“数据乱”

因此：

- contract 需要摘要字段
- 前端需要展示语义层

### 3.8 真实链路问题必须通过真实请求定位

今天 Gemini 的错误，不是通过页面猜出来的，而是通过真实请求直接定位到：

- 调用层 payload 问题
- API payload 问题

这条经验后续应保持：

> 涉及 Experiment 主链路的问题，必须真实发一次请求，而不是只看 UI 表象。

## 4. 今日已采取的修正动作

- 修复 Gemini 调用层中 `generationConfig.model` 的错误
- 补齐 Prompt 页的版本管理、另存模板、回退的产品定义
- 补齐 Dataset / Evaluator 版本管理补充 PRD
- 增加：
  - Agent 2 / Agent 3 的版本管理分工文档
  - 主 agent 的领域改造清单
- 继续确认 Prompt-first Experiment MVP 的实验输入结构

## 5. 下一步的直接动作

### P0

- 去掉前端 create experiment 的 baseline/mock fallback
- 打通真实 `/api/experiments`
- 确保不同 dataset / evaluator 选择会产生真实不同结果

### P1

- Experiment 详情页只展示本次选择的 evaluator
- Detail / statistics 不再铺固定全量指标模板
- 补齐 basic info summary 的 contract

### P2

- 继续落地 Dataset / Evaluator / Prompt 的版本管理
- 让 Experiment configuration 绑定具体版本可回读

## 6. 今日结论

今天不是“功能突然变多了”，而是系统第一次比较清晰地暴露出：

- 哪些是真主线
- 哪些是假成功
- 哪些是产品定义问题
- 哪些是执行链路问题

最大的结论是：

> Prompt-first Experiment MVP 的方向没有错，当前真正要解决的是“真实创建、真实执行、真实展示”，而不是继续扩大产品范围。
