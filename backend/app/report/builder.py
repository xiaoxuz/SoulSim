"""报告生成。ReACT 模式 + 图谱工具，分章节生成结构化报告。"""
import json
import logging
import re
import threading
import time

from app.graph import tools as graph_tools
from app.llm import client
from app.repositories import store

logger = logging.getLogger(__name__)

_REPORT_SECTIONS = [
    ("story", "以讲故事的方式，将世界设定和推演所有天数串联成一段精湛干练的叙事。要求：有逻辑、不水篇幅、语句精湛干练、展现世界从初始到终局的演变脉络。输出 JSON：{\"story\": \"叙事正文（一段或分多段，每段聚焦一个阶段）\"}。"),
    ("executive_summary", "生成执行摘要：主要趋势、最可能结果、最大不确定性、关键变量。"),
    ("goal_assessment", "生成目标达成评估章节：明确判断推演目标（simulation_goal）是否被证明/证伪/部分证明。必须包含：① 判断结论（已证明/已证伪/部分证明/未定论）② 判定依据（引用具体事件标题和 agent 反应，附 time_step）③ 如果未定论，说明缺什么证据或条件。使用图谱工具查询关键事件证据。输出 JSON：{\"verdict\": \"已证明|已证伪|部分证明|未定论\", \"reasoning\": \"判定依据\", \"evidence\": [\"事件标题@Day X\", ...], \"gap\": \"如果未定论，缺什么（已定论则留空）\"}。"),
    ("world_setup", "生成世界设定章节：推演目标、协议摘要、关键角色。"),
    ("timeline", "生成事件时间线章节：每轮的关键事件和角色反应。"),
    ("agent_perspectives", "生成角色视角章节：每个 agent 的立场变化和行为总结。"),
    ("relationship_changes", "生成关系变化章节：角色之间的关系如何演变。使用图谱查询工具获取关系数据。"),
    ("metrics", "生成指标章节：各项指标的变化趋势。"),
    ("key_drivers", "生成关键驱动章节：哪些变量影响最大、如果改变会怎样。使用深度洞察工具分析。"),
]

_SECTION_SYS = """你是多 Agent 世界模拟的报告分析师（Report Agent）。
你正在为一次推演生成报告的「{section_name}」章节。

你可以使用以下工具来获取更多信息：
- TOOL:quick_search("查询内容") — 快速搜索特定实体或关系
- TOOL:panorama_search("查询内容") — 全景搜索某个主题
- TOOL:insight_forge("查询内容") — 深度洞察分析
- TOOL:interview_agent("角色名", "问题") — 采访某个角色

使用工具时严格按上面格式输出，一次只用一个工具。
观察到工具结果后继续分析。
当你准备好输出最终内容时，以 FINAL: 开头输出 JSON。

规则：
- 每个结论必须有事件或数据支撑
- 不要编造数据中没有的信息"""

_FALLBACK_SYS = """你是多 Agent 世界模拟的报告生成器。
根据推演数据生成报告的「{section_name}」章节。
输出 JSON。每个结论必须有事件支撑。"""


_SECTION_LABELS = {
    "story": "故事",
    "executive_summary": "执行摘要",
    "goal_assessment": "目标达成评估",
    "world_setup": "世界设定",
    "timeline": "事件时间线",
    "agent_perspectives": "角色视角",
    "relationship_changes": "关系变化",
    "metrics": "指标",
    "key_drivers": "关键驱动",
    "intervention_impact": "干预影响",
}


def _generate_report_inner(run_id: str):
    """实际生成报告的 generator。复用已有 report 记录，跳过已完成章节。

    事件类型：
    - {type: "report_started", report_id, sections, completed}
    - {type: "section_started", section_key, label}
    - {type: "section_completed", section_key, label, data, cached?}
    - {type: "section_error", section_key, label, error}
    - {type: "report_completed", report_id}
    """
    run = store.get_run(run_id)
    if not run:
        logger.warning("[report] run not found: %s", run_id)
        yield {"type": "error", "message": "run not found"}
        return
    world = store.get_world(run["world_id"])
    world_id = run["world_id"]
    agents = store.list_agents(world_id)
    events = store.list_events(run_id)
    interventions = store.list_interventions(run_id)
    logger.info("[report] start: run=%s world=%s agents=%d events=%d interventions=%d",
                run_id, world_id, len(agents), len(events), len(interventions))

    base_context = (
        f"【推演目标（必须回扣，所有章节都要围绕此目标）】\n{world.get('simulation_goal')}\n\n"
        f"参与角色：{[{'name': a['name'], 'role': a.get('role_type')} for a in agents]}\n"
        f"事件时间线：{[{'step': e['time_step'], 'title': e['title'], 'desc': e['description'][:100]} for e in events]}\n"
        f"最终状态：{run.get('final_world_state')}\n"
        f"指标序列：{run.get('metric_series')}\n"
        f"关系变化：{run.get('relationship_series')}"
    )

    existing = store.get_report_by_run(run_id)
    if existing:
        report_id = existing["report_id"]
        completed_keys = [k for k, _ in _REPORT_SECTIONS if existing.get(k) is not None]
        if interventions and existing.get("intervention_impact") is not None:
            completed_keys.append("intervention_impact")
    else:
        report_row = store.create_report(run_id, {})
        report_id = report_row["report_id"]
        completed_keys = []

    section_list = [{"key": k, "label": _SECTION_LABELS.get(k, k)} for k, _ in _REPORT_SECTIONS]
    if interventions:
        section_list.append({"key": "intervention_impact", "label": "干预影响"})
    yield {"type": "report_started", "report_id": report_id, "sections": section_list, "completed": completed_keys}

    for section_key, section_prompt in _REPORT_SECTIONS:
        label = _SECTION_LABELS.get(section_key, section_key)
        if section_key in completed_keys:
            logger.info("[report] section cached: %s", section_key)
            yield {"type": "section_completed", "section_key": section_key, "label": label,
                   "data": existing.get(section_key), "cached": True}
            continue
        logger.info("[report] section start: %s", section_key)
        yield {"type": "section_started", "section_key": section_key, "label": label}
        t_sec = time.time()
        try:
            section_data = _react_section(
                section_key, section_prompt, base_context,
                world_id, run_id, agents,
            )
            store.update_report_section(report_id, section_key, section_data)
            logger.info("[report] section done: %s cost=%.2fs", section_key, time.time() - t_sec)
            yield {"type": "section_completed", "section_key": section_key, "label": label, "data": section_data}
        except Exception as e:
            logger.warning("[report] section failed: %s cost=%.2fs err=%s", section_key, time.time() - t_sec, e)
            yield {"type": "section_error", "section_key": section_key, "label": label, "error": str(e)}

    if interventions:
        label = "干预影响"
        if "intervention_impact" in completed_keys:
            logger.info("[report] section cached: intervention_impact")
            yield {"type": "section_completed", "section_key": "intervention_impact", "label": label,
                   "data": existing.get("intervention_impact"), "cached": True}
        else:
            logger.info("[report] section start: intervention_impact")
            yield {"type": "section_started", "section_key": "intervention_impact", "label": label}
            t_iv = time.time()
            try:
                current_report = store.get_report_by_run(run_id) or {}
                impact = _analyze_intervention_impact(interventions, events, current_report)
                store.update_report_section(report_id, "intervention_impact", impact)
                logger.info("[report] section done: intervention_impact cost=%.2fs", time.time() - t_iv)
                yield {"type": "section_completed", "section_key": "intervention_impact", "label": label, "data": impact}
            except Exception as e:
                logger.warning("[report] intervention_impact failed: cost=%.2fs err=%s", time.time() - t_iv, e)
                yield {"type": "section_error", "section_key": "intervention_impact", "label": label, "error": str(e)}

    try:
        evidence = [{"conclusion": e["title"], "event_ids": [e["event_id"]]} for e in events]
        store.update_report_section(report_id, "evidence_map", evidence)
        logger.info("[report] evidence_map saved: entries=%d", len(evidence))
    except Exception as e:
        logger.warning("[report] evidence_map failed: %s", e)

    logger.info("[report] stream completed: run=%s report=%s", run_id, report_id)
    yield {"type": "report_completed", "report_id": report_id}


class _ReportTaskState:
    """单个 run 的报告生成任务状态。支持多订阅者。"""
    def __init__(self):
        self.events: list[dict] = []
        self.done: bool = False
        self.lock = threading.Lock()

    def append(self, evt: dict) -> None:
        with self.lock:
            self.events.append(evt)
            if evt.get("type") in ("report_completed", "error"):
                self.done = True

    def snapshot_after(self, idx: int) -> tuple[list[dict], bool, int]:
        with self.lock:
            return list(self.events[idx:]), self.done, len(self.events)


_active_tasks: dict[str, _ReportTaskState] = {}
_active_tasks_lock = threading.Lock()


def _run_report_task(run_id: str, state: _ReportTaskState) -> None:
    """后台线程：跑 _generate_report_inner，事件写入 state。"""
    try:
        for evt in _generate_report_inner(run_id):
            state.append(evt)
    except Exception as e:
        logger.exception("report task failed: %s", run_id)
        state.append({"type": "error", "message": str(e)})


def subscribe_report_stream(run_id: str):
    """订阅报告生成进度。首次调用启动后台任务，后续调用（含刷新重连）订阅同一任务。

    已完成的章节会立即以 cached=True 推送给新订阅者，未完成的章节继续生成。
    """
    with _active_tasks_lock:
        state = _active_tasks.get(run_id)
        if state is None:
            state = _ReportTaskState()
            _active_tasks[run_id] = state
            threading.Thread(target=_run_report_task, args=(run_id, state), daemon=True).start()

    sent = 0
    while True:
        events, done, total = state.snapshot_after(sent)
        for evt in events:
            yield evt
            sent += 1
        if done and sent >= total:
            break
        time.sleep(0.3)


def generate_report(run_id: str) -> dict:
    run = store.get_run(run_id)
    world = store.get_world(run["world_id"])
    world_id = run["world_id"]
    agents = store.list_agents(world_id)
    events = store.list_events(run_id)
    interventions = store.list_interventions(run_id)

    base_context = (
        f"【推演目标（必须回扣，所有章节都要围绕此目标）】\n{world.get('simulation_goal')}\n\n"
        f"参与角色：{[{'name': a['name'], 'role': a.get('role_type')} for a in agents]}\n"
        f"事件时间线：{[{'step': e['time_step'], 'title': e['title'], 'desc': e['description'][:100]} for e in events]}\n"
        f"最终状态：{run.get('final_world_state')}\n"
        f"指标序列：{run.get('metric_series')}\n"
        f"关系变化：{run.get('relationship_series')}"
    )

    report = {"intervention_impact": {}}

    for section_key, section_prompt in _REPORT_SECTIONS:
        section_data = _react_section(
            section_key, section_prompt, base_context,
            world_id, run_id, agents,
        )
        report[section_key] = section_data

    # M5: 分析上帝干预对推演的影响
    if interventions:
        report["intervention_impact"] = _analyze_intervention_impact(
            interventions, events, report
        )
        logger.info("[intervention] impact analyzed: run=%s, %d interventions",
                    run_id, len(interventions))

    evidence = []
    for e in events:
        evidence.append({"conclusion": e["title"], "event_ids": [e["event_id"]]})
    report["evidence_map"] = evidence

    return store.create_report(run_id, report)


def _analyze_intervention_impact(interventions: list[dict], events: list[dict], report: dict) -> dict:
    """分析每次上帝干预对推演的实际影响。"""
    iv_data = [{
        "time_step": iv.get("time_step"),
        "type": iv.get("intervention_type"),
        "description": iv.get("description"),
        "expected_effect": iv.get("expected_effect", ""),
    } for iv in interventions]

    min_step = min((iv.get("time_step", 0) for iv in interventions), default=0)
    post_events = [{"step": e["time_step"], "title": e["title"],
                    "desc": (e.get("description") or "")[:100]}
                   for e in events if (e.get("time_step", 0) or 0) >= min_step]

    impact_sys = """你是多 Agent 模拟世界的干预影响分析师。分析每次上帝干预对推演的实际影响。

输出 JSON 对象：
- interventions: array，每个元素包含：
  - time_step: number
  - type: string
  - description: string
  - expected_effect: string
  - actual_effect: string，根据后续事件和 agent 反应分析的实际影响（不超过 80 字）
  - impact_assessment: "高" | "中" | "低"
- summary: string，整体干预对推演的影响总结（不超过 100 字）"""

    user = (f"干预列表：{iv_data}\n\n"
            f"干预时点及之后的事件：{post_events}\n\n"
            f"报告执行摘要：{report.get('executive_summary', {})}\n"
            f"指标变化：{report.get('metrics', {})}\n"
            f"关系变化：{report.get('relationship_changes', {})}\n"
            f"分析干预的实际影响：")

    try:
        result = client.complete_json(impact_sys, user)
        # 回填每个 intervention 的 actual_effect
        for iv in interventions:
            iv_id = iv["intervention_id"]
            analyzed = next((x for x in result.get("interventions", [])
                             if x.get("time_step") == iv.get("time_step")), None)
            if analyzed and analyzed.get("actual_effect"):
                store.update_intervention_result(
                    iv_id, analyzed["actual_effect"], iv.get("resulting_event_id")
                )
        return result
    except Exception as e:
        logger.warning("intervention impact analysis failed: %s", e)
        return {"interventions": iv_data, "summary": "分析失败", "error": str(e)}


def _react_section(
    section_key: str, section_prompt: str, base_context: str,
    world_id: str, run_id: str, agents: list[dict],
) -> dict | list | str:
    """ReACT 循环生成一个章节。最多 3 轮工具调用。"""
    sys_prompt = _SECTION_SYS.format(section_name=section_key)
    conversation = f"基础素材：\n{base_context}\n\n任务：{section_prompt}"

    tool_funcs = {
        "quick_search": lambda args: graph_tools.quick_search(world_id, args[0]),
        "panorama_search": lambda args: graph_tools.panorama_search(world_id, args[0]),
        "insight_forge": lambda args: graph_tools.insight_forge(world_id, args[0], run_id=run_id),
        "interview_agent": lambda args: graph_tools.interview_agent(world_id, run_id, args[0], args[1] if len(args) > 1 else "请分享你的看法"),
    }

    for round_num in range(4):
        response = client.complete(sys_prompt, conversation)

        if "FINAL:" in response:
            json_part = response.split("FINAL:", 1)[1].strip()
            try:
                return client._parse_json(json_part)
            except (json.JSONDecodeError, Exception):
                return json_part

        tool_call = _parse_tool_call(response)
        if tool_call and round_num < 3:
            tool_name, tool_args = tool_call
            func = tool_funcs.get(tool_name)
            if func:
                try:
                    result = func(tool_args)
                    observation = json.dumps(result, ensure_ascii=False, default=str)[:2000]
                except Exception as e:
                    observation = f"工具调用失败：{e}"
                conversation += f"\n\n{response}\n\nObservation: {observation}\n\n继续分析，准备好后以 FINAL: 开头输出 JSON。"
            else:
                conversation += f"\n\n{response}\n\nObservation: 未知工具 {tool_name}\n\n请直接以 FINAL: 开头输出 JSON。"
        else:
            try:
                return client._parse_json(response)
            except (json.JSONDecodeError, Exception):
                break

    return _fallback_section(section_key, section_prompt, base_context)


def _fallback_section(section_key: str, section_prompt: str, base_context: str) -> dict:
    sys_prompt = _FALLBACK_SYS.format(section_name=section_key)
    data = client.complete_json(sys_prompt, f"{base_context}\n\n{section_prompt}")
    if isinstance(data, list):
        return data
    return data


def _parse_tool_call(text: str) -> tuple[str, list[str]] | None:
    match = re.search(r'TOOL:(\w+)\((.+?)\)', text)
    if not match:
        return None
    tool_name = match.group(1)
    args_str = match.group(2)
    args = [a.strip().strip('"\'') for a in args_str.split('",')]
    return tool_name, args
