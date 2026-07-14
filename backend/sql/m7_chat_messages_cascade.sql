-- M7: Fix chat_messages.agent_id foreign key cascade
-- 根因: m4_chat.sql:15 加外键时漏了 ON DELETE 子句，默认 NO ACTION，
-- 导致删 world 时 worlds CASCADE 删 agents 被 chat_messages.agent_id 阻止。
-- 改成 ON DELETE SET NULL: 删 agent 时消息的 agent_id 置 NULL（消息本身通过
-- chat_sessions.world_id -> session_id 的 CASCADE 链已被清理，SET NULL 只解除阻止）。

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_agent_id_fkey;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE SET NULL;
