# Downey Evals Loop

本仓库当前提供 `Downey evals loop` 的最小可运行核心，重点覆盖 AI 搜索 agent 的分层实验管理，并附带本地 Web UI：

- `Query -> Retrieval -> Rerank -> Answer` 分层建模
- retrieval / rerank / answer / overall 四层指标
- A/B experiment comparison
- 基于规则的 root-cause attribution
- 外卖、商超两个 AI 搜索样例
- 本地 Web comparison 界面，支持 `overall -> layer -> case -> trace` 下钻

## 快速开始

```bash
npm install
npm test
npm run build
npm run dev
npm start
npm run serve
npm run auto-debug-loop -- --mode detect-only
```

- `npm run dev`
  - 启动本地 Web UI，默认地址为 `http://localhost:5173`
- `npm start`
  - 继续保留 CLI 输出，用于直接查看 comparison JSON
- `npm run serve`
  - 用内置 Node 静态服务器启动 `dist/`，适合服务器部署和 PM2 托管
- `npm run auto-debug-loop -- --mode detect-only`
  - 运行自动排障框架，只检测不改代码，输出结构化 JSON 报告
- `npm run auto-debug-loop -- --mode detect-and-fix`
  - 运行自动检测与有限自修；当前支持恢复 evaluator / comparison / view-model 三类已知 contract 基线，并带回滚护栏

## 当前实现

- [src/domain/types.ts](./src/domain/types.ts)
  - 定义 `EvalCase`、`TraceRun`、`ExperimentRun`、`ExperimentComparison`
- [src/domain/evaluators.ts](./src/domain/evaluators.ts)
  - 实现 retrieval / rerank / answer / overall 指标
- [src/domain/comparison.ts](./src/domain/comparison.ts)
  - 实现 comparison 和 root-cause attribution
- [src/domain/sample-data.ts](./src/domain/sample-data.ts)
  - 提供外卖、商超样例数据和 baseline/candidate 实验
- [src/web/App.tsx](./src/web/App.tsx)
  - 实现 Coze Loop 风格的实验对比页
- [src/web/view-model.ts](./src/web/view-model.ts)
  - 把领域 comparison 数据整理成前端视图模型

## 为什么这一版比 Coze Loop 更适配外卖/商超

Coze Loop 是通用型 AI 应用评测与观测平台，能力面更广，但对你当前要做的外卖/商超 AI 搜索来说有几个天然不贴身的地方：

1. 它更偏“通用评测平台”，而这一版直接把被测对象建模成 `AI 搜索流水线`
- 这里不是只测最终回答，而是天然拆成 `retrieval / rerank / answer`
- 对外卖、商超这类交易搜索场景，问题往往就出在召回漏货、重排错位、解释不利于决策，这一版可以直接定位

2. 它的 comparison 更偏“指标并排展示”，而这一版优先看端到端业务结果
- 首屏先看 `proxy_ctr / proxy_cvr / satisfaction / latency`
- 再向下归因到 layer delta 和具体 evidence case
- 这更贴近外卖、商超团队真正关心的“为什么转化掉了”

3. 它的 evaluator 更通用，而这一版 evaluator 是围绕 AI 搜索链路设计的
- retrieval 看 coverage、constraint recall、noise
- rerank 看 hit@k、top1、constraint preservation
- answer 看 correctness、groundedness、actionability、explanation quality
- 这些指标和“搜得到、排得对、说得清、能成交”直接相关

4. 它可以评很多对象，而这一版默认就是为本地单人迭代优化
- 不做多租户、模型管理、应用注册、标签等重平台能力
- 把复杂度集中在你真正会用的评测闭环和实验下钻

5. 它更像平台，而这一版更像“行业化实验台”
- 外卖和商超样例数据从一开始就带约束、候选、业务 outcome label
- 后续可以自然接入缺货替代、凑单推荐、履约解释、售后问答这类高价值场景

## 设计约束

- `answer_correctness` 是 `binary`，只能返回 `0` 或 `1`
- comparison 页的数据模型支持 `overall -> layer -> case -> trace` 下钻
- 归因先做规则化 root-cause analysis，不做因果推断

## 服务器代码管理

建议不要直接在服务器上手改代码。更稳的方式是：

1. 本地开发并提交 Git
- 本地写代码、跑测试、提交到 GitHub/GitLab
- 服务器只负责部署，不作为开发环境

2. 服务器只保留部署副本
- 建议目录：
```bash
/opt/downey-evals-loop/app
/opt/downey-evals-loop/shared
```
- `app` 放代码
- `shared` 放 `.env`、SQLite、上传文件、日志

3. 环境变量和代码分离
- 复制 [.env.example](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/.env.example) 为服务器上的 `.env`
- 不要把真实 API Key 提交进 Git

4. 用 PM2 托管服务
- 项目已经提供 [ecosystem.config.cjs](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/ecosystem.config.cjs)
- 构建后可用：
```bash
pm2 start ecosystem.config.cjs
pm2 save
```

5. 用部署脚本更新代码
- 项目已经提供 [scripts/deploy.sh](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/scripts/deploy.sh)
- 在服务器执行：
```bash
APP_DIR=/opt/downey-evals-loop/app BRANCH=main bash scripts/deploy.sh
```

6. 推荐部署流程
```bash
git clone <your-repo> /opt/downey-evals-loop/app
cd /opt/downey-evals-loop/app
cp .env.example .env
npm ci
npm run build
pm2 start ecosystem.config.cjs
```

7. 后续更新
```bash
cd /opt/downey-evals-loop/app
bash scripts/deploy.sh
```

## 部署文件

- [.env.example](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/.env.example)
  - 环境变量模板
- [ecosystem.config.cjs](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/ecosystem.config.cjs)
  - PM2 配置
- [scripts/serve-dist.mjs](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/scripts/serve-dist.mjs)
  - 生产静态文件服务
- [scripts/deploy.sh](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/scripts/deploy.sh)
  - 一键更新部署脚本
