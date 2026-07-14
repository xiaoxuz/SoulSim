/** SoulSim 静态 HTML 导出：世界信息 + 知识图谱 + 推演报告 + 时间线。 */

export interface ExportParams {
  world: any;
  report: any;
  rawLog: any[];
  graph: { nodes: any[]; edges: any[] };
  agents: any[];
}

const GRAPH_COLORS: Record<string, string> = {
  person: "#22d3ee", teacher: "#22d3ee", student: "#67e8f9", principal: "#06b6d4",
  parent: "#22d3ee", user: "#67e8f9", customer: "#67e8f9", employee: "#67e8f9",
  team: "#a78bfa", organization: "#a78bfa", department: "#c4b5fd", school: "#8b5cf6",
  company: "#8b5cf6", group: "#c4b5fd", committee: "#8b5cf6",
  event: "#fb7185", incident: "#fb7185", crisis: "#f43f5e", conflict: "#f43f5e",
  activity: "#fda4af", meeting: "#fda4af",
  product: "#fbbf24", tool: "#fbbf24", technology: "#f59e0b", system: "#f59e0b",
  resource: "#fbbf24", equipment: "#f59e0b", platform: "#f59e0b",
  strategy: "#34d399", policy: "#34d399", plan: "#10b981", rule: "#10b981",
  regulation: "#10b981", law: "#059669",
  concept: "#818cf8", subject: "#818cf8", topic: "#a5b4fc", knowledge: "#818cf8",
  skill: "#a5b4fc", idea: "#a5b4fc",
  location: "#fb923c", place: "#fb923c", site: "#fb923c", venue: "#fb923c",
  metric: "#34d399", outcome: "#34d399", result: "#34d399", indicator: "#34d399",
  pivot: "#fb7185", goal: "#fbbf24", risk: "#fb7185", opportunity: "#34d399",
};

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 递归渲染任意 report 字段（dict/list/str/number）为 HTML。 */
function renderValue(v: any, depth = 0): string {
  if (v == null) return "";
  if (typeof v === "string") {
    const text = v.trim();
    if (!text) return "";
    // 多段文本按换行拆成段落
    return text.split(/\n+/).filter(Boolean).map((p) => `<p class="rpt-para">${esc(p)}</p>`).join("");
  }
  if (typeof v === "number" || typeof v === "boolean") return `<p class="rpt-para">${esc(v)}</p>`;
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    return `<ul class="rpt-list">${v.map((item) => `<li>${renderValue(item, depth + 1)}</li>`).join("")}</ul>`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v).filter(([, val]) => val != null && val !== "" && !(Array.isArray(val) && val.length === 0));
    if (entries.length === 0) return "";
    return entries
      .map(([k, val]) => {
        const label = prettyKey(k);
        return `<div class="rpt-field"><span class="rpt-field-key">${esc(label)}</span>${renderValue(val, depth + 1)}</div>`;
      })
      .join("");
  }
  return "";
}

function prettyKey(k: string): string {
  const map: Record<string, string> = {
    story: "故事",
    executive_summary: "总结分析",
    world_setup: "世界设定",
    agent_perspectives: "角色视角",
    relationship_changes: "关系变化",
    metrics: "指标分析",
    key_drivers: "关键驱动",
    intervention_impact: "上帝干预影响",
    timeline: "事件时间线",
    entries: "条目",
    section: "章节",
    chapter: "章节",
    content: "内容",
    overall_evolution: "整体演变",
    key_relationship_shifts: "关键关系转变",
    metrics_chapter: "指标章节",
    summary: "摘要",
    findings: "发现",
    causal_logic: "因果逻辑",
    counterfactuals: "反事实推演",
    most_powerful_drivers_ranked: "最强驱动排序",
    interventions: "干预列表",
    name: "名称",
    type: "类型",
    role: "角色",
    stance: "立场",
    emotion: "情绪",
    goal: "目标",
    belief: "信念",
  };
  return map[k] || k.replace(/_/g, " ");
}

function renderReportSection(title: string, content: any, id: string): string {
  const body = renderValue(content);
  if (!body) return "";
  return `<section id="${id}" class="rpt-section"><h2 class="rpt-h2">${esc(title)}</h2>${body}</section>`;
}

function renderTimeline(rawLog: any[], agents: any[]): string {
  if (!rawLog || rawLog.length === 0) return "";
  const days = rawLog.map((entry) => {
    const step = entry.step || "?";
    const event = entry.event || {};
    const responses = entry.responses || [];
    const state = entry.state || {};
    const isIntervention = event.source === "intervention";

    const eventHtml = `
      <div class="day-event">
        <span class="day-tag ${isIntervention ? "day-tag-intervention" : ""}">${isIntervention ? "⚡ 上帝干预" : "事件"}</span>
        ${event.event_type ? `<span class="day-tag day-tag-type">${esc(event.event_type)}</span>` : ""}
        <h4 class="day-event-title">${esc(event.title || "")}</h4>
        <p class="rpt-para">${esc(event.description || "")}</p>
      </div>`;

    const responsesHtml = responses.length
      ? `<div class="day-responses">${responses
          .map((r: any) => {
            const agent = agents.find((a) => a.agent_id === r.agent_id);
            const name = r.name || agent?.name || "?";
            return `
            <div class="day-response">
              <div class="day-response-head">
                <span class="day-response-name">${esc(name)}</span>
              </div>
              ${r.action_detail ? `<p class="day-response-action-detail"><span class="day-response-label">🎬 具体行动</span>${esc(r.action_detail)}</p>` : ""}
              <p class="day-response-speech">${esc(r.speech || "")}</p>
              ${r.thought ? `<p class="day-response-thought">内心：${esc(r.thought)}</p>` : ""}
              ${r.stance_delta ? `<p class="day-response-delta">立场变化：${esc(r.stance_delta)}</p>` : ""}
            </div>`;
          })
          .join("")}</div>`
      : "";

    const stateHtml = state.summary
      ? `<div class="day-state">
          <span class="day-tag day-tag-state">世界态势</span>
          <p class="rpt-para">${esc(state.summary)}</p>
          ${state.group_state ? `<p class="rpt-para"><span class="rpt-field-key">群体状态：</span>${esc(state.group_state)}</p>` : ""}
          ${state.metrics && Object.keys(state.metrics).length
            ? `<div class="day-metrics">${Object.entries(state.metrics)
                .map(([k, v]) => `<span class="metric-chip">${esc(prettyKey(k))}: ${esc(v)}</span>`)
                .join("")}</div>`
            : ""}
        </div>`
      : "";

    const goalHtml = event.goal_progress
      ? `<div class="day-goal">
          <span class="day-tag day-tag-goal">目标进度</span>
          <p class="rpt-para">${esc(event.goal_progress)}</p>
          ${event.next_focus ? `<p class="rpt-para"><span class="rpt-field-key">下一步聚焦：</span>${esc(event.next_focus)}</p>` : ""}
        </div>`
      : "";

    return `
      <div class="day-entry">
        <div class="day-header">DAY ${step}</div>
        ${eventHtml}
        ${responsesHtml}
        ${stateHtml}
        ${goalHtml}
      </div>`;
  });

  return `<section id="sec-timeline" class="rpt-section"><h2 class="rpt-h2">推演时间线</h2>${days.join("")}</section>`;
}

function renderGraph(graph: { nodes: any[]; edges: any[] }): string {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  if (nodes.length === 0 && edges.length === 0) return "";

  const data = {
    nodes: nodes.map((n: any) => ({
      id: n.node_id,
      name: n.name || n.node_id,
      entity_type: n.entity_type || "unknown",
      summary: n.summary || "",
      is_agent: !!n.is_agent,
    })),
    edges: edges.map((e: any) => ({
      source: e.source_node,
      target: e.target_node,
      relation: e.relation || "",
      weight: e.weight ?? 1,
    })),
  };
  // escape </script> 防止 HTML 解析错误
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const colorsJson = JSON.stringify(GRAPH_COLORS).replace(/</g, "\\u003c");

  return `<section id="sec-graph" class="rpt-section">
    <h2 class="rpt-h2">知识图谱</h2>
    <p class="rpt-meta">${nodes.length} 节点 · ${edges.length} 关系 · 拖拽节点 / 滚轮缩放 / 悬停查看</p>
    <div id="graph-canvas" class="graph-canvas"></div>
    <script>
(function() {
  var data = ${dataJson};
  var colors = ${colorsJson};
  function hashColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    var hue = Math.abs(hash) % 360;
    return "hsl(" + hue + ", 68%, 62%)";
  }
  function colorOf(t) {
    if (!t) return "#475569";
    return colors[t.toLowerCase()] || hashColor(t);
  }

  var W = 880, H = 540;
  var cx = W/2, cy = H/2, r = Math.min(W, H) * 0.32;
  data.nodes.forEach(function(n, i) {
    n.x = cx + r * Math.cos(2 * Math.PI * i / data.nodes.length);
    n.y = cy + r * Math.sin(2 * Math.PI * i / data.nodes.length);
    n.vx = 0; n.vy = 0;
  });
  var nodeMap = {};
  data.nodes.forEach(function(n) { nodeMap[n.id] = n; });

  for (var iter = 0; iter < 400; iter++) {
    for (var i = 0; i < data.nodes.length; i++) {
      for (var j = i+1; j < data.nodes.length; j++) {
        var a = data.nodes[i], b = data.nodes[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var dist = Math.sqrt(dx*dx + dy*dy) || 1;
        var force = 1500 / (dist * dist);
        var fx = (dx/dist) * force, fy = (dy/dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    for (var k = 0; k < data.edges.length; k++) {
      var e = data.edges[k];
      var a = nodeMap[e.source], b = nodeMap[e.target];
      if (!a || !b) continue;
      var dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx*dx + dy*dy) || 1;
      var force = (dist - 130) * 0.02;
      a.vx += (dx/dist) * force; a.vy += (dy/dist) * force;
      b.vx -= (dx/dist) * force; b.vy -= (dy/dist) * force;
    }
    for (var m = 0; m < data.nodes.length; m++) {
      var n = data.nodes[m];
      n.vx += (cx - n.x) * 0.0008;
      n.vy += (cy - n.y) * 0.0008;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
    }
  }

  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < data.nodes.length; i++) {
    var n = data.nodes[i];
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  var pad = 90;
  var vbX = minX - pad, vbY = minY - pad;
  var vbW = (maxX - minX) + pad * 2;
  var vbH = (maxY - minY) + pad * 2;

  var container = document.getElementById("graph-canvas");
  var svgNS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", vbX + " " + vbY + " " + vbW + " " + vbH);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "540px";
  svg.style.display = "block";
  svg.style.cursor = "grab";

  var defs = document.createElementNS(svgNS, "defs");
  var pattern = document.createElementNS(svgNS, "pattern");
  pattern.setAttribute("id", "gp-grid");
  pattern.setAttribute("width", "40");
  pattern.setAttribute("height", "40");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  var dot = document.createElementNS(svgNS, "circle");
  dot.setAttribute("cx", "20");
  dot.setAttribute("cy", "20");
  dot.setAttribute("r", "0.6");
  dot.setAttribute("fill", "rgba(255,255,255,0.05)");
  pattern.appendChild(dot);
  defs.appendChild(pattern);
  svg.appendChild(defs);

  var bgRect = document.createElementNS(svgNS, "rect");
  bgRect.setAttribute("x", vbX);
  bgRect.setAttribute("y", vbY);
  bgRect.setAttribute("width", vbW);
  bgRect.setAttribute("height", vbH);
  bgRect.setAttribute("fill", "url(#gp-grid)");
  svg.appendChild(bgRect);

  var edgesG = document.createElementNS(svgNS, "g");
  var edgeEls = [];
  for (var k = 0; k < data.edges.length; k++) {
    var e = data.edges[k];
    var a = nodeMap[e.source], b = nodeMap[e.target];
    if (!a || !b) continue;
    var line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("stroke", "rgba(255,255,255,0.08)");
    line.setAttribute("stroke-width", Math.max(0.8, Math.min(e.weight * 2, 4)));
    edgesG.appendChild(line);
    edgeEls.push({ line: line, e: e });
  }
  svg.appendChild(edgesG);

  var nodesG = document.createElementNS(svgNS, "g");
  for (var i = 0; i < data.nodes.length; i++) {
    (function(n) {
      var c = colorOf(n.entity_type);
      var g = document.createElementNS(svgNS, "g");
      g.style.cursor = "pointer";

      var circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", n.x);
      circle.setAttribute("cy", n.y);
      circle.setAttribute("r", n.is_agent ? 9 : 7);
      circle.setAttribute("fill", c);
      circle.setAttribute("fill-opacity", "0.85");
      circle.setAttribute("stroke", "rgba(255,255,255,0.12)");
      circle.setAttribute("stroke-width", "0.8");
      g.appendChild(circle);

      if (n.is_agent) {
        var ring = document.createElementNS(svgNS, "circle");
        ring.setAttribute("cx", n.x);
        ring.setAttribute("cy", n.y);
        ring.setAttribute("r", 13);
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", c);
        ring.setAttribute("stroke-opacity", "0.3");
        ring.setAttribute("stroke-width", "1");
        g.insertBefore(ring, circle);
      }

      var text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", n.x);
      text.setAttribute("y", n.y - (n.is_agent ? 16 : 14));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "#94a3b8");
      text.setAttribute("font-size", "11");
      text.setAttribute("font-family", "'Chakra Petch', sans-serif");
      text.textContent = n.name;
      g.appendChild(text);

      g.addEventListener("mouseenter", function() {
        circle.setAttribute("r", n.is_agent ? 11 : 9);
        circle.setAttribute("stroke", "rgba(255,255,255,0.7)");
        circle.setAttribute("stroke-width", "2");
        text.setAttribute("fill", "#e2e8f0");
        text.setAttribute("font-size", "12");
        text.setAttribute("font-weight", "600");
        for (var k = 0; k < edgeEls.length; k++) {
          var ee = edgeEls[k];
          if (ee.e.source === n.id || ee.e.target === n.id) {
            ee.line.setAttribute("stroke", c);
            ee.line.setAttribute("stroke-opacity", "0.7");
          } else {
            ee.line.setAttribute("stroke-opacity", "0.03");
          }
        }
        var tip = document.createElement("div");
        tip.className = "graph-tip";
        tip.innerHTML = '<div class="graph-tip-name" style="color:' + c + '">' + n.name + '</div>' +
          (n.entity_type ? '<div class="graph-tip-type">' + n.entity_type + (n.is_agent ? ' · AGENT' : '') + '</div>' : '') +
          (n.summary ? '<div class="graph-tip-summary">' + n.summary + '</div>' : '');
        container.appendChild(tip);
      });
      g.addEventListener("mousemove", function(ev) {
        var tip = container.querySelector(".graph-tip");
        if (tip) {
          var rect = container.getBoundingClientRect();
          tip.style.left = (ev.clientX - rect.left + 14) + "px";
          tip.style.top = (ev.clientY - rect.top + 14) + "px";
        }
      });
      g.addEventListener("mouseleave", function() {
        circle.setAttribute("r", n.is_agent ? 9 : 7);
        circle.setAttribute("stroke", "rgba(255,255,255,0.12)");
        circle.setAttribute("stroke-width", "0.8");
        text.setAttribute("fill", "#94a3b8");
        text.setAttribute("font-size", "11");
        text.setAttribute("font-weight", "400");
        for (var k = 0; k < edgeEls.length; k++) {
          edgeEls[k].line.setAttribute("stroke", "rgba(255,255,255,0.08)");
          edgeEls[k].line.setAttribute("stroke-opacity", "1");
        }
        var tip = container.querySelector(".graph-tip");
        if (tip) tip.remove();
      });

      // 拖拽
      g.addEventListener("mousedown", function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var startX = ev.clientX, startY = ev.clientY;
        var nx = n.x, ny = n.y;
        function onMove(ev2) {
          var scale = svg._scale || 1;
          n.x = nx + (ev2.clientX - startX) / scale;
          n.y = ny + (ev2.clientY - startY) / scale;
          n.vx = 0; n.vy = 0;
          circle.setAttribute("cx", n.x);
          circle.setAttribute("cy", n.y);
          if (n.is_agent) ring.setAttribute("cx", n.x), ring.setAttribute("cy", n.y);
          text.setAttribute("x", n.x);
          text.setAttribute("y", n.y - (n.is_agent ? 16 : 14));
          for (var k = 0; k < edgeEls.length; k++) {
            var ee = edgeEls[k];
            if (ee.e.source === n.id) { ee.line.setAttribute("x1", n.x); ee.line.setAttribute("y1", n.y); }
            if (ee.e.target === n.id) { ee.line.setAttribute("x2", n.x); ee.line.setAttribute("y2", n.y); }
          }
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      nodesG.appendChild(g);
    })(data.nodes[i]);
  }
  svg.appendChild(nodesG);

  // 滚轮缩放
  svg.addEventListener("wheel", function(ev) {
    ev.preventDefault();
    var vb = svg.getAttribute("viewBox").split(" ").map(parseFloat);
    var factor = ev.deltaY > 0 ? 1.1 : 0.9;
    var newW = vb[2] * factor, newH = vb[3] * factor;
    var rect = svg.getBoundingClientRect();
    var mx = (ev.clientX - rect.left) / rect.width;
    var my = (ev.clientY - rect.top) / rect.height;
    var dx = (vb[2] - newW) * mx;
    var dy = (vb[3] - newH) * my;
    svg.setAttribute("viewBox", (vb[0] + dx) + " " + (vb[1] + dy) + " " + newW + " " + newH);
    svg._scale = rect.width / newW;
  });

  // 背景拖拽平移
  svg.addEventListener("mousedown", function(ev) {
    if (ev.target !== svg && ev.target !== bgRect) return;
    svg.style.cursor = "grabbing";
    var startX = ev.clientX, startY = ev.clientY;
    var vb = svg.getAttribute("viewBox").split(" ").map(parseFloat);
    var rect = svg.getBoundingClientRect();
    function onMove(ev2) {
      var dx = (ev2.clientX - startX) * vb[2] / rect.width;
      var dy = (ev2.clientY - startY) * vb[3] / rect.height;
      svg.setAttribute("viewBox", (vb[0] - dx) + " " + (vb[1] - dy) + " " + vb[2] + " " + vb[3]);
    }
    function onUp() {
      svg.style.cursor = "grab";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  container.appendChild(svg);
})();
    </script>
  </section>`;
}

const AGENT_COLORS = ["cyan", "amber", "emerald", "violet", "rose"] as const;
const AGENT_COLOR_HEX: Record<string, string> = {
  cyan: "#22d3ee", amber: "#fbbf24", emerald: "#34d399", violet: "#a78bfa", rose: "#fb7185",
};

function renderAgents(agents: any[]): string {
  if (!agents || agents.length === 0) return "";
  const cards = agents.map((a: any, i: number) => {
    const color = AGENT_COLORS[i % AGENT_COLORS.length];
    const hex = AGENT_COLOR_HEX[color];
    const sp = a.skill_profile || {};
    const state = a.current_internal_state || {};
    const birth = a.birth_context || {};
    const hasSkill = sp && (sp.raw_content?.length > 100 || sp.identity || (sp.mental_models?.length || 0) > 0);

    // SkillProfile 各字段
    const identityHtml = sp.identity && typeof sp.identity === "object" ? `
      <div class="sp-block">
        <p class="sp-label" style="color:${hex}">IDENTITY</p>
        <p class="sp-text">${esc(sp.identity.name || "")}${sp.identity.domain ? " · " + esc(sp.identity.domain) : ""}${sp.identity.background ? " · " + esc(sp.identity.background) : ""}</p>
      </div>` : "";

    const mentalModelsHtml = Array.isArray(sp.mental_models) && sp.mental_models.length > 0 ? `
      <div class="sp-block">
        <p class="sp-label" style="color:${hex}">MENTAL MODELS</p>
        ${sp.mental_models.map((m: any) => `<p class="sp-text">• ${typeof m === "string" ? esc(m) : esc(m.name || "") + "：" + esc(m.description || "")}</p>`).join("")}
      </div>` : "";

    const decisionRulesHtml = Array.isArray(sp.decision_rules) && sp.decision_rules.length > 0 ? `
      <div class="sp-block">
        <p class="sp-label" style="color:${hex}">DECISION RULES</p>
        ${sp.decision_rules.map((r: any) => `<p class="sp-text">• ${typeof r === "string" ? esc(r) : esc(r.trigger || "") + " → " + esc(r.rule || "")}</p>`).join("")}
      </div>` : "";

    const exprHtml = sp.expression_style && typeof sp.expression_style === "object" ? `
      <div class="sp-block">
        <p class="sp-label" style="color:${hex}">EXPRESSION STYLE</p>
        <p class="sp-text">语气${esc(sp.expression_style.tone || "")} · 节奏${esc(sp.expression_style.rhythm || "")} · 用词${esc(sp.expression_style.vocabulary || "")}${sp.expression_style.habits ? " · 习惯" + esc(sp.expression_style.habits) : ""}</p>
      </div>` : "";

    const valuesHtml = Array.isArray(sp.values) && sp.values.length > 0 ? `
      <div class="sp-block">
        <p class="sp-label" style="color:${hex}">VALUES</p>
        <p class="sp-text">${sp.values.map((v: any) => esc(String(v))).join(" · ")}</p>
      </div>` : "";

    const antiHtml = Array.isArray(sp.anti_patterns) && sp.anti_patterns.length > 0 ? `
      <div class="sp-block sp-anti">
        <p class="sp-label" style="color:#fb7185">ANTI-PATTERNS</p>
        <p class="sp-text">${sp.anti_patterns.map((ap: any) => esc(String(ap))).join(" · ")}</p>
      </div>` : "";

    const honestyHtml = sp.honesty_boundary ? `
      <div class="sp-block">
        <p class="sp-label" style="color:${hex}">HONESTY BOUNDARY</p>
        <p class="sp-text">${esc(sp.honesty_boundary)}</p>
      </div>` : "";

    return `
      <details class="agent-card" style="border-left-color:${hex}">
        <summary class="agent-summary">
          <div class="agent-avatar" style="background:${hex}22;color:${hex}">${esc(a.name?.[0] || "?")}</div>
          <div class="agent-info">
            <div class="agent-name-row">
              <span class="agent-name" style="color:${hex}">${esc(a.name || "?")}</span>
              ${hasSkill ? `<span class="agent-skill-tag">Skill profile</span>` : ""}
            </div>
            <p class="agent-meta">${esc(a.role_type || "Agent")}${birth.identity ? " · " + esc(birth.identity) : ""}</p>
            ${state.stance ? `<p class="agent-meta agent-stance">立场：${esc(state.stance)}</p>` : ""}
          </div>
          <span class="agent-expand-hint">详情</span>
        </summary>
        <div class="agent-detail">
          ${identityHtml}
          ${mentalModelsHtml}
          ${decisionRulesHtml}
          ${exprHtml}
          ${valuesHtml}
          ${antiHtml}
          ${honestyHtml}
        </div>
      </details>`;
  }).join("");

  return `<section id="sec-agents" class="rpt-section">
    <h2 class="rpt-h2">Agents · ${agents.length}</h2>
    <p class="rpt-meta">点击卡片展开查看 SkillProfile（认知操作系统）</p>
    <div class="agent-list">${cards}</div>
  </section>`;
}

function renderWorldInfo(world: any): string {
  return `<section id="sec-world" class="rpt-section">
    <h2 class="rpt-h2">世界信息</h2>
    <div class="rpt-field"><span class="rpt-field-key">世界标题</span><p class="rpt-para">${esc(world.title)}</p></div>
    <div class="rpt-field"><span class="rpt-field-key">推演目标</span><p class="rpt-para">${esc(world.simulation_goal)}</p></div>
    ${world.world_background ? `<div class="rpt-field"><span class="rpt-field-key">世界背景</span><p class="rpt-para">${esc(world.world_background)}</p></div>` : ""}
  </section>`;
}

const CSS = `
* { box-sizing: border-box; }
body {
  background: #0a0e1a; color: #e2e8f0;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.7; margin: 0; padding: 32px 20px;
  font-size: 15px;
}
.cover { max-width: 900px; margin: 0 auto 40px; padding: 32px 0; border-bottom: 1px solid rgba(34,211,238,0.2); }
.cover h1 { font-size: 28px; color: #22d3ee; margin: 0 0 12px; font-weight: 700; letter-spacing: 0.02em; }
.cover .meta { color: #64748b; font-size: 13px; }
.cover .goal { color: #94a3b8; margin-top: 12px; font-size: 14px; }
/* TOC 目录 */
.toc { max-width: 900px; margin: 0 auto 32px; padding: 20px 24px; background: #131826; border-radius: 10px; border: 1px solid rgba(148,163,184,0.08); }
.toc-title { font-size: 11px; color: #64748b; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 12px; font-weight: 600; }
.toc-list { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0; padding: 0; list-style: none; }
.toc-list li a { display: inline-block; padding: 4px 12px; font-size: 13px; color: #94a3b8; background: rgba(148,163,184,0.06); border-radius: 4px; text-decoration: none; transition: all 0.15s; border: 1px solid rgba(148,163,184,0.1); }
.toc-list li a:hover { color: #22d3ee; background: rgba(34,211,238,0.08); border-color: rgba(34,211,238,0.3); }
.rpt-section { max-width: 900px; margin: 0 auto 32px; padding: 24px; background: #131826; border-radius: 10px; border: 1px solid rgba(148,163,184,0.08); }
.rpt-h2 { font-size: 18px; color: #22d3ee; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid rgba(34,211,238,0.15); letter-spacing: 0.04em; }
.rpt-meta { color: #64748b; font-size: 12px; margin: -8px 0 16px; }
.rpt-para { margin: 6px 0; color: #cbd5e1; }
.rpt-list { margin: 8px 0; padding-left: 20px; color: #cbd5e1; }
.rpt-list li { margin: 4px 0; }
.rpt-field { margin: 12px 0; }
.rpt-field-key { display: inline-block; color: #a78bfa; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 4px; text-transform: uppercase; }
/* timeline */
.day-entry { margin: 16px 0; padding: 16px; background: #0f1420; border-radius: 8px; border-left: 3px solid #22d3ee; }
.day-header { font-size: 13px; color: #22d3ee; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 10px; }
.day-tag { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 3px; margin-right: 6px; background: rgba(34,211,238,0.12); color: #22d3ee; border: 1px solid rgba(34,211,238,0.3); letter-spacing: 0.05em; }
.day-tag-intervention { background: rgba(167,139,250,0.12); color: #a78bfa; border-color: rgba(167,139,250,0.3); }
.day-tag-type { background: rgba(251,191,36,0.12); color: #fbbf24; border-color: rgba(251,191,36,0.3); }
.day-tag-state { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.3); }
.day-tag-goal { background: rgba(34,211,238,0.12); color: #22d3ee; border-color: rgba(34,211,238,0.3); }
.day-event { margin-bottom: 12px; }
.day-event-title { font-size: 15px; color: #e2e8f0; margin: 6px 0; font-weight: 600; }
.day-responses { margin: 12px 0; }
.day-response { margin: 10px 0; padding: 10px 12px; background: rgba(148,163,184,0.05); border-radius: 6px; }
.day-response-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.day-response-name { color: #22d3ee; font-weight: 600; font-size: 13px; }
.day-response-label { color: #64748b; font-size: 11px; margin-right: 4px; }
.day-response-action-detail { margin: 4px 0; color: #cbd5e1; font-size: 13px; line-height: 1.6; }
.day-response-speech { margin: 4px 0; color: #e2e8f0; }
.day-response-thought { margin: 4px 0; color: #64748b; font-size: 13px; font-style: italic; }
.day-response-delta { margin: 2px 0; color: #a78bfa; font-size: 12px; }
.day-state { margin-top: 12px; padding: 10px 12px; background: rgba(16,185,129,0.05); border-radius: 6px; }
.day-goal { margin-top: 12px; padding: 10px 12px; background: rgba(34,211,238,0.05); border-radius: 6px; border-left: 2px solid rgba(34,211,238,0.4); }
.day-metrics { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.metric-chip { font-size: 11px; padding: 2px 8px; background: rgba(148,163,184,0.1); border-radius: 3px; color: #94a3b8; }
/* graph */
.graph-canvas { position: relative; width: 100%; height: 540px; background: #0a0e1a; border-radius: 8px; overflow: hidden; border: 1px solid rgba(148,163,184,0.1); margin-top: 12px; }
.graph-tip { position: absolute; background: rgba(6,8,13,0.95); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px 14px; max-width: 260px; pointer-events: none; z-index: 20; backdrop-filter: blur(8px); box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
.graph-tip-name { font-size: 13px; font-weight: 600; font-family: 'Chakra Petch', sans-serif; letter-spacing: 0.02em; }
.graph-tip-type { font-size: 10px; color: #64748b; margin-top: 3px; letter-spacing: 0.08em; text-transform: uppercase; }
.graph-tip-summary { font-size: 12px; color: #94a3b8; margin-top: 8px; line-height: 1.55; }
/* agent cards */
.agent-list { display: flex; flex-direction: column; gap: 12px; }
.agent-card { background: #0f1420; border-radius: 8px; border-left: 3px solid #22d3ee; overflow: hidden; }
.agent-card[open] { background: #0f1420; }
.agent-summary { padding: 12px 14px; cursor: pointer; list-style: none; display: flex; align-items: center; gap: 12px; }
.agent-summary::-webkit-details-marker { display: none; }
.agent-summary:hover { background: rgba(148,163,184,0.04); }
.agent-avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: 'Chakra Petch', sans-serif; flex-shrink: 0; }
.agent-info { flex: 1; min-width: 0; }
.agent-name-row { display: flex; align-items: center; gap: 8px; }
.agent-name { font-size: 14px; font-weight: 700; font-family: 'Chakra Petch', sans-serif; }
.agent-skill-tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(148,163,184,0.1); color: #94a3b8; letter-spacing: 0.05em; }
.agent-meta { margin: 2px 0 0; font-size: 12px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-stance { color: #94a3b8; }
.agent-expand-hint { font-size: 11px; color: #64748b; flex-shrink: 0; }
.agent-card[open] .agent-expand-hint { display: none; }
.agent-detail { padding: 12px 14px; border-top: 1px solid rgba(148,163,184,0.08); display: flex; flex-direction: column; gap: 10px; }
.sp-block { font-size: 12px; }
.sp-label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px; font-family: 'Chakra Petch', sans-serif; font-weight: 600; }
.sp-text { margin: 2px 0; color: #cbd5e1; line-height: 1.7; }
.sp-anti { background: rgba(251,113,133,0.04); padding: 8px 10px; border-radius: 4px; border-left: 2px solid rgba(251,113,133,0.4); }
`;

export function buildExportHtml(params: ExportParams): string {
  const { world, report, rawLog, graph, agents } = params;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const sections: string[] = [];
  const tocEntries: { id: string; title: string }[] = [];

  sections.push(renderWorldInfo(world));
  tocEntries.push({ id: "sec-world", title: "世界信息" });

  const agentsHtml = renderAgents(agents);
  if (agentsHtml) {
    sections.push(agentsHtml);
    tocEntries.push({ id: "sec-agents", title: `Agents · ${agents.length}` });
  }

  const graphHtml = renderGraph(graph);
  if (graphHtml) {
    sections.push(graphHtml);
    tocEntries.push({ id: "sec-graph", title: "知识图谱" });
  }

  if (report) {
    const storyBody = renderValue(report.story);
    if (storyBody) {
      sections.push(renderReportSection("故事", report.story, "sec-story"));
      tocEntries.push({ id: "sec-story", title: "故事" });
    }
  }

  const timelineHtml = renderTimeline(rawLog, agents);
  if (timelineHtml) {
    sections.push(timelineHtml);
    tocEntries.push({ id: "sec-timeline", title: "推演时间线" });
  }

  if (report) {
    const sectionDefs: { key: string; title: string; id: string }[] = [
      { key: "executive_summary", title: "总结分析", id: "sec-summary" },
      { key: "goal_assessment", title: "目标达成评估", id: "sec-goal" },
      { key: "world_setup", title: "世界设定", id: "sec-setup" },
      { key: "agent_perspectives", title: "角色视角", id: "sec-perspectives" },
      { key: "relationship_changes", title: "关系变化", id: "sec-relations" },
      { key: "metrics", title: "指标分析", id: "sec-metrics" },
      { key: "key_drivers", title: "关键驱动", id: "sec-drivers" },
    ];
    for (const sd of sectionDefs) {
      const body = renderValue(report[sd.key]);
      if (body) {
        sections.push(renderReportSection(sd.title, report[sd.key], sd.id));
        tocEntries.push({ id: sd.id, title: sd.title });
      }
    }
    if (report.intervention_impact && Object.keys(report.intervention_impact).length > 0) {
      sections.push(renderReportSection("上帝干预影响", report.intervention_impact, "sec-intervention"));
      tocEntries.push({ id: "sec-intervention", title: "上帝干预影响" });
    }
  }

  const tocHtml = tocEntries.length > 0
    ? `<nav class="toc">
        <p class="toc-title">目录</p>
        <ul class="toc-list">${tocEntries.map(t => `<li><a href="#${t.id}">${esc(t.title)}</a></li>`).join("")}</ul>
      </nav>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(world.title)} - 推演报告</title>
<style>${CSS}</style>
</head>
<body>
<div class="cover">
  <h1>${esc(world.title)}</h1>
  <div class="meta">SoulSim 推演报告 · 导出于 ${dateStr}</div>
  <div class="goal">推演目标：${esc(world.simulation_goal)}</div>
</div>
${tocHtml}
${sections.join("\n")}
</body>
</html>`;
}
