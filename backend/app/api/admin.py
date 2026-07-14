"""Admin 通用 CRUD 路由。元数据驱动，14 张表统一处理。"""
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from psycopg.types.json import Json
from pydantic import BaseModel

from app.db.session import get_conn
from app.repositories import store

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------- 表元数据 ----------
# readonly: 主键/created_at 等系统字段
# widget: textarea / json / select / text(默认) / number / boolean
# options: select 的可选值
# fk: 外键提示，前端可点击跳转

TABLES: dict[str, dict] = {
    "worlds": {
        "label": "世界",
        "pk": "world_id",
        "order_by": "created_at DESC",
        "columns": {
            "world_id": {"type": "text", "readonly": True},
            "title": {"type": "text"},
            "simulation_goal": {"type": "text", "widget": "textarea"},
            "seed_material": {"type": "text", "widget": "textarea"},
            "world_background": {"type": "text", "widget": "textarea"},
            "world_protocol": {"type": "jsonb", "widget": "json"},
            "entity_graph": {"type": "jsonb", "widget": "json"},
            "world_state": {"type": "jsonb", "widget": "json"},
            "intervention_mode": {"type": "jsonb", "widget": "json"},
            "status": {"type": "text", "widget": "select",
                       "options": ["draft", "building", "ready", "running", "paused", "finished", "build_failed"]},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "skill_profiles": {
        "label": "灵魂档案",
        "pk": "skill_profile_id",
        "order_by": "created_at DESC",
        "columns": {
            "skill_profile_id": {"type": "text", "readonly": True},
            "source_type": {"type": "text"},
            "source_ref": {"type": "text"},
            "identity": {"type": "jsonb", "widget": "json"},
            "mental_models": {"type": "jsonb", "widget": "json"},
            "decision_rules": {"type": "jsonb", "widget": "json"},
            "expression_style": {"type": "jsonb", "widget": "json"},
            "values": {"type": "jsonb", "widget": "json"},
            "anti_patterns": {"type": "jsonb", "widget": "json"},
            "honesty_boundary": {"type": "text", "widget": "textarea"},
            "provenance": {"type": "jsonb", "widget": "json"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "agents": {
        "label": "Agent",
        "pk": "agent_id",
        "order_by": "created_at DESC",
        "columns": {
            "agent_id": {"type": "text", "readonly": True},
            "world_id": {"type": "text", "fk": "worlds"},
            "name": {"type": "text"},
            "tier": {"type": "text", "widget": "select", "options": ["core", "supporting", "background"]},
            "role_type": {"type": "text"},
            "skill_profile_id": {"type": "text", "fk": "skill_profiles"},
            "birth_context": {"type": "jsonb", "widget": "json"},
            "current_internal_state": {"type": "jsonb", "widget": "json"},
            "memory_summary": {"type": "text", "widget": "textarea"},
            "is_active": {"type": "boolean", "widget": "boolean"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "simulation_runs": {
        "label": "推演运行",
        "pk": "run_id",
        "order_by": "started_at DESC",
        "columns": {
            "run_id": {"type": "text", "readonly": True},
            "world_id": {"type": "text", "fk": "worlds"},
            "status": {"type": "text", "widget": "select",
                       "options": ["running", "paused", "finished", "failed"]},
            "total_steps": {"type": "int", "widget": "number"},
            "stop_reason": {"type": "text"},
            "final_world_state": {"type": "jsonb", "widget": "json"},
            "event_timeline": {"type": "jsonb", "widget": "json"},
            "agent_memory_index": {"type": "jsonb", "widget": "json"},
            "relationship_graph": {"type": "jsonb", "widget": "json"},
            "relationship_series": {"type": "jsonb", "widget": "json"},
            "metric_series": {"type": "jsonb", "widget": "json"},
            "raw_log": {"type": "jsonb", "widget": "json"},
            "report_context": {"type": "jsonb", "widget": "json"},
            "report_id": {"type": "text", "fk": "reports"},
            "paused_at_step": {"type": "int", "widget": "number"},
            "pause_reason": {"type": "text"},
            "stage_summary": {"type": "jsonb", "widget": "json"},
            "started_at": {"type": "timestamptz", "readonly": True},
            "finished_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "events": {
        "label": "事件",
        "pk": "event_id",
        "order_by": "time_step ASC, created_at ASC",
        "columns": {
            "event_id": {"type": "text", "readonly": True},
            "world_id": {"type": "text", "fk": "worlds"},
            "run_id": {"type": "text", "fk": "simulation_runs"},
            "time_step": {"type": "int", "widget": "number"},
            "title": {"type": "text"},
            "description": {"type": "text", "widget": "textarea"},
            "source": {"type": "text", "widget": "select",
                       "options": ["system", "agent", "intervention", "god"]},
            "involved_entities": {"type": "jsonb", "widget": "json"},
            "visible_to": {"type": "jsonb", "widget": "json"},
            "impact_hints": {"type": "text"},
            "uncertainty": {"type": "real", "widget": "number"},
            "from_intervention_id": {"type": "text", "fk": "interventions"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "memories": {
        "label": "记忆",
        "pk": "memory_id",
        "order_by": "created_at DESC",
        "columns": {
            "memory_id": {"type": "text", "readonly": True},
            "agent_id": {"type": "text", "fk": "agents"},
            "world_id": {"type": "text", "fk": "worlds"},
            "run_id": {"type": "text", "fk": "simulation_runs"},
            "memory_type": {"type": "text", "widget": "select",
                            "options": ["event", "relationship", "internal", "goal", "other"]},
            "time_step": {"type": "int", "widget": "number"},
            "source_event_id": {"type": "text", "fk": "events"},
            "content": {"type": "text", "widget": "textarea"},
            "structured_delta": {"type": "jsonb", "widget": "json"},
            "is_subjective": {"type": "boolean", "widget": "boolean"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "interventions": {
        "label": "上帝干预",
        "pk": "intervention_id",
        "order_by": "time_step ASC, created_at ASC",
        "columns": {
            "intervention_id": {"type": "text", "readonly": True},
            "world_id": {"type": "text", "fk": "worlds"},
            "run_id": {"type": "text", "fk": "simulation_runs"},
            "time_step": {"type": "int", "widget": "number"},
            "created_by": {"type": "text"},
            "intervention_type": {"type": "text", "widget": "select",
                                  "options": ["world_event", "information_release"]},
            "target_scope": {"type": "jsonb", "widget": "json"},
            "description": {"type": "text", "widget": "textarea"},
            "structured_patch": {"type": "jsonb", "widget": "json"},
            "visible_to": {"type": "jsonb", "widget": "json"},
            "expected_effect": {"type": "text", "widget": "textarea"},
            "actual_effect_after_resume": {"type": "text", "widget": "textarea"},
            "resulting_event_id": {"type": "text", "fk": "events"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "reports": {
        "label": "报告",
        "pk": "report_id",
        "order_by": "created_at DESC",
        "columns": {
            "report_id": {"type": "text", "readonly": True},
            "run_id": {"type": "text", "fk": "simulation_runs"},
            "executive_summary": {"type": "jsonb", "widget": "json"},
            "world_setup": {"type": "jsonb", "widget": "json"},
            "timeline": {"type": "jsonb", "widget": "json"},
            "agent_perspectives": {"type": "jsonb", "widget": "json"},
            "relationship_changes": {"type": "jsonb", "widget": "json"},
            "metrics": {"type": "jsonb", "widget": "json"},
            "key_drivers": {"type": "jsonb", "widget": "json"},
            "evidence_map": {"type": "jsonb", "widget": "json"},
            "intervention_impact": {"type": "jsonb", "widget": "json"},
            "story": {"type": "jsonb", "widget": "json"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "graph_ontology": {
        "label": "图谱本体",
        "pk": "ontology_id",
        "order_by": "created_at DESC",
        "columns": {
            "ontology_id": {"type": "text", "readonly": True},
            "world_id": {"type": "text", "fk": "worlds"},
            "entity_types": {"type": "jsonb", "widget": "json"},
            "edge_types": {"type": "jsonb", "widget": "json"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "graph_nodes": {
        "label": "图谱节点",
        "pk": "node_id",
        "order_by": "last_updated DESC",
        "columns": {
            "node_id": {"type": "text", "readonly": True},
            "world_id": {"type": "text", "fk": "worlds"},
            "name": {"type": "text"},
            "entity_type": {"type": "text"},
            "properties": {"type": "jsonb", "widget": "json"},
            "summary": {"type": "text", "widget": "textarea"},
            "first_seen": {"type": "int", "widget": "number"},
            "last_updated": {"type": "int", "widget": "number"},
            "source": {"type": "text"},
            "is_agent": {"type": "boolean", "widget": "boolean"},
            "agent_id": {"type": "text", "fk": "agents"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "graph_edges": {
        "label": "图谱边",
        "pk": "edge_id",
        "order_by": "last_updated DESC",
        "columns": {
            "edge_id": {"type": "text", "readonly": True},
            "world_id": {"type": "text", "fk": "worlds"},
            "source_node": {"type": "text", "fk": "graph_nodes"},
            "target_node": {"type": "text", "fk": "graph_nodes"},
            "relation": {"type": "text"},
            "weight": {"type": "real", "widget": "number"},
            "properties": {"type": "jsonb", "widget": "json"},
            "first_seen": {"type": "int", "widget": "number"},
            "last_updated": {"type": "int", "widget": "number"},
            "source": {"type": "text"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "chat_sessions": {
        "label": "聊天会话",
        "pk": "session_id",
        "order_by": "created_at DESC",
        "columns": {
            "session_id": {"type": "text", "readonly": True},
            "run_id": {"type": "text", "fk": "simulation_runs"},
            "world_id": {"type": "text", "fk": "worlds"},
            "session_type": {"type": "text", "widget": "select",
                             "options": ["world_agent", "report_agent", "group"]},
            "target_agent_id": {"type": "text", "fk": "agents"},
            "name": {"type": "text"},
            "max_rounds": {"type": "int", "widget": "number"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
    "chat_session_members": {
        "label": "群聊成员",
        "pk": "id",
        "order_by": "id ASC",
        "columns": {
            "id": {"type": "text", "readonly": True},
            "session_id": {"type": "text", "fk": "chat_sessions"},
            "agent_id": {"type": "text", "fk": "agents"},
        },
    },
    "chat_messages": {
        "label": "聊天消息",
        "pk": "message_id",
        "order_by": "created_at DESC",
        "columns": {
            "message_id": {"type": "text", "readonly": True},
            "session_id": {"type": "text", "fk": "chat_sessions"},
            "role": {"type": "text", "widget": "select",
                     "options": ["user", "assistant", "system"]},
            "content": {"type": "text", "widget": "textarea"},
            "metadata": {"type": "jsonb", "widget": "json"},
            "agent_id": {"type": "text", "fk": "agents"},
            "agent_name": {"type": "text"},
            "created_at": {"type": "timestamptz", "readonly": True},
        },
    },
}


# ---------- helpers ----------

def _q(ident: str) -> str:
    """安全引号包裹标识符。表名/列名都走白名单校验。"""
    if ident not in {c for t in TABLES.values() for c in t["columns"]} | set(TABLES) | {"id"}:
        raise HTTPException(400, f"invalid identifier: {ident}")
    return f'"{ident}"'


def _coerce_value(val: Any, col_meta: dict) -> Any:
    """把前端送来的值转成 psycopg 能接受的。"""
    if val is None or val == "":
        return None
    t = col_meta.get("type")
    if t == "jsonb":
        if isinstance(val, (dict, list)):
            return Json(val)
        if isinstance(val, str):
            try:
                return Json(json.loads(val))
            except json.JSONDecodeError:
                raise HTTPException(400, f"invalid JSON: {val[:80]}")
        return Json(val)
    if t == "int":
        return int(val)
    if t in ("real",):
        return float(val)
    if t == "boolean":
        if isinstance(val, bool):
            return val
        return str(val).lower() in ("true", "1", "yes", "on")
    return val


# ---------- routes ----------

# ---------- 世界管理：以世界为单元的聚合视图 ----------

WORLD_CHILD_TABLES = [
    "agents",
    "simulation_runs",
    "events",
    "memories",
    "interventions",
    "graph_ontology",
    "graph_nodes",
    "graph_edges",
    "chat_sessions",
]


@router.get("/admin/worlds/overview")
def worlds_overview():
    """所有世界 + 每个世界的关联数据计数。前端管理后台主视图用。"""
    with get_conn() as conn:
        worlds = conn.execute(
            "SELECT world_id, title, simulation_goal, status, created_at "
            "FROM worlds ORDER BY created_at DESC"
        ).fetchall()

        # 一次查所有世界的子表计数，避免 N+1
        child_counts: dict[str, dict[str, int]] = {t: {} for t in WORLD_CHILD_TABLES}
        for table in WORLD_CHILD_TABLES:
            rows = conn.execute(
                f'SELECT world_id, COUNT(*) AS c FROM "{table}" GROUP BY world_id'
            ).fetchall()
            for r in rows:
                child_counts[table][r["world_id"]] = r["c"]

        # reports 通过 simulation_runs 间接关联
        reports_rows = conn.execute(
            'SELECT sr.world_id AS world_id, COUNT(*) AS c '
            "FROM reports r JOIN simulation_runs sr ON r.run_id = sr.run_id "
            "GROUP BY sr.world_id"
        ).fetchall()
        reports_map = {r["world_id"]: r["c"] for r in reports_rows}

        # chat_messages 通过 chat_sessions 间接关联
        msg_rows = conn.execute(
            'SELECT cs.world_id AS world_id, COUNT(*) AS c '
            "FROM chat_messages cm JOIN chat_sessions cs ON cm.session_id = cs.session_id "
            "GROUP BY cs.world_id"
        ).fetchall()
        msg_map = {r["world_id"]: r["c"] for r in msg_rows}

        result = []
        for w in worlds:
            wid = w["world_id"]
            counts = {t: child_counts[t].get(wid, 0) for t in WORLD_CHILD_TABLES}
            counts["reports"] = reports_map.get(wid, 0)
            counts["chat_messages"] = msg_map.get(wid, 0)
            result.append({**w, "counts": counts})
        return result


@router.delete("/admin/worlds/{world_id}")
def delete_world(world_id: str):
    """删除世界。ON DELETE CASCADE 会自动清掉所有相关数据。"""
    with get_conn() as conn:
        row = conn.execute(
            'DELETE FROM worlds WHERE world_id = %s RETURNING world_id, title',
            (world_id,),
        ).fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "world not found")
    logger.info("[admin] deleted world: id=%s title=%s (cascade)", world_id, row["title"])
    return {"deleted": world_id, "title": row["title"]}


@router.post("/admin/worlds/{world_id}/runs/reset")
def reset_world_runs(world_id: str):
    """重置推演：清空所有 run 数据（events/memories/interventions/reports/chat），保留构建产物。
    世界回到 ready 状态，可重新点「开始推演」。"""
    world = store.get_world(world_id)
    if not world:
        raise HTTPException(404, "world not found")
    result = store.reset_world_runs(world_id)
    logger.info("[admin] reset runs: world=%s title=%s", world_id, world.get("title"))
    return result


@router.post("/admin/worlds/{world_id}/reports/reset")
def reset_world_reports(world_id: str):
    """重置报告：清空世界所有 run 的报告，保留推演产物。可重新生成报告。"""
    world = store.get_world(world_id)
    if not world:
        raise HTTPException(404, "world not found")
    result = store.reset_world_reports(world_id)
    logger.info("[admin] reset reports: world=%s title=%s", world_id, world.get("title"))
    return result


# ---------- 通用 CRUD ----------

@router.get("/admin/meta")
def list_tables_meta():
    """返回所有表的元数据 + 行数。前端用来渲染左侧 sidebar。"""
    result = []
    for table_key, meta in TABLES.items():
        with get_conn() as conn:
            count = conn.execute(f"SELECT COUNT(*) AS c FROM {_q(table_key)}").fetchone()["c"]
        result.append({
            "table": table_key,
            "label": meta["label"],
            "pk": meta["pk"],
            "count": count,
        })
    return result


@router.get("/admin/{table}")
def list_rows(table: str, limit: int = Query(100, le=500), offset: int = 0, q: str = "", world_id: str = ""):
    if table not in TABLES:
        raise HTTPException(404, f"unknown table: {table}")
    meta = TABLES[table]
    cols = list(meta["columns"].keys())
    col_list = ", ".join(_q(c) for c in cols)

    where_parts: list[str] = []
    params: list[Any] = []
    if q:
        text_cols = [c for c, m in meta["columns"].items() if m["type"] == "text"]
        if text_cols:
            like_clauses = " OR ".join(f"{_q(c)} ILIKE %s" for c in text_cols)
            where_parts.append(f"({like_clauses})")
            params.extend([f"%{q}%"] * len(text_cols))
    if world_id and "world_id" in meta["columns"]:
        where_parts.append('"world_id" = %s')
        params.append(world_id)

    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    order = meta.get("order_by", "created_at DESC")
    sql = f"SELECT {col_list} FROM {_q(table)} {where_clause} ORDER BY {order} LIMIT %s OFFSET %s"
    params.extend([limit, offset])

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        total_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {_q(table)} {where_clause}",
            params[:-2] if where_clause else [],
        ).fetchone()
    return {"rows": rows, "total": total_row["c"], "columns": cols, "meta": meta}


@router.get("/admin/{table}/{row_id}")
def get_row(table: str, row_id: str):
    if table not in TABLES:
        raise HTTPException(404, f"unknown table: {table}")
    meta = TABLES[table]
    pk = meta["pk"]
    cols = list(meta["columns"].keys())
    col_list = ", ".join(_q(c) for c in cols)
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {col_list} FROM {_q(table)} WHERE {_q(pk)} = %s",
            (row_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "row not found")
    return {"row": row, "meta": meta}


class UpdateReq(BaseModel):
    data: dict


@router.post("/admin/{table}")
def create_row(table: str, req: UpdateReq):
    if table not in TABLES:
        raise HTTPException(404, f"unknown table: {table}")
    meta = TABLES[table]
    cols_meta = meta["columns"]

    # 只接受非 readonly 字段
    insert_cols = []
    insert_vals = []
    for k, v in req.data.items():
        if k not in cols_meta:
            continue
        if cols_meta[k].get("readonly"):
            continue
        insert_cols.append(k)
        insert_vals.append(_coerce_value(v, cols_meta[k]))

    if not insert_cols:
        raise HTTPException(400, "no fields to insert")

    col_list = ", ".join(_q(c) for c in insert_cols)
    placeholder_list = ", ".join("%s" for _ in insert_vals)
    sql = f"INSERT INTO {_q(table)} ({col_list}) VALUES ({placeholder_list}) RETURNING *"

    with get_conn() as conn:
        row = conn.execute(sql, insert_vals).fetchone()
        conn.commit()
    logger.info("[admin] created: table=%s pk=%s", table, row[meta["pk"]])
    return row


@router.put("/admin/{table}/{row_id}")
def update_row(table: str, row_id: str, req: UpdateReq):
    if table not in TABLES:
        raise HTTPException(404, f"unknown table: {table}")
    meta = TABLES[table]
    cols_meta = meta["columns"]
    pk = meta["pk"]

    set_clauses = []
    set_vals = []
    for k, v in req.data.items():
        if k not in cols_meta:
            continue
        if cols_meta[k].get("readonly") or k == pk:
            continue
        set_clauses.append(f"{_q(k)} = %s")
        set_vals.append(_coerce_value(v, cols_meta[k]))

    if not set_clauses:
        raise HTTPException(400, "no fields to update")

    set_clauses_str = ", ".join(set_clauses)
    set_vals.append(row_id)
    sql = f"UPDATE {_q(table)} SET {set_clauses_str} WHERE {_q(pk)} = %s RETURNING *"

    with get_conn() as conn:
        row = conn.execute(sql, set_vals).fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "row not found")
    logger.info("[admin] updated: table=%s pk=%s fields=%s", table, row_id, list(req.data.keys()))
    return row


@router.delete("/admin/{table}/{row_id}")
def delete_row(table: str, row_id: str):
    if table not in TABLES:
        raise HTTPException(404, f"unknown table: {table}")
    meta = TABLES[table]
    pk = meta["pk"]
    with get_conn() as conn:
        row = conn.execute(
            f"DELETE FROM {_q(table)} WHERE {_q(pk)} = %s RETURNING {_q(pk)}",
            (row_id,),
        ).fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "row not found")
    logger.info("[admin] deleted: table=%s pk=%s", table, row_id)
    return {"deleted": row_id}
