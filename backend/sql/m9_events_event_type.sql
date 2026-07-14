-- M9: events 表加 event_type 列
-- 用于把 world_protocol.event_types 从 prompt 软约束变成可记录、可校验、可调试的结构化字段

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS event_type text DEFAULT '';
