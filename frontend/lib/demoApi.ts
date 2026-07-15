import { demoAgents, demoChatReplies, demoGraph, demoGraphStats, demoInterventions, demoReport, demoRun, demoRunId, demoRuns, demoWorld, demoWorldId } from "./demoData";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type DemoState = {
  world: any;
  agents: any[];
  run: any | null;
  report: any | null;
  chatMessages: Record<string, any[]>;
  chatReplyIndex: number;
};

const state: DemoState = {
  world: { ...demoWorld, status: "ready" },
  agents: [...demoAgents],
  run: { ...demoRun },
  report: { ...demoReport },
  chatMessages: {},
  chatReplyIndex: 0,
};

const demoRawLog = demoRun.raw_log || [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function sseResponse(events: any[], interval = 450): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        await delay(interval);
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function simulationEvents() {
  state.run = { ...demoRun, status: "running", raw_log: [], completed_steps: 0 };
  state.report = null;
  const events: any[] = [
    { type: "run_started", run_id: demoRunId, total_steps: demoRawLog.length },
    { type: "log", msg: `推演启动：${demoAgents.length} 个 Agent，${demoRawLog.length} 天` },
    { type: "log", msg: `参与角色：${demoAgents.map((a) => a.name).join(", ")}` },
  ];
  for (const day of demoRawLog) {
    events.push({ type: "log", msg: `━━━ Day ${day.step}/${demoRawLog.length} 开始 ━━━` });
    events.push({ type: "log", msg: `[Day ${day.step}] 事件：${day.event?.title || "阶段事件"}` });
    for (const response of day.responses || []) {
      events.push({ type: "log", msg: `[Day ${day.step}] ${response.name}：${(response.speech || "").slice(0, 42)}` });
    }
    events.push({ type: "day_complete", run_id: demoRunId, total_steps: demoRawLog.length, data: day, graph_stats: demoGraphStats });
    events.push({ type: "log", msg: `━━━ Day ${day.step}/${demoRawLog.length} 完成 ━━━` });
  }
  events.push({ type: "log", msg: "推演完成，保存结果..." });
  events.push({ type: "simulation_complete", run_id: demoRunId, total_steps: demoRawLog.length, final_world_state: demoRun.final_world_state || demoRawLog[demoRawLog.length - 1]?.state });
  state.run = clone(demoRun);
  return events;
}

function reportEvents() {
  const sections = [
    { key: "story", label: "故事化叙事" },
    { key: "executive_summary", label: "执行摘要" },
    { key: "goal_assessment", label: "目标达成评估" },
    { key: "world_setup", label: "世界设定" },
    { key: "agent_perspectives", label: "角色视角" },
    { key: "relationship_changes", label: "关系变化" },
    { key: "metrics", label: "指标分析" },
    { key: "key_drivers", label: "关键驱动" },
  ];
  const events: any[] = [{ type: "report_started", report_id: demoReport.report_id, sections, completed: [] }];
  for (const section of sections) {
    events.push({ type: "section_started", section_key: section.key });
    events.push({ type: "section_completed", section_key: section.key, data: (demoReport as any)[section.key] });
  }
  events.push({ type: "report_completed", report_id: demoReport.report_id });
  state.report = { ...demoReport };
  state.run = { ...(state.run || demoRun), report_id: demoReport.report_id, status: "finished" };
  return events;
}

function groupEvents(message: string) {
  const activeAgents = demoAgents.slice(0, 3);
  return activeAgents.flatMap((agent, index) => [
    { type: "agent_thinking", agent_id: agent.agent_id, agent_name: agent.name },
    {
      type: "agent_response",
      agent_id: agent.agent_id,
      agent_name: agent.name,
      content: `${agent.name}：针对“${message.slice(0, 20)}”，我会从${agent.role_type}的角度看，核心仍是透明记录和可验证承诺。`,
      order: index,
    },
  ]);
}

export async function demoFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const path = new URL(url, "http://demo.local").pathname;
  if (path.endsWith(`/worlds/${demoWorldId}/run/stream`)) return sseResponse(simulationEvents(), 280);
  if (path.endsWith(`/runs/${demoRunId}/resume/stream`)) return sseResponse(simulationEvents(), 280);
  if (path.endsWith(`/runs/${demoRunId}/report/stream`)) return sseResponse(reportEvents(), 320);
  if (path.includes("/chat/sessions/") && path.endsWith("/messages/stream")) {
    const body = init?.body ? JSON.parse(String(init.body)) : { content: "" };
    return sseResponse(groupEvents(body.content || "这个方案后续风险是什么"), 360);
  }
  return new Response("Not found", { status: 404 });
}

export const demoApi = {
  listWorlds: async () => [clone(state.world)],
  createWorld: async (title: string) => {
    state.world = { ...clone(demoWorld), title: title || demoWorld.title, status: "draft" };
    state.run = null;
    state.report = null;
    return clone(state.world);
  },
  buildWorld: async (_worldId: string, body: { seed_material: string; simulation_goal: string; agent_count?: number; simulation_days?: number }) => {
    state.world = {
      ...clone(demoWorld),
      seed_material: body.seed_material || demoWorld.seed_material,
      simulation_goal: body.simulation_goal || demoWorld.simulation_goal,
      world_protocol: { ...demoWorld.world_protocol, agent_count: body.agent_count || demoWorld.world_protocol?.agent_count || 5, simulation_days: body.simulation_days || demoWorld.world_protocol?.simulation_days || 3 },
      status: "ready",
    };
    state.agents = clone(demoAgents);
    return clone(state.world);
  },
  rebuildWorld: async () => ({ ok: true }),
  getWorld: async () => clone(state.world),
  listAgents: async () => clone(state.agents),
  listRuns: async () => (state.run ? [clone(demoRuns[0] || state.run)] : []),
  startRun: async () => clone(demoRun),
  startRunStream: () => `http://demo.local/api/worlds/${demoWorldId}/run/stream`,
  getRun: async () => clone(state.run || demoRun),
  makeReport: async () => clone(demoReport),
  makeReportStreamUrl: () => `http://demo.local/api/runs/${demoRunId}/report/stream`,
  getReport: async () => clone(state.report || demoReport),
  importSkill: async () => ({ skill_profile_id: "demo-skill-profile" }),
  listSkillProfiles: async () => [],
  bindSkill: async () => ({ ok: true }),
  getGraph: async () => clone(demoGraph),
  getGraphStats: async () => clone(demoGraphStats),
  getOntology: async () => ({ entities: [], relations: [] }),
  createChatSession: async (_runId: string, sessionType: string, targetAgentId?: string) => ({
    session_id: targetAgentId ? `demo-chat-${targetAgentId}` : `demo-chat-${sessionType}`,
    session_type: sessionType,
    target_agent_id: targetAgentId,
  }),
  getChatSession: async (sessionId: string) => ({ session_id: sessionId }),
  listChatMessages: async (sessionId: string) => clone(state.chatMessages[sessionId] || []),
  sendChatMessage: async (sessionId: string, content: string) => {
    const reply = demoChatReplies[state.chatReplyIndex % demoChatReplies.length];
    state.chatReplyIndex += 1;
    state.chatMessages[sessionId] = [...(state.chatMessages[sessionId] || []), { role: "user", content }, { role: "assistant", content: reply }];
    return { role: "assistant", content: reply };
  },
  listRunChatSessions: async () => [],
  createGroupChatSession: async (_runId: string, name: string, agentIds: string[], maxRounds: number = 5) => ({
    session_id: "demo-group-session",
    session_type: "group",
    name,
    agent_ids: agentIds,
    max_rounds: maxRounds,
  }),
  listChatSessionMembers: async () => clone(demoAgents.slice(0, 3)),
  sendGroupMessageStreamUrl: () => "http://demo.local/api/chat/sessions/demo-group-session/messages/stream",
  getLifeHistory: async (agentId: string) => ({ agent_id: agentId, history: [] }),
  setInterventionMode: async () => ({ ok: true }),
  listInterventions: async () => clone(demoInterventions),
  createIntervention: async (_runId: string, body: any) => ({ intervention_id: "demo-intervention", ...body }),
  getStageSummary: async () => ({ paused_at_step: 0, pause_reason: "demo", stage_summary: {} }),
  resumeRunStreamUrl: () => `http://demo.local/api/runs/${demoRunId}/resume/stream`,
  adminMeta: async () => [],
  adminWorldsOverview: async () => [],
  adminDeleteWorld: async () => ({ ok: true }),
  adminResetWorldRuns: async () => ({ ok: true }),
  adminResetWorldReports: async () => ({ ok: true }),
  adminList: async () => [],
  adminGet: async () => ({}),
  adminCreate: async () => ({}),
  adminUpdate: async () => ({}),
  adminDelete: async () => ({ ok: true }),
};
