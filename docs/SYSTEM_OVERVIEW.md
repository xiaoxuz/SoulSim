# SoulSim 系统交接文档

> 目标读者：下一位接手本项目的 AI / 工程师。本文不是推广文案，而是快速建立工程上下文的系统说明。

## 1. 项目一句话

SoulSim 是一个多 Agent 社会模拟工作台：用户输入一个世界种子和推演目标，系统自动构建世界、生成角色、注入角色灵魂、运行多日模拟、生成报告，并允许用户基于某一次推演结果与角色或报告进行深度互动。

核心体验是一条 5 步工作流：

1. 种子输入：输入世界背景、模拟目标、Agent 数量、推演天数。
2. 世界构建：LLM 生成世界协议、角色档案、知识图谱。
3. 模拟推演：多 Agent 按天感知事件、思考、发言、行动并更新世界状态。
4. 报告生成：基于某次推演生成结构化分析报告。
5. 深度互动：与单个 Agent、Report Agent 或多 Agent 群聊。

当前版本已经支持 `world -> simulation_runs` 一对多：同一个世界构建完成后可以多次推演，Step 2 显示推演记录列表，Step 3/4/5 都绑定当前选中的 run。

## 2. 技术栈

### 后端

- Python 3.10
- FastAPI
- psycopg 3
- PostgreSQL + JSONB
- CAMEL / OpenAI-compatible LLM client
- SSE 用于推演、报告和群聊流式输出

### 前端

- Next.js 16
- React 19
- TypeScript
- 原生 CSS / Tailwind v4 依赖
- EventSource / fetch 调用后端 API

### 端口

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`
- 后端健康检查：`http://localhost:8000/health`

## 3. 目录结构

```text
SoulSim/
├── backend/
│   ├── app/
│   │   ├── api/                 # FastAPI 路由：主业务 routes.py、管理后台 admin.py
│   │   ├── chat/                # 1v1、报告、群聊 Agent
│   │   ├── db/                  # 数据库连接
│   │   ├── engine/              # 世界构建、推演循环、Agent 感知/响应
│   │   ├── graph/               # 知识图谱构建、更新、工具调用
│   │   ├── llm/                 # LLM client 封装
│   │   ├── report/              # 报告生成器
│   │   ├── repositories/        # store.py 数据访问层
│   │   ├── soul/                # SkillProfile / 灵魂配置解析
│   │   ├── config.py            # 环境变量配置
│   │   └── main.py              # FastAPI app 入口
│   ├── sql/                     # schema.sql + migrations
│   └── requirements.txt
├── frontend/
│   ├── app/                     # Next.js App Router 页面
│   ├── components/              # 前端组件
│   ├── lib/                     # API client、导出 HTML、类型辅助
│   └── package.json
├── docs/                        # 项目文档
├── logs/                        # start.sh 运行日志
├── start.sh                     # 一键启动前后端
└── stop.sh                      # 一键停止前后端
```

## 4. 本地运行

### 4.1 环境变量

后端读取 `backend/.env`，配置类在 `backend/app/config.py`：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/soulsim
LLM_API_KEY=你的 key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

也可以用 OpenAI-compatible 服务，只要兼容 `/v1/chat/completions` 类接口。

### 4.2 安装依赖

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

### 4.3 初始化数据库

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

`schema.sql` 已尽量同步当前结构；migrations 仍建议执行，保证已有库和新库都对齐。

### 4.4 启动 / 停止

推荐在项目根目录执行：

```bash
./start.sh
./stop.sh
```

`start.sh` 会启动：

- 后端：`backend/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
- 前端：`npm run dev`

日志在：

```text
logs/backend.log
logs/frontend.log
```

## 5. 核心数据模型

### 5.1 主实体

- `worlds`：世界定义、背景、协议、当前世界状态。
- `skill_profiles`：角色灵魂配置，支持结构化字段和 `raw_content` 原始 SKILL 文本。
- `agents`：世界中的角色，包含 birth context、当前内部状态、记忆摘要。
- `simulation_runs`：一次推演记录。一个 world 可以有多条 run。
- `world_baselines`：世界构建完成后的基线快照，用于每次新 run 前恢复初始状态。
- `events`：推演中每天生成的事件。
- `memories`：Agent 在某次 run 中形成的记忆，带 `run_id`。
- `interventions`：上帝干预，带 `run_id` 和 `time_step`。
- `reports`：报告，按 `run_id` 绑定。
- `graph_nodes` / `graph_edges` / `graph_ontology`：世界知识图谱。
- `chat_sessions` / `chat_messages` / `chat_session_members`：1v1、Report Agent 和群聊。

### 5.2 world 与 run 的关系

当前关键设计：

```text
worlds 1 ── N simulation_runs
simulation_runs 1 ── 1 reports
simulation_runs 1 ── N chat_sessions
simulation_runs 1 ── N events / memories / interventions
```

`world_state`、`agents.current_internal_state`、`graph_nodes`、`graph_edges` 仍是 world 级当前态。为避免第二次推演继承第一次末态，系统在世界构建完成后保存 `world_baselines`，每次创建新 run 前先恢复 baseline。

### 5.3 baseline 保存内容

`world_baselines` 保存：

- `world_state`
- 每个 agent 的 `agent_id`、`current_internal_state`、`memory_summary`
- `graph_nodes` 完整字段，保留 `node_id`
- `graph_edges` 完整字段，保留 `edge_id/source_node/target_node`

新 run 启动走 `store.create_run_from_baseline(world_id)`：

1. `SELECT ... FOR UPDATE` 锁定 world 行。
2. 检查同 world 是否存在 `running` / `paused` run。
3. 读取 baseline；没有 baseline 则返回 `world baseline not found`。
4. 删除当前 graph nodes/edges。
5. 恢复 baseline graph、agent state、world state。
6. 创建新的 `simulation_runs` 记录。
7. 提交事务。

这一步必须保持原子性，不能退回到“路由层先检查再 reset 再 create”的非事务写法。

## 6. 后端关键流程

### 6.1 世界构建

入口：`backend/app/api/routes.py`

- `POST /api/worlds` 创建 draft world。
- `POST /api/worlds/{world_id}/build` 后台构建。
- `_build_world_task()` 负责实际构建。

构建顺序：

1. `store.reset_world_build_data(world_id)` 清理旧构建产物。
2. `builder.build_world()` 生成世界背景、协议、实体图。
3. `builder.build_agents()` 生成 Agent。
4. `store.update_world_build()` 写世界协议和背景。
5. `store.create_agents()` 写 Agent 和 SkillProfile。
6. `build_graph_from_seed()` 初始化知识图谱。
7. `store.update_world_state(world_id, {}, "ready")`。
8. `store.save_world_baseline(world_id)` 保存构建完成 baseline。

### 6.2 推演运行

入口：

- 非流式：`POST /api/worlds/{world_id}/run`
- SSE：`POST /api/worlds/{world_id}/run/stream`
- 恢复：`GET /api/runs/{run_id}/resume/stream`

主逻辑：`backend/app/engine/loop.py`

一天的主要过程：

1. 生成当天世界事件。
2. 每个 agent 感知事件。
3. `actor.respond()` 生成 thought、speech、action_detail、stance_delta、emotion_delta。
4. 写 event / memory。
5. 更新 world_state。
6. 更新知识图谱。
7. 保存 run progress。
8. 通过 SSE 推送日志和阶段状态。

`actor.respond()` 已支持 `run_id`，读取记忆时使用 `store.list_memories_for_run(run_id, agent_id)`，避免新 run 读取旧 run 记忆。

### 6.3 上帝干预 / 暂停恢复

相关表：`interventions`、`simulation_runs.paused_at_step`、`pause_reason`、`stage_summary`

相关 API 在 `routes.py` 后半部分。推演中可以暂停、写入干预、恢复。恢复已有 run 时不走 baseline reset；baseline 只用于创建全新 run。

### 6.4 报告生成

入口：

- `POST /api/runs/{run_id}/report`
- `POST /api/runs/{run_id}/report/stream`
- `GET /api/runs/{run_id}/report`

主逻辑：`backend/app/report/builder.py`

报告章节包括：

- `story`
- `executive_summary`
- `goal_assessment`
- `world_setup`
- `timeline`
- `agent_perspectives`
- `relationship_changes`
- `metrics`
- `key_drivers`
- `evidence_map`
- `intervention_impact`

报告按 `run_id` 绑定。前端切换 selected run 时会清空旧报告状态，并重新读取该 run 的报告。

### 6.5 深度互动

相关文件：

- `backend/app/chat/world_agent.py`：单 Agent 1v1。
- `backend/app/chat/report_agent.py`：报告问答。
- `backend/app/chat/group_agent.py`：多 Agent 群聊。

关键约束：

- chat session 必须绑定 `run_id`。
- `world_agent.py` 和 `group_agent.py` 读取 life history 时必须传 `session["run_id"]`，保证 memories 按 run 隔离。
- 关系图目前仍读取 world 当前图谱，不是历史 run 图谱快照。

## 7. 前端关键流程

主页面：`frontend/app/worlds/[id]/page.tsx`

### 7.1 5 步工作台

页面维护当前 step，并根据 world / selected run 状态展示不同区域：

1. Step 1：种子输入。
2. Step 2：世界构建结果、Agent 档案、灵魂注入、推演记录列表。
3. Step 3：selected run 的模拟推演日志和 timeline。
4. Step 4：selected run 的报告。
5. Step 5：selected run 的深度互动。

### 7.2 selected run 状态

关键状态：

```ts
const [runs, setRuns] = useState<any[]>([]);
const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
const [selectedRun, setSelectedRun] = useState<any>(null);
```

默认选择策略：

1. paused
2. running
3. 最近 finished
4. 最近 failed
5. 第一条 run

切换 run 走 `selectRun(runId, opts)`：

- 设置 `selectedRunId`
- `api.getRun(runId)` 加载完整 run
- `api.listInterventions(runId)` 加载干预
- 清理 report/chat/log/intervention 相关状态
- finished run 尝试加载 report
- 重建 Step 3 日志

### 7.3 Step 2 推演记录列表

Step 2 展示 `runs`：

- 状态：finished / failed / running / paused
- Run ID 简写
- 是否已生成报告
- 开始时间
- 完成天数 / 总天数
- pause 或 failed 原因
- 当前 selected run 高亮

“开始一次新推演”只在存在 `running` / `paused` run 时禁用；finished / failed 后允许再次启动。

### 7.4 Step 4 / Step 5 run 绑定

所有报告和聊天操作都必须使用 `selectedRun.run_id`：

- `api.getReport(selectedRun.run_id)`
- `connectReportStream(selectedRun.run_id)`
- `api.listRunChatSessions(selectedRun.run_id)`
- `api.createChatSession(selectedRun.run_id, ...)`
- `api.createGroupChatSession(selectedRun.run_id, ...)`

切换 run 时必须清理旧 report/chat cache，否则会串内容。

## 8. 重要 API 速查

### world

- `GET /api/worlds`
- `POST /api/worlds`
- `GET /api/worlds/{world_id}`
- `POST /api/worlds/{world_id}/build`
- `POST /api/worlds/{world_id}/rebuild`
- `GET /api/worlds/{world_id}/agents`
- `GET /api/worlds/{world_id}/graph`
- `GET /api/worlds/{world_id}/runs`

### run

- `POST /api/worlds/{world_id}/run`
- `POST /api/worlds/{world_id}/run/stream`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/resume/stream`

### report

- `POST /api/runs/{run_id}/report`
- `POST /api/runs/{run_id}/report/stream`
- `GET /api/runs/{run_id}/report`

### chat

- `GET /api/runs/{run_id}/chat-sessions`
- `POST /api/chat-sessions`
- `POST /api/group-chat-sessions`
- `GET /api/chat-sessions/{session_id}/messages`
- `POST /api/chat-sessions/{session_id}/messages`
- 群聊 SSE endpoint 在 `routes.py` 中查看 `group_agent.chat_stream` 相关调用。

### admin

管理后台路由在 `backend/app/api/admin.py`，用于通用表数据查看和管理。

## 9. 验证记录

最近一次收口验证结果：

- 后端修改文件 `py_compile` 通过。
- 前端 `npm run build` 通过。
- `/api/worlds` 返回 200。
- `/api/worlds/{world_id}/runs` 返回 200。
- 浏览器验证：
  - Step 2 可显示 3 条历史 run。
  - finished run 高亮 selected。
  - failed run 切换后显示推演出错，不串旧报告。
  - finished run 切回后 Step 3 恢复 3 天日志和 76 条系统日志。
  - Step 4 报告绑定 finished run。
  - Step 5 群聊 session 列表按 selected run 展示。
- code review 复核：
  - active run 并发竞态已通过 `create_run_from_baseline()` 原子事务修复。
  - world_agent / group_agent memories 已按 `session.run_id` 隔离。

## 10. 已知边界和后续建议

### 10.1 历史 world 没有 baseline

老 world 如果是在 `world_baselines` 引入前构建的，启动新 run 会返回：

```text
world baseline not found
```

这是安全兜底，避免从历史末态错误重跑。

可选后续：提供“将当前 ready 状态捕获为 baseline”的管理操作，但要明确这不是原始构建态。

### 10.2 图谱仍是 world 当前态

当前实现没有 run-level graph snapshot。影响：

- 左侧知识图谱显示的是 world 当前图谱。
- 重新生成旧 run 报告时，如果报告工具读取当前图谱，可能引用新 run 后的图谱。
- Agent chat 的 relations 仍来自当前 world graph。

如果要严格历史回放，需要新增：

- `simulation_runs.final_graph_snapshot`
- 或 run 级 graph tables
- 或 graph_nodes / graph_edges 增加 run_id 版本化

### 10.3 resume running 仍需谨慎

`resume_run_stream` 支持 paused / running / failed。running 场景主要用于前端刷新后重连，但如果用户重复触发，仍可能出现同一 run 多 worker 风险。后续可以增加 run-level worker lock 或 `simulation_runs.worker_token`。

### 10.4 LLM 输出稳定性

Agent 输出依赖 prompt 约束。当前 `actor.py` 强要求：

- thought / speech 第一人称。
- action_detail 第三人称旁观记录。
- 多 Agent 本轮行动不得互相冲突。
- SkillProfile 的 expression_style / anti_patterns / values 必须体现。

后续改 prompt 时要保留这些强约束，否则角色容易同质化。

## 11. 常见排障入口

### 后端启动失败

看：

```text
logs/backend.log
backend/app/config.py
backend/.env
```

常见原因：

- `DATABASE_URL` 错。
- PostgreSQL 未启动。
- migration 没执行，缺列。
- LLM key 或 base_url 错。

### 前端启动失败

看：

```text
logs/frontend.log
frontend/package.json
frontend/lib/api.ts
```

常见原因：

- 后端没启动。
- 3000 端口占用。
- Next.js build/type error。

### 推演卡住

看：

- `logs/backend.log`
- `backend/app/engine/loop.py`
- `backend/app/engine/actor.py`
- `simulation_runs.status / raw_log / paused_at_step / stop_reason`

### 报告不显示

看：

- `reports` 是否有对应 `run_id`
- `simulation_runs.report_id`
- 前端 selected run 是否正确
- `backend/app/report/builder.py`

### 聊天串内容

先查：

- `chat_sessions.run_id`
- 前端是否切换 run 后清理了 session cache
- `world_agent.py` / `group_agent.py` 是否传 `session["run_id"]` 给 `get_agent_life_history()`

## 12. 接手优先级建议

如果继续开发，建议优先级如下：

1. 做 run-level graph snapshot，解决历史 run 图谱回放和旧 run 报告重生成的严格一致性。
2. 给 `resume_run_stream` 增加 run-level worker lock，避免同一 run 重复 worker。
3. 给旧 world 提供 baseline 捕获/迁移工具。
4. 补自动化测试：store baseline reset、run selection、chat memory run isolation。
5. 补部署文档和生产环境配置。

## 13. 截图占位

以下位置适合后续补截图：

```text
[截图占位：SoulSim 首页]
[截图占位：5 步工作台总览]
[截图占位：Step 2 世界构建与推演记录列表]
[截图占位：Step 3 多 Agent 推演日志]
[截图占位：Step 4 推演报告]
[截图占位：Step 5 深度互动 / 群聊]
[截图占位：知识图谱节点详情]
```
