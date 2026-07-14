-- M4: Group chat support
-- chat_sessions: add name + max_rounds for group sessions
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS name text DEFAULT '';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS max_rounds int DEFAULT 3;

-- Group chat members
CREATE TABLE IF NOT EXISTS chat_session_members (
    id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_id text NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    agent_id   text NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    UNIQUE(session_id, agent_id)
);

-- chat_messages: add agent identity for group chat messages
-- agent_id 外键 ON DELETE SET NULL: 删 agent 时消息保留但发送者置空（消息本身会通过
-- chat_sessions.world_id -> session_id 的 CASCADE 链被清理，SET NULL 只解除阻止）。
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(agent_id) ON DELETE SET NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS agent_name text DEFAULT '';
