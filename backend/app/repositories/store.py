"""M1 数据访问层。集中八实体的最小 CRUD，psycopg 直连，dict 出入。"""
from typing import Any

from psycopg.types.json import Json

from app.db.session import get_conn


def _json(v: Any) -> Json:
    return Json(v if v is not None else {})


# ---------- worlds ----------

def create_world(title: str, simulation_goal: str, seed_material: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO worlds (title, simulation_goal, seed_material, status)
               VALUES (%s, %s, %s, 'draft') RETURNING *""",
            (title, simulation_goal, seed_material),
        ).fetchone()
        conn.commit()
        return row


def get_world(world_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM worlds WHERE world_id = %s", (world_id,)
        ).fetchone()


def list_worlds() -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT world_id, title, simulation_goal, status, created_at "
            "FROM worlds ORDER BY created_at DESC"
        ).fetchall()


def update_world_build(
    world_id: str,
    world_protocol: dict,
    entity_graph: dict,
    world_background: str,
    status: str = "ready",
) -> None:
    with get_conn() as conn:
        conn.execute(
            """UPDATE worlds
               SET world_protocol = %s, entity_graph = %s,
                   world_background = %s, status = %s
               WHERE world_id = %s""",
            (_json(world_protocol), _json(entity_graph), world_background, status, world_id),
        )
        conn.commit()


def update_world_state(world_id: str, world_state: dict, status: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE worlds SET world_state = %s, status = %s WHERE world_id = %s",
            (_json(world_state), status, world_id),
        )
        conn.commit()


def reset_world_build_data(world_id: str) -> None:
    """清理世界的构建产物（agents / graph / world_background / world_state）。
    用于重建场景：保证 _build_world_task 等价于首次构建，避免残留数据导致重复 INSERT。
    保留 world_protocol 中的 agent_count/simulation_days（构建参数），以便构建失败时前端仍能回填表单。"""
    with get_conn() as conn:
        conn.execute("DELETE FROM agents WHERE world_id = %s", (world_id,))
        conn.execute("DELETE FROM graph_edges WHERE world_id = %s", (world_id,))
        conn.execute("DELETE FROM graph_nodes WHERE world_id = %s", (world_id,))
        conn.execute("DELETE FROM graph_ontology WHERE world_id = %s", (world_id,))
        conn.execute("DELETE FROM world_baselines WHERE world_id = %s", (world_id,))
        conn.execute(
            """UPDATE worlds
               SET world_background = NULL, world_state = '{}'::jsonb
               WHERE world_id = %s""",
            (world_id,),
        )
        conn.commit()


def save_world_baseline(world_id: str) -> None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT
                   COALESCE(w.world_state, '{}'::jsonb) AS world_state,
                   COALESCE((
                       SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
                       FROM (
                           SELECT agent_id, current_internal_state, memory_summary, created_at
                           FROM agents WHERE world_id = %s
                       ) a
                   ), '[]'::jsonb) AS agents,
                   COALESCE((
                       SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at)
                       FROM (
                           SELECT node_id, world_id, name, entity_type, properties, summary,
                                  first_seen, last_updated, source, is_agent, agent_id, created_at
                           FROM graph_nodes WHERE world_id = %s
                       ) n
                   ), '[]'::jsonb) AS graph_nodes,
                   COALESCE((
                       SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
                       FROM (
                           SELECT edge_id, world_id, source_node, target_node, relation, weight,
                                  properties, first_seen, last_updated, source, created_at
                           FROM graph_edges WHERE world_id = %s
                       ) e
                   ), '[]'::jsonb) AS graph_edges
               FROM worlds w WHERE w.world_id = %s""",
            (world_id, world_id, world_id, world_id),
        ).fetchone()
        if not row:
            raise ValueError("world not found")
        conn.execute(
            """INSERT INTO world_baselines (world_id, world_state, agents, graph_nodes, graph_edges)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (world_id) DO UPDATE
               SET world_state = EXCLUDED.world_state,
                   agents = EXCLUDED.agents,
                   graph_nodes = EXCLUDED.graph_nodes,
                   graph_edges = EXCLUDED.graph_edges,
                   updated_at = now()""",
            (world_id, Json(row["world_state"]), Json(row["agents"]), Json(row["graph_nodes"]), Json(row["graph_edges"])),
        )
        conn.commit()


def reset_world_to_baseline(world_id: str) -> None:
    with get_conn() as conn:
        baseline = conn.execute(
            "SELECT * FROM world_baselines WHERE world_id = %s",
            (world_id,),
        ).fetchone()
        if not baseline:
            raise ValueError("world baseline not found")

        conn.execute("DELETE FROM graph_edges WHERE world_id = %s", (world_id,))
        conn.execute("DELETE FROM graph_nodes WHERE world_id = %s", (world_id,))
        conn.execute(
            """INSERT INTO graph_nodes
               (node_id, world_id, name, entity_type, properties, summary, first_seen,
                last_updated, source, is_agent, agent_id, created_at)
               SELECT node_id, world_id, name, entity_type, properties, summary, first_seen,
                      last_updated, source, is_agent, agent_id, created_at
               FROM jsonb_to_recordset(%s::jsonb) AS n(
                   node_id text, world_id text, name text, entity_type text, properties jsonb,
                   summary text, first_seen int, last_updated int, source text,
                   is_agent boolean, agent_id text, created_at timestamptz
               )""",
            (Json(baseline["graph_nodes"]),),
        )
        conn.execute(
            """INSERT INTO graph_edges
               (edge_id, world_id, source_node, target_node, relation, weight, properties,
                first_seen, last_updated, source, created_at)
               SELECT edge_id, world_id, source_node, target_node, relation, weight, properties,
                      first_seen, last_updated, source, created_at
               FROM jsonb_to_recordset(%s::jsonb) AS e(
                   edge_id text, world_id text, source_node text, target_node text,
                   relation text, weight real, properties jsonb, first_seen int,
                   last_updated int, source text, created_at timestamptz
               )""",
            (Json(baseline["graph_edges"]),),
        )
        conn.execute(
            """UPDATE agents a
               SET current_internal_state = b.current_internal_state,
                   memory_summary = b.memory_summary
               FROM jsonb_to_recordset(%s::jsonb) AS b(
                   agent_id text, current_internal_state jsonb, memory_summary text, created_at timestamptz
               )
               WHERE a.agent_id = b.agent_id AND a.world_id = %s""",
            (Json(baseline["agents"]), world_id),
        )
        conn.execute(
            "UPDATE worlds SET world_state = %s, status = 'ready' WHERE world_id = %s",
            (Json(baseline["world_state"]), world_id),
        )
        conn.commit()


def update_intervention_mode(world_id: str, mode: dict) -> None:
    """更新世界的上帝干预配置。"""
    with get_conn() as conn:
        conn.execute(
            "UPDATE worlds SET intervention_mode = %s WHERE world_id = %s",
            (_json(mode), world_id),
        )
        conn.commit()


# ---------- skill_profiles ----------

def create_skill_profile(sp: dict) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO skill_profiles
               (source_type, source_ref, identity, mental_models, decision_rules,
                expression_style, values, anti_patterns, honesty_boundary, provenance, raw_content)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (
                sp.get("source_type", "generated"),
                sp.get("source_ref", ""),
                _json(sp.get("identity")),
                Json(sp.get("mental_models", [])),
                Json(sp.get("decision_rules", [])),
                _json(sp.get("expression_style")),
                Json(sp.get("values", [])),
                Json(sp.get("anti_patterns", [])),
                sp.get("honesty_boundary", ""),
                Json(sp.get("provenance", [])),
                sp.get("raw_content"),
            ),
        ).fetchone()
        conn.commit()
        return row


def get_skill_profile(skill_profile_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM skill_profiles WHERE skill_profile_id = %s",
            (skill_profile_id,),
        ).fetchone()


# ---------- agents ----------

def create_agents(world_id: str, agents: list[dict]) -> list[dict]:
    out = []
    with get_conn() as conn:
        for a in agents:
            sp = a.get("skill_profile")
            sp_id = None
            if sp:
                sp_row = conn.execute(
                    """INSERT INTO skill_profiles
                       (source_type, source_ref, identity, mental_models, decision_rules,
                        expression_style, values, anti_patterns, honesty_boundary, provenance, raw_content)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING skill_profile_id""",
                    (
                        sp.get("source_type", "generated"),
                        sp.get("source_ref", ""),
                        _json(sp.get("identity")),
                        Json(sp.get("mental_models", [])),
                        Json(sp.get("decision_rules", [])),
                        _json(sp.get("expression_style")),
                        Json(sp.get("values", [])),
                        Json(sp.get("anti_patterns", [])),
                        sp.get("honesty_boundary", ""),
                        Json(sp.get("provenance", [])),
                        sp.get("raw_content"),
                    ),
                ).fetchone()
                sp_id = sp_row["skill_profile_id"]

            row = conn.execute(
                """INSERT INTO agents
                   (world_id, name, tier, role_type, skill_profile_id, birth_context, current_internal_state)
                   VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (
                    world_id,
                    a.get("name"),
                    a.get("tier", "core"),
                    a.get("role_type"),
                    sp_id,
                    _json(a.get("birth_context")),
                    _json(a.get("current_internal_state")),
                ),
            ).fetchone()
            out.append(row)
        conn.commit()
    return out


def list_agents(world_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM agents WHERE world_id = %s ORDER BY created_at", (world_id,)
        ).fetchall()


def get_agent_with_soul(agent_id: str) -> dict | None:
    """查询 agent 并附加其 SkillProfile（灵魂）。"""
    with get_conn() as conn:
        agent = conn.execute(
            "SELECT * FROM agents WHERE agent_id = %s", (agent_id,)
        ).fetchone()
        if not agent:
            return None
        if agent.get("skill_profile_id"):
            sp = conn.execute(
                "SELECT * FROM skill_profiles WHERE skill_profile_id = %s",
                (agent["skill_profile_id"],),
            ).fetchone()
            agent["skill_profile"] = dict(sp) if sp else None
        else:
            agent["skill_profile"] = None
        return agent


def list_agents_with_soul(world_id: str, *, include_raw: bool = False) -> list[dict]:
    """查询世界的所有 agent 并附加 SkillProfile。"""
    with get_conn() as conn:
        if include_raw:
            sql = """SELECT a.*, row_to_json(sp.*) as skill_profile
                     FROM agents a
                     LEFT JOIN skill_profiles sp ON a.skill_profile_id = sp.skill_profile_id
                     WHERE a.world_id = %s ORDER BY a.created_at"""
        else:
            sql = """SELECT a.*,
                     (SELECT row_to_json(t) FROM (
                       SELECT sp.skill_profile_id, sp.source_type, sp.source_ref,
                              sp.identity, sp.mental_models, sp.decision_rules,
                              sp.expression_style, sp.values, sp.anti_patterns,
                              sp.honesty_boundary, sp.provenance, sp.created_at,
                              CASE WHEN sp.raw_content IS NOT NULL AND length(sp.raw_content) > 0
                                   THEN length(sp.raw_content) ELSE 0 END as raw_content_length
                       FROM skill_profiles sp WHERE sp.skill_profile_id = a.skill_profile_id
                     ) t) as skill_profile
                     FROM agents a WHERE a.world_id = %s ORDER BY a.created_at"""
        agents = conn.execute(sql, (world_id,)).fetchall()
        return agents


def bind_skill_profile(agent_id: str, skill_profile_id: str) -> dict | None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE agents SET skill_profile_id = %s WHERE agent_id = %s",
            (skill_profile_id, agent_id),
        )
        conn.commit()
        return get_agent_with_soul(agent_id)


def list_skill_profiles() -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM skill_profiles ORDER BY created_at DESC"
        ).fetchall()


def update_agent_state(agent_id: str, internal_state: dict, memory_summary: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE agents SET current_internal_state = %s, memory_summary = %s WHERE agent_id = %s",
            (_json(internal_state), memory_summary, agent_id),
        )
        conn.commit()


# ---------- simulation_runs ----------

def create_run(world_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO simulation_runs (world_id, status) VALUES (%s, 'running') RETURNING *",
            (world_id,),
        ).fetchone()
        conn.commit()
        return row


def create_run_from_baseline(world_id: str) -> dict:
    with get_conn() as conn:
        world = conn.execute(
            "SELECT world_id FROM worlds WHERE world_id = %s FOR UPDATE",
            (world_id,),
        ).fetchone()
        if not world:
            raise ValueError("world not found")

        active = conn.execute(
            """SELECT 1 FROM simulation_runs
               WHERE world_id = %s AND status IN ('running', 'paused')
               LIMIT 1""",
            (world_id,),
        ).fetchone()
        if active:
            raise ValueError("world has active run; finish or resume it before starting a new run")

        baseline = conn.execute(
            "SELECT * FROM world_baselines WHERE world_id = %s",
            (world_id,),
        ).fetchone()
        if not baseline:
            raise ValueError("world baseline not found")

        conn.execute("DELETE FROM graph_edges WHERE world_id = %s", (world_id,))
        conn.execute("DELETE FROM graph_nodes WHERE world_id = %s", (world_id,))
        conn.execute(
            """INSERT INTO graph_nodes
               (node_id, world_id, name, entity_type, properties, summary, first_seen,
                last_updated, source, is_agent, agent_id, created_at)
               SELECT node_id, world_id, name, entity_type, properties, summary, first_seen,
                      last_updated, source, is_agent, agent_id, created_at
               FROM jsonb_to_recordset(%s::jsonb) AS n(
                   node_id text, world_id text, name text, entity_type text, properties jsonb,
                   summary text, first_seen int, last_updated int, source text,
                   is_agent boolean, agent_id text, created_at timestamptz
               )""",
            (Json(baseline["graph_nodes"]),),
        )
        conn.execute(
            """INSERT INTO graph_edges
               (edge_id, world_id, source_node, target_node, relation, weight, properties,
                first_seen, last_updated, source, created_at)
               SELECT edge_id, world_id, source_node, target_node, relation, weight, properties,
                      first_seen, last_updated, source, created_at
               FROM jsonb_to_recordset(%s::jsonb) AS e(
                   edge_id text, world_id text, source_node text, target_node text,
                   relation text, weight real, properties jsonb, first_seen int,
                   last_updated int, source text, created_at timestamptz
               )""",
            (Json(baseline["graph_edges"]),),
        )
        conn.execute(
            """UPDATE agents a
               SET current_internal_state = b.current_internal_state,
                   memory_summary = b.memory_summary
               FROM jsonb_to_recordset(%s::jsonb) AS b(
                   agent_id text, current_internal_state jsonb, memory_summary text, created_at timestamptz
               )
               WHERE a.agent_id = b.agent_id AND a.world_id = %s""",
            (Json(baseline["agents"]), world_id),
        )
        conn.execute(
            "UPDATE worlds SET world_state = %s, status = 'ready' WHERE world_id = %s",
            (Json(baseline["world_state"]), world_id),
        )
        row = conn.execute(
            "INSERT INTO simulation_runs (world_id, status) VALUES (%s, 'running') RETURNING *",
            (world_id,),
        ).fetchone()
        conn.commit()
        return row


def list_runs(world_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            """SELECT run_id, world_id, status, total_steps, stop_reason,
                      paused_at_step, pause_reason, report_id, started_at, finished_at,
                      jsonb_array_length(COALESCE(raw_log, '[]'::jsonb)) AS completed_steps
               FROM simulation_runs
               WHERE world_id = %s
               ORDER BY started_at DESC""",
            (world_id,),
        ).fetchall()


def has_active_run(world_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT 1 FROM simulation_runs
               WHERE world_id = %s AND status IN ('running', 'paused')
               LIMIT 1""",
            (world_id,),
        ).fetchone()
        return bool(row)


def get_run(run_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM simulation_runs WHERE run_id = %s", (run_id,)
        ).fetchone()


def fail_run(run_id: str, error: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE simulation_runs SET status = 'failed', stop_reason = %s, finished_at = now() WHERE run_id = %s",
            (error, run_id),
        )
        conn.commit()


def finish_run(
    run_id: str,
    total_steps: int,
    stop_reason: str,
    final_world_state: dict,
    event_timeline: list,
    relationship_graph: list,
    relationship_series: list,
    metric_series: list,
    raw_log: list,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """UPDATE simulation_runs
               SET status = 'finished', total_steps = %s, stop_reason = %s,
                   final_world_state = %s, event_timeline = %s,
                   relationship_graph = %s, relationship_series = %s,
                   metric_series = %s, raw_log = %s, finished_at = now()
               WHERE run_id = %s""",
            (
                total_steps, stop_reason, _json(final_world_state),
                Json(event_timeline), Json(relationship_graph),
                Json(relationship_series), Json(metric_series), Json(raw_log), run_id,
            ),
        )
        conn.commit()


def reset_world_runs(world_id: str) -> dict:
    """清空世界的所有推演产物，保留构建产物（agents / graph / protocol / background）。
    用于让世界回到「已构建未推演」状态，可重新跑推演。

    CASCADE 自动带走 events / interventions / reports / chat_sessions / chat_messages。
    memories.run_id 无外键，单独清。
    重置 world_state 和 status。"""
    with get_conn() as conn:
        conn.execute("DELETE FROM simulation_runs WHERE world_id = %s", (world_id,))
        conn.execute("DELETE FROM memories WHERE world_id = %s", (world_id,))
        conn.execute(
            """UPDATE worlds
               SET world_state = '{}'::jsonb, status = 'ready'
               WHERE world_id = %s""",
            (world_id,),
        )
        conn.commit()
    return {"world_id": world_id, "cleared": ["simulation_runs", "events", "memories", "interventions", "reports", "chat_sessions", "chat_messages"]}


def reset_world_reports(world_id: str) -> dict:
    """清空世界所有 run 的报告，保留推演产物（events / memories / raw_log 等）。
    用于重新生成报告。simulation_runs.report_id 也清空。"""
    with get_conn() as conn:
        conn.execute(
            """DELETE FROM reports USING simulation_runs
               WHERE reports.run_id = simulation_runs.run_id
                 AND simulation_runs.world_id = %s""",
            (world_id,),
        )
        conn.execute(
            """UPDATE simulation_runs
               SET report_id = NULL
               WHERE world_id = %s""",
            (world_id,),
        )
        conn.commit()
    return {"world_id": world_id, "cleared": ["reports"]}


# ---------- run status / progress (M5 intervention) ----------

def update_run_status(
    run_id: str,
    status: str,
    paused_at_step: int | None = None,
    pause_reason: str | None = None,
    stage_summary: dict | None = None,
) -> None:
    """更新 run 状态。支持 paused / running / finished / failed。
    paused_at_step、pause_reason、stage_summary 传 None 时不动。"""
    sets = ["status = %s"]
    params: list = [status]
    if paused_at_step is not None:
        sets.append("paused_at_step = %s")
        params.append(paused_at_step)
    if pause_reason is not None:
        sets.append("pause_reason = %s")
        params.append(pause_reason)
    if stage_summary is not None:
        sets.append("stage_summary = %s")
        params.append(Json(stage_summary))
    if status == "running":
        sets.append("pause_reason = NULL")
    params.append(run_id)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE simulation_runs SET {', '.join(sets)} WHERE run_id = %s",
            tuple(params),
        )
        conn.commit()


def save_run_progress(
    run_id: str,
    total_steps: int,
    raw_log: list,
    event_timeline: list,
    metric_series: list,
    relationship_series: list,
) -> None:
    """增量保存推演进度（每天结束或暂停时调用）。"""
    with get_conn() as conn:
        conn.execute(
            """UPDATE simulation_runs
               SET total_steps = %s, raw_log = %s, event_timeline = %s,
                   metric_series = %s, relationship_series = %s
               WHERE run_id = %s""",
            (total_steps, Json(raw_log), Json(event_timeline),
             Json(metric_series), Json(relationship_series), run_id),
        )
        conn.commit()


def load_run_progress(run_id: str) -> dict | None:
    """加载历史推演进度（恢复时调用）。"""
    with get_conn() as conn:
        return conn.execute(
            """SELECT run_id, world_id, status, total_steps, paused_at_step,
                      pause_reason, stage_summary, raw_log, event_timeline,
                      metric_series, relationship_series, final_world_state
               FROM simulation_runs WHERE run_id = %s""",
            (run_id,),
        ).fetchone()


# ---------- interventions ----------

def create_intervention(
    world_id: str,
    run_id: str,
    time_step: int,
    intervention_type: str,
    description: str,
    target_scope: dict | None = None,
    structured_patch: dict | None = None,
    visible_to: list | None = None,
    expected_effect: str = "",
    created_by: str = "human",
) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO interventions
               (world_id, run_id, time_step, created_by, intervention_type,
                target_scope, description, structured_patch, visible_to, expected_effect)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (world_id, run_id, time_step, created_by, intervention_type,
             Json(target_scope or {}), description, Json(structured_patch or {}),
             Json(visible_to or []), expected_effect),
        ).fetchone()
        conn.commit()
        return row


def list_interventions(run_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM interventions WHERE run_id = %s ORDER BY time_step ASC, created_at ASC",
            (run_id,),
        ).fetchall()


def get_intervention(intervention_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM interventions WHERE intervention_id = %s",
            (intervention_id,),
        ).fetchone()


def update_intervention_result(
    intervention_id: str,
    actual_effect: str,
    resulting_event_id: str | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """UPDATE interventions
               SET actual_effect_after_resume = %s, resulting_event_id = %s
               WHERE intervention_id = %s""",
            (actual_effect, resulting_event_id, intervention_id),
        )
        conn.commit()


# ---------- events ----------

def create_event(run_id: str, world_id: str, event: dict) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO events
               (world_id, run_id, time_step, title, event_type, description, source, involved_entities, visible_to, impact_hints, goal_progress, next_focus)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (
                world_id, run_id, event.get("time_step"), event.get("title"), event.get("event_type", ""),
                event.get("description"), event.get("source", "runtime"),
                _json(event.get("involved_entities", [])), _json(event.get("visible_to", [])),
                event.get("impact_hints"),
                event.get("goal_progress", ""),
                event.get("next_focus", ""),
            ),
        ).fetchone()
        conn.commit()
        return row


def list_events(run_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM events WHERE run_id = %s ORDER BY time_step, created_at", (run_id,)
        ).fetchall()


# ---------- memories ----------

def create_memories(memories: list[dict]) -> None:
    with get_conn() as conn:
        for m in memories:
            conn.execute(
                """INSERT INTO memories
                   (agent_id, world_id, run_id, memory_type, time_step, source_event_id, content, structured_delta, is_subjective)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    m["agent_id"], m["world_id"], m.get("run_id"), m.get("memory_type"),
                    m.get("time_step"), m.get("source_event_id"), m.get("content"),
                    _json(m.get("structured_delta")), m.get("is_subjective", True),
                ),
            )
        conn.commit()


def list_memories(agent_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM memories WHERE agent_id = %s ORDER BY time_step, created_at", (agent_id,)
        ).fetchall()


# ---------- reports ----------

def create_report(run_id: str, report: dict) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO reports
               (run_id, story, executive_summary, world_setup, timeline, agent_perspectives,
                relationship_changes, metrics, key_drivers, evidence_map, intervention_impact)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (
                run_id, _json(report.get("story")), _json(report.get("executive_summary")),
                _json(report.get("world_setup")), Json(report.get("timeline", [])),
                Json(report.get("agent_perspectives", [])), _json(report.get("relationship_changes")),
                _json(report.get("metrics")), Json(report.get("key_drivers", [])),
                Json(report.get("evidence_map", [])), _json(report.get("intervention_impact")),
            ),
        ).fetchone()
        conn.execute(
            "UPDATE simulation_runs SET report_id = %s WHERE run_id = %s",
            (row["report_id"], run_id),
        )
        conn.commit()
        return row


def get_report_by_run(run_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM reports WHERE run_id = %s ORDER BY created_at DESC LIMIT 1", (run_id,)
        ).fetchone()


_REPORT_SECTION_COLUMNS = {
    "story", "executive_summary", "goal_assessment", "world_setup", "timeline", "agent_perspectives",
    "relationship_changes", "metrics", "key_drivers", "evidence_map", "intervention_impact",
}


def update_report_section(report_id: str, section_key: str, section_data) -> None:
    """增量更新报告某个章节字段。section_key 必须在白名单内（防 SQL 注入）。"""
    if section_key not in _REPORT_SECTION_COLUMNS:
        raise ValueError(f"invalid section_key: {section_key}")
    with get_conn() as conn:
        conn.execute(
            f"UPDATE reports SET {section_key} = %s WHERE report_id = %s",
            (_json(section_data), report_id),
        )
        conn.commit()


# ---------- graph_ontology ----------

def create_ontology(world_id: str, entity_types: list, edge_types: list) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO graph_ontology (world_id, entity_types, edge_types)
               VALUES (%s, %s, %s)
               ON CONFLICT (world_id) DO UPDATE
               SET entity_types = EXCLUDED.entity_types, edge_types = EXCLUDED.edge_types
               RETURNING *""",
            (world_id, Json(entity_types), Json(edge_types)),
        ).fetchone()
        conn.commit()
        return row


def get_ontology(world_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM graph_ontology WHERE world_id = %s", (world_id,)
        ).fetchone()


# ---------- graph_nodes ----------

def upsert_node(
    world_id: str, name: str, entity_type: str, *,
    properties: dict | None = None, summary: str = "",
    time_step: int = 0, source: str = "seed",
    is_agent: bool = False, agent_id: str | None = None,
) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO graph_nodes
               (world_id, name, entity_type, properties, summary, first_seen, last_updated, source, is_agent, agent_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (world_id, name) DO UPDATE
               SET entity_type = EXCLUDED.entity_type,
                   properties = graph_nodes.properties || EXCLUDED.properties,
                   summary = CASE WHEN EXCLUDED.summary != '' THEN EXCLUDED.summary ELSE graph_nodes.summary END,
                   last_updated = EXCLUDED.last_updated,
                   is_agent = COALESCE(EXCLUDED.is_agent, graph_nodes.is_agent),
                   agent_id = COALESCE(EXCLUDED.agent_id, graph_nodes.agent_id)
               RETURNING *""",
            (world_id, name, entity_type, _json(properties or {}), summary,
             time_step, time_step, source, is_agent, agent_id),
        ).fetchone()
        conn.commit()
        return row


def get_node_by_name(world_id: str, name: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM graph_nodes WHERE world_id = %s AND name = %s",
            (world_id, name),
        ).fetchone()


def list_nodes(world_id: str, entity_type: str | None = None) -> list[dict]:
    with get_conn() as conn:
        if entity_type:
            return conn.execute(
                "SELECT * FROM graph_nodes WHERE world_id = %s AND entity_type = %s ORDER BY created_at",
                (world_id, entity_type),
            ).fetchall()
        return conn.execute(
            "SELECT * FROM graph_nodes WHERE world_id = %s ORDER BY created_at",
            (world_id,),
        ).fetchall()


def search_nodes_by_keyword(world_id: str, keyword: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM graph_nodes WHERE world_id = %s AND (name ILIKE %s OR summary ILIKE %s)",
            (world_id, f"%{keyword}%", f"%{keyword}%"),
        ).fetchall()


# ---------- graph_edges ----------

def upsert_edge(
    world_id: str, source_name: str, target_name: str, relation: str, *,
    weight: float = 0.5, properties: dict | None = None,
    time_step: int = 0, source: str = "seed",
) -> dict | None:
    """按 source/target 名称 upsert 边。节点不存在时跳过。"""
    with get_conn() as conn:
        src = conn.execute(
            "SELECT node_id FROM graph_nodes WHERE world_id = %s AND name = %s",
            (world_id, source_name),
        ).fetchone()
        tgt = conn.execute(
            "SELECT node_id FROM graph_nodes WHERE world_id = %s AND name = %s",
            (world_id, target_name),
        ).fetchone()
        if not src or not tgt:
            return None
        row = conn.execute(
            """INSERT INTO graph_edges
               (world_id, source_node, target_node, relation, weight, properties, first_seen, last_updated, source)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (world_id, source_node, target_node, relation)
               WHERE FALSE  -- no natural unique, use triple index for lookup only
               DO NOTHING
               RETURNING *""",
            (world_id, src["node_id"], tgt["node_id"], relation, weight,
             _json(properties or {}), time_step, time_step, source),
        ).fetchone()
        conn.commit()
        return row


def upsert_edge_by_id(
    world_id: str, source_node_id: str, target_node_id: str, relation: str, *,
    weight: float = 0.5, properties: dict | None = None,
    time_step: int = 0, source: str = "seed",
) -> dict:
    with get_conn() as conn:
        existing = conn.execute(
            """SELECT * FROM graph_edges
               WHERE world_id = %s AND source_node = %s AND target_node = %s AND relation = %s""",
            (world_id, source_node_id, target_node_id, relation),
        ).fetchone()
        if existing:
            row = conn.execute(
                """UPDATE graph_edges SET weight = %s, properties = properties || %s::jsonb,
                   last_updated = %s WHERE edge_id = %s RETURNING *""",
                (weight, _json(properties or {}), time_step, existing["edge_id"]),
            ).fetchone()
        else:
            row = conn.execute(
                """INSERT INTO graph_edges
                   (world_id, source_node, target_node, relation, weight, properties, first_seen, last_updated, source)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (world_id, source_node_id, target_node_id, relation, weight,
                 _json(properties or {}), time_step, time_step, source),
            ).fetchone()
        conn.commit()
        return row


def get_node_edges(world_id: str, node_name: str) -> list[dict]:
    """查某节点的所有边（含关联节点名称）。"""
    with get_conn() as conn:
        node = conn.execute(
            "SELECT node_id FROM graph_nodes WHERE world_id = %s AND name = %s",
            (world_id, node_name),
        ).fetchone()
        if not node:
            return []
        return conn.execute(
            """SELECT e.*, sn.name as source_name, tn.name as target_name
               FROM graph_edges e
               JOIN graph_nodes sn ON e.source_node = sn.node_id
               JOIN graph_nodes tn ON e.target_node = tn.node_id
               WHERE e.world_id = %s AND (e.source_node = %s OR e.target_node = %s)
               ORDER BY e.weight DESC""",
            (world_id, node["node_id"], node["node_id"]),
        ).fetchall()


def get_full_graph(world_id: str) -> dict:
    """获取完整图谱（节点+边）。"""
    with get_conn() as conn:
        nodes = conn.execute(
            "SELECT * FROM graph_nodes WHERE world_id = %s ORDER BY created_at",
            (world_id,),
        ).fetchall()
        edges = conn.execute(
            """SELECT e.*, sn.name as source_name, tn.name as target_name
               FROM graph_edges e
               JOIN graph_nodes sn ON e.source_node = sn.node_id
               JOIN graph_nodes tn ON e.target_node = tn.node_id
               WHERE e.world_id = %s ORDER BY e.weight DESC""",
            (world_id,),
        ).fetchall()
        return {"nodes": nodes, "edges": edges}


def update_edge_weight(edge_id: str, delta: float, time_step: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            """UPDATE graph_edges
               SET weight = GREATEST(0.0, LEAST(1.0, weight + %s)), last_updated = %s
               WHERE edge_id = %s RETURNING *""",
            (delta, time_step, edge_id),
        ).fetchone()
        conn.commit()
        return row


def get_graph_stats(world_id: str) -> dict:
    with get_conn() as conn:
        node_count = conn.execute(
            "SELECT count(*) as cnt FROM graph_nodes WHERE world_id = %s", (world_id,)
        ).fetchone()["cnt"]
        edge_count = conn.execute(
            "SELECT count(*) as cnt FROM graph_edges WHERE world_id = %s", (world_id,)
        ).fetchone()["cnt"]
        type_dist = conn.execute(
            "SELECT entity_type, count(*) as cnt FROM graph_nodes WHERE world_id = %s GROUP BY entity_type ORDER BY cnt DESC",
            (world_id,),
        ).fetchall()
        return {"node_count": node_count, "edge_count": edge_count, "type_distribution": type_dist}


# ---------- memories (enhanced) ----------

def list_memories_by_type(agent_id: str, memory_type: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM memories WHERE agent_id = %s AND memory_type = %s ORDER BY time_step, created_at",
            (agent_id, memory_type),
        ).fetchall()


def list_memories_for_run(run_id: str, agent_id: str | None = None) -> list[dict]:
    with get_conn() as conn:
        if agent_id:
            return conn.execute(
                "SELECT * FROM memories WHERE run_id = %s AND agent_id = %s ORDER BY time_step, created_at",
                (run_id, agent_id),
            ).fetchall()
        return conn.execute(
            "SELECT * FROM memories WHERE run_id = %s ORDER BY time_step, created_at",
            (run_id,),
        ).fetchall()


def get_agent_life_history(agent_id: str, run_id: str | None = None) -> dict:
    """获取 agent 生命史：记忆按 run 隔离，关系图仍使用当前 world 图谱。"""
    with get_conn() as conn:
        agent = conn.execute(
            "SELECT * FROM agents WHERE agent_id = %s", (agent_id,)
        ).fetchone()
        if not agent:
            return {"agent": None, "memories": [], "relations": []}
        if run_id:
            memories = conn.execute(
                "SELECT * FROM memories WHERE agent_id = %s AND run_id = %s ORDER BY time_step, created_at",
                (agent_id, run_id),
            ).fetchall()
        else:
            memories = conn.execute(
                "SELECT * FROM memories WHERE agent_id = %s ORDER BY time_step, created_at",
                (agent_id,),
            ).fetchall()
        node = conn.execute(
            "SELECT node_id FROM graph_nodes WHERE world_id = %s AND name = %s",
            (agent["world_id"], agent.get("name")),
        ).fetchone()
        relations = []
        if node:
            relations = conn.execute(
                """SELECT e.relation, e.weight, sn.name as source_name, tn.name as target_name
                   FROM graph_edges e
                   JOIN graph_nodes sn ON e.source_node = sn.node_id
                   JOIN graph_nodes tn ON e.target_node = tn.node_id
                   WHERE (e.source_node = %s OR e.target_node = %s)
                   ORDER BY e.weight DESC""",
                (node["node_id"], node["node_id"]),
            ).fetchall()
        return {"agent": agent, "memories": memories, "relations": relations}


# ---------- chat_sessions ----------

def create_chat_session(run_id: str, world_id: str, session_type: str, target_agent_id: str | None = None) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO chat_sessions (run_id, world_id, session_type, target_agent_id)
               VALUES (%s, %s, %s, %s) RETURNING *""",
            (run_id, world_id, session_type, target_agent_id),
        ).fetchone()
        conn.commit()
        return row


def get_chat_session(session_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM chat_sessions WHERE session_id = %s", (session_id,)
        ).fetchone()


def list_chat_sessions(run_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM chat_sessions WHERE run_id = %s ORDER BY created_at",
            (run_id,),
        ).fetchall()


def append_chat_message(session_id: str, role: str, content: str, metadata: dict | None = None,
                        agent_id: str | None = None, agent_name: str = "") -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO chat_messages (session_id, role, content, metadata, agent_id, agent_name)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
            (session_id, role, content, _json(metadata or {}), agent_id, agent_name),
        ).fetchone()
        conn.commit()
        return row


def list_chat_messages(session_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM chat_messages WHERE session_id = %s AND role != 'system' ORDER BY created_at",
            (session_id,),
        ).fetchall()


def get_chat_discussion_state(session_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT metadata FROM chat_messages
               WHERE session_id = %s AND role = 'system' AND metadata->>'kind' = 'discussion_state'
               ORDER BY created_at DESC LIMIT 1""",
            (session_id,),
        ).fetchone()
        return row["metadata"].get("state", {}) if row else {}


def save_chat_discussion_state(session_id: str, state: dict) -> dict:
    return append_chat_message(
        session_id,
        "system",
        "discussion_state",
        metadata={"kind": "discussion_state", "state": state},
    )


# ---------- group chat ----------

def create_group_chat_session(run_id: str, world_id: str, name: str, agent_ids: list[str], max_rounds: int = 3) -> dict:
    max_rounds = max(1, min(int(max_rounds or 3), 10))
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO chat_sessions (run_id, world_id, session_type, name, max_rounds)
               VALUES (%s, %s, 'group', %s, %s) RETURNING *""",
            (run_id, world_id, name, max_rounds),
        ).fetchone()
        sid = row["session_id"]
        for aid in agent_ids:
            conn.execute(
                "INSERT INTO chat_session_members (session_id, agent_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (sid, aid),
            )
        conn.commit()
        return row


def list_chat_session_members(session_id: str) -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            """SELECT m.agent_id, a.name, a.role_type, a.birth_context,
                      sp.identity as sp_identity
               FROM chat_session_members m
               JOIN agents a ON a.agent_id = m.agent_id
               LEFT JOIN skill_profiles sp ON a.skill_profile_id = sp.skill_profile_id
               WHERE m.session_id = %s ORDER BY a.name""",
            (session_id,),
        ).fetchall()


def add_chat_session_members(session_id: str, agent_ids: list[str]):
    with get_conn() as conn:
        for aid in agent_ids:
            conn.execute(
                "INSERT INTO chat_session_members (session_id, agent_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (session_id, aid),
            )
        conn.commit()
