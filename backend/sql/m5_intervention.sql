-- M5: Intervention 上帝干预支持
-- simulation_runs: 新增暂停状态字段，支持 pause/resume 状态机
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS paused_at_step int;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS stage_summary jsonb DEFAULT '{}'::jsonb;

-- interventions 表已在 schema.sql 中定义，这里加索引便于按 run / world 查询
CREATE INDEX IF NOT EXISTS idx_interventions_run   ON interventions(run_id);
CREATE INDEX IF NOT EXISTS idx_interventions_world ON interventions(world_id);
CREATE INDEX IF NOT EXISTS idx_interventions_time  ON interventions(run_id, time_step);
