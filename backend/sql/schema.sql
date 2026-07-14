-- SoulSim 数据库 schema。对应 04-mvp/数据模型.md 的八个核心实体。
-- 嵌套结构统一用 JSONB；主键用 text（uuid 字符串），跨世界全局唯一。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS worlds (
    world_id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title             text,
    simulation_goal   text,
    seed_material     text,
    world_background  text,
    world_protocol    jsonb DEFAULT '{}'::jsonb,
    entity_graph      jsonb DEFAULT '{}'::jsonb,
    world_state       jsonb DEFAULT '{}'::jsonb,
    intervention_mode jsonb DEFAULT '{}'::jsonb,
    status            text  DEFAULT 'draft',
    created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_profiles (
    skill_profile_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    source_type      text,
    source_ref       text,
    identity         jsonb DEFAULT '{}'::jsonb,
    mental_models    jsonb DEFAULT '[]'::jsonb,
    decision_rules   jsonb DEFAULT '[]'::jsonb,
    expression_style jsonb DEFAULT '{}'::jsonb,
    values           jsonb DEFAULT '[]'::jsonb,
    anti_patterns    jsonb DEFAULT '[]'::jsonb,
    honesty_boundary text,
    provenance       jsonb DEFAULT '{}'::jsonb,
    raw_content      text,
    created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
    agent_id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    world_id               text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    name                   text,
    tier                   text DEFAULT 'core',
    role_type              text,
    skill_profile_id       text REFERENCES skill_profiles(skill_profile_id) ON DELETE SET NULL,
    birth_context          jsonb DEFAULT '{}'::jsonb,
    current_internal_state jsonb DEFAULT '{}'::jsonb,
    memory_summary         text DEFAULT '',
    is_active              boolean DEFAULT true,
    created_at             timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simulation_runs (
    run_id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    world_id           text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    status             text DEFAULT 'running',
    total_steps        int  DEFAULT 0,
    stop_reason        text,
    final_world_state  jsonb DEFAULT '{}'::jsonb,
    event_timeline     jsonb DEFAULT '[]'::jsonb,
    agent_memory_index jsonb DEFAULT '{}'::jsonb,
    relationship_graph jsonb DEFAULT '[]'::jsonb,
    relationship_series jsonb DEFAULT '[]'::jsonb,
    metric_series      jsonb DEFAULT '[]'::jsonb,
    raw_log            jsonb DEFAULT '[]'::jsonb,
    report_context     jsonb DEFAULT '{}'::jsonb,
    report_id          text,
    paused_at_step     int,
    pause_reason       text,
    stage_summary      jsonb DEFAULT '{}'::jsonb,
    started_at         timestamptz DEFAULT now(),
    finished_at        timestamptz
);

CREATE TABLE IF NOT EXISTS world_baselines (
    world_id    text PRIMARY KEY REFERENCES worlds(world_id) ON DELETE CASCADE,
    world_state jsonb DEFAULT '{}'::jsonb,
    agents      jsonb DEFAULT '[]'::jsonb,
    graph_nodes jsonb DEFAULT '[]'::jsonb,
    graph_edges jsonb DEFAULT '[]'::jsonb,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
    event_id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    world_id            text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    run_id              text REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
    time_step           int,
    title               text,
    event_type          text DEFAULT '',
    description         text,
    source              text,
    involved_entities   jsonb DEFAULT '[]'::jsonb,
    visible_to          jsonb DEFAULT '[]'::jsonb,
    impact_hints        text,
    uncertainty         real DEFAULT 0,
    from_intervention_id text,
    goal_progress       text DEFAULT '',
    next_focus          text DEFAULT '',
    created_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memories (
    memory_id        text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    agent_id         text NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    world_id         text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    run_id           text,
    memory_type      text,
    time_step        int,
    source_event_id  text,
    content          text,
    structured_delta jsonb DEFAULT '{}'::jsonb,
    is_subjective    boolean DEFAULT true,
    created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interventions (
    intervention_id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    world_id                  text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    run_id                    text REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
    time_step                 int,
    created_by                text DEFAULT 'human',
    intervention_type         text,
    target_scope              jsonb DEFAULT '{}'::jsonb,
    description               text,
    structured_patch          jsonb DEFAULT '{}'::jsonb,
    visible_to                jsonb DEFAULT '[]'::jsonb,
    expected_effect           text,
    actual_effect_after_resume text,
    resulting_event_id        text,
    created_at                timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
    report_id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    run_id               text REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
    story                jsonb DEFAULT '{}'::jsonb,
    executive_summary    jsonb DEFAULT '{}'::jsonb,
    goal_assessment      jsonb DEFAULT '{}'::jsonb,
    world_setup          jsonb DEFAULT '{}'::jsonb,
    timeline             jsonb DEFAULT '[]'::jsonb,
    agent_perspectives   jsonb DEFAULT '[]'::jsonb,
    relationship_changes jsonb DEFAULT '{}'::jsonb,
    metrics              jsonb DEFAULT '{}'::jsonb,
    key_drivers          jsonb DEFAULT '{}'::jsonb,
    evidence_map         jsonb DEFAULT '[]'::jsonb,
    intervention_impact  jsonb DEFAULT '{}'::jsonb,
    created_at           timestamptz DEFAULT now()
);

-- ---------- M3: 知识图谱 ----------

CREATE TABLE IF NOT EXISTS graph_ontology (
    ontology_id  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    world_id     text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE UNIQUE,
    entity_types jsonb DEFAULT '[]'::jsonb,
    edge_types   jsonb DEFAULT '[]'::jsonb,
    created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS graph_nodes (
    node_id      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    world_id     text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    name         text NOT NULL,
    entity_type  text NOT NULL,
    properties   jsonb DEFAULT '{}'::jsonb,
    summary      text DEFAULT '',
    first_seen   int DEFAULT 0,
    last_updated int DEFAULT 0,
    source       text DEFAULT 'seed',
    is_agent     boolean DEFAULT false,
    agent_id     text REFERENCES agents(agent_id) ON DELETE SET NULL,
    created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS graph_edges (
    edge_id      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    world_id     text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    source_node  text NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
    target_node  text NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
    relation     text NOT NULL,
    weight       real DEFAULT 0.5,
    properties   jsonb DEFAULT '{}'::jsonb,
    first_seen   int DEFAULT 0,
    last_updated int DEFAULT 0,
    source       text DEFAULT 'seed',
    created_at   timestamptz DEFAULT now()
);

-- ---------- M3: 聊天 ----------

CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    run_id          text NOT NULL REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
    world_id        text NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    session_type    text NOT NULL,
    target_agent_id text REFERENCES agents(agent_id) ON DELETE SET NULL,
    name            text DEFAULT '',
    max_rounds      int DEFAULT 3,
    created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_session_members (
    id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_id text NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    agent_id   text NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    UNIQUE(session_id, agent_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    message_id   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_id   text NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    role         text NOT NULL,
    content      text NOT NULL,
    metadata     jsonb DEFAULT '{}'::jsonb,
    agent_id     text REFERENCES agents(agent_id) ON DELETE SET NULL,
    agent_name   text DEFAULT '',
    created_at   timestamptz DEFAULT now()
);

-- ---------- indexes ----------

CREATE INDEX IF NOT EXISTS idx_agents_world     ON agents(world_id);
CREATE INDEX IF NOT EXISTS idx_events_run       ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_memories_agent   ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_world       ON simulation_runs(world_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_name_world ON graph_nodes(world_id, name);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type   ON graph_nodes(world_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node);
CREATE INDEX IF NOT EXISTS idx_graph_edges_triple ON graph_edges(world_id, source_node, target_node, relation);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
