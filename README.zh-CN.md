# SoulSim

[English](README.md) | [中文](README.zh-CN.md)

SoulSim 是一个多 Agent 社会模拟工作台：输入一个复杂议题，它会生成一个可运行的世界，让不同立场、目标和性格的角色在同一时空中连续互动、冲突、协商和演化，最终产出可追踪的过程日志、结构化报告和可继续追问的深度互动。

它适合用于产品策略预演、组织决策推演、舆情传播模拟、剧本与世界观创作，以及多 Agent 社会行为研究。

![SoulSim 首页](docs/assets/index.jpg)

## 核心能力

- 从世界种子自动构建模拟场景、角色档案和知识图谱。
- 支持粘贴 `SKILL.md` 形式的灵魂配置，增强 Agent 的人格一致性。
- 多 Agent 按天感知事件、思考、发言、行动，并更新世界状态。
- 同一个 world 支持多次 simulation run，适合做对照实验。
- 每次 run 独立保存日志、事件、记忆、干预、报告和聊天记录。
- 支持上帝干预、暂停恢复、结构化报告、1v1 角色对话、Report Agent 问答和多 Agent 群聊。

## 5 步工作流

### Step 1：输入种子

输入世界背景、模拟目标、Agent 数量和推演天数。

![Step 1 种子输入](docs/assets/step1.jpg)

### Step 2：构建世界

系统自动生成世界背景、Agent 档案、知识图谱，并展示该 world 下的推演记录列表。

![Step 2 世界构建结果与推演记录列表](docs/assets/step2.jpg)

### Step 3：运行模拟

多 Agent 按天行动，前端通过 SSE 展示推演日志、阶段状态和时间线。

![Step 3 多 Agent 推演日志](docs/assets/step3.jpg)

### Step 4：生成报告

基于当前选中的 run 生成结构化报告，包含故事化叙事、执行摘要、目标达成评估、角色视角、关系变化、指标变化、关键驱动因素和证据映射。

![Step 4 结构化报告](docs/assets/step4.jpg)

### Step 5：深度互动

基于当前选中的 run，与单个角色、Report Agent 或多个 Agent 群聊继续追问。

![Step 5 角色与报告深度互动](docs/assets/step5-1.jpg)

![Step 5 多 Agent 群聊](docs/assets/step5-2.jpg)

## 架构概览

```text
SoulSim/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── api/             # API 路由与管理后台
│   │   ├── chat/            # 1v1、报告问答、群聊 Agent
│   │   ├── engine/          # 世界构建与多 Agent 推演循环
│   │   ├── graph/           # 知识图谱构建与更新
│   │   ├── llm/             # LLM client 封装
│   │   ├── report/          # 报告生成
│   │   └── repositories/    # 数据访问层
│   └── sql/                 # schema 与 migrations
├── frontend/                # Next.js 前端
│   ├── app/                 # App Router 页面
│   ├── components/          # UI 组件
│   └── lib/                 # API client 与类型辅助
├── docs/                    # 系统文档与推广文档
├── start.sh                 # 一键启动前后端
└── stop.sh                  # 一键停止前后端
```

核心数据关系：

```text
worlds 1 ── N simulation_runs
simulation_runs 1 ── 1 reports
simulation_runs 1 ── N events / memories / interventions
simulation_runs 1 ── N chat_sessions
```

## 技术栈

后端：

- Python 3.10
- FastAPI
- psycopg 3
- PostgreSQL + JSONB
- CAMEL / OpenAI-compatible LLM client
- SSE 流式输出

前端：

- Next.js 16
- React 19
- TypeScript
- 原生 CSS / Tailwind v4 依赖
- EventSource / fetch

## 本地启动

### 1. 配置后端环境变量

后端读取 `backend/.env`：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/soulsim
LLM_API_KEY=你的 key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

`LLM_BASE_URL` 支持 OpenAI-compatible 服务。

### 2. 安装依赖

后端：

```bash
cd backend
python -m venv venv
./venv/bin/pip install -r requirements.txt
```

前端：

```bash
cd frontend
npm install
```

### 3. 初始化数据库

```bash
psql "$DATABASE_URL" -f backend/sql/schema.sql
psql "$DATABASE_URL" -f backend/sql/m4_chat.sql
psql "$DATABASE_URL" -f backend/sql/m5_intervention.sql
psql "$DATABASE_URL" -f backend/sql/m6_goal_progress.sql
psql "$DATABASE_URL" -f backend/sql/m7_chat_messages_cascade.sql
psql "$DATABASE_URL" -f backend/sql/m8_report_goal_assessment.sql
psql "$DATABASE_URL" -f backend/sql/m9_events_event_type.sql
psql "$DATABASE_URL" -f backend/sql/m10_world_baselines.sql
```

### 4. 启动服务

在项目根目录执行：

```bash
./start.sh
```

默认端口：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`
- 健康检查：`http://localhost:8000/health`

`./start.sh` 会同时监听本机和局域网地址，并在启动成功后打印可访问的局域网 URL，例如：

```text
局域网前端: http://192.168.1.23:3000
局域网后端: http://192.168.1.23:8000
```

同一局域网内的设备访问 `http://本机IP:3000` 即可打开前端，前端会请求同一 IP 的 `8000` 端口。需要手动指定 IP 或 API 地址时，可这样启动：

```bash
SOULSIM_HOST=192.168.1.23 ./start.sh
NEXT_PUBLIC_API_BASE=http://192.168.1.23:8000/api ./start.sh
```

停止服务：

```bash
./stop.sh
```

日志位置：

```text
logs/backend.log
logs/frontend.log
```

### Demo 回放模式

如果要发布或预览一个只依赖前端的体验站，可开启 Demo 模式启动前端：

```bash
cd frontend
NEXT_PUBLIC_DEMO_MODE=1 npm run dev -- --hostname 0.0.0.0
```

Demo 模式会在浏览器内回放一个内置的已完成世界，并模拟 API 响应和流式事件，不需要后端、数据库或 LLM 服务。

## 重要 API

World：

- `POST /api/worlds`
- `GET /api/worlds/{world_id}`
- `POST /api/worlds/{world_id}/build`
- `GET /api/worlds/{world_id}/agents`
- `GET /api/worlds/{world_id}/graph`
- `GET /api/worlds/{world_id}/runs`

Run：

- `POST /api/worlds/{world_id}/run`
- `POST /api/worlds/{world_id}/run/stream`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/resume/stream`

Report：

- `POST /api/runs/{run_id}/report`
- `POST /api/runs/{run_id}/report/stream`
- `GET /api/runs/{run_id}/report`

Chat：

- `GET /api/runs/{run_id}/chat-sessions`
- `POST /api/chat-sessions`
- `POST /api/group-chat-sessions`
- `GET /api/chat-sessions/{session_id}/messages`
- `POST /api/chat-sessions/{session_id}/messages`

## 文档

- [系统交接文档](docs/SYSTEM_OVERVIEW.md)：面向下一位接手项目的 AI / 工程师，包含架构、数据模型、核心流程、排障入口和后续优先级。
- [项目推广文档](docs/PROMOTION.md)：面向展示和传播，包含产品定位、核心价值、典型场景、演示流程和截图占位。

## 当前成熟度

当前版本已经具备完整 demo 闭环：

- 世界创建与构建
- Agent 生成与灵魂注入
- 知识图谱展示
- 多日模拟推演
- 多 run 推演记录
- 上帝干预与恢复
- 结构化报告
- 1v1 对话
- Report Agent 问答
- 多 Agent 群聊
- 管理后台基础能力

## 已知边界

- 老 world 如果是在 `world_baselines` 引入前构建的，启动新 run 会返回 `world baseline not found`。这是为了避免从历史末态错误重跑。
- 当前图谱仍是 world 当前态，不是严格的 run-level graph snapshot。历史 run 的日志、事件、报告和聊天已按 run 隔离，但图谱回放还不是完整历史快照。
- `resume_run_stream` 支持 running 重连，但后续仍建议增加 run-level worker lock，避免同一 run 被重复 worker 处理。

## Roadmap

短期：

- 增加历史 run 的图谱快照回放。
- 增强不同 run 的对比视图。
- 提供旧 world baseline 捕获工具。
- 补充自动化测试和 demo seed。

中期：

- 支持更多干预类型。
- 支持指标可视化和关系变化动画。
- 支持导出完整研究报告。
- 支持模板化场景库。

长期：

- 形成可复用的复杂系统模拟平台。
- 支持组织决策、社会议题、产品策略、教育研究、剧情创作等多领域场景。
- 提供 Agent 灵魂库和世界协议库。
