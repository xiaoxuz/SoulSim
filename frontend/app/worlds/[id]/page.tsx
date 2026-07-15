"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, apiFetch, isDemoMode } from "@/lib/api";
import { buildExportHtml } from "@/lib/exportHtml";
import { KnowledgeGraph, graphColor, type GraphStats } from "@/components/KnowledgeGraph";
import { StepIndicator } from "@/components/StepIndicator";
import { AgentResponseCard, AGENT_COLORS } from "@/components/AgentResponseCard";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function WorldWorkbench() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === "new";
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [world, setWorld] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [streamingRun, setStreamingRun] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportSections, setReportSections] = useState<Record<string, any>>({});
  const [reportSectionProgress, setReportSectionProgress] = useState<{ key: string; label: string; status: "pending" | "running" | "done" | "error"; error?: string }[]>([]);
  const [currentStep, setCurrentStep] = useState(isNew ? 1 : 2);
  const [graphKey, setGraphKey] = useState(0);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [actionLoading, setActionLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logExpanded, setLogExpanded] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [manualStep, setManualStep] = useState(false);
  const [staleWarning, setStaleWarning] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"split" | "workspace" | "world">("split");
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
  const layoutOptions = [
    ["world", "世界"],
    ["split", "并排"],
    ["workspace", "工作台"],
  ] as const;

  // Step 1
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [seed, setSeed] = useState("");
  const [agentCount, setAgentCount] = useState(5);
  const [simDays, setSimDays] = useState(3);
  const [interventionEnabled, setInterventionEnabled] = useState(true);

  // Step 2 soul import
  const [skillText, setSkillText] = useState("");
  const [skillTarget, setSkillTarget] = useState("");
  const [importing, setImporting] = useState(false);

  // Step 5 chat
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatTarget, setChatTarget] = useState<string>("Report Agent");
  const [sessionCache, setSessionCache] = useState<Record<string, string>>({});
  const [chatMode, setChatMode] = useState<"direct" | "group">("direct");
  const [groupSessions, setGroupSessions] = useState<any[]>([]);
  const [activeGroupSessionId, setActiveGroupSessionId] = useState<string | null>(null);
  const [groupMessages, setGroupMessages] = useState<any[]>([]);
  const [groupInput, setGroupInput] = useState("");
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupStreamCount, setGroupStreamCount] = useState(0);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [selectedGroupAgents, setSelectedGroupAgents] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [groupMaxRounds, setGroupMaxRounds] = useState(5);
  const groupEndRef = useRef<HTMLDivElement>(null);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [agentThoughts, setAgentThoughts] = useState<Record<string, { status: string; text: string }>>({});
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const groupInputRef = useRef<HTMLTextAreaElement>(null);

  // Expanded agents in Step 3
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const toggleAgent = useCallback((key: string) => {
    setExpandedAgents(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  }, []);
  // Collapsed days in Step 3 timeline
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(new Set());
  const toggleDay = useCallback((step: number) => {
    setCollapsedDays(prev => { const s = new Set(prev); s.has(step) ? s.delete(step) : s.add(step); return s; });
  }, []);
  // 每完成一天，自动折叠之前的天，只展开最新一天
  const prevLogLenRef = useRef(0);
  useEffect(() => {
    const newLen = (selectedRun?.raw_log || []).length;
    if (newLen > prevLogLenRef.current && newLen > 0) {
      setCollapsedDays(prev => {
        const s = new Set(prev);
        for (let i = 1; i <= newLen - 1; i++) s.add(i);
        s.delete(newLen);
        return s;
      });
    }
    prevLogLenRef.current = newLen;
  }, [selectedRun?.raw_log?.length]);
  // Collapsed days in Step 4 report timeline
  const [collapsedRptDays, setCollapsedRptDays] = useState<Set<number>>(new Set());
  const toggleRptDay = useCallback((step: number) => {
    setCollapsedRptDays(prev => { const s = new Set(prev); s.has(step) ? s.delete(step) : s.add(step); return s; });
  }, []);
  // Collapsed sections in Step 4 report
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = useCallback((id: string) => {
    setCollapsedSections(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }, []);

  // --- M5 上帝干预状态 ---
  const [pausedInfo, setPausedInfo] = useState<{ step: number; totalSteps: number; pauseReason: string; stageSummary: any } | null>(null);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [interventionType, setInterventionType] = useState<"world_event" | "information_release">("world_event");
  const [interventionDesc, setInterventionDesc] = useState("");
  const [interventionExpected, setInterventionExpected] = useState("");
  const [interventionVisibleTo, setInterventionVisibleTo] = useState<string[]>([]);
  const [interventionSubmitting, setInterventionSubmitting] = useState(false);

  // 从 run 数据重构日志：刷新页面后日志控制台仍能看到推演过程
  function rebuildLogsFromRun(run: any, ivs: any[] = []): string[] {
    if (!run) return [];
    const logs: string[] = [];
    const total = run.total_steps || run.raw_log?.length || 0;
    const rawLog: any[] = run.raw_log || [];
    if (rawLog.length === 0) return logs;
    const agentNames = rawLog[0]?.responses?.map((r: any) => r.name).filter(Boolean) || [];
    logs.push(`推演启动：${agentNames.length} 个 Agent，${total} 天`);
    if (agentNames.length > 0) logs.push(`参与角色：${agentNames.join(", ")}`);
    // 按 time_step 索引干预，便于对应到 Day
    const ivByStep: Record<number, any[]> = {};
    for (const iv of ivs) {
      const t = iv.time_step ?? iv.timeStep;
      if (!ivByStep[t]) ivByStep[t] = [];
      ivByStep[t].push(iv);
    }
    for (const day of rawLog) {
      const step = day.step;
      logs.push(`━━━ Day ${step}/${total} 开始 ━━━`);
      const event = day.event || {};
      const isIntervention = event.source === "intervention";
      if (isIntervention) {
        logs.push(`[Day ${step}][intervention] 注入上帝事件：${(event.description || "").slice(0, 60)}`);
      } else {
        logs.push(`[Day ${step}] 生成事件中...`);
        logs.push(`[Day ${step}] 事件：${event.title || ""}`);
      }
      for (const r of day.responses || []) {
        logs.push(`[Day ${step}] ${r.name} 感知事件中...`);
        logs.push(`[Day ${step}] ${r.name} 思考与响应中...`);
        const detail = r.action_detail ? `｜${r.action_detail.slice(0, 30)}` : "";
        logs.push(`[Day ${step}] ${r.name}：${(r.speech || "").slice(0, 60)}${detail}`);
      }
      logs.push(`[Day ${step}] 更新世界状态...`);
      logs.push(`[Day ${step}] 态势：${(day.state?.summary || "").slice(0, 60)}`);
      // 信息释放干预
      const infoIvs = (ivByStep[step] || []).filter(iv => iv.intervention_type === "information_release");
      for (const iv of infoIvs) {
        const recipients = iv.visible_to?.length ?? agentNames.length;
        logs.push(`[Day ${step}][intervention] 信息释放：${(iv.description || "").slice(0, 60)}（${recipients} 个 agent 收到）`);
      }
      logs.push(`[Day ${step}] 写入 ${(day.responses?.length || 0)} 条记忆`);
      logs.push(`[Day ${step}] 更新知识图谱...`);
      logs.push(`[Day ${step}][intervention] 进度已保存`);
      logs.push(`━━━ Day ${step}/${total} 完成 ━━━`);
    }
    if (run.status === "paused") {
      logs.push(`[intervention] 生成阶段摘要...`);
      logs.push(`[intervention] 推演暂停（reason=${run.pause_reason || "step"}, step=${run.paused_at_step || total}）- 等待上帝干预`);
    } else if (run.status === "finished") {
      logs.push(`推演完成，保存结果...`);
      logs.push(`✓ 推演完成！`);
    }
    return logs;
  }

  function clearRunScopedState() {
    setReport(null);
    setReportSections({});
    setReportSectionProgress([]);
    setReportGenerating(false);
    setPausedInfo(null);
    setInterventions([]);
    setLogs([]);
    setChatSessionId(null);
    setChatMessages([]);
    setSessionCache({});
    setGroupSessions([]);
    setActiveGroupSessionId(null);
    setGroupMessages([]);
    setGroupMembers([]);
    setAgentThoughts({});
  }

  async function selectRun(runId: string, opts?: { step?: number }) {
    setSelectedRunId(runId);
    clearRunScopedState();
    const full = await api.getRun(runId);
    setSelectedRun(full);

    let ivs: any[] = [];
    try {
      ivs = await api.listInterventions(runId);
      setInterventions(ivs);
    } catch {}

    if (full.status === "paused") {
      try {
        const summary = await api.getStageSummary(runId);
        setPausedInfo({
          step: summary.paused_at_step || full.total_steps || 0,
          totalSteps: full.total_steps || 0,
          pauseReason: summary.pause_reason || "step",
          stageSummary: summary.stage_summary || {},
        });
      } catch {}
    }

    if (full.status === "finished") {
      try {
        const rpt = await api.getReport(runId);
        setReport(rpt);
        if (!isReportComplete(rpt)) connectReportStream(runId, { reset: false });
      } catch {}
    }

    const rebuilt = rebuildLogsFromRun(full, ivs);
    if (rebuilt.length > 0) setLogs(rebuilt);
    if (opts?.step) {
      setManualStep(true);
      setCurrentStep(opts.step);
    }
  }

  // --- Data loading ---
  const loadWorld = useCallback(async () => {
    if (isNew) return;
    try {
      const w = await api.getWorld(id);
      setWorld(w);
      setLoading(false);
      if (w.status !== "draft" && w.status !== "building") {
        const a = await api.listAgents(id);
        setAgents(a);
      }
      const r = await api.listRuns(id);
      setRuns(r);
      if (r.length > 0) {
        const bestRun = r.find((x: any) => x.status === "paused")
          || r.find((x: any) => x.status === "running")
          || r.find((x: any) => x.status === "finished")
          || r.find((x: any) => x.status === "failed")
          || r[0];
        await selectRun(bestRun.run_id);
      }
    } catch { setLoading(false); }
  }, [id, isNew]);

  useEffect(() => { loadWorld(); }, [loadWorld]);

  // --- 回填 Step 1 表单：已存在的世界点回 Step 1 时显示原提交参数 ---
  const formHydratedRef = useRef(false);
  useEffect(() => {
    if (isDemoMode && isNew && !formHydratedRef.current) {
      formHydratedRef.current = true;
      api.getWorld(id).then((w: any) => {
        setTitle(w.title || "");
        setGoal(w.simulation_goal || "");
        setSeed(w.seed_material || "");
        setAgentCount(w.world_protocol?.agent_count || 5);
        setSimDays(w.world_protocol?.simulation_days || 3);
        setInterventionEnabled(Boolean(w.intervention_mode?.enabled));
      }).catch(() => {});
      return;
    }
    if (isNew || !world || formHydratedRef.current) return;
    formHydratedRef.current = true;
    if (world.title) setTitle(world.title);
    if (world.simulation_goal) setGoal(world.simulation_goal);
    if (world.seed_material) setSeed(world.seed_material);
    const protocol = world.world_protocol || {};
    if (protocol.agent_count) setAgentCount(protocol.agent_count);
    if (protocol.simulation_days) setSimDays(protocol.simulation_days);
    const im = world.intervention_mode || {};
    if (typeof im.enabled === "boolean") setInterventionEnabled(im.enabled);
  }, [world, isNew]);

  // --- Portal 注入到全局 nav 右侧 ---
  useEffect(() => {
    setNavSlot(document.getElementById("nav-right-slot"));
    return () => setNavSlot(null);
  }, []);

  // --- Step auto-detection ---
  useEffect(() => {
    if (isNew) { setCurrentStep(1); return; }
    if (!world) return;
    if (streamingRun) { setManualStep(false); setCurrentStep(3); return; }
    if (manualStep) return;
    if (world.status === "draft") { setCurrentStep(1); return; }
    if (world.status === "building") { setCurrentStep(2); return; }
    if (world.status === "build_failed") { setCurrentStep(2); return; }
    if (!selectedRun) { setCurrentStep(2); return; }
    if (selectedRun.status === "running") { setCurrentStep(3); return; }
    if (selectedRun.status === "paused") { setCurrentStep(3); return; }
    if (selectedRun.status === "finished" && !report) {
      setCurrentStep(prev => prev === 5 ? 5 : prev === 4 ? 4 : 3);
      return;
    }
    if (report) { setCurrentStep(prev => prev === 5 ? 5 : 4); return; }
  }, [world, selectedRun, report, runs, isNew, streamingRun, manualStep]);

  // --- Polling ---
  useEffect(() => {
    if (!world || world.status !== "building") return;
    setLogs(prev => prev.length === 0 ? ["世界构建启动...", "正在分析种子材料，生成世界协议..."] : prev);
    let tick = 0;
    const buildMsgs = ["生成实体图谱中...", "抽取关键角色...", "构建 Agent 人设...", "生成 SkillProfile...", "构建知识图谱..."];
    const t = setInterval(async () => {
      tick++;
      if (tick <= buildMsgs.length) setLogs(prev => [...prev, buildMsgs[tick - 1]]);
      const w = await api.getWorld(id);
      setWorld(w);
      if (w.status !== "building") {
        clearInterval(t);
        setLogs(prev => [...prev, "✓ 世界构建完成！"]);
        const a = await api.listAgents(id);
        setAgents(a);
        setGraphKey(k => k + 1);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [world?.status, id]);

  // Step 5 进入时预加载已有 chat sessions → sessionCache + groupSessions
  // --- Running 轮询：SSE 断开后（如刷新页面）持续跟进后端 worker 进度 ---
  // 后端 daemon worker 断开后仍会跑完，每天 save_run_progress 写入 raw_log。
  // 前端轮询 getRun 拿到 raw_log 增长，不用重连 SSE（重连会启动第二个 worker）。
  useEffect(() => {
    if (!selectedRun || selectedRun.status !== "running" || streamingRun) {
      setStaleWarning(false);
      return;
    }
    const rid = selectedRun.run_id;
    let lastLen = (selectedRun.raw_log || []).length;
    let lastUpdateTime = Date.now();
    const t = setInterval(async () => {
      try {
        const full = await api.getRun(rid);
        const newLen = (full.raw_log || []).length;
        if (newLen !== lastLen) {
          lastLen = newLen;
          lastUpdateTime = Date.now();
          setStaleWarning(false);
        } else if (Date.now() - lastUpdateTime > 60000) {
          setStaleWarning(true);
        }
        setSelectedRun(full);
        setRuns(prev => prev.map(r => r.run_id === rid ? { ...r, status: full.status, total_steps: full.total_steps, completed_steps: (full.raw_log || []).length, stop_reason: full.stop_reason, pause_reason: full.pause_reason, paused_at_step: full.paused_at_step, report_id: full.report_id } : r));
        const rebuilt = rebuildLogsFromRun(full, []);
        if (rebuilt.length > 0) setLogs(prev => prev.length > 0 && prev[prev.length - 1] === rebuilt[rebuilt.length - 1] ? prev : rebuilt);
        if (full.status === "finished") {
          clearInterval(t);
          setStaleWarning(false);
          try {
            const rpt = await api.getReport(rid);
            setReport(rpt);
            if (!isReportComplete(rpt)) connectReportStream(rid, { reset: false });
          } catch {}
        } else if (full.status === "paused") {
          clearInterval(t);
          setStaleWarning(false);
          try {
            const summary = await api.getStageSummary(rid);
            setPausedInfo({
              step: summary.paused_at_step || full.total_steps || 0,
              totalSteps: full.total_steps || 0,
              pauseReason: summary.pause_reason || "step",
              stageSummary: summary.stage_summary || {},
            });
            const ivs = await api.listInterventions(rid);
            setInterventions(ivs);
          } catch {}
        } else if (full.status === "failed") {
          clearInterval(t);
          setStaleWarning(false);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRun?.run_id, selectedRun?.status, streamingRun]);

  useEffect(() => {
    if (currentStep !== 5 || !selectedRun?.run_id) return;
    (async () => {
      try {
        const sessions = await api.listRunChatSessions(selectedRun.run_id);
        const cache: Record<string, string> = {};
        const groups: any[] = [];
        for (const s of sessions) {
          if (s.session_type === "group") {
            groups.push(s);
          } else {
            const key = s.target_agent_id || "report_agent";
            if (!cache[key]) cache[key] = s.session_id;
          }
        }
        setSessionCache(cache);
        setGroupSessions(groups);
      } catch {}
    })();
  }, [currentStep, selectedRun?.run_id]);

  // SSE 模式下不需要 running 轮询，由 handleStartRun 的 fetch stream 处理

  // --- Actions ---
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setActionLoading(true);
    setLogs(["创建世界..."]);
    try {
      const w = await api.createWorld(title);
      setLogs(prev => [...prev, `世界 ${w.world_id.slice(0, 8)}... 创建成功`]);
      setLogs(prev => [...prev, "启动构建任务..."]);
      await api.buildWorld(w.world_id, { seed_material: seed, simulation_goal: goal, agent_count: agentCount, simulation_days: simDays });
      await api.setInterventionMode(w.world_id, interventionEnabled);
      setLogs(prev => [...prev, `[intervention] 上帝干预已${interventionEnabled ? "开启" : "关闭"}`]);
      setWorld({ ...w, status: "building", simulation_goal: goal, title });
      router.replace(`/worlds/${w.world_id}`);
      setLoading(false);
    } catch { alert("创建失败"); setLogs(prev => [...prev, "✗ 创建失败"]); }
    setActionLoading(false);
  }

  async function handleRebuild() {
    if (!world) return;
    setActionLoading(true);
    setLogs(["重新构建世界..."]);
    try {
      await api.rebuildWorld(world.world_id);
      setWorld({ ...world, status: "building", world_state: {} });
      setLogs(prev => [...prev, "构建任务已重新启动"]);
    } catch (e: any) {
      alert(`重建失败：${e?.message || e}`);
      setLogs(prev => [...prev, "✗ 重建失败"]);
    }
    setActionLoading(false);
  }

  function handleStartRun() {
    setActionLoading(true);
    setStreamingRun(true);
    setCurrentStep(3);
    clearRunScopedState();
    setSelectedRunId(null);
    setSelectedRun({ status: "running", raw_log: [], total_steps: 0 });

    const url = api.startRunStream(id);
    apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then(async (res) => {
      if (!res.ok || !res.body) { alert("启动失败"); setActionLoading(false); setStreamingRun(false); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { processSSEEvent(JSON.parse(line.slice(6))); } catch {}
        }
      }
      setActionLoading(false);
      setStreamingRun(false);
    }).catch(() => { setLogs(prev => [...prev, "✗ 连接失败"]); setActionLoading(false); setStreamingRun(false); });
  }

  // SSE 事件处理（handleStartRun 和 handleResumeRun 共用）
  function processSSEEvent(evt: any) {
    if (evt.type === "log") {
      setLogs(prev => [...prev, evt.msg]);
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } else if (evt.type === "run_started") {
      const newRun = { run_id: evt.run_id, total_steps: evt.total_steps, completed_steps: 0, status: "running" };
      setSelectedRunId(evt.run_id);
      setSelectedRun((prev: any) => ({ ...prev, ...newRun }));
      setRuns(prev => [newRun, ...prev.filter(r => r.run_id !== evt.run_id)]);
      setLogs(prev => [...prev, `Run ${evt.run_id.slice(0,8)}... 创建成功，开始 ${evt.total_steps} 天推演`]);
    } else if (evt.type === "day_complete") {
      setSelectedRun((prev: any) => ({
        ...prev,
        raw_log: [...(prev?.raw_log || []), evt.data],
        total_steps: evt.total_steps,
      }));
      setRuns(prev => prev.map(r => r.run_id === (evt.run_id || selectedRun?.run_id) ? { ...r, total_steps: evt.total_steps, completed_steps: (r.completed_steps || 0) + 1 } : r));
      setGraphKey(k => k + 1);
      if (evt.graph_stats) setGraphStats(evt.graph_stats);
    } else if (evt.type === "pause") {
      setPausedInfo({ step: evt.step, totalSteps: evt.total_steps, pauseReason: evt.pause_reason, stageSummary: evt.stage_summary });
      setSelectedRun((prev: any) => ({ ...prev, run_id: evt.run_id || prev?.run_id, status: "paused" }));
      setRuns(prev => prev.map(r => r.run_id === evt.run_id ? { ...r, status: "paused" } : r));
      setStreamingRun(false);
      setActionLoading(false);
      setLogs(prev => [...prev, `[intervention] 推演暂停（Day ${evt.step}，原因：${evt.pause_reason}）- 等待上帝干预`]);
      const rid = evt.run_id;
      if (rid) api.listInterventions(rid).then(setInterventions).catch(() => {});
    } else if (evt.type === "resume_started") {
      setPausedInfo(null);
      setSelectedRun((prev: any) => ({ ...prev, status: "running" }));
      setStreamingRun(true);
      setLogs(prev => [...prev, evt.start_step > evt.total_steps ? "[intervention] 推演天数已满，正在完成收束" : `[intervention] 恢复推演：从 Day ${evt.start_step} 继续`]);
    } else if (evt.type === "simulation_complete") {
      setSelectedRunId(evt.run_id);
      setSelectedRun((prev: any) => ({ ...prev, status: "finished", run_id: evt.run_id, total_steps: evt.total_steps, final_world_state: evt.final_world_state }));
      setRuns(prev => prev.map(r => r.run_id === evt.run_id ? { ...r, status: "finished", total_steps: evt.total_steps } : r));
      setActionLoading(false);
      setStreamingRun(false);
      setLogs(prev => [...prev, "✓ 推演完成！"]);
      api.getRun(evt.run_id).then(setSelectedRun);
      setGraphKey(k => k + 1);
    } else if (evt.type === "error") {
      setLogs(prev => [...prev, `✗ 错误：${evt.message}`]);
      setSelectedRun((prev: any) => prev ? ({ ...prev, status: "failed", stop_reason: evt.message }) : prev);
      setRuns(prev => prev.map(r => r.run_id === selectedRun?.run_id ? { ...r, status: "failed" } : r));
      setActionLoading(false);
      setStreamingRun(false);
    }
  }

  async function handleExportHtml() {
    if (!world || !selectedRun) return;
    try {
      setActionLoading(true);
      const graph = await api.getGraph(worldId);
      const html = buildExportHtml({
        world,
        report: report || {},
        rawLog: (selectedRun?.raw_log || []) as any[],
        graph,
        agents,
      });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeTitle = (world.title || "soulsim").replace(/[\\/:*?"<>|]/g, "_");
      a.download = `${safeTitle}-推演报告.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLogs(prev => [...prev, "✓ 已导出 HTML 报告"]);
    } catch (e: any) {
      setLogs(prev => [...prev, `✗ 导出失败：${e?.message || e}`]);
    } finally {
      setActionLoading(false);
    }
  }

  function handleResumeRun() {
    const rid = selectedRun?.run_id;
    if (!rid) return;
    setActionLoading(true);
    setStreamingRun(true);
    setLogs(prev => [...prev, `[intervention] 连接恢复流...`]);
    apiFetch(api.resumeRunStreamUrl(rid)).then(async (res) => {
      if (!res.ok || !res.body) { alert("恢复失败"); setActionLoading(false); setStreamingRun(false); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { processSSEEvent(JSON.parse(line.slice(6))); } catch {}
        }
      }
      setActionLoading(false);
      setStreamingRun(false);
    }).catch(() => { setLogs(prev => [...prev, "✗ 恢复连接失败"]); setActionLoading(false); setStreamingRun(false); });
  }

  async function handleSubmitIntervention() {
    const rid = selectedRun?.run_id;
    if (!rid || !interventionDesc.trim()) return;
    setInterventionSubmitting(true);
    try {
      const nextStep = (pausedInfo?.step || 0) + 1;
      await api.createIntervention(rid, {
        time_step: nextStep,
        intervention_type: interventionType,
        description: interventionDesc.trim(),
        expected_effect: interventionExpected.trim(),
        visible_to: interventionType === "information_release" ? interventionVisibleTo : [],
        target_scope: {},
        structured_patch: {},
      });
      setLogs(prev => [...prev, `[intervention] 已提交${interventionType === "world_event" ? "世界事件" : "信息释放"}干预（Day ${nextStep}）：${interventionDesc.trim().slice(0, 60)}`]);
      setInterventionDesc("");
      setInterventionExpected("");
      setInterventionVisibleTo([]);
      const list = await api.listInterventions(rid);
      setInterventions(list);
    } catch (e: any) {
      setLogs(prev => [...prev, `[intervention] ✗ 提交失败：${e.message}`]);
    } finally {
      setInterventionSubmitting(false);
    }
  }

  const REPORT_SECTION_KEYS = ["story", "executive_summary", "goal_assessment", "world_setup", "timeline", "agent_perspectives", "relationship_changes", "metrics", "key_drivers"];
  function isReportComplete(rpt: any): boolean {
    if (!rpt) return false;
    return REPORT_SECTION_KEYS.every(k => rpt[k] != null);
  }

  function connectReportStream(runId: string, opts: { reset: boolean }) {
    if (opts.reset) {
      setReport(null);
      setReportSections({});
      setReportSectionProgress([]);
    }
    setReportGenerating(true);

    function processReportSSEEvent(evt: any) {
      if (evt.type === "report_started") {
        const sections = evt.sections || [];
        const completedSet = new Set<string>(evt.completed || []);
        setReportSectionProgress(sections.map((s: any) => ({
          key: s.key, label: s.label,
          status: completedSet.has(s.key) ? "done" as const : "pending" as const,
        })));
        setReport((prev: any) => prev ? { ...prev, report_id: evt.report_id } : { report_id: evt.report_id, run_id: runId });
      } else if (evt.type === "section_started") {
        setReportSectionProgress(prev => prev.map(s => s.key === evt.section_key ? { ...s, status: "running" } : s));
      } else if (evt.type === "section_completed") {
        setReportSectionProgress(prev => prev.map(s => s.key === evt.section_key ? { ...s, status: "done" } : s));
        setReportSections(prev => ({ ...prev, [evt.section_key]: evt.data }));
        setReport((prev: any) => ({ ...prev, [evt.section_key]: evt.data }));
      } else if (evt.type === "section_error") {
        setReportSectionProgress(prev => prev.map(s => s.key === evt.section_key ? { ...s, status: "error", error: evt.error } : s));
      } else if (evt.type === "report_completed") {
        api.getReport(runId).then(rpt => {
          setReport(rpt);
          setRuns(prev => prev.map(r => r.run_id === runId ? { ...r, report_id: rpt.report_id } : r));
          setReportGenerating(false);
          setActionLoading(false);
        });
      } else if (evt.type === "error") {
        alert(`报告生成错误: ${evt.message}`);
        setReportGenerating(false);
        setActionLoading(false);
      }
    }

    const url = api.makeReportStreamUrl(runId);
    apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then(async (res) => {
      if (!res.ok || !res.body) { alert("启动报告生成失败"); setReportGenerating(false); setActionLoading(false); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { processReportSSEEvent(JSON.parse(line.slice(6))); } catch {}
        }
      }
      setReportGenerating(false);
      setActionLoading(false);
    }).catch(() => { alert("报告生成连接失败"); setReportGenerating(false); setActionLoading(false); });
  }

  async function handleMakeReport() {
    if (!selectedRun?.run_id) return;
    setActionLoading(true);
    setCurrentStep(4);
    connectReportStream(selectedRun.run_id, { reset: true });
  }

  async function handleImportSkill() {
    if (!skillText.trim() || !skillTarget) return;
    setImporting(true);
    try {
      const sp = await api.importSkill(skillText);
      await api.bindSkill(skillTarget, sp.skill_profile_id);
      const a = await api.listAgents(id);
      setAgents(a);
      setSkillText(""); setSkillTarget("");
    } catch { alert("注入失败"); }
    setImporting(false);
  }

  async function handleSelectChat(agentId: string | null, name: string) {
    if (!selectedRun?.run_id) return;
    const runId = selectedRun.run_id;
    setChatTarget(name);
    setChatLoading(true);
    const cacheKey = agentId || "report_agent";
    const existingSessionId = sessionCache[cacheKey];
    if (existingSessionId) {
      setChatSessionId(existingSessionId);
      try {
        const msgs = await api.listChatMessages(existingSessionId);
        setChatMessages(msgs);
      } catch { setChatMessages([]); }
    } else {
      setChatMessages([]);
      try {
        const type = agentId ? "world_agent" : "report_agent";
        const sess = await api.createChatSession(runId, type, agentId || undefined);
        setChatSessionId(sess.session_id);
        setSessionCache(prev => ({ ...prev, [cacheKey]: sess.session_id }));
      } catch {}
    }
    setChatLoading(false);
  }

  async function handleSendChat() {
    if (!chatInput.trim() || !chatSessionId) return;
    const msg = chatInput;
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setChatLoading(true);
    try {
      const resp = await api.sendChatMessage(chatSessionId, msg);
      setChatMessages(prev => [...prev, { role: "assistant", content: resp.content }]);
    } catch { setChatMessages(prev => [...prev, { role: "assistant", content: "回复失败，请重试" }]); }
    setChatLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  // --- Group chat ---
  async function handleCreateGroup() {
    if (!groupName.trim() || selectedGroupAgents.size < 2 || !selectedRun?.run_id) return;
    const runId = selectedRun.run_id;
    setGroupLoading(true);
    try {
      const sess = await api.createGroupChatSession(runId, groupName, Array.from(selectedGroupAgents), groupMaxRounds);
      setGroupSessions(prev => [...prev, sess]);
      setActiveGroupSessionId(sess.session_id);
      setGroupMessages([]);
      setAgentThoughts({});
      const members = await api.listChatSessionMembers(sess.session_id);
      setGroupMembers(members);
      setShowCreateGroup(false);
      setGroupName("");
      setSelectedGroupAgents(new Set());
    } catch { alert("创建群聊失败"); }
    setGroupLoading(false);
  }

  async function handleSelectGroup(sessionId: string) {
    setActiveGroupSessionId(sessionId);
    setGroupLoading(true);
    setAgentThoughts({});
    try {
      const [msgs, members] = await Promise.all([
        api.listChatMessages(sessionId),
        api.listChatSessionMembers(sessionId),
      ]);
      setGroupMessages(msgs);
      setGroupMembers(members);
    } catch { setGroupMessages([]); setGroupMembers([]); }
    setGroupLoading(false);
  }

  function handleGroupInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setGroupInput(val);
    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      setMentionFilter(atMatch[1]);
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
    }
  }

  function insertMention(name: string) {
    const val = groupInput;
    const el = groupInputRef.current;
    const cursorPos = el?.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf("@");
    const before = val.slice(0, atIdx);
    const after = val.slice(cursorPos);
    const newVal = `${before}@${name} ${after}`;
    setGroupInput(newVal);
    setShowMentionDropdown(false);
    setTimeout(() => el?.focus(), 0);
  }

  function getAgentIntro(member: any): string {
    const sp = member.sp_identity;
    if (sp && typeof sp === "object") {
      const parts = [sp.domain, sp.background].filter(Boolean);
      return parts.join(" · ") || member.role_type || "";
    }
    const bc = member.birth_context;
    if (bc && typeof bc === "object" && typeof bc.identity === "string") return bc.identity;
    return member.role_type || "";
  }

  function agentBgColor(color: string): string {
    const map: Record<string, string> = {
      cyan: "rgba(34,211,238,0.2)",
      amber: "rgba(251,191,36,0.2)",
      emerald: "rgba(52,211,153,0.2)",
      violet: "rgba(167,139,250,0.2)",
      rose: "rgba(251,113,133,0.2)",
    };
    return map[color] || "rgba(34,211,238,0.2)";
  }

  function handleSendGroupMessage() {
    if (!groupInput.trim() || !activeGroupSessionId) return;
    const msg = groupInput;
    setGroupInput("");
    setShowMentionDropdown(false);
    setGroupMessages(prev => [...prev, { role: "user", content: msg }]);
    setGroupStreamCount(prev => prev + 1);

    const url = api.sendGroupMessageStreamUrl(activeGroupSessionId);
    apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: msg }) }).then(async (res) => {
      if (!res.ok || !res.body) { setGroupStreamCount(prev => Math.max(0, prev - 1)); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "agent_response") {
              setGroupMessages(prev => [...prev, { role: "assistant", content: evt.content, agent_name: evt.agent_name, agent_id: evt.agent_id }]);
              setAgentThoughts(prev => ({ ...prev, [evt.agent_id]: { status: "responded", text: "" } }));
            } else if (evt.type === "agent_thinking") {
              setAgentThoughts(prev => ({ ...prev, [evt.agent_id]: { status: "thinking", text: "思考中..." } }));
            } else if (evt.type === "agent_skip") {
              setAgentThoughts(prev => ({ ...prev, [evt.agent_id]: { status: "skipped", text: "—" } }));
            }
          } catch {}
        }
      }
      setGroupStreamCount(prev => Math.max(0, prev - 1));
      setTimeout(() => groupEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }).catch(() => { setGroupStreamCount(prev => Math.max(0, prev - 1)); });
  }

  // --- Report data unwrap (LLM often double-nests section keys) ---
  function rptVal(key: string): any {
    if (!report) return null;
    const v = report[key];
    if (!v) return null;
    if (typeof v === "object" && !Array.isArray(v) && v[key] != null) return v[key];
    return v;
  }
  function rptArr(key: string, innerKey?: string): any[] {
    const v = rptVal(key);
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const k = innerKey || Object.keys(v).find(k => Array.isArray(v[k]));
      if (k && Array.isArray(v[k])) return v[k];
    }
    return [];
  }
  function renderValue(v: any, depth = 0): React.ReactNode {
    if (v == null) return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return v.map((item, i) => (
      <div key={i} className={depth > 0 ? "ml-2" : ""}>
        {typeof item === "string" ? <p>• {item}</p> : typeof item === "object" ? (
          <div className="mt-1 p-2 rounded" style={{ background: depth === 0 ? "rgba(0,0,0,0.15)" : "transparent" }}>
            {Object.entries(item).map(([k2, v2]) => (
              <div key={k2}><strong style={{ color: "var(--text-primary)" }}>{k2}:</strong> {renderValue(v2, depth + 1)}</div>
            ))}
          </div>
        ) : <p>• {String(item)}</p>}
      </div>
    ));
    if (typeof v === "object") return (
      <div className={depth > 0 ? "ml-2" : ""}>
        {Object.entries(v).map(([k, val]) => (
          <div key={k} className="mt-1"><strong style={{ color: "var(--text-primary)" }}>{k}:</strong> {renderValue(val, depth + 1)}</div>
        ))}
      </div>
    );
    return String(v);
  }

  // --- Derived data ---
  const rawLog = (selectedRun?.raw_log || []) as any[];
  const configuredDays = (world?.world_protocol as any)?.simulation_days || selectedRun?.total_steps || 0;
  const isPausedAtFinalStep = selectedRun?.status === "paused" && configuredDays > 0 && (pausedInfo?.step || rawLog.length) >= configuredDays;
  const agentNames: string[] = [];
  const agentIdMap: Record<string, string> = {};
  rawLog.forEach((entry: any) => {
    (entry.responses || []).forEach((r: any) => {
      if (r.name && !agentNames.includes(r.name)) { agentNames.push(r.name); agentIdMap[r.name] = r.agent_id; }
    });
  });
  const protocol = (world?.world_protocol || {}) as any;
  const worldId = isNew ? "" : id;
  const demoStepOneLocked = isDemoMode && isNew;

  // maxReached: 用户已实际到达的最高步骤（回看时 StepIndicator 保持已完成样式）
  const maxReached = (() => {
    if (isNew) return 1;
    if (!world || world.status === "draft") return 1;
    if (world.status === "building") return 2;
    if (!selectedRun) return 2;
    if (selectedRun.status === "running" || selectedRun.status === "paused" || selectedRun.status === "failed" || streamingRun) return 3;
    if (selectedRun.status === "finished" && !report) return 3;
    if (report) return 5;
    return currentStep;
  })();

  // --- Render ---
  if (loading) return (
    <div className="flex items-center justify-center" style={{ height: "calc(100vh - 60px)", color: "var(--text-muted)" }}>
      <span className="status-dot status-dot-building" style={{ width: 10, height: 10 }} />
      <span className="text-sm ml-3">加载中</span>
    </div>
  );

  return (
    <div className={`world-layout world-layout--${layoutMode}`}>
      {/* 布局切换：通过 Portal 注入到全局 nav 右侧 #nav-right-slot */}
      {navSlot && createPortal(
        <div className="layout-switcher">
          {layoutOptions.map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => setLayoutMode(mode)} className={`layout-option ${layoutMode === mode ? "layout-option-active" : ""}`}>
              {label}
            </button>
          ))}
        </div>,
        navSlot
      )}
      {/* ═══ LEFT: 观测面板 — 图谱满屏 + 浮层信息 ═══ */}
      <aside className="world-observer">
        {/* 图谱铺满整个面板 */}
        {worldId && world && world.status !== "draft" && world.status !== "building" ? (
          <KnowledgeGraph key={graphKey} worldId={worldId} fill onStatsLoaded={setGraphStats} />
        ) : (
          <div className="flex flex-col items-center justify-center" style={{ width: "100%", height: "100%", background: "var(--bg-deep)" }}>
            <svg width="80" height="80" viewBox="0 0 80 80" style={{ color: "var(--text-muted)", opacity: 0.1 }}>
              <circle cx="25" cy="25" r="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="55" cy="25" r="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="40" cy="55" r="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <line x1="33" y1="25" x2="47" y2="25" stroke="currentColor" strokeWidth="1" />
              <line x1="28" y1="33" x2="37" y2="47" stroke="currentColor" strokeWidth="1" />
              <line x1="52" y1="33" x2="43" y2="47" stroke="currentColor" strokeWidth="1" />
            </svg>
            <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>知识图谱将在构建后出现</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)", opacity: 0.5 }}>可缩放 · 可拖拽 · 可点击节点查看详情</p>
          </div>
        )}

        {/* 顶部浮层：世界信息 */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 15,
          padding: "16px 20px",
          background: "linear-gradient(180deg, rgba(6,8,13,0.85) 0%, rgba(6,8,13,0.6) 70%, transparent 100%)",
          pointerEvents: "none",
        }}>
          <div style={{ pointerEvents: "auto" }}>
            <Link href="/" className="text-xs inline-flex items-center gap-1 mb-3 transition-colors" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)" }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              WORLDS
            </Link>
          </div>
          {world ? (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-chakra)", textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{world.title}</h2>
                <span className={`tag tag-${world.status === "ready" || world.status === "finished" ? "emerald" : world.status === "building" ? "cyan" : "muted"}`} style={{ fontSize: 9 }}>
                  {world.status}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
                {world.simulation_goal}
              </p>
            </div>
          ) : isNew ? (
            <div>
              <h2 className="text-lg font-bold text-gradient" style={{ fontFamily: "var(--font-chakra)" }}>NEW WORLD</h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>配置种子材料开始构建</p>
            </div>
          ) : null}
        </div>

        {/* 底部浮层：统计信息 */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 15,
          padding: "12px 20px",
          background: "linear-gradient(0deg, rgba(6,8,13,0.85) 0%, rgba(6,8,13,0.6) 70%, transparent 100%)",
        }}>
          <div className="flex items-center gap-3 flex-wrap" style={{ fontSize: 10, fontFamily: "var(--font-chakra)", letterSpacing: "0.06em" }}>
            {agents.length > 0 && (
              <span style={{ color: "var(--accent-cyan)" }}>{agents.length} AGENTS</span>
            )}
            {selectedRun?.status === "finished" && (
              <span style={{ color: "var(--accent-amber)" }}>{selectedRun.total_steps} DAYS</span>
            )}
            {graphStats && (
              <>
                <span style={{ color: "var(--text-muted)" }}>{graphStats.node_count} NODES</span>
                <span style={{ color: "var(--text-muted)" }}>{graphStats.edge_count} EDGES</span>
              </>
            )}
            {graphStats?.type_distribution && (
              <div className="flex items-center gap-2 ml-auto">
                {graphStats.type_distribution.slice(0, 6).map(td => (
                  <span key={td.entity_type} className="flex items-center gap-1" style={{ color: "var(--text-muted)", fontSize: 9 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: graphColor(td.entity_type), display: "inline-block" }} />
                    {td.entity_type}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ═══ RIGHT: 工作台 ═══ */}
      <section className="world-workbench">
        <div className="workbench-topbar">
          <div className="flex-1">
            <StepIndicator current={currentStep} maxReached={maxReached} onStepClick={(s) => { setManualStep(true); setCurrentStep(s); }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="workbench-content">

            {/* ═══ STEP 1: 种子输入 ═══ */}
            {currentStep === 1 && (
              <form onSubmit={handleCreate} className="animate-in space-y-6">
                <div className="step-header">
                  <div>
                    <p className="step-kicker">WORLD CREATION</p>
                    <h2 className="step-title text-gradient">创建新世界</h2>
                    <p className="step-subtitle">输入世界设定、推演目标和初始材料，系统会生成知识图谱与具备独立立场的 Agent。</p>
                    {demoStepOneLocked && (
                      <p className="text-xs mt-3" style={{ color: "var(--accent-amber)", fontFamily: "var(--font-chakra)", letterSpacing: "0.04em" }}>
                        DEMO DATA LOCKED · 体验站将使用这组已完成推演数据回放完整流程
                      </p>
                    )}
                  </div>
                </div>
                <div className="reading-section">
                  <div className="grid gap-4">
                    <div>
                      <label className="label block" style={{ fontFamily: "var(--font-chakra)" }}>WORLD NAME</label>
                      <input value={title} onChange={e => setTitle(e.target.value)} required disabled={demoStepOneLocked} placeholder="如：社区舆论演化" />
                    </div>
                    <div>
                      <label className="label block" style={{ fontFamily: "var(--font-chakra)" }}>SIMULATION GOAL</label>
                      <input value={goal} onChange={e => setGoal(e.target.value)} required disabled={demoStepOneLocked} placeholder="如：在 5 天内，谣言会因权威澄清而衰减" />
                      <p className="text-xs mt-2" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                        建议写成可证伪命题，如「在 X 条件下，A 会在 N 天内发生变化」，而不是只写「观察 A 与 B 的关系」。
                      </p>
                    </div>
                    <div>
                      <label className="label block" style={{ fontFamily: "var(--font-chakra)" }}>SEED MATERIAL</label>
                      <textarea value={seed} onChange={e => setSeed(e.target.value)} required disabled={demoStepOneLocked} rows={9} placeholder="描述世界的背景设定、关键角色、初始条件..." />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="label block" style={{ fontFamily: "var(--font-chakra)" }}>AGENT COUNT</label>
                    <div className="choice-grid mt-2">{[3, 5, 8, 10].map(n => (
                      <button key={n} type="button" disabled={demoStepOneLocked} onClick={() => setAgentCount(n)} className={`choice-card ${agentCount === n ? "choice-card-active" : ""}`}>
                        <span className="choice-value">{n}</span>
                        <span className="choice-label">Agents</span>
                      </button>
                    ))}</div>
                  </div>
                  <div>
                    <label className="label block" style={{ fontFamily: "var(--font-chakra)" }}>SIMULATION DAYS</label>
                    <div className="choice-grid mt-2">{[3, 5, 7, 10].map(n => (
                      <button key={n} type="button" disabled={demoStepOneLocked} onClick={() => setSimDays(n)} className={`choice-card ${simDays === n ? "choice-card-active" : ""}`}>
                        <span className="choice-value">{n}</span>
                        <span className="choice-label">Days</span>
                      </button>
                    ))}</div>
                  </div>
                </div>
                {/* M5 上帝干预开关 */}
                <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.04)", marginTop: 16 }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs" style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", letterSpacing: "0.1em" }}>GOD INTERVENTION</p>
                      <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>开启上帝干预</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>推演每天暂停一次，你可以注入事件或释放信息，干预后续演化</p>
                    </div>
                    <button
                      type="button"
                      disabled={demoStepOneLocked}
                      onClick={() => setInterventionEnabled(!interventionEnabled)}
                      style={{
                        width: 44, height: 24, borderRadius: 12, border: "1px solid var(--border)",
                        background: interventionEnabled ? "rgba(167,139,250,0.2)" : "var(--bg-deep)",
                        position: "relative", cursor: "pointer", transition: "background 0.2s",
                      }}
                    >
                      <span style={{
                        position: "absolute", top: 2, left: interventionEnabled ? 22 : 2,
                        width: 18, height: 18, borderRadius: "50%", background: interventionEnabled ? "var(--accent-violet)" : "var(--text-muted)",
                        transition: "left 0.2s, background 0.2s",
                      }} />
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={actionLoading || (!!world && world.status !== "draft")} className="btn-primary w-full justify-center">
                  {actionLoading || world?.status === "building"
                    ? <><span className="status-dot status-dot-building" /> 构建中...</>
                    : (world && world.status !== "draft" ? "世界已构建" : "开始构建")}
                </button>
              </form>
            )}

            {/* ═══ STEP 2: 世界构建 ═══ */}
            {currentStep === 2 && (
              <div className="animate-in">
                {world?.status === "building" ? (
                  <div className="text-center py-20">
                    <div className="status-dot status-dot-building mx-auto mb-4" style={{ width: 14, height: 14 }} />
                    <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-chakra)" }}>世界构建中</h3>
                    <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>正在分析种子材料，生成知识图谱和 Agent 人设...</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>每 3 秒自动刷新</p>
                  </div>
                ) : world?.status === "build_failed" ? (
                  <div className="space-y-6">
                    <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-rose)", background: "rgba(251,113,133,0.06)" }}>
                      <p className="step-kicker" style={{ color: "var(--accent-rose)" }}>BUILD FAILED</p>
                      <h2 className="step-title" style={{ color: "var(--accent-rose)" }}>世界构建失败</h2>
                      <p className="step-subtitle">可能是 LLM 上游临时故障或种子材料过长。可点击下方按钮重新构建。</p>
                      {world?.world_state?.build_error && (
                        <div className="mt-3 p-3" style={{ background: "rgba(0,0,0,0.3)", borderRadius: 6, border: "1px solid var(--border)" }}>
                          <p className="text-xs mb-1" style={{ color: "var(--accent-rose)", fontFamily: "var(--font-chakra)", letterSpacing: "0.08em" }}>ERROR DETAIL</p>
                          <p className="text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.6, fontFamily: "monospace", wordBreak: "break-all" }}>{world.world_state.build_error}</p>
                        </div>
                      )}
                      <div className="mt-3 text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.7 }}>
                        <p><span style={{ color: "var(--text-secondary)" }}>推演目标：</span>{world?.simulation_goal || "（未设置）"}</p>
                        <p className="mt-1"><span style={{ color: "var(--text-secondary)" }}>种子材料：</span>{(world?.seed_material || "").slice(0, 100)}{(world?.seed_material || "").length > 100 ? "..." : ""}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleRebuild}
                      disabled={actionLoading}
                      className="btn-primary w-full justify-center text-base py-3"
                    >
                      {actionLoading ? <><span className="status-dot status-dot-building" /> 重建中...</> : "重新构建世界"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="step-header">
                      <div>
                        <p className="step-kicker">WORLD READY</p>
                        <h2 className="step-title">世界构建完成</h2>
                        <p className="step-subtitle">世界背景、Agent 档案和知识图谱已经生成，可以继续调整 Agent 灵魂或启动模拟。</p>
                      </div>
                    </div>
                    {world?.world_background && (
                      <div className="reading-section">
                        <h3 className="reading-title">世界背景</h3>
                        <p className="reading-body">{world.world_background}</p>
                      </div>
                    )}
                    {agents.length > 0 && (
                      <div>
                        <p className="label mb-2" style={{ fontFamily: "var(--font-chakra)" }}>AGENTS · {agents.length}</p>
                        <div className="space-y-3">
                          {agents.map((a: any, i: number) => {
                            const color = AGENT_COLORS[i % AGENT_COLORS.length];
                            const sp = a.skill_profile;
                            const hasSkill = sp?.raw_content_length > 100 || (sp?.raw_content && sp.raw_content.length > 100);
                            const state = a.current_internal_state || {};
                            return (
                              <details key={a.agent_id} className="card-static overflow-hidden" style={{ borderLeft: `3px solid var(--accent-${color})` }}>
                                <summary className="p-3" style={{ cursor: "pointer", listStyle: "none" }}>
                                  <div className="agent-row" style={{ border: "none", background: "transparent", padding: 0 }}>
                                    <div className="avatar-circle" style={{ width: 30, height: 30, background: agentBgColor(color), color: `var(--accent-${color})`, fontSize: 11, fontFamily: "var(--font-chakra)" }}>{a.name?.[0] || "?"}</div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold" style={{ color: `var(--accent-${color})`, fontFamily: "var(--font-chakra)" }}>{a.name}</span>
                                        {hasSkill && <span className="meta-line">Skill profile</span>}
                                      </div>
                                      <p className="meta-line truncate">{a.role_type || "Agent"} · {a.birth_context?.identity || "未设置身份描述"}</p>
                                      {state.stance && <p className="meta-line truncate">立场：{state.stance}</p>}
                                    </div>
                                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>详情</span>
                                  </div>
                                </summary>
                                {sp && (
                                  <div className="px-3 pb-3 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
                                    {sp.identity && typeof sp.identity === "object" && (
                                      <div className="pt-2">
                                        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 9, letterSpacing: "0.06em" }}>IDENTITY</span>
                                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{sp.identity.name} · {sp.identity.domain} · {sp.identity.background}</p>
                                      </div>
                                    )}
                                    {sp.mental_models && Array.isArray(sp.mental_models) && sp.mental_models.length > 0 && (
                                      <div>
                                        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 9, letterSpacing: "0.06em" }}>MENTAL MODELS</span>
                                        <div className="mt-0.5 space-y-0.5">
                                          {sp.mental_models.map((m: any, mi: number) => (
                                            <p key={mi} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                              • {typeof m === "string" ? m : `${m.name}：${m.description}`}
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {sp.decision_rules && Array.isArray(sp.decision_rules) && sp.decision_rules.length > 0 && (
                                      <div>
                                        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 9, letterSpacing: "0.06em" }}>DECISION RULES</span>
                                        <div className="mt-0.5 space-y-0.5">
                                          {sp.decision_rules.map((r: any, ri: number) => (
                                            <p key={ri} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                              • {typeof r === "string" ? r : `${r.trigger} → ${r.rule}`}
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {sp.expression_style && typeof sp.expression_style === "object" && (
                                      <div>
                                        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 9, letterSpacing: "0.06em" }}>EXPRESSION STYLE</span>
                                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                                          语气{sp.expression_style.tone} · 节奏{sp.expression_style.rhythm} · 用词{sp.expression_style.vocabulary}
                                        </p>
                                      </div>
                                    )}
                                    {sp.values && Array.isArray(sp.values) && sp.values.length > 0 && (
                                      <div>
                                        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 9, letterSpacing: "0.06em" }}>VALUES</span>
                                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{sp.values.map((v: any) => String(v)).join(" · ")}</p>
                                      </div>
                                    )}
                                    {sp.anti_patterns && Array.isArray(sp.anti_patterns) && sp.anti_patterns.length > 0 && (
                                      <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-rose)", background: "rgba(251,113,133,0.04)", padding: "8px 10px" }}>
                                        <span className="text-xs" style={{ color: "var(--accent-rose)", fontFamily: "var(--font-chakra)", fontSize: 9, letterSpacing: "0.06em" }}>ANTI-PATTERNS</span>
                                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{sp.anti_patterns.map((ap: any) => String(ap)).join(" · ")}</p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </details>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Soul Import */}
                    <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.04)" }}>
                      <p className="step-kicker" style={{ color: "var(--accent-violet)" }}>SOUL INJECTION</p>
                      <p className="meta-line mb-3">粘贴 SKILL.md 内容为 Agent 注入灵魂</p>
                      <textarea value={skillText} onChange={e => setSkillText(e.target.value)} rows={4} placeholder="粘贴 SKILL.md 内容..." />
                      <div className="flex gap-2 mt-2">
                        <select value={skillTarget} onChange={e => setSkillTarget(e.target.value)} className="flex-1" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text-primary)", fontSize: 12 }}>
                          <option value="">选择目标 Agent...</option>
                          {agents.map((a: any) => <option key={a.agent_id} value={a.agent_id}>{a.name}</option>)}
                        </select>
                        <button onClick={handleImportSkill} disabled={importing || !skillText.trim() || !skillTarget} className="btn-primary" style={{ fontSize: 12 }}>
                          {importing ? "注入中..." : "注入"}
                        </button>
                      </div>
                    </div>
                    {runs.length > 0 && (
                      <div className="reading-section">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="reading-title" style={{ marginBottom: 0 }}>推演记录</h3>
                          <span className="meta-line">{runs.length} RUNS</span>
                        </div>
                        <div className="space-y-2">
                          {runs.map((run: any, idx: number) => {
                            const active = run.run_id === selectedRun?.run_id || run.run_id === selectedRunId;
                            const started = run.started_at ? new Date(run.started_at).toLocaleString("zh-CN", { hour12: false }) : `Run ${idx + 1}`;
                            const done = run.completed_steps ?? 0;
                            const total = run.total_steps || (world?.world_protocol as any)?.simulation_days || "?";
                            return (
                              <button
                                key={run.run_id}
                                type="button"
                                onClick={() => selectRun(run.run_id, { step: 3 })}
                                className="agent-row w-full text-left"
                                style={{
                                  borderColor: active ? "var(--accent-cyan)" : "var(--border)",
                                  background: active ? "rgba(34,211,238,0.08)" : "var(--bg-surface)",
                                  cursor: "pointer",
                                }}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`tag tag-${run.status === "finished" ? "emerald" : run.status === "running" ? "cyan" : run.status === "paused" ? "amber" : run.status === "failed" ? "rose" : "muted"}`} style={{ fontSize: 9 }}>{run.status}</span>
                                    <span className="text-xs" style={{ color: "var(--text-primary)", fontFamily: "var(--font-chakra)" }}>Run {run.run_id.slice(0, 8)}</span>
                                    {run.report_id && <span className="meta-line">已生成报告</span>}
                                  </div>
                                  <p className="meta-line">{started} · {done}/{total} 天{run.pause_reason ? ` · ${run.pause_reason}` : ""}{run.stop_reason && run.status === "failed" ? ` · ${run.stop_reason}` : ""}</p>
                                </div>
                                {active && <span className="text-xs" style={{ color: "var(--accent-cyan)", fontFamily: "var(--font-chakra)" }}>SELECTED</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={handleStartRun}
                      disabled={actionLoading || runs.some((r: any) => r.status === "running" || r.status === "paused")}
                      className="btn-primary w-full justify-center text-base py-3"
                    >
                      {actionLoading
                        ? <><span className="status-dot status-dot-building" /> 启动中...</>
                        : runs.some((r: any) => r.status === "running") ? "推演进行中"
                        : runs.some((r: any) => r.status === "paused") ? "先继续或完成暂停推演"
                        : runs.length > 0 ? "开始一次新推演"
                        : "开始模拟推演"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ STEP 3: 模拟推演 ═══ */}
            {currentStep === 3 && (
              <div className="animate-in space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="label" style={{ fontFamily: "var(--font-chakra)" }}>SIMULATION</p>
                    <h2 className="text-xl font-bold mt-1" style={{ color: "var(--text-primary)", fontFamily: "var(--font-chakra)" }}>
                      {selectedRun?.status === "running" ? "推演进行中" : selectedRun?.status === "paused" ? "推演已暂停 · 等待上帝干预" : "推演完成"}
                    </h2>
                  </div>
                  {selectedRun?.status === "running" && (
                    <span className="status-label" style={{ color: "var(--accent-amber)" }}><span className="status-dot status-dot-running" /> running</span>
                  )}
                  {selectedRun?.status === "paused" && (
                    <span className="status-label" style={{ color: "var(--accent-violet)" }}><span className="status-dot" style={{ background: "var(--accent-violet)" }} /> paused</span>
                  )}
                </div>
                {selectedRun?.status === "running" && (
                  <div style={{
                    background: "linear-gradient(135deg, rgba(251,191,36,0.08) 0%, rgba(34,211,238,0.06) 100%)",
                    border: "1px solid rgba(251,191,36,0.25)",
                    borderRadius: 12,
                    padding: "20px 24px",
                    boxShadow: "0 0 30px rgba(251,191,36,0.08), inset 0 0 20px rgba(34,211,238,0.03)",
                    animation: "progress-pulse 2.5s ease-in-out infinite",
                  }}>
                    <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
                      <span className="status-dot status-dot-running" style={{ width: 10, height: 10 }} />
                      <span style={{ fontFamily: "var(--font-chakra)", fontSize: 12, color: "var(--accent-amber)", letterSpacing: "0.12em", fontWeight: 700 }}>
                        SIMULATING
                      </span>
                    </div>
                    <div className="flex items-baseline gap-4" style={{ marginBottom: 12 }}>
                      <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 36, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>
                        Day {rawLog.length}
                      </span>
                      <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 18, color: "var(--text-muted)" }}>
                        / {selectedRun?.total_steps || "?"}
                      </span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-jetbrains)", fontSize: 22, fontWeight: 700, color: "var(--accent-cyan)" }}>
                        {selectedRun?.total_steps ? Math.round((rawLog.length / selectedRun.total_steps) * 100) : 0}%
                      </span>
                    </div>
                    <div style={{
                      height: 6,
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: 3,
                      overflow: "hidden",
                      marginBottom: 12,
                    }}>
                      <div style={{
                        height: "100%",
                        width: `${selectedRun?.total_steps ? (rawLog.length / selectedRun.total_steps) * 100 : 0}%`,
                        background: "linear-gradient(90deg, var(--accent-amber), var(--accent-cyan))",
                        borderRadius: 3,
                        transition: "width 0.5s ease",
                        boxShadow: "0 0 12px rgba(34,211,238,0.4)",
                      }} />
                    </div>
                    {rawLog.length > 0 && (() => {
                      const lastEntry = rawLog[rawLog.length - 1];
                      const lastEvent = lastEntry?.event || {};
                      const respCount = (lastEntry?.responses || []).length;
                      return (
                        <div className="flex items-center gap-3" style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-chakra)" }}>
                          <span style={{ color: "var(--text-secondary)" }}>
                            最新事件：{lastEvent.title || "..."}
                          </span>
                          {respCount > 0 && <span>· {respCount} 个 Agent 已响应</span>}
                        </div>
                      );
                    })()}
                  </div>
                )}
                {/* 推演天数已满但未标记 finished（SSE 在最后一步后中断）：直接触发完成流程 */}
                {selectedRun?.status === "running" && !streamingRun && selectedRun.total_steps > 0 && rawLog.length >= (world?.world_protocol as any)?.simulation_days && (
                  <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-amber)", background: "rgba(251,191,36,0.04)" }}>
                    <p className="text-xs mb-1" style={{ color: "var(--accent-amber)", fontFamily: "var(--font-chakra)", letterSpacing: "0.08em" }}>推演未正常结束</p>
                    <p className="text-xs mb-3" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      已完成 {rawLog.length}/{(world?.world_protocol as any)?.simulation_days} 天，但后端未标记为完成（SSE 可能在最后一步后中断）。点击下方按钮触发完成流程，进入报告生成。
                    </p>
                    <button onClick={handleResumeRun} disabled={actionLoading} className="btn-primary" style={{ fontSize: 12, padding: "8px 16px" }}>
                      {actionLoading ? <><span className="status-dot status-dot-building" /> 连接中...</> : "完成推演"}
                    </button>
                  </div>
                )}
                {/* 刷新后 SSE 断开：轮询跟进中，仅 60 秒无进度更新才显示恢复按钮（避免和轮询冲突启动第二个 worker） */}
                {selectedRun?.status === "running" && !streamingRun && selectedRun.total_steps > 0 && rawLog.length < (world?.world_protocol as any)?.simulation_days && staleWarning && (
                  <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-amber)", background: "rgba(251,191,36,0.04)" }}>
                    <p className="text-xs mb-1" style={{ color: "var(--accent-amber)", fontFamily: "var(--font-chakra)", letterSpacing: "0.08em" }}>推演已中断</p>
                    <p className="text-xs mb-3" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      后端推演进度超过 60 秒未更新，可能已中断。已完成 {rawLog.length}/{selectedRun.total_steps} 天，点击下方按钮从 Day {rawLog.length + 1} 恢复推演。
                    </p>
                    <button onClick={handleResumeRun} disabled={actionLoading} className="btn-primary" style={{ fontSize: 12, padding: "8px 16px" }}>
                      {actionLoading ? <><span className="status-dot status-dot-building" /> 连接中...</> : `恢复推演（从 Day ${rawLog.length + 1}）`}
                    </button>
                  </div>
                )}
                {/* 推演出错中断：显示错误信息 + 断点继续按钮 */}
                {selectedRun?.status === "failed" && !streamingRun && (
                  <div className="analysis-panel" style={{ borderLeftColor: "#fb7185", background: "rgba(251,113,133,0.06)", boxShadow: "0 0 0 1px rgba(251,113,133,0.15)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ color: "#fb7185", fontFamily: "var(--font-chakra)", fontSize: 10, letterSpacing: "0.1em", border: "1px solid #fb7185", padding: "2px 8px", borderRadius: 4, background: "rgba(251,113,133,0.1)", fontWeight: 700 }}>✗ 推演出错</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>已完成 {rawLog.length}/{selectedRun.total_steps || 0} 天</span>
                    </div>
                    <p className="text-xs mb-3" style={{ color: "var(--text-secondary)", lineHeight: 1.6, wordBreak: "break-word" }}>
                      {selectedRun.stop_reason || "推演过程中出现错误"}
                    </p>
                    <button onClick={handleResumeRun} disabled={actionLoading} className="btn-primary" style={{ fontSize: 12, padding: "8px 16px" }}>
                      {actionLoading ? <><span className="status-dot status-dot-building" /> 连接中...</> : `断点继续（从 Day ${rawLog.length + 1}）`}
                    </button>
                  </div>
                )}
                {rawLog.flatMap((entry: any, i: number) => {
                  const event = entry.event || {};
                  const responses = entry.responses || [];
                  const state = entry.state || {};
                  const step = entry.step || i + 1;
                  const isIntervention = event.source === "intervention";
                  const isCollapsed = collapsedDays.has(step);
                  // 该 Day 对应的信息释放：新 run 优先读 raw_log，旧 run 兼容 interventions 接口
                  const stepInfoIvs = (entry.info_releases?.length ? entry.info_releases : interventions.filter(iv => iv.time_step === step && iv.intervention_type === "information_release"));
                  const infoReleaseKeywords = stepInfoIvs.flatMap((iv: any) => String(iv.description || "")
                    .split(/[，。；、\s]+/)
                    .map((word: string) => word.trim())
                    .filter((word: string) => word.length >= 2));
                  const getInfoReleaseStatus = (r: any) => {
                    const received = stepInfoIvs.some((iv: any) => !iv.visible_to?.length || iv.visible_to.includes(r.agent_id));
                    if (!received) return undefined;
                    const text = `${r.thought || ""}\n${r.speech || ""}\n${r.action_detail || ""}`;
                    const responded = infoReleaseKeywords.some((word: string) => text.includes(word));
                    return { received, responded };
                  };
                  const elements: any[] = [];
                  // 先渲染 information_release 干预卡片（这些不会出现在 event 里）
                  for (const iv of stepInfoIvs) {
                    const recipients = iv.visible_to?.length || 0;
                    const recipientNames = iv.visible_to?.length
                      ? iv.visible_to.map((aid: string) => agents.find(a => a.agent_id === aid)?.name).filter(Boolean).join("、")
                      : "全部 Agent";
                    elements.push(
                      <div key={`iv-info-${iv.intervention_id}`} className="timeline-entry" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.08)", boxShadow: "0 0 0 1px rgba(167,139,250,0.15)" }}>
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold" style={{ fontFamily: "var(--font-chakra)", color: "var(--accent-violet)", letterSpacing: "0.08em" }}>DAY {step}</span>
                              <span style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", fontSize: 10, letterSpacing: "0.1em", border: "1px solid var(--accent-violet)", padding: "2px 8px", borderRadius: 4, background: "rgba(167,139,250,0.1)", fontWeight: 700 }}>⚡ 上帝干预 · 信息释放</span>
                            </div>
                            <h3 className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{iv.description?.slice(0, 40) || "信息释放"}</h3>
                          </div>
                          <span className="text-xs" style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{recipients || agents.length} agents</span>
                        </div>
                        <p className="reading-body mb-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>{iv.description}</p>
                        {iv.expected_effect && <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>预期效果：{iv.expected_effect}</p>}
                        <p className="text-xs" style={{ color: "var(--accent-violet)", opacity: 0.85 }}>可见范围：{recipientNames}</p>
                      </div>
                    );
                  }
                  // 再渲染 Day 卡片（world_event 干预的 event 已经在里面，通过 isIntervention 标识）
                  elements.push(
                    <div key={`day-${step}`} className="timeline-entry" style={isIntervention ? { borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.06)", boxShadow: "0 0 0 1px rgba(167,139,250,0.15)" } : undefined}>
                      <div
                        className="flex items-start justify-between gap-4 mb-2"
                        style={{ cursor: "pointer", userSelect: "none" }}
                        onClick={() => toggleDay(step)}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 10 }}>{isCollapsed ? "▸" : "▾"}</span>
                            <span className="text-sm font-bold" style={{ fontFamily: "var(--font-chakra)", color: isIntervention ? "var(--accent-violet)" : "var(--accent-cyan)", letterSpacing: "0.08em" }}>DAY {step}</span>
                            {event.event_type && <span style={{ color: "var(--accent-amber)", fontFamily: "var(--font-chakra)", fontSize: 10, letterSpacing: "0.1em", border: "1px solid rgba(251,191,36,0.35)", padding: "2px 8px", borderRadius: 4, background: "rgba(251,191,36,0.08)", fontWeight: 700 }}>{event.event_type}</span>}
                            {isIntervention && <span style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", fontSize: 10, letterSpacing: "0.1em", border: "1px solid var(--accent-violet)", padding: "2px 8px", borderRadius: 4, background: "rgba(167,139,250,0.1)", fontWeight: 700 }}>⚡ 上帝干预 · 世界事件</span>}
                          </div>
                          <h3 className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{event.title}</h3>
                        </div>
                        <span className="text-xs" style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{responses.length} agents</span>
                      </div>
                      {!isCollapsed && (
                        <>
                          <p className="reading-body mb-4" style={{ fontSize: 12 }}>{event.description}</p>
                          {responses.length > 0 && (
                            <div className="mb-3">
                              <p className="text-xs mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", letterSpacing: "0.06em" }}>AGENT RESPONSES</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {responses.map((r: any, j: number) => (
                                  <AgentResponseCard
                                    key={j}
                                    r={r}
                                    color={AGENT_COLORS[agentNames.indexOf(r.name) % AGENT_COLORS.length]}
                                    expanded={expandedAgents.has(`${step}-${r.name}`)}
                                    onToggle={() => toggleAgent(`${step}-${r.name}`)}
                                    infoReleaseStatus={getInfoReleaseStatus(r)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {state.summary && (
                            <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.04)" }}>
                              <p className="text-xs mb-1" style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", letterSpacing: "0.08em" }}>WORLD STATE</p>
                              <p className="text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{state.summary}</p>
                              {state.group_state && <p className="text-xs mt-1" style={{ color: "var(--text-muted)", lineHeight: 1.7 }}>群体态势：{state.group_state}</p>}
                            </div>
                          )}
                          {event.goal_progress && (
                            <div className="analysis-panel mt-3" style={{ borderLeftColor: "var(--accent-cyan)", background: "rgba(34,211,238,0.04)" }}>
                              <p className="text-xs mb-1" style={{ color: "var(--accent-cyan)", fontFamily: "var(--font-chakra)", letterSpacing: "0.08em" }}>GOAL PROGRESS</p>
                              <p className="text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{event.goal_progress}</p>
                              {event.next_focus && <p className="text-xs mt-1" style={{ color: "var(--text-muted)", lineHeight: 1.7 }}>下一步聚焦：{event.next_focus}</p>}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                  return elements;
                })}

                {/* ═══ M5 上帝干预：暂停面板 ═══ */}
                {pausedInfo && (
                  <div className="space-y-4">
                    {/* 阶段摘要 */}
                    <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.06)" }}>
                      <div className="mb-3">
                        <p className="text-xs" style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", letterSpacing: "0.1em" }}>STAGE SUMMARY</p>
                        <h3 className="text-base font-bold mt-1" style={{ color: "var(--text-primary)", fontFamily: "var(--font-chakra)" }}>
                          Day {pausedInfo.step} 推演暂停 · {pausedInfo.pauseReason === "step" ? "固定步长" : pausedInfo.pauseReason === "key_event" ? "关键事件" : "报告前"}
                        </h3>
                      </div>
                      {pausedInfo.stageSummary && (
                        <div className="space-y-3 mt-3">
                          {pausedInfo.stageSummary.key_events?.length > 0 && (
                            <div><p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>关键事件</p>
                              <ul className="text-xs space-y-1" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                                {pausedInfo.stageSummary.key_events.map((e: string, i: number) => <li key={i}>· {e}</li>)}
                              </ul>
                            </div>
                          )}
                          {pausedInfo.stageSummary.agent_state_changes?.length > 0 && (
                            <div><p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Agent 状态变化</p>
                              <ul className="text-xs space-y-1" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                                {pausedInfo.stageSummary.agent_state_changes.map((e: string, i: number) => <li key={i}>· {e}</li>)}
                              </ul>
                            </div>
                          )}
                          {pausedInfo.stageSummary.metric_changes?.length > 0 && (
                            <div><p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>指标变化</p>
                              <ul className="text-xs space-y-1" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                                {pausedInfo.stageSummary.metric_changes.map((e: string, i: number) => <li key={i}>· {e}</li>)}
                              </ul>
                            </div>
                          )}
                          {pausedInfo.stageSummary.high_impact_variables?.length > 0 && (
                            <div><p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>高影响变量</p>
                              <ul className="text-xs space-y-1" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                                {pausedInfo.stageSummary.high_impact_variables.map((e: string, i: number) => <li key={i}>· {e}</li>)}
                              </ul>
                            </div>
                          )}
                          {pausedInfo.stageSummary.suggested_interventions?.length > 0 && (
                            <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 8 }}>
                              <p className="text-xs mb-1" style={{ color: "var(--accent-amber)" }}>干预建议（参考）</p>
                              <ul className="text-xs space-y-1" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
                                {pausedInfo.stageSummary.suggested_interventions.map((e: string, i: number) => <li key={i}>· {e}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 干预编辑器 */}
                    <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-amber)", background: "rgba(251,191,36,0.04)" }}>
                      <p className="text-xs mb-3" style={{ color: "var(--accent-amber)", fontFamily: "var(--font-chakra)", letterSpacing: "0.1em" }}>GOD INTERVENTION</p>
                      <div className="segmented-control mb-3" style={{ display: "inline-flex" }}>
                        <button type="button" className={`segmented-option ${interventionType === "world_event" ? "segmented-option-active" : ""}`} onClick={() => setInterventionType("world_event")}>世界事件</button>
                        <button type="button" className={`segmented-option ${interventionType === "information_release" ? "segmented-option-active" : ""}`} onClick={() => setInterventionType("information_release")}>信息释放</button>
                      </div>
                      <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                        {interventionType === "world_event" ? "向整个世界注入一个事件，所有 agent 都会感知到" : "只向选定的 agent 释放信息，其他 agent 不知道"}
                      </p>
                      <textarea
                        value={interventionDesc}
                        onChange={(e) => setInterventionDesc(e.target.value)}
                        placeholder={interventionType === "world_event" ? "描述要注入的事件，例如：城里来了一个神秘的陌生人..." : "描述要释放的信息，例如：只有内部员工知道产品有重大缺陷..."}
                        rows={3}
                        style={{ width: "100%", background: "var(--bg-deep)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", color: "var(--text-primary)", fontSize: 13, fontFamily: "var(--font-outfit)", resize: "vertical" }}
                      />
                      <input
                        type="text"
                        value={interventionExpected}
                        onChange={(e) => setInterventionExpected(e.target.value)}
                        placeholder="预期效果（可选，例如：引发恐慌/促成合作）"
                        style={{ width: "100%", background: "var(--bg-deep)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text-primary)", fontSize: 12, marginTop: 8 }}
                      />
                      {interventionType === "information_release" && (
                        <div style={{ marginTop: 12 }}>
                          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>可见 Agent（不选则全部可见）</p>
                          <div className="grid grid-cols-2 gap-2">
                            {agents.map((a: any) => (
                              <label key={a.agent_id} className="flex items-center gap-2" style={{ padding: "6px 10px", background: "var(--bg-deep)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={interventionVisibleTo.includes(a.agent_id)}
                                  onChange={(e) => {
                                    if (e.target.checked) setInterventionVisibleTo(prev => [...prev, a.agent_id]);
                                    else setInterventionVisibleTo(prev => prev.filter((id: string) => id !== a.agent_id));
                                  }}
                                  style={{ accentColor: "var(--accent-violet)" }}
                                />
                                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{a.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleSubmitIntervention}
                        disabled={!interventionDesc.trim() || interventionSubmitting}
                        className="btn-primary mt-3"
                        style={{ fontSize: 12, padding: "8px 16px" }}
                      >
                        {interventionSubmitting ? "提交中..." : `提交干预（影响 Day ${(pausedInfo.step || 0) + 1}）`}
                      </button>
                    </div>

                    {/* 已提交干预列表 */}
                    {interventions.length > 0 && (
                      <div className="reading-section">
                        <p className="step-kicker mb-2">已提交干预（{interventions.length}）</p>
                        {interventions.map((iv: any) => (
                          <div key={iv.intervention_id} className="agent-row" style={{ padding: "10px 12px" }}>
                            <div className="flex items-center gap-2 mb-1">
                              <span style={{ fontSize: 10, fontFamily: "var(--font-chakra)", color: iv.intervention_type === "world_event" ? "var(--accent-cyan)" : "var(--accent-violet)", letterSpacing: "0.08em" }}>
                                {iv.intervention_type === "world_event" ? "世界事件" : "信息释放"} · Day {iv.time_step}
                              </span>
                            </div>
                            <p className="text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>{iv.description}</p>
                            {iv.expected_effect && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>预期：{iv.expected_effect}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 继续推演 */}
                    <button
                      onClick={handleResumeRun}
                      disabled={streamingRun}
                      className="btn-primary w-full justify-center text-base py-3"
                      style={{ background: "linear-gradient(135deg, var(--accent-violet), var(--accent-cyan))" }}
                    >
                      {streamingRun ? <><span className="status-dot status-dot-running" /> 推演中...</> : (isPausedAtFinalStep ? "完成推演" : `继续推演（从 Day ${(pausedInfo.step || 0) + 1}）`)}
                    </button>
                  </div>
                )}

                {selectedRun?.status === "finished" && !report && !reportGenerating && (
                  <button onClick={handleMakeReport} disabled={actionLoading} className="btn-primary w-full justify-center text-base py-3">
                    {actionLoading ? <><span className="status-dot status-dot-building" /> 生成中...</> : "生成分析报告"}
                  </button>
                )}

              </div>
            )}

            {/* ═══ STEP 4: 报告 ═══ */}
            {currentStep === 4 && (
              <div className="animate-in space-y-6">
                {/* 章节进度面板 - 生成中时显示 */}
                {reportGenerating && reportSectionProgress.length > 0 && (
                  <div style={{
                    background: "rgba(34,211,238,0.04)",
                    border: "1px solid rgba(34,211,238,0.2)",
                    borderRadius: 10,
                    padding: "16px 20px",
                  }}>
                    <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
                      <span className="status-dot status-dot-building" style={{ width: 10, height: 10 }} />
                      <span style={{ fontFamily: "var(--font-chakra)", fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
                        报告生成中 · {reportSectionProgress.filter(s => s.status === "done").length}/{reportSectionProgress.length} 章节
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
                        {reportSectionProgress.find(s => s.status === "running")?.label ? `正在生成：${reportSectionProgress.find(s => s.status === "running")!.label}` : ""}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {reportSectionProgress.map(s => (
                        <div key={s.key} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 12px",
                          borderRadius: 6,
                          background: s.status === "done" ? "rgba(34,197,94,0.08)"
                            : s.status === "running" ? "rgba(34,211,238,0.1)"
                            : s.status === "error" ? "rgba(239,68,68,0.08)"
                            : "rgba(255,255,255,0.02)",
                          border: `1px solid ${s.status === "done" ? "rgba(34,197,94,0.3)"
                            : s.status === "running" ? "rgba(34,211,238,0.4)"
                            : s.status === "error" ? "rgba(239,68,68,0.3)"
                            : "rgba(255,255,255,0.06)"}`,
                          fontSize: 12,
                          fontFamily: "var(--font-chakra)",
                        }}>
                          <span style={{
                            color: s.status === "done" ? "rgb(74,222,128)"
                              : s.status === "running" ? "rgb(34,211,238)"
                              : s.status === "error" ? "rgb(248,113,113)"
                              : "var(--text-muted)",
                            fontWeight: 700,
                            minWidth: 14,
                          }}>
                            {s.status === "done" ? "✓" : s.status === "running" ? "●" : s.status === "error" ? "✗" : "○"}
                          </span>
                          <span style={{
                            color: s.status === "done" ? "var(--text-primary)"
                              : s.status === "running" ? "var(--accent-cyan)"
                              : s.status === "error" ? "rgb(248,113,113)"
                              : "var(--text-muted)",
                            flex: 1,
                            animation: s.status === "running" ? "progress-pulse 1.5s ease-in-out infinite" : undefined,
                          }}>
                            {s.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 无报告内容且不在生成中：显示生成按钮 */}
                {!reportGenerating && (!report || !REPORT_SECTION_KEYS.some(k => report[k] != null)) && selectedRun?.status === "finished" && (
                  <div className="text-center py-20">
                    <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>报告尚未生成</p>
                    <button onClick={handleMakeReport} className="btn-primary" style={{ fontSize: 14, padding: "10px 24px" }}>
                      生成分析报告
                    </button>
                  </div>
                )}

                {report && REPORT_SECTION_KEYS.some(k => report[k] != null) && (
                  <>
                    <div className="step-header">
                      <div>
                        <p className="step-kicker">REPORT</p>
                        <h2 className="step-title">推演分析报告</h2>
                        <p className="step-subtitle">报告内容完整保留，按时间线、角色、关系、指标和关键驱动分层阅读。</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={handleExportHtml} disabled={actionLoading}
                          className="btn-primary"
                          style={{ fontSize: 12, padding: "8px 16px", background: "transparent", border: "1px solid var(--accent-cyan, #22d3ee)", color: "var(--accent-cyan, #22d3ee)", boxShadow: "none" }}>
                          {actionLoading ? "导出中..." : "导出 HTML"}
                        </button>
                        <button onClick={() => { setManualStep(true); setCurrentStep(5); }} className="btn-primary" style={{ fontSize: 12, padding: "8px 16px" }}>
                          进入深度互动
                        </button>
                      </div>
                    </div>
                    <div className="report-layout">
                      {/* 目录导航 */}
                      <div className="report-nav">
                        <p className="step-kicker" style={{ marginBottom: 6 }}>目录</p>
                        <div className={layoutMode === "workspace" ? "grid gap-1" : "grid grid-cols-2 gap-1"}>
                          {[
                            ["rpt-story", "故事", rptVal("story")],
                            ["rpt-timeline", "事件时间线", rawLog.length > 0],
                            ["rpt-setup", "世界设定", rptVal("world_setup")],
                            ["rpt-perspectives", "角色视角", rptArr("agent_perspectives", "agent_perspectives").length > 0],
                            ["rpt-relations", "关系变化", rptArr("relationship_changes", "changes").length > 0],
                            ["rpt-metrics", "指标分析", rptArr("metrics", "metrics").length > 0],
                            ["rpt-drivers", "关键驱动", rptArr("key_drivers", "key_drivers").length > 0],
                            ["rpt-intervention", "上帝干预影响", report?.intervention_impact && Object.keys(report.intervention_impact).length > 0 && (report.intervention_impact.interventions?.length || 0) > 0],
                            ["rpt-goal", "目标达成评估", rptVal("goal_assessment")],
                            ["rpt-summary", "总结分析", rptVal("executive_summary")],
                          ].filter(([,,v]) => v).map(([id, label]) => (
                            <button key={id as string} type="button" className="report-nav-item"
                              onClick={() => document.getElementById(id as string)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                              {label as string}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="report-body space-y-8">
                    {/* ── 事件时间线（从 raw_log 日记式渲染）── */}
                    {rawLog.length > 0 && (
                      <div id="rpt-timeline" className="space-y-4">
                        <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-timeline")}>
                          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-timeline") ? "▸" : "▾"}</span>
                          <p className="label" style={{ fontFamily: "var(--font-chakra)" }}>事件时间线</p>
                        </div>
                        {!collapsedSections.has("rpt-timeline") && (
                        <>
                        {rawLog.flatMap((entry: any, di: number) => {
                          const event = entry.event || {};
                          const responses = entry.responses || [];
                          const state = entry.state || {};
                          const metrics = state.metrics || {};
                          const prevMetrics = di > 0 ? (rawLog[di - 1]?.state?.metrics || {}) : null;
                          const step = entry.step || di + 1;
                          const isIntervention = event.source === "intervention";
                          const isCollapsed = collapsedRptDays.has(step);
                          // 该 Day 对应的 information_release 干预（world_event 已在 event 里）
                          const stepInfoIvs = interventions.filter(iv => iv.time_step === step && iv.intervention_type === "information_release");
                          const elements: any[] = [];
                          // 先渲染 information_release 干预卡片
                          for (const iv of stepInfoIvs) {
                            const recipients = iv.visible_to?.length || 0;
                            const recipientNames = iv.visible_to?.length
                              ? iv.visible_to.map((aid: string) => agents.find(a => a.agent_id === aid)?.name).filter(Boolean).join("、")
                              : "全部 Agent";
                            elements.push(
                              <div key={`rpt-iv-info-${iv.intervention_id}`} className="timeline-entry" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.08)", boxShadow: "0 0 0 1px rgba(167,139,250,0.15)" }}>
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold" style={{ fontFamily: "var(--font-chakra)", color: "var(--accent-violet)", letterSpacing: "0.08em" }}>DAY {step}</span>
                                    <span style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", fontSize: 10, letterSpacing: "0.1em", border: "1px solid var(--accent-violet)", padding: "2px 8px", borderRadius: 4, background: "rgba(167,139,250,0.1)", fontWeight: 700 }}>⚡ 上帝干预 · 信息释放</span>
                                  </div>
                                  <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}>{recipients || agents.length} 位角色接收</span>
                                </div>
                                <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{iv.description?.slice(0, 40) || "信息释放"}</h3>
                                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--text-secondary)" }}>{iv.description}</p>
                                {iv.expected_effect && <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>预期效果：{iv.expected_effect}</p>}
                                <p className="text-xs" style={{ color: "var(--accent-violet)", opacity: 0.85 }}>可见范围：{recipientNames}</p>
                              </div>
                            );
                          }
                          // 再渲染 Day 卡片
                          elements.push(
                            <div key={`rpt-day-${step}`} className="timeline-entry" style={isIntervention ? { borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.06)", boxShadow: "0 0 0 1px rgba(167,139,250,0.15)" } : undefined}>
                              <div
                                className="flex items-center justify-between mb-3"
                                style={{ cursor: "pointer", userSelect: "none" }}
                                onClick={() => toggleRptDay(step)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{isCollapsed ? "▸" : "▾"}</span>
                                  <span className="text-sm font-bold" style={{ fontFamily: "var(--font-chakra)", color: isIntervention ? "var(--accent-violet)" : "var(--accent-cyan)", letterSpacing: "0.08em" }}>DAY {step}</span>
                                  {event.event_type && <span style={{ color: "var(--accent-amber)", fontFamily: "var(--font-chakra)", fontSize: 10, letterSpacing: "0.1em", border: "1px solid rgba(251,191,36,0.35)", padding: "2px 8px", borderRadius: 4, background: "rgba(251,191,36,0.08)", fontWeight: 700 }}>{event.event_type}</span>}
                                  {isIntervention && <span style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", fontSize: 10, letterSpacing: "0.1em", border: "1px solid var(--accent-violet)", padding: "2px 8px", borderRadius: 4, background: "rgba(167,139,250,0.1)", fontWeight: 700 }}>⚡ 上帝干预 · 世界事件</span>}
                                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{event.title}</h3>
                                </div>
                                <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}>{responses.length} 位角色参与</span>
                              </div>
                              {!isCollapsed && (
                                <div className="space-y-4">
                                  {/* 世界事件 */}
                                  <div>
                                    <p className="text-xs font-bold mb-1.5" style={{ color: "var(--accent-amber)", fontFamily: "var(--font-chakra)", letterSpacing: "0.06em", fontSize: 9 }}>◇ 世界事件</p>
                                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{event.description}</p>
                                    {event.impact_hints && (
                                      <p className="text-xs mt-1.5 pl-3" style={{ color: "var(--text-muted)", borderLeft: "2px solid rgba(251,191,36,0.3)" }}>
                                        {event.impact_hints}
                                      </p>
                                    )}
                                  </div>

                                  {/* 角色行动 */}
                                  {responses.length > 0 && (
                                    <div>
                                      <p className="text-xs font-bold mb-2" style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)", letterSpacing: "0.06em", fontSize: 9 }}>◇ 角色行动</p>
                                      <div className="space-y-3">
                                        {responses.map((r: any, j: number) => {
                                          const agentIdx = agentNames.indexOf(r.name);
                                          const color = AGENT_COLORS[agentIdx >= 0 ? agentIdx % AGENT_COLORS.length : j % AGENT_COLORS.length];
                                          return (
                                            <div key={j} className="analysis-panel" style={{ borderLeftColor: `var(--accent-${color})`, background: "rgba(0,0,0,0.16)" }}>
                                              <div className="flex items-start justify-between gap-3 mb-2">
                                                <span className="text-xs font-bold" style={{ color: `var(--accent-${color})`, fontFamily: "var(--font-chakra)" }}>{r.name}</span>
                                              </div>
                                              <div className="space-y-2">
                                                {r.action_detail && (
                                                  <div>
                                                    <span className="text-xs" style={{ color: "var(--text-muted)", fontSize: 9 }}>具体行动</span>
                                                    <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--text-secondary)" }}>{r.action_detail}</p>
                                                  </div>
                                                )}
                                                {r.speech && (
                                                  <div>
                                                    <span className="text-xs" style={{ color: "var(--text-muted)", fontSize: 9 }}>发言</span>
                                                    <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--text-secondary)" }}>"{r.speech}"</p>
                                                  </div>
                                                )}
                                                {r.thought && (
                                                  <div>
                                                    <span className="text-xs" style={{ color: "var(--text-muted)", fontSize: 9 }}>内心</span>
                                                    <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>{r.thought}</p>
                                                  </div>
                                                )}
                                                <div className="flex gap-4 flex-wrap">
                                                  {r.stance_delta && (
                                                    <div className="flex-1" style={{ minWidth: 120 }}>
                                                      <span className="text-xs" style={{ color: "var(--accent-amber)", fontSize: 9 }}>立场变化</span>
                                                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{r.stance_delta}</p>
                                                    </div>
                                                  )}
                                                  {r.emotion_delta && (
                                                    <div className="flex-1" style={{ minWidth: 120 }}>
                                                      <span className="text-xs" style={{ color: "var(--accent-rose)", fontSize: 9 }}>情绪变化</span>
                                                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{r.emotion_delta}</p>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* 世界状态变化 */}
                                  {Object.keys(metrics).length > 0 && (
                                    <div>
                                      <p className="text-xs font-bold mb-2" style={{ color: "var(--accent-emerald)", fontFamily: "var(--font-chakra)", letterSpacing: "0.06em", fontSize: 9 }}>◇ 世界状态</p>
                                      {state.summary && <p className="text-xs mb-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{state.summary}</p>}
                                      {state.group_state && <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>群体态势：{state.group_state}</p>}
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                        {Object.entries(metrics).filter(([k]) => k !== "关键成员间信任矩阵").map(([k, v]) => {
                                          const prev = prevMetrics?.[k];
                                          const numV = typeof v === "number" ? v : null;
                                          const numP = typeof prev === "number" ? prev : null;
                                          const delta = numV != null && numP != null ? numV - numP : null;
                                          return (
                                            <div key={k} className="flex items-center justify-between text-xs py-0.5">
                                              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{k}</span>
                                              <span style={{ fontFamily: "var(--font-jetbrains)", fontSize: 10, color: delta != null ? (delta > 0 ? "var(--accent-emerald)" : delta < 0 ? "var(--accent-rose)" : "var(--text-muted)") : "var(--text-secondary)" }}>
                                                {typeof v === "number" ? v.toFixed(2) : String(v).slice(0, 20)}
                                                {delta != null && delta !== 0 && <span> ({delta > 0 ? "+" : ""}{delta.toFixed(2)})</span>}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {metrics["关键成员间信任矩阵"] && (
                                        <div className="mt-2">
                                          <span className="text-xs" style={{ color: "var(--text-muted)", fontSize: 9 }}>信任矩阵</span>
                                          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)", fontSize: 9 }}>{String(metrics["关键成员间信任矩阵"])}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                          return elements;
                        })}
                        </>
                        )}
                      </div>
                    )}

                    {/* Story 故事章节 */}
                    {(() => {
                      const storyData = rptVal("story");
                      if (!storyData) return null;
                      const text = typeof storyData === "string" ? storyData : (storyData.story || storyData.text || JSON.stringify(storyData));
                      const paragraphs = typeof text === "string" ? text.split(/\n+/).filter(Boolean) : [];
                      return (
                        <section id="rpt-story" className="reading-section">
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-story")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-story") ? "▸" : "▾"}</span>
                            <p className="step-kicker">故事</p>
                          </div>
                          {!collapsedSections.has("rpt-story") && (
                            <div className="reading-body mt-3" style={{ borderLeft: "2px solid rgba(34,211,238,0.25)", paddingLeft: 16 }}>
                              {paragraphs.length > 0
                                ? paragraphs.map((p: string, i: number) => (
                                  <p key={i} style={{ fontSize: 14, lineHeight: 1.95, color: "var(--text-secondary)", marginBottom: 10 }}>{p}</p>
                                ))
                                : <p style={{ fontSize: 14, lineHeight: 1.95, color: "var(--text-secondary)" }}>{String(text)}</p>
                              }
                            </div>
                          )}
                        </section>
                      );
                    })()}

                    {/* World Setup */}
                    {(() => {
                      const ws = rptVal("world_setup");
                      if (!ws) return null;
                      const roles = ws["关键角色"] || ws.roles || ws.key_roles;
                      return (
                        <section id="rpt-setup" className="reading-section">
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-setup")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-setup") ? "▸" : "▾"}</span>
                            <p className="step-kicker">世界设定</p>
                          </div>
                          {!collapsedSections.has("rpt-setup") && (
                          <div className="reading-body space-y-3">
                            {typeof ws === "string" ? <p>{ws}</p> : (
                              <>
                                {ws["推演目标"] && (
                                  <div>
                                    <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>推演目标</p>
                                    <div className="text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{renderValue(ws["推演目标"])}</div>
                                  </div>
                                )}
                                {ws["协议摘要"] && (
                                  <div>
                                    <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>协议摘要</p>
                                    <div className="text-xs" style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{renderValue(ws["协议摘要"])}</div>
                                  </div>
                                )}
                                {Array.isArray(roles) && roles.length > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>关键角色</p>
                                    {roles.map((r: any, i: number) => {
                                      const name = r.name || r["姓名"] || r.role || "?";
                                      const roleStr = r.role || r["角色定位"] || r["职责"] || r.description || "";
                                      const stance = r["立场变化"] || r.stance || r["立场"] || "";
                                      return (
                                        <div key={i} className="agent-row" style={{ borderLeft: `3px solid var(--accent-${AGENT_COLORS[i % AGENT_COLORS.length]})` }}>
                                          <div style={{ minWidth: 0 }}>
                                            <p className="text-xs font-bold" style={{ color: `var(--accent-${AGENT_COLORS[i % AGENT_COLORS.length]})` }}>{name}</p>
                                            {roleStr && <p className="meta-line">{roleStr}</p>}
                                            {stance && <p className="meta-line" style={{ color: "var(--text-muted)" }}>{stance}</p>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          )}
                        </section>
                      );
                    })()}

                    {/* Agent Perspectives */}
                    {(() => {
                      const aps = rptArr("agent_perspectives", "agent_perspectives");
                      const pattern = rptVal("agent_perspectives")?.overall_pattern;
                      if (aps.length === 0 && !pattern) return null;
                      return (
                        <section id="rpt-perspectives" className="reading-section">
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-perspectives")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-perspectives") ? "▸" : "▾"}</span>
                            <p className="step-kicker">角色视角</p>
                          </div>
                          {!collapsedSections.has("rpt-perspectives") && (
                          <>
                          {pattern && <div className="analysis-panel mb-4"><p className="reading-body">{pattern}</p></div>}
                          <div className="space-y-3">
                            {aps.map((ap: any, i: number) => (
                              <div key={i} className="analysis-panel" style={{ borderLeftColor: `var(--accent-${AGENT_COLORS[i % AGENT_COLORS.length]})`, background: "rgba(0,0,0,0.12)" }}>
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <span className="text-xs font-bold" style={{ color: `var(--accent-${AGENT_COLORS[i % AGENT_COLORS.length]})` }}>{ap.agent || ap.name}</span>
                                  {(ap.stance_change || ap.stance_shift) && <span className="meta-line" style={{ textAlign: "right" }}>{ap.stance_change || ap.stance_shift}</span>}
                                </div>
                                {(ap.behavior_summary || ap.summary) && <p className="reading-body" style={{ fontSize: 12 }}>{ap.behavior_summary || ap.summary}</p>}
                                {ap.evidence && Array.isArray(ap.evidence) && (
                                  <div className="mt-2 space-y-1">
                                    {ap.evidence.map((e: string, j: number) => <p key={j} className="meta-line">• {e}</p>)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          </>
                          )}
                        </section>
                      );
                    })()}

                    {/* Relationship Changes */}
                    {(() => {
                      const changes = rptArr("relationship_changes", "changes");
                      if (changes.length === 0) return null;
                      return (
                        <section id="rpt-relations" className="reading-section">
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-relations")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-relations") ? "▸" : "▾"}</span>
                            <p className="step-kicker">关系变化</p>
                          </div>
                          {!collapsedSections.has("rpt-relations") && (
                          <div className="definition-list">
                            {changes.map((rc: any, i: number) => (
                              <div key={i} className="definition-row">
                                <div className="definition-key">{rc.pair || rc.relationship || `关系 ${i + 1}`}</div>
                                <div className="definition-value">
                                  {rc.change && <p style={{ color: "var(--text-primary)" }}>{rc.change}</p>}
                                  {rc.impact && <p>{rc.impact}</p>}
                                  {rc.evidence && <p className="meta-line">{rc.evidence}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                          )}
                        </section>
                      );
                    })()}

                    {/* Metrics */}
                    {(() => {
                      const metrics = rptArr("metrics", "metrics");
                      if (metrics.length === 0) return null;
                      return (
                        <section id="rpt-metrics" className="reading-section">
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-metrics")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-metrics") ? "▸" : "▾"}</span>
                            <p className="step-kicker">指标分析</p>
                          </div>
                          {!collapsedSections.has("rpt-metrics") && (
                          <div className="definition-list">
                            {metrics.map((m: any, i: number) => (
                              <div key={i} className="definition-row">
                                <div className="definition-key">{m.name || m.metric || `指标 ${i + 1}`}</div>
                                <div className="definition-value">
                                  {m.value && <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-jetbrains)" }}>{m.value}</span>}
                                  {m.trend && <span style={{ color: "var(--text-muted)" }}> ({m.trend})</span>}
                                  {m.evidence && <p className="mt-1">{m.evidence}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                          )}
                        </section>
                      );
                    })()}

                    {/* Key Drivers */}
                    {(() => {
                      const drivers = rptArr("key_drivers", "key_drivers");
                      if (drivers.length === 0) return null;
                      return (
                        <section id="rpt-drivers" className="reading-section">
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-drivers")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-drivers") ? "▸" : "▾"}</span>
                            <p className="step-kicker">关键驱动</p>
                          </div>
                          {!collapsedSections.has("rpt-drivers") && (
                          <div className="space-y-3">
                            {drivers.map((d: any, i: number) => (
                              <div key={i} className="analysis-panel" style={{ borderLeftColor: "var(--accent-rose)", background: "rgba(251,113,133,0.04)" }}>
                                <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>{d.driver || d.name}</p>
                                {d.impact_mechanism && <p className="reading-body" style={{ fontSize: 12 }}>{d.impact_mechanism}</p>}
                                {d.if_worsens && <p className="mt-2 text-xs" style={{ color: "var(--accent-rose)" }}>恶化：{d.if_worsens}</p>}
                                {d.if_improves && <p className="mt-1 text-xs" style={{ color: "var(--accent-emerald)" }}>改善：{d.if_improves}</p>}
                                {d.evidence && Array.isArray(d.evidence) && (
                                  <div className="mt-2 space-y-1">
                                    {d.evidence.map((e: string, j: number) => <p key={j} className="meta-line">• {e}</p>)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          )}
                        </section>
                      );
                    })()}

                    {/* M5 上帝干预影响分析 */}
                    {report?.intervention_impact && (report.intervention_impact.interventions?.length || 0) > 0 && (
                      <section id="rpt-intervention" className="space-y-3">
                        <div className="analysis-panel" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.05)" }}>
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-intervention")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-intervention") ? "▸" : "▾"}</span>
                            <p className="step-kicker" style={{ color: "var(--accent-violet)" }}>上帝干预影响</p>
                          </div>
                          {!collapsedSections.has("rpt-intervention") && (
                          <>
                          <div className="space-y-3 mt-3">
                            {report.intervention_impact.interventions.map((iv: any, i: number) => (
                              <div key={i} className="agent-row" style={{ padding: "10px 12px" }}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span style={{ fontSize: 10, fontFamily: "var(--font-chakra)", color: iv.type === "world_event" ? "var(--accent-cyan)" : "var(--accent-violet)", letterSpacing: "0.08em" }}>
                                    {iv.type === "world_event" ? "世界事件" : "信息释放"} · Day {iv.time_step}
                                  </span>
                                  {iv.impact_assessment && (
                                    <span style={{ fontSize: 9, fontFamily: "var(--font-chakra)", padding: "1px 6px", borderRadius: 4, border: `1px solid ${iv.impact_assessment === "高" ? "rgba(251,113,133,0.4)" : iv.impact_assessment === "中" ? "rgba(251,191,36,0.4)" : "rgba(34,211,238,0.4)"}`, color: iv.impact_assessment === "高" ? "var(--accent-pink)" : iv.impact_assessment === "中" ? "var(--accent-amber)" : "var(--accent-cyan)" }}>
                                      影响：{iv.impact_assessment}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs mb-1" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>{iv.description}</p>
                                {iv.expected_effect && <p className="text-xs" style={{ color: "var(--text-muted)" }}>预期：{iv.expected_effect}</p>}
                                {iv.actual_effect && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)", lineHeight: 1.6, borderLeft: "2px solid var(--accent-violet)", paddingLeft: 8 }}>实际：{iv.actual_effect}</p>}
                              </div>
                            ))}
                          </div>
                          {report.intervention_impact.summary && (
                            <p className="text-xs mt-3" style={{ color: "var(--text-secondary)", lineHeight: 1.7, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                              {report.intervention_impact.summary}
                            </p>
                          )}
                          </>
                          )}
                        </div>
                      </section>
                    )}

                    {/* 目标达成评估（回扣 simulation_goal） */}
                    {(() => {
                      const ga = rptVal("goal_assessment");
                      if (!ga) return null;
                      const obj = typeof ga === "object" && !Array.isArray(ga) ? ga : null;
                      const text = typeof ga === "string" ? ga : null;
                      const verdict = obj?.verdict || "";
                      const verdictColor = verdict.includes("证明") && !verdict.includes("未")
                        ? "var(--accent-emerald)"
                        : verdict.includes("证伪")
                        ? "var(--accent-rose)"
                        : verdict.includes("部分")
                        ? "var(--accent-amber)"
                        : "var(--text-muted)";
                      return (
                        <section id="rpt-goal" className="analysis-panel" style={{ borderLeftColor: verdictColor, background: "rgba(255,255,255,0.03)" }}>
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-goal")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-goal") ? "▸" : "▾"}</span>
                            <p className="step-kicker" style={{ color: verdictColor }}>目标达成评估</p>
                          </div>
                          {!collapsedSections.has("rpt-goal") && (
                          <div className="reading-body space-y-3">
                            {text && <p>{text}</p>}
                            {obj && (
                              <>
                                {verdict && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}>判定</span>
                                    <span className="text-base font-semibold" style={{ color: verdictColor, fontFamily: "var(--font-chakra)" }}>{verdict}</span>
                                  </div>
                                )}
                                {obj.reasoning && <p style={{ color: "var(--text-secondary)" }}>{String(obj.reasoning)}</p>}
                                {Array.isArray(obj.evidence) && obj.evidence.length > 0 && (
                                  <div>
                                    <p className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}>证据</p>
                                    {obj.evidence.map((e: any, i: number) => (
                                      <div key={i} className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>• {typeof e === "string" ? e : renderValue(e)}</div>
                                    ))}
                                  </div>
                                )}
                                {obj.gap && String(obj.gap).trim() && (
                                  <div className="mt-2">
                                    <span className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}>缺口</span>
                                    <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{String(obj.gap)}</p>
                                  </div>
                                )}
                                {Object.entries(obj).filter(([k]) => !["verdict", "reasoning", "evidence", "gap"].includes(k)).map(([k, v]) => (
                                  <div key={k} className="mt-2"><strong style={{ color: "var(--text-primary)" }}>{k}：</strong>{renderValue(v)}</div>
                                ))}
                              </>
                            )}
                          </div>
                          )}
                        </section>
                      );
                    })()}

                    {/* 总结分析（原执行摘要，移到末尾） */}
                    {(() => {
                      const es = rptVal("executive_summary");
                      if (!es) return null;
                      const text = typeof es === "string" ? es : null;
                      const obj = typeof es === "object" && !Array.isArray(es) ? es : null;
                      return (
                        <section id="rpt-summary" className="analysis-panel" style={{ borderLeftColor: "var(--accent-amber)", background: "rgba(251,191,36,0.05)" }}>
                          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleSection("rpt-summary")}>
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 11 }}>{collapsedSections.has("rpt-summary") ? "▸" : "▾"}</span>
                            <p className="step-kicker" style={{ color: "var(--accent-amber)" }}>总结分析</p>
                          </div>
                          {!collapsedSections.has("rpt-summary") && (
                          <div className="reading-body space-y-2">
                            {text && <p>{text}</p>}
                            {obj?.bottom_line && <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{obj.bottom_line}</p>}
                            {obj?.main_trends && Array.isArray(obj.main_trends) && obj.main_trends.map((t: string, i: number) => <div key={i} className="mt-1">• {typeof t === "string" ? t : renderValue(t)}</div>)}
                            {obj && Object.entries(obj).filter(([k]) => k !== "bottom_line" && k !== "main_trends").map(([k, v]) => (
                              <div key={k} className="mt-2"><strong style={{ color: "var(--text-primary)" }}>{k}：</strong>{renderValue(v)}</div>
                            ))}
                          </div>
                          )}
                        </section>
                      );
                    })()}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ═══ STEP 5: 深度互动 ═══ */}
            {currentStep === 5 && (
              <div className="animate-in space-y-5">
                <div className="step-header">
                  <div>
                    <p className="step-kicker">DEEP INTERACTION</p>
                    <h2 className="step-title">深度互动</h2>
                    <p className="step-subtitle">与单个 Agent 深聊，或把多个 Agent 拉进同一场讨论，观察他们如何回应、沉默和互相影响。</p>
                  </div>
                  <div className="segmented-control">
                    <button onClick={() => setChatMode("direct")} className={`segmented-option ${chatMode === "direct" ? "segmented-option-active" : ""}`}>
                      1v1 对话
                    </button>
                    <button onClick={() => setChatMode("group")} className={`segmented-option ${chatMode === "group" ? "segmented-option-active" : ""}`}>
                      群聊
                    </button>
                  </div>
                </div>

                {/* === 1v1 模式 === */}
                {chatMode === "direct" && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {agentNames.map((name, i) => {
                        const color = AGENT_COLORS[i % AGENT_COLORS.length];
                        const active = chatTarget === name;
                        return (
                          <button key={name} onClick={() => handleSelectChat(agentIdMap[name], name)} className={`agent-row ${active ? "agent-row-active" : ""}`} style={{ borderLeft: `3px solid var(--accent-${color})`, cursor: "pointer" }}>
                            <div className="avatar-circle" style={{ width: 26, height: 26, background: agentBgColor(color), color: `var(--accent-${color})`, fontSize: 10, fontFamily: "var(--font-chakra)" }}>{name[0]}</div>
                            <span className="text-xs font-bold truncate" style={{ color: active ? `var(--accent-${color})` : "var(--text-secondary)", fontFamily: "var(--font-chakra)" }}>{name}</span>
                          </button>
                        );
                      })}
                      <button onClick={() => handleSelectChat(null, "Report Agent")} className={`agent-row ${chatTarget === "Report Agent" ? "agent-row-active" : ""}`} style={{ borderLeft: "3px solid var(--accent-amber)", cursor: "pointer" }}>
                        <div className="avatar-circle" style={{ width: 26, height: 26, background: "rgba(251,191,36,0.2)", color: "var(--accent-amber)", fontSize: 10, fontFamily: "var(--font-chakra)" }}>R</div>
                        <span className="text-xs font-bold truncate" style={{ color: chatTarget === "Report Agent" ? "var(--accent-amber)" : "var(--text-secondary)", fontFamily: "var(--font-chakra)" }}>Report Agent</span>
                      </button>
                    </div>
                    <div className="chat-container" style={{ height: layoutMode === "workspace" ? "calc(100vh - 260px)" : 520, minHeight: 520, borderTop: `2px solid var(--accent-${chatTarget === "Report Agent" ? "amber" : AGENT_COLORS[agentNames.indexOf(chatTarget || "") % AGENT_COLORS.length] || "cyan"})` }}>
                      <div className="chat-header">
                        <div className="flex items-center gap-2">
                          {chatTarget && chatTarget !== "Report Agent" && (() => {
                            const ci = agentNames.indexOf(chatTarget);
                            const c = AGENT_COLORS[ci >= 0 ? ci % AGENT_COLORS.length : 0];
                            return (
                              <div className="avatar-circle" style={{ width: 28, height: 28, background: agentBgColor(c), color: `var(--accent-${c})`, fontSize: 11, fontFamily: "var(--font-chakra)" }}>
                                {chatTarget[0]}
                              </div>
                            );
                          })()}
                          <span className="text-xs font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-chakra)" }}>{chatTarget}</span>
                        </div>
                        {chatSessionId && <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}>session active</span>}
                      </div>
                      <div className="chat-body space-y-3">
                        {chatMessages.length === 0 && !chatLoading && (
                          <p className="text-center text-xs py-16" style={{ color: "var(--text-muted)" }}>开始与 {chatTarget} 对话...</p>
                        )}
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className="max-w-[80%]">
                              <div className="rounded-lg px-3 py-2" style={{
                                background: msg.role === "user" ? "rgba(34,211,238,0.08)" : "rgba(0,0,0,0.25)",
                                border: `1px solid ${msg.role === "user" ? "rgba(34,211,238,0.15)" : "var(--border)"}`,
                                borderLeft: msg.role === "assistant" ? `3px solid var(--accent-${chatTarget === "Report Agent" ? "amber" : AGENT_COLORS[agentNames.indexOf(chatTarget || "") % AGENT_COLORS.length] || "cyan"})` : undefined,
                              }}>
                                <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{msg.content}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="flex justify-start">
                            <div className="rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)" }}>
                              <span className="status-dot status-dot-building" style={{ width: 6, height: 6 }} />
                              <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>思考中...</span>
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                      <div className="chat-footer">
                        <textarea
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                          placeholder="输入消息..."
                          rows={1}
                          className="flex-1"
                          style={{ resize: "none", minHeight: 36, fontSize: 12 }}
                        />
                        <button onClick={handleSendChat} disabled={chatLoading || !chatInput.trim()} className="btn-primary" style={{ fontSize: 12, padding: "8px 18px" }}>
                          发送
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* === 群聊模式 === */}
                {chatMode === "group" && (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1">
                        {groupSessions.map((gs: any) => {
                          const active = activeGroupSessionId === gs.session_id;
                          return (
                            <button key={gs.session_id} onClick={() => handleSelectGroup(gs.session_id)} className={`agent-row ${active ? "agent-row-active" : ""}`} style={{ borderLeft: "3px solid var(--accent-violet)", cursor: "pointer" }}>
                              <div className="avatar-circle" style={{ width: 24, height: 24, background: "rgba(167,139,250,0.18)", color: "var(--accent-violet)", fontSize: 10, fontFamily: "var(--font-chakra)" }}>G</div>
                              <div className="min-w-0 text-left">
                                <p className="text-xs font-bold truncate" style={{ color: active ? "var(--accent-violet)" : "var(--text-secondary)", fontFamily: "var(--font-chakra)" }}>{gs.name || "未命名群"}</p>
                                <p className="meta-line" style={{ fontSize: 10 }}>group session</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => setShowCreateGroup(!showCreateGroup)} className="btn-ghost" style={{ fontSize: 12, padding: "8px 14px", flexShrink: 0 }}>
                        {showCreateGroup ? "取消" : "新建群聊"}
                      </button>
                    </div>

                    {showCreateGroup && (
                      <div className="analysis-panel space-y-3" style={{ borderLeftColor: "var(--accent-violet)", background: "rgba(167,139,250,0.04)" }}>
                        <p className="step-kicker" style={{ color: "var(--accent-violet)" }}>NEW GROUP</p>
                        <div>
                          <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>群名称</label>
                          <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="如：战略讨论组" style={{ fontSize: 12 }} />
                        </div>
                        <div>
                          <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>选择成员（至少 2 人）</label>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {agents.map((a: any, i: number) => {
                              const sel = selectedGroupAgents.has(a.agent_id);
                              const color = AGENT_COLORS[i % AGENT_COLORS.length];
                              return (
                                <button key={a.agent_id} onClick={() => setSelectedGroupAgents(prev => { const s = new Set(prev); sel ? s.delete(a.agent_id) : s.add(a.agent_id); return s; })} className={`agent-row ${sel ? "agent-row-active" : ""}`} style={{ borderLeft: `3px solid var(--accent-${color})`, cursor: "pointer" }}>
                                  <div className="avatar-circle" style={{ width: 26, height: 26, background: agentBgColor(color), color: `var(--accent-${color})`, fontSize: 10, fontFamily: "var(--font-chakra)" }}>{a.name?.[0] || "?"}</div>
                                  <div className="min-w-0 flex-1 text-left">
                                    <p className="text-xs font-bold truncate" style={{ color: sel ? `var(--accent-${color})` : "var(--text-secondary)", fontFamily: "var(--font-chakra)" }}>{a.name}</p>
                                    <p className="meta-line truncate">{a.role_type || a.birth_context?.identity || "Agent"}</p>
                                  </div>
                                  <span style={{ color: sel ? "var(--accent-emerald)" : "var(--text-muted)", fontSize: 12 }}>{sel ? "✓" : ""}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-end gap-4">
                          <div style={{ width: 220 }}>
                            <label className="text-xs block mb-2" style={{ color: "var(--text-muted)" }}>自动讨论强度</label>
                            <div className="choice-grid">{[3, 5, 8].map(n => (
                              <button key={n} type="button" onClick={() => setGroupMaxRounds(n)} className={`choice-card ${groupMaxRounds === n ? "choice-card-active" : ""}`} style={{ padding: 10 }}>
                                <span className="choice-value" style={{ fontSize: 16 }}>{n}</span>
                                <span className="choice-label">Budget</span>
                              </button>
                            ))}</div>
                          </div>
                          <div className="flex-1" />
                          <button onClick={handleCreateGroup} disabled={groupLoading || !groupName.trim() || selectedGroupAgents.size < 2} className="btn-primary" style={{ fontSize: 12, padding: "9px 18px" }}>
                            {groupLoading ? "创建中..." : `创建（${selectedGroupAgents.size} 人）`}
                          </button>
                        </div>
                      </div>
                    )}

                    {activeGroupSessionId && (
                      <div className="chat-container" style={{ flexDirection: "row", height: layoutMode === "workspace" ? "calc(100vh - 260px)" : "calc(100vh - 320px)", minHeight: 480, borderTop: "2px solid var(--accent-violet)" }}>
                        {/* 左侧：成员列表 */}
                        <div className="flex-shrink-0 overflow-y-auto" style={{ width: 160, borderRight: "1px solid var(--border)", background: "rgba(6,8,13,0.4)", padding: "10px 6px" }}>
                          <div className="px-1 mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-chakra)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>Members</div>
                          {groupMembers.map((member: any, idx: number) => {
                            const color = AGENT_COLORS[idx % AGENT_COLORS.length];
                            const thought = agentThoughts[member.agent_id];
                            return (
                              <div key={member.agent_id} className="member-strip" onClick={() => insertMention(member.name)}>
                                <div className="flex items-center gap-2">
                                  <div className="avatar-circle" style={{ width: 28, height: 28, background: agentBgColor(color), color: `var(--accent-${color})`, fontSize: 11, fontFamily: "var(--font-chakra)" }}>
                                    {member.name?.[0] || "?"}
                                  </div>
                                  <span className="text-xs font-bold truncate flex-1" style={{ color: `var(--accent-${color})`, fontFamily: "var(--font-chakra)", fontSize: 11 }}>{member.name}</span>
                                  {thought && (
                                    <span className="flex-shrink-0">
                                      {thought.status === "thinking" && <span className="status-dot status-dot-building" style={{ width: 6, height: 6, marginRight: 0 }} />}
                                      {thought.status === "responded" && <span style={{ color: "var(--accent-emerald)", fontSize: 11 }}>&#10003;</span>}
                                      {thought.status === "skipped" && <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {groupMembers.length === 0 && <p className="text-xs text-center py-4" style={{ color: "var(--text-muted)", fontSize: 9 }}>加载中...</p>}
                        </div>

                        {/* 右侧：聊天区 */}
                        <div className="flex-1 flex flex-col min-w-0">
                          <div className="chat-header">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold" style={{ color: "var(--accent-violet)", fontFamily: "var(--font-chakra)" }}>
                                {groupSessions.find((g: any) => g.session_id === activeGroupSessionId)?.name || "群聊"}
                              </span>
                              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>·</span>
                              <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}>{groupMembers.length} members</span>
                            </div>
                          </div>
                          <div className="chat-body space-y-3">
                            {groupMessages.length === 0 && groupStreamCount === 0 && (
                              <p className="text-center text-xs py-16" style={{ color: "var(--text-muted)" }}>发消息开始群聊，输入 @ 可点名特定 Agent</p>
                            )}
                            {groupMessages.map((msg: any, i: number) => {
                              const memberIdx = groupMembers.findIndex((m: any) => m.name === msg.agent_name);
                              const msgColor = memberIdx >= 0 ? AGENT_COLORS[memberIdx % AGENT_COLORS.length] : AGENT_COLORS[agentNames.indexOf(msg.agent_name) % AGENT_COLORS.length] || "cyan";

                              if (msg.role === "user") {
                                return (
                                  <div key={i} className="flex justify-end">
                                    <div className="max-w-[80%] rounded-lg px-3 py-2" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
                                      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{msg.content}</p>
                                    </div>
                                  </div>
                                );
                              }

                              if (msg.role === "thought") {
                                return (
                                  <div key={i} className="flex justify-start">
                                    <div className="max-w-[85%]">
                                      <span className="text-xs mb-0.5 block" style={{ color: `var(--accent-${msgColor})`, fontFamily: "var(--font-chakra)", fontSize: 10, opacity: 0.6 }}>
                                        {msg.agent_name}
                                      </span>
                                      <div className="chat-bubble-thought-only">
                                        <span style={{ marginRight: 4 }}>💭</span>{msg.thought}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div key={i} className="flex justify-start">
                                  <div className="max-w-[85%]">
                                    <span className="text-xs font-bold mb-0.5 block" style={{ color: `var(--accent-${msgColor})`, fontFamily: "var(--font-chakra)", fontSize: 10 }}>
                                      {msg.agent_name}
                                    </span>
                                    <div className="rounded-lg px-3 py-2" style={{
                                      background: "rgba(0,0,0,0.25)",
                                      border: `1px solid ${agentBgColor(msgColor)}`,
                                      borderLeft: `3px solid var(--accent-${msgColor})`,
                                    }}>
                                      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{msg.content}</p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {groupStreamCount > 0 && (
                              <div className="flex justify-start">
                                <div className="rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)" }}>
                                  <span className="status-dot status-dot-building" style={{ width: 6, height: 6 }} />
                                  <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>讨论中...</span>
                                </div>
                              </div>
                            )}
                            <div ref={groupEndRef} />
                          </div>
                          <div className="relative">
                            {showMentionDropdown && (
                              <div className="absolute bottom-full left-0 right-0 mx-3 mb-1 rounded-lg overflow-hidden" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", zIndex: 20, maxHeight: 200, overflowY: "auto" }}>
                                <button className="w-full text-left px-3 py-2 text-xs hover:bg-white/5" style={{ color: "var(--accent-amber)" }} onClick={() => insertMention("所有人")}>
                                  @所有人 <span style={{ color: "var(--text-muted)", fontSize: 9 }}>全员候选</span>
                                </button>
                                {groupMembers.filter((m: any) => !mentionFilter || m.name.includes(mentionFilter)).map((m: any, idx: number) => {
                                  const mc = AGENT_COLORS[idx % AGENT_COLORS.length];
                                  return (
                                    <button key={m.agent_id} className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 flex items-center gap-2" onClick={() => insertMention(m.name)}>
                                      <span className="avatar-circle" style={{ width: 18, height: 18, background: agentBgColor(mc), color: `var(--accent-${mc})`, fontSize: 9 }}>{m.name?.[0]}</span>
                                      <span style={{ color: `var(--accent-${mc})` }}>@{m.name}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className="chat-footer">
                              <textarea
                                ref={groupInputRef}
                                value={groupInput}
                                onChange={handleGroupInputChange}
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !showMentionDropdown) { e.preventDefault(); handleSendGroupMessage(); } if (e.key === "Escape") setShowMentionDropdown(false); }}
                                placeholder="发消息到群聊... 输入 @ 点名"
                                rows={1}
                                className="flex-1"
                                style={{ resize: "none", minHeight: 36, fontSize: 12 }}
                              />
                              <button onClick={handleSendGroupMessage} disabled={!groupInput.trim() || !activeGroupSessionId} className="btn-primary" style={{ fontSize: 12, padding: "8px 18px", background: "linear-gradient(135deg, var(--accent-violet), #7c3aed)" }}>
                                发送
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {groupSessions.length === 0 && !activeGroupSessionId && !showCreateGroup && (
                      <div className="text-center py-16">
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>还没有群聊，点击上方创建一个</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

          </div>
        </div>

        {/* ═══ 吸底日志面板（Step 1-3 可见）═══ */}
        {logs.length > 0 && currentStep <= 3 && (
          <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-deep)", flexShrink: 0 }}>
            <div
              className="flex items-center justify-between px-4 py-1.5"
              style={{ cursor: "pointer", borderBottom: logExpanded ? "1px solid var(--border)" : "none" }}
              onClick={() => setLogExpanded(!logExpanded)}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--accent-cyan)", fontSize: 10, fontFamily: "var(--font-chakra)", letterSpacing: "0.08em" }}>
                  SYSTEM LOG
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 9, fontFamily: "var(--font-jetbrains)" }}>
                  {logs.length} entries
                </span>
                {actionLoading && <span className="status-dot status-dot-building" style={{ width: 5, height: 5 }} />}
              </div>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{logExpanded ? "▼" : "▲"}</span>
            </div>
            {logExpanded && (
              <div style={{ maxHeight: 180, overflowY: "auto", padding: "8px 16px" }}>
                {logs.map((log, i) => (
                  <p key={i} style={{
                    color: log.includes("━━━") ? "#22d3ee" : log.startsWith("✓") ? "#34d399" : log.startsWith("✗") ? "#fb7185" : "#475569",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    lineHeight: "1.7",
                    margin: 0,
                  }}>
                    {log}
                  </p>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
