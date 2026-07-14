-- M10: world baseline snapshots for repeatable runs
-- Captures the ready-state world/agent/graph baseline after build so each new run can start cleanly.

CREATE TABLE IF NOT EXISTS world_baselines (
    world_id    text PRIMARY KEY REFERENCES worlds(world_id) ON DELETE CASCADE,
    world_state jsonb DEFAULT '{}'::jsonb,
    agents      jsonb DEFAULT '[]'::jsonb,
    graph_nodes jsonb DEFAULT '[]'::jsonb,
    graph_edges jsonb DEFAULT '[]'::jsonb,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);
