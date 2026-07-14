-- M8: reports 表加 goal_assessment 列（目标达成评估章节）
-- 用于闭环：报告层回扣 simulation_goal，判断是否证明话题

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS goal_assessment jsonb DEFAULT '{}'::jsonb;
