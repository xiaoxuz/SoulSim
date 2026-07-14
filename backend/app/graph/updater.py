"""推演中知识图谱增量更新。每轮从事件和 agent 响应中抽取图谱变化。"""
from app.llm import client
from app.repositories import store

_DELTA_SYS = """你是知识图谱增量更新器。根据本轮事件和角色反应，识别图谱需要的变更。

本体约束：
- 实体类型仅限: {entity_types}
- 关系类型仅限: {edge_types}

已有实体: {existing_nodes}

规则：
- 只输出真正新增或变化的内容
- 新实体必须是材料中确实出现的，不要凭空捏造
- weight_delta 范围 -0.3 到 +0.3（合作/支持 +0.1~0.2，对抗/反对 -0.1~0.2，重大冲突/和解 +-0.3）
- 如果没有变化，对应数组返回空

输出 JSON 对象：
- new_entities: 数组，每个 {{name, type, properties, summary}}
- new_relations: 数组，每个 {{source, target, relation, weight}}（新出现的关系）
- weight_updates: 数组，每个 {{source, target, relation, delta}}（已有关系的权重变化）"""


def extract_graph_delta(world_id: str, event: dict, responses: list[dict], step: int) -> dict:
    ontology = store.get_ontology(world_id)
    if not ontology:
        return {"new_entities": [], "new_relations": [], "weight_updates": []}

    nodes = store.list_nodes(world_id)
    existing_names = [n["name"] for n in nodes]

    resp_digest = "; ".join(
        f"{r.get('name', '?')}({r.get('action', '?')}): {r.get('speech', '')[:60]}"
        for r in responses
    )

    sys_prompt = _DELTA_SYS.format(
        entity_types=", ".join(ontology["entity_types"]),
        edge_types=", ".join(ontology["edge_types"]),
        existing_nodes=", ".join(existing_names),
    )
    user = (
        f"第{step}轮事件：{event.get('title', '')} - {event.get('description', '')}\n"
        f"角色反应：{resp_digest}"
    )

    data = client.complete_json(sys_prompt, user)
    return {
        "new_entities": data.get("new_entities", []),
        "new_relations": data.get("new_relations", []),
        "weight_updates": data.get("weight_updates", []),
    }


def apply_graph_delta(world_id: str, delta: dict, step: int) -> dict:
    """将增量变化写入数据库，返回统计。"""
    added_nodes = 0
    added_edges = 0
    updated_edges = 0

    for ent in delta.get("new_entities", []):
        if not ent.get("name"):
            continue
        store.upsert_node(
            world_id, ent["name"], ent.get("type", "unknown"),
            properties=ent.get("properties"),
            summary=ent.get("summary", ""),
            time_step=step, source="runtime",
        )
        added_nodes += 1

    for rel in delta.get("new_relations", []):
        src = store.get_node_by_name(world_id, rel.get("source", ""))
        tgt = store.get_node_by_name(world_id, rel.get("target", ""))
        if src and tgt:
            store.upsert_edge_by_id(
                world_id, src["node_id"], tgt["node_id"],
                rel.get("relation", "related"),
                weight=rel.get("weight", 0.5),
                time_step=step, source="runtime",
            )
            added_edges += 1

    for upd in delta.get("weight_updates", []):
        src = store.get_node_by_name(world_id, upd.get("source", ""))
        tgt = store.get_node_by_name(world_id, upd.get("target", ""))
        if not src or not tgt:
            continue
        from app.db.session import get_conn
        with get_conn() as conn:
            edge = conn.execute(
                """SELECT edge_id FROM graph_edges
                   WHERE world_id = %s AND source_node = %s AND target_node = %s AND relation = %s""",
                (world_id, src["node_id"], tgt["node_id"], upd.get("relation", "")),
            ).fetchone()
        if edge:
            store.update_edge_weight(edge["edge_id"], upd.get("delta", 0), step)
            updated_edges += 1

    return {"added_nodes": added_nodes, "added_edges": added_edges, "updated_edges": updated_edges}
