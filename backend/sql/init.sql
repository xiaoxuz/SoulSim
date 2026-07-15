-- SoulSim database initialization entrypoint.
-- Run this file from the project root:
--   psql "$DATABASE_URL" -f backend/sql/init.sql

\ir schema.sql
\ir m4_chat.sql
\ir m5_intervention.sql
\ir m6_goal_progress.sql
\ir m7_chat_messages_cascade.sql
\ir m8_report_goal_assessment.sql
\ir m9_events_event_type.sql
\ir m10_world_baselines.sql
