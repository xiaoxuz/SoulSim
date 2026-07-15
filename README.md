# SoulSim

[English](README.md) | [中文](README.zh-CN.md)

SoulSim is a multi-agent social simulation workspace. Give it a complex topic, and it builds a runnable world where agents with different positions, goals, and personalities interact, conflict, negotiate, and evolve in the same timeline. The system produces traceable process logs, structured reports, and follow-up conversations for deeper exploration.

It is useful for product strategy rehearsal, organizational decision simulation, public-opinion propagation modeling, story and worldbuilding, and multi-agent social behavior research.

![SoulSim home](docs/assets/index.jpg)

## Core Capabilities

- Automatically builds simulation scenes, agent profiles, and a knowledge graph from a world seed.
- Supports pasting `SKILL.md`-style soul profiles to strengthen agent personality consistency.
- Lets multiple agents perceive events, think, speak, act, and update the world state day by day.
- Supports multiple simulation runs under the same world, making comparative experiments easier.
- Stores logs, events, memories, interventions, reports, and chat records independently for each run.
- Supports god-mode interventions, pause and resume, structured reports, one-on-one character chat, Report Agent Q&A, and multi-agent group chat.

## 5-Step Workflow

### Step 1: Enter A Seed

Enter the world background, simulation goal, number of agents, and simulation days.

![Step 1 seed input](docs/assets/step1.jpg)

### Step 2: Build The World

The system automatically generates the world background, agent profiles, and knowledge graph, then shows the simulation run list for that world.

![Step 2 world build result and run list](docs/assets/step2.jpg)

### Step 3: Run The Simulation

Agents act day by day. The frontend displays simulation logs, stage status, and timeline updates through SSE.

![Step 3 multi-agent simulation logs](docs/assets/step3.jpg)

### Step 4: Generate A Report

Generate a structured report for the selected run, including narrative recap, executive summary, goal assessment, character perspectives, relationship changes, metric changes, key drivers, and evidence mapping.

![Step 4 structured report](docs/assets/step4.jpg)

### Step 5: Explore Further

Continue asking questions based on the selected run through one-on-one character chat, Report Agent chat, or multi-agent group chat.

![Step 5 character and report interaction](docs/assets/step5-1.jpg)

![Step 5 multi-agent group chat](docs/assets/step5-2.jpg)

## Architecture Overview

```text
SoulSim/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── api/             # API routes and admin backend
│   │   ├── chat/            # 1v1, report Q&A, and group-chat agents
│   │   ├── engine/          # World building and multi-agent simulation loop
│   │   ├── graph/           # Knowledge graph building and updates
│   │   ├── llm/             # LLM client wrapper
│   │   ├── report/          # Report generation
│   │   └── repositories/    # Data access layer
│   └── sql/                 # Schema and migrations
├── frontend/                # Next.js frontend
│   ├── app/                 # App Router pages
│   ├── components/          # UI components
│   └── lib/                 # API client and type helpers
├── docs/                    # System and promotion docs
├── start.sh                 # One-command frontend/backend startup
└── stop.sh                  # One-command frontend/backend shutdown
```

Core data relationships:

```text
worlds 1 ── N simulation_runs
simulation_runs 1 ── 1 reports
simulation_runs 1 ── N events / memories / interventions
simulation_runs 1 ── N chat_sessions
```

## Tech Stack

Backend:

- Python 3.10
- FastAPI
- psycopg 3
- PostgreSQL + JSONB
- CAMEL / OpenAI-compatible LLM client
- SSE streaming output

Frontend:

- Next.js 16
- React 19
- TypeScript
- Native CSS / Tailwind v4 dependencies
- EventSource / fetch

## Local Setup

### 1. Configure Backend Environment Variables

The backend reads `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/soulsim
LLM_API_KEY=your key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

`LLM_BASE_URL` supports OpenAI-compatible services.

### 2. Install Dependencies

Backend:

```bash
cd backend
python -m venv venv
./venv/bin/pip install -r requirements.txt
```

Frontend:

```bash
cd frontend
npm install
```

### 3. Initialize The Database

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

### 4. Start Services

Run from the project root:

```bash
./start.sh
```

Default ports:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Health check: `http://localhost:8000/health`

`./start.sh` listens on both local and LAN addresses, then prints the reachable LAN URLs after startup, for example:

```text
LAN frontend: http://192.168.1.23:3000
LAN backend: http://192.168.1.23:8000
```

Devices on the same LAN can open `http://your-machine-ip:3000`. The frontend will request the same IP on port `8000`. To specify the IP or API URL manually:

```bash
SOULSIM_HOST=192.168.1.23 ./start.sh
NEXT_PUBLIC_API_BASE=http://192.168.1.23:8000/api ./start.sh
```

Stop services:

```bash
./stop.sh
```

Logs:

```text
logs/backend.log
logs/frontend.log
```

### Demo Replay Mode

To publish or preview a frontend-only experience site, run the frontend with demo mode enabled:

```bash
cd frontend
NEXT_PUBLIC_DEMO_MODE=1 npm run dev -- --hostname 0.0.0.0
```

In demo mode, the workbench replays a built-in completed world and simulates API responses and streaming events in the browser. It does not require the backend, database, or LLM service.

## Important APIs

World:

- `POST /api/worlds`
- `GET /api/worlds/{world_id}`
- `POST /api/worlds/{world_id}/build`
- `GET /api/worlds/{world_id}/agents`
- `GET /api/worlds/{world_id}/graph`
- `GET /api/worlds/{world_id}/runs`

Run:

- `POST /api/worlds/{world_id}/run`
- `POST /api/worlds/{world_id}/run/stream`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/resume/stream`

Report:

- `POST /api/runs/{run_id}/report`
- `POST /api/runs/{run_id}/report/stream`
- `GET /api/runs/{run_id}/report`

Chat:

- `GET /api/runs/{run_id}/chat-sessions`
- `POST /api/chat-sessions`
- `POST /api/group-chat-sessions`
- `GET /api/chat-sessions/{session_id}/messages`
- `POST /api/chat-sessions/{session_id}/messages`

## Documentation

- [System handoff document](docs/SYSTEM_OVERVIEW.md): for the next AI or engineer taking over the project, covering architecture, data model, core flows, troubleshooting entry points, and follow-up priorities.
- [Promotion document](docs/PROMOTION.md): for product presentation and sharing, covering positioning, core value, typical scenarios, demo flow, and screenshot placeholders.

## Current Maturity

The current version provides a complete demo loop:

- World creation and building
- Agent generation and soul injection
- Knowledge graph display
- Multi-day simulation runs
- Multiple run records
- God-mode interventions and resume
- Structured reports
- One-on-one chat
- Report Agent Q&A
- Multi-agent group chat
- Basic admin backend

## Known Boundaries

- Older worlds built before `world_baselines` was introduced will return `world baseline not found` when starting a new run. This prevents rerunning from an incorrect historical end state.
- The current graph is still the world's current-state graph, not a strict run-level graph snapshot. Logs, events, reports, and chats are isolated by run, but graph replay is not yet a complete historical snapshot.
- `resume_run_stream` supports reconnecting to a running simulation, but a run-level worker lock is still recommended to avoid duplicate workers processing the same run.

## Roadmap

Short term:

- Add historical run graph snapshot replay.
- Improve comparison views across runs.
- Provide a baseline capture tool for old worlds.
- Add automated tests and demo seeds.

Medium term:

- Support more intervention types.
- Support metric visualizations and relationship-change animations.
- Support exporting complete research reports.
- Support templated scenario libraries.

Long term:

- Become a reusable complex-system simulation platform.
- Support organization decisions, social issues, product strategy, education research, story creation, and more domains.
- Provide an agent soul library and world protocol library.
