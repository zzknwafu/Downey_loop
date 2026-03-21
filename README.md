# Downey Evals Loop

本仓库现在提供一套本地优先的最小联调骨架：

- 共享 API contract：`Dataset / Evaluator / Experiment / Trace`
- 共享 mock data：前后端都从同一批 seed fixture 出发
- 本地存储适配层：默认 `local_json`，保留 `SQLITE_PATH` 配置位
- 统一启动方式：`dev / build / start`
- 前端通过 `/api/bootstrap` 联调，后端负责 API 与生产静态资源

## 目录

```text
src/
├─ domain/           # 现有评测计算与 comparison 逻辑
├─ shared/           # 共享 contract 与 mock seed
├─ server/           # 配置读取、存储适配、HTTP API
└─ web/              # 前端入口与 view-model 映射
scripts/
└─ dev.mjs           # 一键启动 server watch + vite
```

## 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

开发模式：

- Web UI: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3000`

## AI 配置

当前运行时固定使用 Gemini 2.5 Flash，不做模型切换器，也不做多模型支持。

推荐在 `.env` 里配置：

```env
GEMINI_API_KEY=你的Gemini_API_Key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

如果你还在迁移旧环境，也可以继续保留兼容变量：

```env
OPENAI_API_KEY=你的兼容Key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

优先级规则：

- 服务端优先读 `GEMINI_API_KEY` / `GEMINI_BASE_URL`
- 如果没有，再回退读 `OPENAI_API_KEY` / `OPENAI_BASE_URL`
- 模型名固定为 `gemini-2.5-flash`

非 Gemini / OpenAI 的 provider 当前不自动支持。要接其他厂商，建议新增一层 provider adapter，再让服务端注入统一接口，而不是在业务层继续堆条件分支。

生产构建：

```bash
npm run build
npm start
```

## 脚本

- `npm run dev`
  启动 TypeScript server watch、Node API 和 Vite dev server。
- `npm run build`
  构建 `dist/server` 和 `dist/client`。
- `npm start`
  启动编译后的 Node 服务，同时提供 API 和静态前端。
- `npm test`
  运行评测逻辑、contract 与本地存储测试。

## Coze Loop 模板提取与映射

- 已下载的开源仓库位于 [`.cache/coze-loop`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/.cache/coze-loop)
- 已提取的 evaluator / prompt 相关资产位于 [`artifacts/coze-loop-oss`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/artifacts/coze-loop-oss)
- 外卖 / 商超 AI 搜索评估器映射说明见 [`docs/coze-loop-evaluator-mapping.md`](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/docs/coze-loop-evaluator-mapping.md)

## API Contract

最小实体接口定义在 [src/shared/contracts.ts](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/shared/contracts.ts)。

主要端点：

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/datasets`
- `POST /api/datasets`
- `GET /api/evaluators`
- `POST /api/evaluators`
- `GET /api/experiments`
- `POST /api/experiments`
- `GET /api/experiments/:id`
- `POST /api/comparisons`
- `GET /api/traces`
- `GET /api/traces/:id`

`/api/bootstrap` 返回完整联调快照，包含：

- `datasets`
- `evaluators`
- `experiments`
- `traces`
- `ab_experiment`

## 存储

- 默认存储驱动：`local_json`
- 服务层状态文件：`$DATA_DIR/$STORE_FILE`
- 兼容快照文件：`$DATA_DIR/app-state.json`
- 预留配置：`SQLITE_PATH`

当前实现优先保证本地稳定联调，不额外引入原生 SQLite 依赖；后续可在不改 contract 的前提下替换成真正的 SQLite adapter。

## 前后端联调说明

- 后端以 [src/shared/contracts.ts](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/shared/contracts.ts) 为单一事实来源输出接口 shape。
- HTTP 层已接到 [src/services/eval-loop-service.ts](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/services/eval-loop-service.ts)，实验运行与 comparison 不再只是静态 mock。
- 前端在 [src/web/view-model.ts](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/web/view-model.ts) 中把共享 contract 映射成页面需要的 view model。
- API 不可用时，前端会回退到共享 seed fixture，保证页面和 mock shape 不漂。
- mock fixture 生成逻辑位于 [src/shared/mock-data.ts](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/src/shared/mock-data.ts)。

最小闭环建议：

1. `GET /api/bootstrap` 拉取当前 datasets / evaluators / experiments / traces。
2. `POST /api/datasets` 或 `POST /api/evaluators` 创建联调数据。
3. `POST /api/experiments` 触发一次最小实验运行。
4. `GET /api/traces/:id` 查看 case trace。
5. `POST /api/comparisons` 对两个 run 生成 comparison。

## 环境变量

参考 [.env.example](/Users/zhangchaokai/Documents/贪吃蛇/Downey_evals_loop/.env.example)：

- `HOST`
- `PORT`
- `APP_NAME`
- `APP_BASE_URL`
- `DATA_DIR`
- `STORE_FILE`
- `SQLITE_PATH`
- `GEMINI_API_KEY`
- `GEMINI_BASE_URL`
- `OPENAI_API_KEY` 兼容读取
- `OPENAI_BASE_URL` 兼容读取
