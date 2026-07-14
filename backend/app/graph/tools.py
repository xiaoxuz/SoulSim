"""图谱查询工具。对标 MiroFish 的 quick_search / panorama_search / insight_forge。"""
from app.llm import client
from app.repositories import store

_EXTRACT_KEYWORDS_SYS = """从用户查询中提取搜索关键词。
输出 JSON: {keywords: [string], entity_types: [string], relation_types: [string]}
keywords 是实体名称或关键词，entity_types 和 relation_types 可为空。"""

_SUMMARIZE_SYS = """你是知识图谱分析师。根据图谱查询结果回答用户的问题。
基于提供的节点和关系数据，给出准确、有依据的回答。
如果数据不足以回答，明确说明。"""

_INSIGHT_SYS = """你是知识图谱深度分析师。基于完整的世界知识图谱和记忆数据，
对用户的分析性问题进行多角度深度分析。

输出 JSON 对象：
- answer: string，分析结论
- key_factors: [string]，关键影响因素
- evidence: [string]，支撑证据（引用具体实体和关系）
- risks: [string]，潜在风险或不确定性"""


def quick_search(world_id: str, query: str) -> dict:
    """快速搜索：从 query 提取关键词 → SQL 搜索节点/边。"""
    kw_data = client.complete_json(_EXTRACT_KEYWORDS_SYS, query)
    keywords = kw_data.get("keywords", [query])

    matched_nodes = []
    matched_edges = []
    for kw in keywords[:5]:
        nodes = store.search_nodes_by_keyword(world_id, kw)
        matched_nodes.extend(nodes)
        for node in nodes:
            edges = store.get_node_edges(world_id, node["name"])
            matched_edges.extend(edges)

    seen_node_ids = set()
    unique_nodes = []
    for n in matched_nodes:
        if n["node_id"] not in seen_node_ids:
            seen_node_ids.add(n["node_id"])
            unique_nodes.append(n)

    seen_edge_ids = set()
    unique_edges = []
    for e in matched_edges:
        if e["edge_id"] not in seen_edge_ids:
            seen_edge_ids.add(e["edge_id"])
            unique_edges.append(e)

    return {
        "tool": "quick_search",
        "query": query,
        "nodes": [{"name": n["name"], "type": n["entity_type"], "summary": n.get("summary", "")} for n in unique_nodes[:10]],
        "edges": [{"source": e["source_name"], "target": e["target_name"], "relation": e["relation"], "weight": e["weight"]} for e in unique_edges[:15]],
    }


def panorama_search(world_id: str, query: str) -> dict:
    """全景搜索：获取相关子图 + LLM 摘要综合。"""
    search_result = quick_search(world_id, query)
    full_graph = store.get_full_graph(world_id)

    graph_text = _format_graph_for_llm(full_graph)
    user_prompt = (
        f"用户问题：{query}\n\n"
        f"完整图谱：\n{graph_text}\n\n"
        f"请全面分析并回答。"
    )
    answer = client.complete(_SUMMARIZE_SYS, user_prompt)

    return {
        "tool": "panorama_search",
        "query": query,
        "answer": answer,
        "graph_stats": store.get_graph_stats(world_id),
    }


def insight_forge(world_id: str, query: str, run_id: str | None = None) -> dict:
    """深度洞察：完整图谱 + 记忆 → LLM 多角度分析。"""
    full_graph = store.get_full_graph(world_id)
    graph_text = _format_graph_for_llm(full_graph)

    memory_text = ""
    if run_id:
        memories = store.list_memories_for_run(run_id)
        memory_lines = [f"[T{m['time_step']}][{m['memory_type']}] {m['content'][:100]}" for m in memories[-30:]]
        memory_text = "\n".join(memory_lines)

    user_prompt = (
        f"分析问题：{query}\n\n"
        f"知识图谱：\n{graph_text}\n\n"
    )
    if memory_text:
        user_prompt += f"推演记忆（最近30条）：\n{memory_text}\n\n"
    user_prompt += "请进行深度分析。"

    data = client.complete_json(_INSIGHT_SYS, user_prompt)
    return {
        "tool": "insight_forge",
        "query": query,
        "answer": data.get("answer", ""),
        "key_factors": data.get("key_factors", []),
        "evidence": data.get("evidence", []),
        "risks": data.get("risks", []),
    }


def interview_agent(world_id: str, run_id: str, agent_name: str, question: str) -> dict:
    """模拟采访某个 agent，用其灵魂+记忆构建临时 context。"""
    from app.engine.actor import _build_soul_block

    agents = store.list_agents_with_soul(world_id, include_raw=True)
    target = None
    for a in agents:
        if a.get("name") == agent_name:
            target = a
            break
    if not target:
        return {"tool": "interview_agent", "agent": agent_name, "answer": f"找不到名为「{agent_name}」的角色"}

    soul_block = _build_soul_block(target)
    memories = store.list_memories_for_run(run_id, agent_id=target["agent_id"])
    memory_text = "\n".join(f"[T{m['time_step']}] {m['content'][:100]}" for m in memories[-15:])
    relations = store.get_node_edges(world_id, agent_name)
    rel_text = "\n".join(f"{e['source_name']} --[{e['relation']}]--> {e['target_name']}" for e in relations[:10])

    sys_prompt = (
        f"你是{agent_name}，正在接受采访。完全以第一人称回答。\n\n"
        f"你的灵魂：\n{soul_block[:1000]}\n\n"
        f"你的记忆：\n{memory_text}\n\n"
        f"你的关系：\n{rel_text}"
    )
    answer = client.complete(sys_prompt, f"采访问题：{question}")
    return {"tool": "interview_agent", "agent": agent_name, "answer": answer}


def _format_graph_for_llm(graph: dict) -> str:
    lines = ["实体："]
    for n in graph.get("nodes", []):
        lines.append(f"  - {n['name']} ({n['entity_type']}): {n.get('summary', '')[:80]}")
    lines.append("\n关系：")
    for e in graph.get("edges", []):
        lines.append(f"  - {e['source_name']} --[{e['relation']}:{e['weight']}]--> {e['target_name']}")
    return "\n".join(lines)
