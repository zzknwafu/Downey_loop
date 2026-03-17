# Downey Evals Loop — 2026-03-18 复盘记录

Version: v0.1  
Date: 2026-03-18

## 1. 目的

记录今天在 `数据集模块收口`、`Prompt 页定位调整`、`实验信息架构收口` 过程中暴露的问题，并总结为什么今天整体效率明显高于昨天。

这份复盘的重点不是追责，而是沉淀：

- 今天为什么推进更顺
- 今天还卡在了哪些点
- 哪些规则必须继续坚持

## 2. 今日结论

今天的整体效率比昨天高，主要原因不是“任务变简单了”，而是：

- 文档已经成为单一事实来源
- Agent 1 / 2 / 3 的边界明显比昨天清晰
- 数据集模块的范围被收缩成 MVP 主线
- 遇到分歧时，先收口产品定义，再推进实现

一句话总结：

> 今天最大的进步，不是多写了多少代码，而是把“先定义清楚，再多线程推进”真正执行起来了。

## 3. 今天做对了什么

### 3.1 数据集模块真正收成了 MVP

今天基本把 `Dataset` 这条线的主骨架打通了：

- 创建数据集
- 修改数据集
- 三类数据集类型
- schema 校验
- 样本量最小值 `>= 10`
- 样本级 create / update / delete
- dataset case 的可编辑结构

这意味着数据集模块不再停留在“看起来像一个页面”，而是有了明确的领域规则。

### 3.2 共享核心 owner 规则开始真正生效

今天几次修改都基本遵守了：

- Agent 1 只动 domain / rules / tests
- Agent 2 负责 UI 动线
- Agent 3 负责 contract / API / store

虽然联调侧测试还是会受影响，但本质上不再是“多个人同时改一个核心文件”，而是“下游适配没有及时跟上上游规则”。

这是健康得多的问题。

### 3.3 产品讨论更聚焦于“最小正确”

今天几次判断都比昨天更稳：

- Dataset 页去掉不必要的 column management
- 数据集样本量下限直接变成 domain 规则
- Prompt 页面不照搬 Coze 的重型 `common configuration`
- 评测 / 观测 / trace / 统计统一回收到 `实验` 板块

这说明产品心智开始从“像 Coze”转向“适合 Downey Evals Loop 的 MVP”。

## 4. 今天暴露出的主要问题

### 4.1 “智能合成”理解最初没有拉齐

表现：

- 一开始对“智能合成”的理解还偏向“生成更多样本”
- 但你的真实意思是“带方向的补样”
- Coze 的两步式 UI 其实隐含了这个产品逻辑：
  - 先定义合成场景及来源
  - 再定义样本配置和生成要求

结果：

- 如果不及时收口，前端很容易把它做成一个普通生成表单
- integration 层也容易只做一个 `source + mode` 的薄接口

今天的修正：

- PRD / backlog / prompts 已改成“方向性智能合成”
- 明确了：
  - `Evaluation set / 智能合成` 双 tab
  - 两步向导
  - 先生成草稿，再确认入库
  - 方向类型：
    - `generalize`
    - `augment_failures`
    - `augment_guardrails`
    - `align_online_distribution`

### 4.2 Prompt 页面一开始还是带着 Coze 的重型心智

表现：

- 原始参考图里有 `common configuration`
- 但对本项目 MVP 来说，这一块并不是必要能力
- 你更需要的是：
  - prompt template
  - preview/debug

结果：

- 如果不收口，Prompt 页面会继续膨胀
- 容易重复建设“实验里本来就要看的东西”

今天的修正：

- 明确 Prompt 页只保留：
  - `Prompt template`
  - `Preview and debug`
- 不强制做 `common configuration`
- 评测、观测、trace、统计统一回到实验结果里看

### 4.3 “评测”和“观测”的导航心智仍然容易割裂

表现：

- 文档和页面最初还保留了较重的“评测中心 / 观测中心”心智
- 但你真实想看的，其实都是“实验结果的不同切面”

结果：

- 如果继续保留独立导航，用户会分不清：
  - 什么时候去实验
  - 什么时候去观测
  - trace 到底属于哪里

今天的修正：

- 文档已经改成：
  - Prompt 页只做单次 debug
  - 真正的评测 / 观测 / trace / 统计统一归到实验板块

这一步很关键，因为它直接减少了产品心智分裂。

### 4.4 新规则一收紧，下游测试马上暴露出“老假设”

表现：

- 当我们新增：
  - `datasetType` 有 case 时不能切换
  - editable case 必须和 schema 对齐
  - dataset case 要使用新的 `EditableDatasetCase` 结构
- 相关测试立刻失败：
  - `tests/datasets-domain.test.ts`
  - `tests/local-store.test.ts`
  - `tests/runner-infra.test.ts`

本质上这些失败不是坏事，而是暴露了：

- integration 层仍在用旧的 case shape
- mock API 的测试还沿着旧样本结构在断言
- “规则升级后，下游测试要一起升级”这件事必须更自觉

今天的修正：

- 这些测试都已对齐新规则
- 最终全量测试回到通过状态

### 4.5 Agent 2 / Agent 3 的 prompt 需要跟产品口径同步刷新

表现：

- 产品定义今天发生了几次关键收口：
  - 智能合成改成方向性补样
  - Prompt 页面收缩成 template + preview/debug
  - 实验统一承载评测/观测/trace/统计

如果 agent prompt 不同步：

- Agent 2 会继续按旧 UI 心智做
- Agent 3 会继续按旧 contract 心智接

今天的修正：

- 已经重新整理了可以直接转发的 Agent 2 / Agent 3 prompt

这说明：

- 在多 agent 协作里，prompt 本身也是“协作文档”，必须版本化管理

## 5. 为什么今天 token 更省

今天 token 消耗比昨天少，主要不是因为讨论少，而是因为：

### 5.1 不再反复争抢“共享核心是谁说了算”

昨天很多 token 花在：

- 修正冲突
- 对齐名词
- 解释为什么不能越权改 domain

今天这部分开销显著下降。

### 5.2 先文档收口，再代码推进

今天出现分歧时，基本都是：

1. 先收产品定义
2. 再改文档
3. 再让 Agent 2 / 3 按文档执行

这种顺序减少了“写完再推翻”的代价。

### 5.3 今天的讨论更集中在主线

主线集中在：

- Dataset
- Prompt 页面定位
- 实验板块收口

没有像昨天那样在导航、对象模型、平台定位上同时大范围摆动。

## 6. 今天沉淀出的规则

### 6.1 新产品能力必须先回答“它属于哪个主模块”

例如今天：

- 智能合成属于 `Dataset`
- preview/debug 属于 `Prompt`
- trace / 统计属于 `Experiment`

如果这一步不先做，页面很快就会长成“哪里都像能放”的状态。

### 6.2 收紧规则时，默认要同步检查三层

每次 domain 规则收紧后，至少要一起检查：

- domain tests
- local store / runner / mock tests
- front-end assumptions

今天已经证明，只改 domain 不看下游测试，会立刻产生“看似随机”的失败。

### 6.3 Agent prompt 也要版本化管理

产品定义一旦变化，必须同步更新：

- `docs/prd.md`
- `docs/backlog.md`
- `docs/prompts.md`
- 转发给 Agent 2 / Agent 3 的执行 prompt

否则代码虽然没冲突，方向也会继续漂移。

## 7. 后续建议

### 7.1 明天继续优先做“实验主线收口”

优先级建议：

1. 统一实验页承载评测 / 观测 / trace / 统计
2. 让 Prompt / Agent 的 target 选择语义更落地
3. 让智能合成从“文档清晰”进入“domain / contract 清晰”

### 7.2 继续避免功能面扩张

明天不建议回头做这些：

- 重型 Prompt IDE
- 通用配置大面板
- 独立 Trace 中心
- 独立统计中心

这些都会再次把 MVP 拉重。

### 7.3 每天收工前都要留一份复盘

建议延续：

- 每天一份 `retrospective-YYYY-MM-DD.md`

这样第二天开工时，所有 agent 都知道：

- 哪些结论已经定了
- 哪些坑今天已经踩过了
- 哪些误解不要再重复

## 8. 今日最终结论

今天的最大进步不是“写了更多功能”，而是：

- 明确了 Dataset 主线
- 把智能合成从“随机生成”拉回“方向性补样”
- 把 Prompt 页面从重型配置拉回 `template + preview/debug`
- 把评测 / 观测统一收回实验板块

一句话总结：

> 今天开始，Downey Evals Loop 的产品骨架比昨天清楚得多，开发开始从“修漂移”转向“沿主线稳定推进”。
