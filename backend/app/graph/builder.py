"""从种子材料构建知识图谱。对标 MiroFish 的 ontology 生成 + 实体关系抽取。"""
from app.llm import client
from app.repositories import store

_ONTOLOGY_SYS = """你是知识图谱本体设计器。从种子材料和推演目标中归纳这个世界的本体结构。

输出 JSON 对象：
- entity_types: string[]，实体类型列表（最多10个，如 person, organization, event, policy, location, concept 等）
- edge_types: string[]，关系类型列表（最多10个，如 supports, opposes, manages, influences, belongs_to, trusts, conflicts_with 等）

规则：
- 只从材料内容归纳，不要添加材料中不存在的类型
- entity_types 必须包含 person（如果材料中有人物）
- edge_types 使用英文小写下划线格式
- 每种类型用一个词或短语"""

_EXTRACT_SYS = """你是知识图谱实体关系抽取器。从种子材料中抽取所有实体和关系。

本体约束（严格遵循）：
- 实体类型仅限: {entity_types}
- 关系类型仅限: {edge_types}

输出 JSON 对象：
- entities: 数组，每个元素：
  - name: string，实体名称（简短、唯一、一致）
  - type: string，必须来自实体类型列表
  - properties: object，实体属性（如 role, stance, influence_level 等，按材料内容填写）
  - summary: string，一句话描述
- relations: 数组，每个元素：
  - source: string，源实体名称（必须在 entities 中出现）
  - target: string，目标实体名称（必须在 entities 中出现）
  - relation: string，必须来自关系类型列表
  - weight: float，0.0-1.0，关系强度/确定性

规则：
- 实体名称必须在整个输出中保持一致（如"张三"不能同时叫"老张"）
- 每个实体至少有一条关系
- weight 0.8+ 表示确定关系，0.3-0.7 表示推测关系"""


def build_ontology(seed_material: str, simulation_goal: str) -> dict:
    user = f"推演目标：{simulation_goal}\n\n种子材料：\n{seed_material[:3000]}"
    data = client.complete_json(_ONTOLOGY_SYS, user)
    entity_types = data.get("entity_types", ["person", "organization", "event"])
    edge_types = data.get("edge_types", ["supports", "opposes", "influences"])
    return {"entity_types": entity_types[:10], "edge_types": edge_types[:10]}


def extract_entities_and_relations(seed_material: str, ontology: dict) -> dict:
    sys_prompt = _EXTRACT_SYS.format(
        entity_types=", ".join(ontology["entity_types"]),
        edge_types=", ".join(ontology["edge_types"]),
    )
    user = f"种子材料：\n{seed_material[:4000]}"
    data = client.complete_json(sys_prompt, user)
    return {
        "entities": data.get("entities", []),
        "relations": data.get("relations", []),
    }


def build_graph_from_seed(world_id: str, seed_material: str, simulation_goal: str) -> dict:
    """完整构建流程：ontology → 实体关系抽取 → 写入 graph_nodes/graph_edges。"""
    ontology = build_ontology(seed_material, simulation_goal)
    store.create_ontology(world_id, ontology["entity_types"], ontology["edge_types"])

    extracted = extract_entities_and_relations(seed_material, ontology)

    node_map = {}
    for ent in extracted["entities"]:
        node = store.upsert_node(
            world_id,
            ent["name"],
            ent.get("type", "unknown"),
            properties=ent.get("properties"),
            summary=ent.get("summary", ""),
            time_step=0,
            source="seed",
        )
        node_map[ent["name"]] = node

    agents = store.list_agents(world_id)
    agent_name_map = {a["name"]: a["agent_id"] for a in agents}
    for name, node in node_map.items():
        if name in agent_name_map:
            store.upsert_node(
                world_id, name, node["entity_type"],
                is_agent=True, agent_id=agent_name_map[name],
            )

    edge_count = 0
    for rel in extracted["relations"]:
        src = node_map.get(rel.get("source"))
        tgt = node_map.get(rel.get("target"))
        if src and tgt:
            store.upsert_edge_by_id(
                world_id,
                src["node_id"],
                tgt["node_id"],
                rel.get("relation", "related"),
                weight=rel.get("weight", 0.5),
                time_step=0,
                source="seed",
            )
            edge_count += 1

    return {
        "ontology": ontology,
        "node_count": len(node_map),
        "edge_count": edge_count,
    }
