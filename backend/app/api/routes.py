import json
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.chat import world_agent, report_agent, group_agent
from app.engine import builder
from app.engine.loop import run_simulation_into, run_simulation_stream
from app.graph.builder import build_graph_from_seed
from app.report.builder import generate_report, subscribe_report_stream
from app.repositories import store
from app.soul.extractor import extract as extract_skill

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateWorldReq(BaseModel):
    title: str
    simulation_goal: str = ""
    seed_material: str = ""
    agent_count: int = 5
    simulation_days: int = 3


class BuildWorldReq(BaseModel):
    seed_material: str
    simulation_goal: str
    agent_count: int = 5
    simulation_days: int = 3


class RunReq(BaseModel):
    max_steps: int | None = None


class ImportSkillReq(BaseModel):
    text: str


class BindSkillReq(BaseModel):
    agent_id: str
    skill_profile_id: str


class CreateChatReq(BaseModel):
    run_id: str
    session_type: str  # 'world_agent' | 'report_agent'
    target_agent_id: str | None = None


class CreateGroupChatReq(BaseModel):
    run_id: str
    name: str
    agent_ids: list[str]
    max_rounds: int = 5


class SendMessageReq(BaseModel):
    content: str


def _build_world_task(world_id: str, seed_material: str, simulation_goal: str, agent_count: int = 5, simulation_days: int = 3):
    import time
    t0 = time.time()
    logger.info("[build] start: world=%s agent_count=%d sim_days=%d", world_id, agent_count, simulation_days)
    try:
        logger.info("[build] reset existing data: world=%s", world_id)
        store.reset_world_build_data(world_id)

        logger.info("[build] set state=building: world=%s", world_id)
        store.update_world_state(world_id, {}, "building")

        t1 = time.time()
        logger.info("[build] build_world start: world=%s", world_id)
        world_data = builder.build_world(seed_material, simulation_goal)
        logger.info("[build] build_world done: world=%s cost=%.2fs bg_len=%d",
                    world_id, time.time() - t1, len(world_data.get("world_background", "")))

        t2 = time.time()
        logger.info("[build] build_agents start: world=%s count=%d", world_id, agent_count)
        agents_data = builder.build_agents(
            world_data["world_protocol"], seed_material, simulation_goal,
            entity_graph=world_data.get("entity_graph", {}),
            agent_count=agent_count,
        )
        logger.info("[build] build_agents done: world=%s cost=%.2fs agents=%d",
                    world_id, time.time() - t2, len(agents_data))

        protocol = world_data["world_protocol"]
        protocol["simulation_days"] = simulation_days
        protocol["agent_count"] = agent_count
        logger.info("[build] update_world_build: world=%s", world_id)
        store.update_world_build(
            world_id,
            world_background=world_data["world_background"],
            entity_graph=world_data["entity_graph"],
            world_protocol=protocol,
            status="building",
        )

        logger.info("[build] create_agents: world=%s count=%d", world_id, len(agents_data))
        store.create_agents(world_id, agents_data)

        t3 = time.time()
        logger.info("[build] build_graph_from_seed start: world=%s", world_id)
        build_graph_from_seed(world_id, seed_material, simulation_goal)
        logger.info("[build] build_graph_from_seed done: world=%s cost=%.2fs", world_id, time.time() - t3)

        logger.info("[build] set state=ready: world=%s", world_id)
        store.update_world_state(world_id, {}, "ready")
        store.save_world_baseline(world_id)

        logger.info("[build] complete: world=%s total_cost=%.2fs", world_id, time.time() - t0)
    except Exception as e:
        logger.exception("[build] failed: world=%s cost=%.2fs err=%s", world_id, time.time() - t0, str(e)[:200])
        err_msg = f"{type(e).__name__}: {str(e)[:500]}"
        store.update_world_state(world_id, {"build_error": err_msg}, "build_failed")


def _run_task(world_id: str, run_id: str, max_steps: int):
    try:
        run_simulation_into(world_id, run_id, max_steps)
    except Exception as e:
        logger.exception("simulation failed: %s", run_id)
        store.fail_run(run_id, str(e))


def _report_task(run_id: str):
    try:
        generate_report(run_id)
    except Exception:
        logger.exception("report generation failed: %s", run_id)


@router.post("/worlds")
def create_world(req: CreateWorldReq):
    world = store.create_world(req.title, req.simulation_goal, req.seed_material)
    return world


@router.post("/worlds/{world_id}/build")
def build_world(world_id: str, req: BuildWorldReq, bg: BackgroundTasks):
    w = store.get_world(world_id)
    if not w:
        raise HTTPException(404, "world not found")
    if req.seed_material:
        from app.db.session import get_conn
        with get_conn() as conn:
            conn.execute(
                "UPDATE worlds SET seed_material = %s, simulation_goal = %s WHERE world_id = %s",
                (req.seed_material, req.simulation_goal, world_id),
            )
            conn.commit()
    _persist_build_params(world_id, req.agent_count, req.simulation_days)
    store.update_world_state(world_id, {}, "building")
    bg.add_task(_build_world_task, world_id, req.seed_material, req.simulation_goal, req.agent_count, req.simulation_days)
    return {"status": "building"}


@router.post("/worlds/{world_id}/rebuild")
def rebuild_world(world_id: str, bg: BackgroundTasks):
    """重新构建失败的世界。从 world 读取原 seed_material/simulation_goal，
    用 world_protocol 中的 agent_count/simulation_days（或默认值）重新触发构建。"""
    w = store.get_world(world_id)
    if not w:
        raise HTTPException(404, "world not found")
    if w["status"] != "build_failed":
        raise HTTPException(400, f"world is not in build_failed state (status={w['status']})")
    protocol = w.get("world_protocol") or {}
    agent_count = protocol.get("agent_count", 5)
    simulation_days = protocol.get("simulation_days", 3)
    seed_material = w.get("seed_material") or ""
    simulation_goal = w.get("simulation_goal") or ""
    store.update_world_state(world_id, {}, "building")
    bg.add_task(_build_world_task, world_id, seed_material, simulation_goal, agent_count, simulation_days)
    logger.info("[rebuild] world=%s agent_count=%d sim_days=%d", world_id, agent_count, simulation_days)
    return {"status": "building"}


def _persist_build_params(world_id: str, agent_count: int, simulation_days: int) -> None:
    """构建启动前先把 agent_count/simulation_days 存到 world_protocol，
    这样即使构建失败，前端回填 Step 1 表单时也能拿到原参数。"""
    from app.db.session import get_conn
    with get_conn() as conn:
        conn.execute(
            """UPDATE worlds SET world_protocol = jsonb_set(
                jsonb_set(COALESCE(world_protocol, '{}'::jsonb), '{agent_count}', %s::jsonb),
                '{simulation_days}', %s::jsonb)
               WHERE world_id = %s""",
            (str(agent_count), str(simulation_days), world_id),
        )
        conn.commit()


@router.get("/worlds")
def list_worlds():
    return store.list_worlds()


@router.get("/worlds/{world_id}")
def get_world(world_id: str):
    w = store.get_world(world_id)
    if not w:
        raise HTTPException(404, "world not found")
    return w


@router.get("/worlds/{world_id}/agents")
def list_agents(world_id: str):
    return store.list_agents_with_soul(world_id)


@router.get("/worlds/{world_id}/runs")
def list_runs(world_id: str):
    return store.list_runs(world_id)


@router.post("/worlds/{world_id}/run")
def start_run(world_id: str, req: RunReq, bg: BackgroundTasks):
    w = store.get_world(world_id)
    if not w:
        raise HTTPException(404, "world not found")
    protocol = w.get("world_protocol") or {}
    max_steps = req.max_steps or protocol.get("simulation_days", 3)
    try:
        run = store.create_run_from_baseline(world_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    bg.add_task(_run_task, world_id, run["run_id"], max_steps)
    return run


@router.post("/worlds/{world_id}/run/stream")
def start_run_stream(world_id: str, req: RunReq):
    import queue
    import threading

    w = store.get_world(world_id)
    if not w:
        raise HTTPException(404, "world not found")
    protocol = w.get("world_protocol") or {}
    max_steps = req.max_steps or protocol.get("simulation_days", 3)
    try:
        run = store.create_run_from_baseline(world_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

    q: queue.Queue = queue.Queue()

    def worker():
        try:
            for evt in run_simulation_stream(world_id, run["run_id"], max_steps):
                q.put(evt)
        except Exception as e:
            logger.exception("simulation stream failed: %s", run["run_id"])
            store.fail_run(run["run_id"], str(e))
            q.put({"type": "error", "message": str(e)})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def event_generator():
        yield f"data: {json.dumps({'type': 'run_started', 'run_id': run['run_id'], 'total_steps': max_steps}, ensure_ascii=False)}\n\n"
        while True:
            try:
                evt = q.get(timeout=120)
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'log', 'msg': '等待中...'}, ensure_ascii=False)}\n\n"
                continue
            if evt is None:
                break
            yield f"data: {json.dumps(evt, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/runs/{run_id}/resume/stream")
def resume_run_stream(run_id: str):
    """恢复暂停的推演。从 paused_at_step+1 继续推演，应用 pending interventions。
    支持 paused 状态（用户上帝干预后继续）、running 状态（前端刷新后 SSE 断开重连）、
    failed 状态（某环节出错中断后断点继续）。"""
    import queue
    import threading

    run = store.get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    if run["status"] not in ("paused", "running", "failed"):
        raise HTTPException(400, f"run is not resumable (status={run['status']})")

    world_id = run["world_id"]
    paused_at = run.get("paused_at_step") or 0
    if run["status"] == "paused":
        start_step = paused_at + 1
    else:
        # running/failed 重连：从 raw_log 长度推断 start_step（loop.py 内部基于此判断是否加载历史）
        raw_log = run.get("raw_log") or []
        start_step = len(raw_log) + 1
    world = store.get_world(world_id)
    protocol = world.get("world_protocol") or {}
    max_steps = protocol.get("simulation_days", 3)

    if start_step > max_steps:
        progress = store.load_run_progress(run_id) or {}
        raw_log = progress.get("raw_log") or run.get("raw_log") or []
        final_world_state = (raw_log[-1].get("state") if raw_log else None) or world.get("world_state") or {}
        event_timeline = progress.get("event_timeline") or run.get("event_timeline") or []
        metric_series = progress.get("metric_series") or run.get("metric_series") or []
        relationship_series = progress.get("relationship_series") or run.get("relationship_series") or []
        final_graph = store.get_full_graph(world_id)
        final_edges = [{"source": e["source_name"], "target": e["target_name"],
                        "relation": e["relation"], "weight": e["weight"]} for e in final_graph.get("edges", [])]
        store.update_world_state(world_id, final_world_state, "finished")
        store.finish_run(run_id=run_id, total_steps=max_steps, stop_reason="max_steps",
                         final_world_state=final_world_state, event_timeline=event_timeline,
                         relationship_graph=final_edges, relationship_series=relationship_series,
                         metric_series=metric_series, raw_log=raw_log)

        def completed_generator():
            yield f"data: {json.dumps({'type': 'resume_started', 'run_id': run_id, 'start_step': start_step, 'total_steps': max_steps}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'log', 'msg': '推演已完成所有步骤，直接进入报告阶段'}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'simulation_complete', 'run_id': run_id, 'total_steps': max_steps, 'final_world_state': final_world_state}, ensure_ascii=False, default=str)}\n\n"

        return StreamingResponse(completed_generator(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    store.update_run_status(run_id, "running")
    logger.info("[intervention] resume: run=%s from step=%d (prev_status=%s)", run_id, start_step, run["status"])

    q: queue.Queue = queue.Queue()

    def worker():
        try:
            for evt in run_simulation_stream(world_id, run_id, max_steps, start_step=start_step):
                q.put(evt)
        except Exception as e:
            logger.exception("resume stream failed: %s", run_id)
            store.fail_run(run_id, str(e))
            q.put({"type": "error", "message": str(e)})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def event_generator():
        yield f"data: {json.dumps({'type': 'resume_started', 'run_id': run_id, 'start_step': start_step, 'total_steps': max_steps}, ensure_ascii=False)}\n\n"
        while True:
            try:
                evt = q.get(timeout=120)
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'log', 'msg': '等待中...'}, ensure_ascii=False)}\n\n"
                continue
            if evt is None:
                break
            yield f"data: {json.dumps(evt, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    r = store.get_run(run_id)
    if not r:
        raise HTTPException(404, "run not found")
    return r


@router.post("/runs/{run_id}/report")
def make_report(run_id: str, bg: BackgroundTasks):
    r = store.get_run(run_id)
    if not r:
        raise HTTPException(404, "run not found")
    bg.add_task(_report_task, run_id)
    return {"status": "generating"}


@router.post("/runs/{run_id}/report/stream")
def make_report_stream(run_id: str):
    """SSE 流式生成报告。每章节完成立即推送，单章节失败不影响整体。"""
    import queue
    import threading

    run = store.get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")

    q: queue.Queue = queue.Queue()

    def worker():
        try:
            for evt in subscribe_report_stream(run_id):
                q.put(evt)
        except Exception as e:
            logger.exception("report stream failed: %s", run_id)
            q.put({"type": "error", "message": str(e)})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def event_generator():
        while True:
            try:
                evt = q.get(timeout=180)
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'log', 'msg': '生成中...'}, ensure_ascii=False)}\n\n"
                continue
            if evt is None:
                break
            yield f"data: {json.dumps(evt, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/runs/{run_id}/report")
def get_report(run_id: str):
    report = store.get_report_by_run(run_id)
    if not report:
        raise HTTPException(404, "report not found")
    return report


@router.get("/agents/{agent_id}/memories")
def get_memories(agent_id: str):
    return store.list_memories(agent_id)


# ---------- skill profiles ----------

@router.post("/skill-profiles/import")
def import_skill(req: ImportSkillReq):
    if not req.text.strip():
        raise HTTPException(400, "empty text")
    profile = extract_skill(req.text)
    saved = store.create_skill_profile(profile)
    return saved


@router.get("/skill-profiles")
def list_skill_profiles():
    return store.list_skill_profiles()


@router.get("/skill-profiles/{sp_id}")
def get_skill_profile(sp_id: str):
    sp = store.get_skill_profile(sp_id)
    if not sp:
        raise HTTPException(404, "skill profile not found")
    return sp


# ---------- graph ----------

@router.get("/worlds/{world_id}/graph")
def get_graph(world_id: str):
    return store.get_full_graph(world_id)


@router.get("/worlds/{world_id}/graph/stats")
def get_graph_stats(world_id: str):
    return store.get_graph_stats(world_id)


@router.get("/worlds/{world_id}/graph/nodes")
def list_graph_nodes(world_id: str, type: str | None = None):
    return store.list_nodes(world_id, entity_type=type)


@router.get("/worlds/{world_id}/ontology")
def get_ontology(world_id: str):
    onto = store.get_ontology(world_id)
    if not onto:
        raise HTTPException(404, "ontology not found")
    return onto


@router.post("/agents/bind-skill")
def bind_skill(req: BindSkillReq):
    sp = store.get_skill_profile(req.skill_profile_id)
    if not sp:
        raise HTTPException(404, "skill profile not found")
    agent = store.bind_skill_profile(req.agent_id, req.skill_profile_id)
    if not agent:
        raise HTTPException(404, "agent not found")
    return agent


# ---------- chat ----------

@router.post("/chat/sessions")
def create_chat_session(req: CreateChatReq):
    run = store.get_run(req.run_id)
    if not run:
        raise HTTPException(404, "run not found")
    session = store.create_chat_session(
        req.run_id, run["world_id"], req.session_type, req.target_agent_id,
    )
    return session


@router.get("/chat/sessions/{session_id}")
def get_chat_session(session_id: str):
    s = store.get_chat_session(session_id)
    if not s:
        raise HTTPException(404, "session not found")
    return s


@router.get("/chat/sessions/{session_id}/messages")
def list_chat_messages(session_id: str):
    return store.list_chat_messages(session_id)


@router.post("/chat/sessions/{session_id}/messages")
def send_chat_message(session_id: str, req: SendMessageReq):
    session = store.get_chat_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    if session["session_type"] == "group":
        raise HTTPException(400, "group sessions must use /messages/stream endpoint")
    if session["session_type"] == "world_agent":
        response = world_agent.chat(session_id, req.content)
    else:
        response = report_agent.chat(session_id, req.content)
    return {"role": "assistant", "content": response}


@router.get("/runs/{run_id}/chat-sessions")
def list_run_chat_sessions(run_id: str):
    return store.list_chat_sessions(run_id)


# ---------- group chat ----------

@router.post("/chat/group-sessions")
def create_group_chat_session(req: CreateGroupChatReq):
    run = store.get_run(req.run_id)
    if not run:
        raise HTTPException(404, "run not found")
    if len(req.agent_ids) < 2:
        raise HTTPException(400, "group chat needs at least 2 agents")
    session = store.create_group_chat_session(
        req.run_id, run["world_id"], req.name, req.agent_ids, req.max_rounds,
    )
    return session


@router.get("/chat/sessions/{session_id}/members")
def get_chat_session_members(session_id: str):
    return store.list_chat_session_members(session_id)


@router.post("/chat/sessions/{session_id}/messages/stream")
def send_group_chat_message_stream(session_id: str, req: SendMessageReq):
    import queue
    import threading

    session = store.get_chat_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    if session["session_type"] != "group":
        raise HTTPException(400, "not a group session")

    q: queue.Queue = queue.Queue()

    def worker():
        try:
            for evt in group_agent.chat_stream(session_id, req.content):
                q.put(evt)
        except Exception as e:
            logger.exception("group chat failed: %s", session_id)
            q.put({"type": "error", "message": str(e)})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def event_generator():
        while True:
            try:
                evt = q.get(timeout=120)
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'log', 'msg': '等待中...'}, ensure_ascii=False)}\n\n"
                continue
            if evt is None:
                break
            yield f"data: {json.dumps(evt, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- memories enhanced ----------

@router.get("/agents/{agent_id}/life-history")
def get_life_history(agent_id: str):
    return store.get_agent_life_history(agent_id)


# ---------- interventions (M5 上帝干预) ----------

class CreateInterventionReq(BaseModel):
    time_step: int
    intervention_type: str  # 'world_event' | 'information_release'
    description: str
    target_scope: dict = {}
    structured_patch: dict = {}
    visible_to: list = []
    expected_effect: str = ""


class InterventionModeReq(BaseModel):
    enabled: bool = False
    pause_policy: list[str] = ["every_simulated_day", "after_key_event", "before_report"]
    intervention_scope: list[str] = ["world_event", "information_release"]


@router.post("/worlds/{world_id}/intervention-mode")
def set_intervention_mode(world_id: str, req: InterventionModeReq):
    w = store.get_world(world_id)
    if not w:
        raise HTTPException(404, "world not found")
    mode = {
        "enabled": req.enabled,
        "pause_policy": req.pause_policy,
        "intervention_scope": req.intervention_scope,
    }
    store.update_intervention_mode(world_id, mode)
    logger.info("[intervention] mode updated: world=%s enabled=%s policy=%s",
                world_id, req.enabled, req.pause_policy)
    return {"world_id": world_id, "intervention_mode": mode}


@router.post("/runs/{run_id}/interventions")
def create_intervention(run_id: str, req: CreateInterventionReq):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    iv = store.create_intervention(
        world_id=run["world_id"],
        run_id=run_id,
        time_step=req.time_step,
        intervention_type=req.intervention_type,
        description=req.description,
        target_scope=req.target_scope,
        structured_patch=req.structured_patch,
        visible_to=req.visible_to,
        expected_effect=req.expected_effect,
    )
    logger.info("[intervention] created: run=%s step=%d type=%s desc=%s",
                run_id, req.time_step, req.intervention_type, req.description[:60])
    return iv


@router.get("/runs/{run_id}/interventions")
def list_interventions(run_id: str):
    return store.list_interventions(run_id)


@router.get("/runs/{run_id}/stage-summary")
def get_stage_summary(run_id: str):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return {
        "run_id": run_id,
        "status": run["status"],
        "paused_at_step": run.get("paused_at_step"),
        "pause_reason": run.get("pause_reason"),
        "stage_summary": run.get("stage_summary") or {},
        "total_steps": run.get("total_steps", 0),
    }
