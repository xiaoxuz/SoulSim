"""世界循环引擎。支持 SSE 流式输出 + M5 上帝干预（暂停-恢复-干预注入）。"""
import logging
import random
from typing import Generator

from app.engine import actor
from app.graph import updater as graph_updater
from app.llm import client
from app.repositories import store

logger = logging.getLogger(__name__)

_EVENT_SYS = """你是多 Agent 模拟世界的事件生成器。每一轮事件必须服务于推演目标（simulation_goal）的推进，而非散漫叙事。

**节奏意识**：你知道总轮数和当前轮次（user prompt 里会告诉你「第 X/N 轮」）。根据推演目标的特点规划合理节奏--前期建立初始状态、暴露关键变量；中期推进核心主题的演变、累积变化；末期必须收束到目标达成或失败的明确结论。最后一轮必须触发目标达成或失败的转折，给出最终判定。不要在末期还在铺垫新线索。

工作流程：
1. 阅读推演目标、已发生事件链、上一轮进度评估
2. 评估当前目标推进程度（百分比 + 简述卡点）
3. 决定本轮事件如何把推演往前推一步
4. 给出下一轮应聚焦的方向

事件类型必须来自协议的 event_types。事件要能引发 agent 反应、推动世界演化。
不要重复已发生事件链里的事件，要往前推进。

输出 JSON 对象：
- title: string
- event_type: string，必须来自协议 event_types 之一
- description: string
- involved: string[]，涉及的角色名
- impact_hints: string，可能的影响
- goal_progress: string，本轮结束时目标推进评估（如"约 40%：三方已接触但尚未正面冲突，A 阵营仍在观望"）。最后一轮必须给出最终结论（如"目标已证明：A 阵营在第 3 天分裂，因为..."）
- next_focus: string，下一轮应聚焦的方向（如"激化 A 与 B 的价值冲突，迫使 A 表态"）。最后一轮留空或写"推演结束" """

_STATE_SYS = """你是多 Agent 模拟世界的状态更新器。
根据本轮事件和所有 agent 的反应，更新世界状态摘要。
输出 JSON 对象：
- summary: string，当前世界态势的简述
- group_state: string，群体情绪/阵营倾向
- metrics: object，协议 report_metrics 中各指标的当前估值（0-1 或简短描述）"""

_KEY_EVENT_SYS = """你是多 Agent 模拟世界的关键事件评估器。判断本轮事件和 agent 反应是否构成"高影响关键事件"。

高影响事件包括：
- 阵营显著变化（agent 立场大幅转向）
- 核心 agent 立场反转（从支持变反对，或反之）
- 关系图出现强冲突（agent 之间关系剧烈变化）
- 指标大幅波动（关键指标明显变化）
- 新事件改变推演方向（出现意外转折）

只返回合法 JSON：{"is_key_event": true/false, "reason": "命中原因（简短，不超过 30 字）"}"""

_STAGE_SUMMARY_SYS = """你是多 Agent 模拟世界的阶段摘要生成器。在推演暂停时，向用户（上帝视角）展示当前世界状态，帮助用户决定是否干预。

输出 JSON 对象：
- key_events: string[]，本阶段关键事件列表（3-5 条）
- agent_state_changes: string[]，主要 agent 状态变化（立场/情绪/关系）
- relationship_changes: string[]，关系和阵营变化
- metric_changes: string[]，指标变化
- high_impact_variables: string[]，当前高影响变量
- suggested_interventions: string[]，可选干预建议（2-3 条，给上帝灵感）"""


def _gen_event(world, agents, last_responses, step, event_history=None, max_steps: int = 0):
    protocol = world.get("world_protocol") or {}
    goal = world.get("simulation_goal") or "（未设置明确推演目标）"
    resp_digest = "; ".join(f"{r['name']}:{(r.get('action_detail') or '无行动')[:40]}" for r in last_responses) or "（首轮，无上一轮反应）"

    history = event_history or []
    recent = history[-3:]
    chain = "\n".join(
        f"  Day {d.get('step')}: {d.get('event', {}).get('title', '')} - {(d.get('event', {}).get('description') or '')[:80]}"
        for d in recent
    ) or "  （首轮，无历史事件）"

    prev_progress = ""
    for d in reversed(history):
        ev = d.get("event", {}) or {}
        if ev.get("goal_progress"):
            prev_progress = f"上轮评估：{ev['goal_progress']}\n上轮下一步聚焦：{ev.get('next_focus', '')}"
            break
    prev_progress = prev_progress or "（首轮，无上一轮进度评估）"

    # 节奏提示：告诉 LLM 总天数和当前进度位置
    step_hint = f"这是第 {step}/{max_steps} 轮" if max_steps else f"这是第 {step} 轮"
    final_hint = ""
    if max_steps and step == max_steps:
        final_hint = "\n\n【重要·最后一轮】事件必须触发目标达成或失败的转折。goal_progress 必须给出最终结论（如『目标已证明/证伪，因为...』），next_focus 留空或写『推演结束』。不要再铺垫新冲突。"

    user = (f"【推演目标】\n{goal}\n\n"
            f"【已发生事件链】\n{chain}\n\n"
            f"【上一轮进度评估】\n{prev_progress}\n\n"
            f"【当前世界状态】{world.get('world_state', {})}\n"
            f"【参与角色】{[a.get('name') for a in agents]}\n"
            f"【上一轮反应摘要】{resp_digest}\n"
            f"协议 event_types：{protocol.get('event_types', [])}\n"
            f"{step_hint}，生成本轮事件并评估目标进度。{final_hint}")
    data = client.complete_json(_EVENT_SYS, user)
    event_type = data.get("event_type", "")
    protocol_types = protocol.get("event_types", []) or []
    if event_type and protocol_types and event_type not in protocol_types:
        logger.warning("[event] event_type '%s' not in protocol event_types %s", event_type, protocol_types)
    return {"time_step": step, "title": data.get("title", f"第{step}轮事件"),
            "event_type": event_type,
            "description": data.get("description", ""), "source": "runtime",
            "involved_entities": data.get("involved", []),
            "visible_to": [a["agent_id"] for a in agents],
            "impact_hints": data.get("impact_hints", ""),
            "goal_progress": data.get("goal_progress", ""),
            "next_focus": data.get("next_focus", "")}


def _update_state(world, event, responses, step):
    protocol = world.get("world_protocol") or {}
    user = (f"报告指标 report_metrics：{protocol.get('report_metrics', [])}\n"
            f"本轮事件：{event['title']} - {event['description']}\n"
            f"agent 反应：{[{'name': r['name'], 'action_detail': r.get('action_detail', ''), 'speech': r['speech']} for r in responses]}")
    data = client.complete_json(_STATE_SYS, user)
    return {"time_step": step, "summary": data.get("summary", ""),
            "group_state": data.get("group_state", ""), "metrics": data.get("metrics", {})}


def _build_extra_memories(agent, event, response, responses, world_state, world_id, run_id, step):
    extras = []
    agent_id = agent["agent_id"]
    agent_name = agent.get("name", "")
    base = {"agent_id": agent_id, "world_id": world_id, "run_id": run_id,
            "time_step": step, "source_event_id": event["event_id"], "is_subjective": True}
    involved = event.get("involved_entities", [])
    for other_r in responses:
        if other_r["agent_id"] == agent_id:
            continue
        other_name = other_r.get("name", "")
        if agent_name in involved and other_name in involved:
            extras.append({**base, "memory_type": "interaction",
                "content": f"与{other_name}在事件「{event['title']}」中互动：对方{other_r.get('action_detail', '无具体行动')}，说了「{other_r['speech'][:80]}」",
                "structured_delta": {"other_agent": other_name, "other_action_detail": other_r.get("action_detail", "")}})
    if response.get("stance_delta") and response["stance_delta"] not in ("无变化", "不变", "无", ""):
        extras.append({**base, "memory_type": "internal_state",
            "content": f"立场变化：{response['stance_delta']}。情绪变化：{response.get('emotion_delta', '')}",
            "structured_delta": {"stance": response["stance_delta"], "emotion": response.get("emotion_delta", "")}})
    if world_state.get("summary"):
        extras.append({**base, "memory_type": "world_awareness",
            "content": f"第{step}轮后世界态势：{world_state['summary']}",
            "structured_delta": {"group_state": world_state.get("group_state", "")}, "is_subjective": False})
    return extras


def _check_key_event(event, responses, world_state) -> tuple[bool, str]:
    """T5: 关键事件检测。LLM 评估当天事件是否高影响。返回 (是否命中, 命中原因)。"""
    user = (f"本轮事件：{event.get('title', '')} - {event.get('description', '')}\n"
            f"agent 反应：{[{'name': r.get('name', ''), 'action_detail': r.get('action_detail', ''), 'stance_delta': r.get('stance_delta', ''), 'speech': r.get('speech', '')[:60]} for r in responses]}\n"
            f"世界态势：{world_state.get('summary', '')}\n"
            f"群体状态：{world_state.get('group_state', '')}\n"
            f"指标：{world_state.get('metrics', {})}\n"
            f"判断是否为高影响关键事件：")
    try:
        result = client.complete_json(_KEY_EVENT_SYS, user)
        return bool(result.get("is_key_event", False)), result.get("reason", "")
    except Exception as e:
        logger.warning("key event check failed: %s", e)
        return False, ""


def _generate_stage_summary(world_id, run_id, step, event, responses, world_state) -> dict:
    """T6: 生成阶段摘要，供上帝视角决策。"""
    events = store.list_events(run_id)
    recent_events = [{"step": e.get("time_step"), "title": e.get("title"),
                      "desc": (e.get("description") or "")[:80]} for e in events[-5:]]
    user = (f"当前时间步：Day {step}\n"
            f"本阶段事件：{event.get('title', '')} - {event.get('description', '')}\n"
            f"最近事件历史：{recent_events}\n"
            f"agent 反应：{[{'name': r.get('name', ''), 'action_detail': r.get('action_detail', ''), 'stance_delta': r.get('stance_delta', '')} for r in responses]}\n"
            f"世界态势：{world_state.get('summary', '')}\n"
            f"群体状态：{world_state.get('group_state', '')}\n"
            f"指标：{world_state.get('metrics', {})}\n"
            f"生成阶段摘要：")
    try:
        result = client.complete_json(_STAGE_SUMMARY_SYS, user)
        result["current_step"] = step
        result["world_state_summary"] = world_state.get("summary", "")
        return result
    except Exception as e:
        logger.warning("stage summary generation failed: %s", e)
        return {
            "current_step": step,
            "key_events": [event.get("title", "")],
            "agent_state_changes": [],
            "relationship_changes": [],
            "metric_changes": [],
            "high_impact_variables": [],
            "suggested_interventions": [],
            "world_state_summary": world_state.get("summary", ""),
            "error": str(e),
        }


def _apply_information_release(intervention, agents, event, step, world_id, run_id) -> list[dict]:
    """T7: Information Release 干预 - 只向 visible_to 范围内的 agent 释放信息，写入感知记忆。
    不在 visible_to 范围内的 agent 完全不知道这条信息。"""
    visible_to = intervention.get("visible_to") or []
    description = intervention.get("description", "")
    expected = intervention.get("expected_effect", "")
    target_ids = set(visible_to) if visible_to else {a["agent_id"] for a in agents}

    memories = []
    for agent in agents:
        if agent["agent_id"] not in target_ids:
            continue
        memories.append({
            "agent_id": agent["agent_id"],
            "world_id": world_id,
            "run_id": run_id,
            "memory_type": "perceived_event",
            "time_step": step,
            "source_event_id": event.get("event_id"),
            "content": f"[信息释放] {description}（预期影响：{expected}）",
            "structured_delta": {
                "intervention_type": "information_release",
                "intervention_id": intervention["intervention_id"],
            },
            "is_subjective": True,
        })
    return memories


def run_simulation_stream(world_id: str, run_id: str, max_steps: int = 3, start_step: int = 1) -> Generator[dict, None, None]:
    """流式推演，yield 每个关键步骤的日志和数据。
    支持从 start_step 恢复推演（M5 暂停-恢复），支持上帝干预注入。"""
    world = store.get_world(world_id)
    agents = store.list_agents_with_soul(world_id, include_raw=True)
    agent_names = [a.get("name", "?") for a in agents]

    # 干预模式配置
    intervention_mode = world.get("intervention_mode") or {}
    intervention_enabled = bool(intervention_mode.get("enabled"))
    pause_policy = intervention_mode.get("pause_policy", []) if intervention_enabled else []

    yield {"type": "log", "msg": f"推演启动：{len(agents)} 个 Agent，{max_steps} 天"}
    logger.info("[run] start: world=%s run=%s agents=%d max_steps=%d start_step=%d",
                world_id, run_id, len(agents), max_steps, start_step)
    if start_step > max_steps:
        yield {"type": "log", "msg": "检测到推演已完成所有步骤，保存结果中..."}
    elif start_step > 1:
        yield {"type": "log", "msg": f"[intervention] 从 Day {start_step} 恢复推演"}
    yield {"type": "log", "msg": f"参与角色：{', '.join(agent_names)}"}
    if intervention_enabled:
        yield {"type": "log", "msg": f"[intervention] 干预已开启，暂停策略：{', '.join(pause_policy) or '无'}"}
        logger.info("[run] intervention enabled: policy=%s", pause_policy)

    # 恢复模式：加载历史进度
    if start_step > 1:
        progress = store.load_run_progress(run_id)
        if progress:
            raw_log = progress.get("raw_log") or []
            event_timeline = progress.get("event_timeline") or []
            metric_series = progress.get("metric_series") or []
            relationship_series = progress.get("relationship_series") or []
            # world_state 从 raw_log 最后一项的 state 字段恢复（save_run_progress 不单独存 final_world_state）
            world_state = (raw_log[-1].get("state") if raw_log else None) or world.get("world_state") or {}
            last_responses = raw_log[-1].get("responses", []) if raw_log else []
            yield {"type": "log", "msg": f"[intervention] 已加载历史进度：{len(raw_log)} 天"}
            logger.info("[run] resume loaded: run=%s history_days=%d", run_id, len(raw_log))
        else:
            raw_log, event_timeline, metric_series, relationship_series = [], [], [], []
            last_responses = []
            world_state = world.get("world_state") or {}
            logger.warning("[run] resume requested but no progress found: run=%s", run_id)
    else:
        event_timeline, metric_series, relationship_series, raw_log = [], [], [], []
        last_responses = []
        world_state = world.get("world_state") or {}

    for step in range(start_step, max_steps + 1):
        yield {"type": "log", "msg": f"━━━ Day {step}/{max_steps} 开始 ━━━"}
        logger.info("[run] Day %d/%d start", step, max_steps)

        # 1. 生成事件（T7: 检查是否有 World Event 干预注入）
        pending = store.list_interventions(run_id)
        step_interventions = [iv for iv in pending if iv.get("time_step") == step]
        world_event_iv = next((iv for iv in step_interventions if iv["intervention_type"] == "world_event"), None)
        info_release_ivs = [iv for iv in step_interventions if iv["intervention_type"] == "information_release"]

        if world_event_iv:
            event = {
                "time_step": step,
                "title": f"[上帝干预] {world_event_iv['description'][:40]}",
                "description": world_event_iv["description"],
                "source": "intervention",
                "involved_entities": world_event_iv.get("target_scope", {}).get("involved", []),
                "visible_to": world_event_iv.get("visible_to") or [a["agent_id"] for a in agents],
                "impact_hints": world_event_iv.get("expected_effect", ""),
                "from_intervention_id": world_event_iv["intervention_id"],
            }
            saved_event = store.create_event(run_id, world_id, event)
            event["event_id"] = saved_event["event_id"]
            yield {"type": "log", "msg": f"[Day {step}][intervention] 注入上帝事件：{world_event_iv['description'][:60]}"}
            logger.info("[run] Day %d event from intervention: %s", step, world_event_iv['description'][:60])
        else:
            yield {"type": "log", "msg": f"[Day {step}] 生成事件中..."}
            try:
                event = _gen_event({**world, "world_state": world_state}, agents, last_responses, step, raw_log, max_steps=max_steps)
            except Exception as e:
                logger.exception("[run] Day %d _gen_event failed", step)
                raise
            saved_event = store.create_event(run_id, world_id, event)
            event["event_id"] = saved_event["event_id"]
            yield {"type": "log", "msg": f"[Day {step}] 事件：{event['title']}"}
            logger.info("[run] Day %d event generated: %s", step, event.get('title', '')[:60])

        # T7: Information Release 干预 - 在 agent respond 前写入，让 visible_to 范围内的 agent 当天就能感知
        for iv in info_release_ivs:
            release_mems = _apply_information_release(iv, agents, event, step, world_id, run_id)
            store.create_memories(release_mems)
            yield {"type": "log", "msg": f"[Day {step}][intervention] 信息释放：{iv['description'][:60]}（{len(release_mems)} 个 agent 收到）"}

        # 2. Agent 逐个响应（串行感知：打乱顺序避免先发优势，后发言者能看到前面人的行动）
        responses: list[dict | None] = [None] * len(agents)
        memories = []
        order = list(range(len(agents)))
        random.shuffle(order)
        yield {"type": "log", "msg": f"[Day {step}] 本轮发言顺序：{', '.join(agents[i].get('name', f'Agent-{i}') for i in order)}"}
        logger.info("[run] Day %d respond order: %s", step, [agents[i].get('name', f'Agent-{i}') for i in order])
        current_round_actions: list[dict] = []
        for idx in order:
            agent = agents[idx]
            ai = idx
            aname = agent.get("name", f"Agent-{ai}")
            yield {"type": "log", "msg": f"[Day {step}] {aname} 感知事件中..."}
            perception = actor.perceive(agent, event)

            yield {"type": "log", "msg": f"[Day {step}] {aname} 思考与响应中..."}
            visible_info_releases = [
                iv for iv in info_release_ivs
                if not iv.get("visible_to") or agent["agent_id"] in (iv.get("visible_to") or [])
            ]
            try:
                r = actor.respond(agent, event, perception=perception, prior_actions=current_round_actions, info_releases=visible_info_releases, run_id=run_id)
            except Exception as e:
                logger.exception("[Day %d] %s respond failed", step, aname)
                yield {"type": "log", "msg": f"[Day {step}] {aname} 响应失败，已跳过：{str(e)[:80]}"}
                r = {
                    "agent_id": agent["agent_id"],
                    "action_detail": "",
                    "speech": "（本轮未响应）",
                    "thought": f"系统记录：本轮响应失败 - {str(e)[:120]}",
                    "stance_delta": "",
                    "emotion_delta": "",
                }
            r["name"] = aname
            responses[ai] = r
            current_round_actions.append({"name": aname, "action_detail": r.get("action_detail", "")})
            detail = f"｜{r['action_detail'][:30]}" if r.get("action_detail") else ""
            yield {"type": "log", "msg": f"[Day {step}] {aname}：{r['speech'][:60]}{detail}"}
            logger.info("[run] Day %d %s responded: %s", step, aname, (r.get('action_detail') or '无行动')[:50])

            new_internal = {
                "stance": r["stance_delta"] or agent.get("current_internal_state", {}).get("stance", ""),
                "emotion": r["emotion_delta"] or agent.get("current_internal_state", {}).get("emotion", ""),
                "goal": agent.get("current_internal_state", {}).get("goal", ""),
                "belief": agent.get("current_internal_state", {}).get("belief", ""),
            }
            store.update_agent_state(agent["agent_id"], internal_state=new_internal, memory_summary=r["thought"])
            agent["current_internal_state"] = new_internal
            memories.append({"agent_id": agent["agent_id"], "world_id": world_id, "run_id": run_id,
                "memory_type": "perceived_event", "time_step": step, "source_event_id": event["event_id"],
                "content": f"事件「{event['title']}」：{r['thought']}",
                "structured_delta": {"stance_delta": r["stance_delta"], "emotion_delta": r["emotion_delta"]},
                "is_subjective": True})
            memories.append({"agent_id": agent["agent_id"], "world_id": world_id, "run_id": run_id,
                "memory_type": "action", "time_step": step, "source_event_id": event["event_id"],
                "content": f"我的行动：{r['action_detail']}｜发言：{r['speech']}" if r.get("action_detail") else f"我的反应：{r['speech']}",
                "structured_delta": {"action_detail": r.get("action_detail", "")}, "is_subjective": True})

        # 3. 世界状态更新
        yield {"type": "log", "msg": f"[Day {step}] 更新世界状态..."}
        try:
            world_state = _update_state(world, event, responses, step)
        except Exception as e:
            logger.exception("[run] Day %d _update_state failed", step)
            world_state = {"summary": "", "group_state": "", "metrics": {}}
        yield {"type": "log", "msg": f"[Day {step}] 态势：{world_state.get('summary', '')[:60]}"}
        logger.info("[run] Day %d state updated: %s", step, world_state.get('summary', '')[:60])

        # 4. 扩展记忆
        for i, agent in enumerate(agents):
            extras = _build_extra_memories(agent, event, responses[i], responses, world_state, world_id, run_id, step)
            memories.extend(extras)

        store.create_memories(memories)
        yield {"type": "log", "msg": f"[Day {step}] 写入 {len(memories)} 条记忆"}
        logger.info("[run] Day %d memories written: +%d", step, len(memories))

        # 5. 图谱更新
        yield {"type": "log", "msg": f"[Day {step}] 更新知识图谱..."}
        try:
            delta = graph_updater.extract_graph_delta(world_id, event, responses, step)
            result = graph_updater.apply_graph_delta(world_id, delta, step)
            yield {"type": "log", "msg": f"[Day {step}] 图谱变化：+{result['added_nodes']}节点 +{result['added_edges']}边 ~{result['updated_edges']}边更新"}
            logger.info("[run] Day %d graph updated: +nodes=%d +edges=%d ~edges=%d",
                        step, result['added_nodes'], result['added_edges'], result['updated_edges'])
        except Exception as e:
            logger.warning("[run] Day %d graph delta failed: %s", step, e)
            yield {"type": "log", "msg": f"[Day {step}] 图谱更新跳过：{e}"}

        # 6. 快照
        graph = store.get_full_graph(world_id)
        edges_snapshot = [{"source": e["source_name"], "target": e["target_name"],
                           "relation": e["relation"], "weight": e["weight"]} for e in graph.get("edges", [])]
        metric_series.append({"time_step": step, "metrics": world_state.get("metrics", {})})
        relationship_series.append({"time_step": step, "edges": edges_snapshot})
        event_timeline.append(event)

        # responses 按实际发言顺序重排，前端时间线/报告/导出 HTML 都按此顺序渲染
        ordered_responses = [responses[i] for i in order]
        day_info_releases = [
            {
                "intervention_id": iv.get("intervention_id"),
                "description": iv.get("description", ""),
                "visible_to": iv.get("visible_to") or [],
                "expected_effect": iv.get("expected_effect", ""),
            }
            for iv in info_release_ivs
        ]
        day_data = {"step": step, "event": event, "info_releases": day_info_releases, "responses": ordered_responses, "state": world_state}
        raw_log.append(day_data)
        last_responses = ordered_responses

        # 每天结束保存进度（支持恢复 + 暂停后重载）
        try:
            store.save_run_progress(run_id, max_steps, raw_log, event_timeline, metric_series, relationship_series)
            yield {"type": "log", "msg": f"[Day {step}][intervention] 进度已保存"}
            logger.info("[run] Day %d progress saved", step)
        except Exception as e:
            logger.exception("[run] Day %d save_run_progress failed", step)
            yield {"type": "log", "msg": f"[Day {step}] 进度保存失败：{str(e)[:80]}"}

        # 暂停点检测
        should_pause = False
        pause_reason = None
        if intervention_enabled and step < max_steps:
            if "every_simulated_day" in pause_policy:
                should_pause = True
                pause_reason = "step"
            if "after_key_event" in pause_policy:
                hit, reason = _check_key_event(event, responses, world_state)
                if hit:
                    should_pause = True
                    pause_reason = "key_event"
                    yield {"type": "log", "msg": f"[intervention] 关键事件命中：{reason}"}

        if should_pause:
            # 暂停前先推送 day_complete，让前端拿到当天的 timeline/world_state/graph
            yield {"type": "day_complete", "step": step, "total_steps": max_steps,
                   "data": day_data, "graph_stats": store.get_graph_stats(world_id)}
            yield {"type": "log", "msg": f"━━━ Day {step}/{max_steps} 完成 ━━━"}

            yield {"type": "log", "msg": f"[intervention] 生成阶段摘要..."}
            summary = _generate_stage_summary(world_id, run_id, step, event, responses, world_state)
            store.update_run_status(run_id, "paused", paused_at_step=step,
                                    pause_reason=pause_reason, stage_summary=summary)
            yield {"type": "log", "msg": f"[intervention] 推演暂停（reason={pause_reason}, step={step}）- 等待上帝干预"}
            logger.info("[run] paused: run=%s step=%d reason=%s", run_id, step, pause_reason)
            yield {"type": "pause", "run_id": run_id, "step": step, "total_steps": max_steps,
                   "pause_reason": pause_reason, "stage_summary": summary}
            return  # 结束 SSE 流，等用户干预后 resume

        yield {"type": "day_complete", "step": step, "total_steps": max_steps,
               "data": day_data, "graph_stats": store.get_graph_stats(world_id)}
        yield {"type": "log", "msg": f"━━━ Day {step}/{max_steps} 完成 ━━━"}
        logger.info("[run] Day %d/%d done", step, max_steps)

    # 正常结束
    yield {"type": "log", "msg": "推演完成，保存结果..."}
    logger.info("[run] finishing: run=%s saving final results", run_id)
    store.update_world_state(world_id, world_state, "finished")
    final_graph = store.get_full_graph(world_id)
    final_edges = [{"source": e["source_name"], "target": e["target_name"],
                    "relation": e["relation"], "weight": e["weight"]} for e in final_graph.get("edges", [])]
    store.finish_run(run_id=run_id, total_steps=max_steps, stop_reason="max_steps",
                     final_world_state=world_state, event_timeline=event_timeline,
                     relationship_graph=final_edges, relationship_series=relationship_series,
                     metric_series=metric_series, raw_log=raw_log)
    logger.info("[run] complete: run=%s total_steps=%d", run_id, max_steps)

    yield {"type": "simulation_complete", "run_id": run_id, "total_steps": max_steps, "final_world_state": world_state}


def run_simulation_into(world_id: str, run_id: str, max_steps: int = 3) -> dict:
    for _ in run_simulation_stream(world_id, run_id, max_steps):
        pass
    return store.get_run(run_id)
