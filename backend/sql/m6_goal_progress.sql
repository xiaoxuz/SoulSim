-- M6: 事件生成注入推演目标 + 进度感知
-- events: 新增 goal_progress / next_focus，让 LLM 在生成事件时输出目标进度评估
ALTER TABLE events ADD COLUMN IF NOT EXISTS goal_progress text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS next_focus   text DEFAULT '';
