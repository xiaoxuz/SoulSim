const BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  (typeof window !== "undefined" ? `http://${window.location.hostname}:8000/api` : "http://localhost:8000/api");

async function req(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export const api = {
  listWorlds: () => req("/worlds"),
  createWorld: (title: string) =>
    req("/worlds", { method: "POST", body: JSON.stringify({ title }) }),
  buildWorld: (worldId: string, body: { seed_material: string; simulation_goal: string; agent_count?: number; simulation_days?: number }) =>
    req(`/worlds/${worldId}/build`, { method: "POST", body: JSON.stringify(body) }),
  rebuildWorld: (worldId: string) =>
    req(`/worlds/${worldId}/rebuild`, { method: "POST", body: JSON.stringify({}) }),
  getWorld: (id: string) => req(`/worlds/${id}`),
  listAgents: (worldId: string) => req(`/worlds/${worldId}/agents`),
  listRuns: (worldId: string) => req(`/worlds/${worldId}/runs`),
  startRun: (id: string) =>
    req(`/worlds/${id}/run`, { method: "POST", body: JSON.stringify({}) }),
  startRunStream: (worldId: string) => `${BASE}/worlds/${worldId}/run/stream`,
  getRun: (id: string) => req(`/runs/${id}`),
  makeReport: (id: string) => req(`/runs/${id}/report`, { method: "POST" }),
  makeReportStreamUrl: (id: string) => `${BASE}/runs/${id}/report/stream`,
  getReport: (id: string) => req(`/runs/${id}/report`),
  importSkill: (text: string) =>
    req("/skill-profiles/import", { method: "POST", body: JSON.stringify({ text }) }),
  listSkillProfiles: () => req("/skill-profiles"),
  bindSkill: (agentId: string, skillProfileId: string) =>
    req("/agents/bind-skill", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, skill_profile_id: skillProfileId }),
    }),

  // graph
  getGraph: (worldId: string) => req(`/worlds/${worldId}/graph`),
  getGraphStats: (worldId: string) => req(`/worlds/${worldId}/graph/stats`),
  getOntology: (worldId: string) => req(`/worlds/${worldId}/ontology`),

  // chat
  createChatSession: (runId: string, sessionType: string, targetAgentId?: string) =>
    req("/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ run_id: runId, session_type: sessionType, target_agent_id: targetAgentId }),
    }),
  getChatSession: (sessionId: string) => req(`/chat/sessions/${sessionId}`),
  listChatMessages: (sessionId: string) => req(`/chat/sessions/${sessionId}/messages`),
  sendChatMessage: (sessionId: string, content: string) =>
    req(`/chat/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  listRunChatSessions: (runId: string) => req(`/runs/${runId}/chat-sessions`),

  // group chat
  createGroupChatSession: (runId: string, name: string, agentIds: string[], maxRounds: number = 5) =>
    req("/chat/group-sessions", {
      method: "POST",
      body: JSON.stringify({ run_id: runId, name, agent_ids: agentIds, max_rounds: maxRounds }),
    }),
  listChatSessionMembers: (sessionId: string) => req(`/chat/sessions/${sessionId}/members`),
  sendGroupMessageStreamUrl: (sessionId: string) => `${BASE}/chat/sessions/${sessionId}/messages/stream`,

  // life history
  getLifeHistory: (agentId: string) => req(`/agents/${agentId}/life-history`),

  // intervention (M5 上帝干预)
  setInterventionMode: (worldId: string, enabled: boolean, pausePolicy: string[] = ["every_simulated_day", "after_key_event", "before_report"], interventionScope: string[] = ["world_event", "information_release"]) =>
    req(`/worlds/${worldId}/intervention-mode`, {
      method: "POST",
      body: JSON.stringify({ enabled, pause_policy: pausePolicy, intervention_scope: interventionScope }),
    }),
  listInterventions: (runId: string) => req(`/runs/${runId}/interventions`),
  createIntervention: (runId: string, body: { time_step: number; intervention_type: string; description: string; target_scope?: object; structured_patch?: object; visible_to?: string[]; expected_effect?: string }) =>
    req(`/runs/${runId}/interventions`, { method: "POST", body: JSON.stringify(body) }),
  getStageSummary: (runId: string) => req(`/runs/${runId}/stage-summary`),
  resumeRunStreamUrl: (runId: string) => `${BASE}/runs/${runId}/resume/stream`,

  // admin
  adminMeta: () => req("/admin/meta"),
  adminWorldsOverview: () => req("/admin/worlds/overview"),
  adminDeleteWorld: (worldId: string) =>
    req(`/admin/worlds/${worldId}`, { method: "DELETE" }),
  adminResetWorldRuns: (worldId: string) =>
    req(`/admin/worlds/${worldId}/runs/reset`, { method: "POST" }),
  adminResetWorldReports: (worldId: string) =>
    req(`/admin/worlds/${worldId}/reports/reset`, { method: "POST" }),
  adminList: (table: string, params: { limit?: number; offset?: number; q?: string; world_id?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.limit) sp.set("limit", String(params.limit));
    if (params.offset) sp.set("offset", String(params.offset));
    if (params.q) sp.set("q", params.q);
    if (params.world_id) sp.set("world_id", params.world_id);
    return req(`/admin/${table}?${sp.toString()}`);
  },
  adminGet: (table: string, id: string) => req(`/admin/${table}/${id}`),
  adminCreate: (table: string, data: object) =>
    req(`/admin/${table}`, { method: "POST", body: JSON.stringify({ data }) }),
  adminUpdate: (table: string, id: string, data: object) =>
    req(`/admin/${table}/${id}`, { method: "PUT", body: JSON.stringify({ data }) }),
  adminDelete: (table: string, id: string) =>
    req(`/admin/${table}/${id}`, { method: "DELETE" }),
};
