"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";

/* eslint-disable @typescript-eslint/no-explicit-any */

type GraphNode = {
  id: string; name: string; entity_type: string; summary?: string;
  properties?: Record<string, any>; source?: string; first_seen?: number; last_updated?: number;
  is_agent?: boolean; agent_id?: string | null;
  x: number; y: number; vx: number; vy: number;
};
type GraphEdge = { source: string; target: string; relation: string; weight: number };
export type GraphStats = { node_count: number; edge_count: number; type_distribution: Array<{ entity_type: string; cnt: number }> };

const GRAPH_COLORS: Record<string, string> = {
  // 人物类 - cyan 系
  person: "#22d3ee", teacher: "#22d3ee", student: "#67e8f9", principal: "#06b6d4",
  parent: "#22d3ee", user: "#67e8f9", customer: "#67e8f9", employee: "#67e8f9",
  // 组织类 - violet 系
  team: "#a78bfa", organization: "#a78bfa", department: "#c4b5fd", school: "#8b5cf6",
  company: "#8b5cf6", group: "#c4b5fd", committee: "#8b5cf6",
  // 事件类 - rose 系
  event: "#fb7185", incident: "#fb7185", crisis: "#f43f5e", conflict: "#f43f5e",
  activity: "#fda4af", meeting: "#fda4af",
  // 物品/工具类 - amber 系
  product: "#fbbf24", tool: "#fbbf24", technology: "#f59e0b", system: "#f59e0b",
  resource: "#fbbf24", equipment: "#f59e0b", platform: "#f59e0b",
  // 策略/规则类 - green 系
  strategy: "#34d399", policy: "#34d399", plan: "#10b981", rule: "#10b981",
  regulation: "#10b981", law: "#059669",
  // 概念类 - indigo 系
  concept: "#818cf8", subject: "#818cf8", topic: "#a5b4fc", knowledge: "#818cf8",
  skill: "#a5b4fc", idea: "#a5b4fc",
  // 位置类 - orange 系
  location: "#fb923c", place: "#fb923c", site: "#fb923c", venue: "#fb923c",
  // 指标/结果类 - emerald 系
  metric: "#34d399", outcome: "#34d399", result: "#34d399", indicator: "#34d399",
  // 其他
  pivot: "#fb7185", goal: "#fbbf24", risk: "#fb7185", opportunity: "#34d399",
};

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 68%, 62%)`;
}

export function graphColor(type: string) {
  if (!type) return "#475569";
  const key = type.toLowerCase();
  return GRAPH_COLORS[key] || hashColor(key);
}

export function KnowledgeGraph({ worldId, fill = false, onStatsLoaded }: {
  worldId: string; fill?: boolean;
  onStatsLoaded?: (stats: GraphStats) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const draggingNode = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Camera: pan + zoom (infinite canvas)
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const panning = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  const WORLD_SIZE = 800;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [graphData, statsData] = await Promise.all([api.getGraph(worldId), api.getGraphStats(worldId)]);
        if (cancelled) return;
        const rawNodes: any[] = graphData.nodes || [];
        const rawEdges: any[] = graphData.edges || [];
        const cx = WORLD_SIZE / 2, cy = WORLD_SIZE / 2, r = WORLD_SIZE * 0.3;
        const gNodes: GraphNode[] = rawNodes.map((n: any, i: number) => ({
          id: n.node_id, name: n.name || n.node_id, entity_type: n.entity_type || "unknown", summary: n.summary,
          properties: n.properties, source: n.source, first_seen: n.first_seen, last_updated: n.last_updated,
          is_agent: n.is_agent, agent_id: n.agent_id,
          x: cx + r * Math.cos((2 * Math.PI * i) / rawNodes.length),
          y: cy + r * Math.sin((2 * Math.PI * i) / rawNodes.length), vx: 0, vy: 0,
        }));
        const gEdges: GraphEdge[] = rawEdges.map((e: any) => ({
          source: e.source_node, target: e.target_node, relation: e.relation || "", weight: e.weight ?? 1,
        }));
        nodesRef.current = gNodes; edgesRef.current = gEdges;
        setNodes([...gNodes]); setEdges(gEdges);
        if (onStatsLoaded) onStatsLoaded(statsData);
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [worldId, onStatsLoaded]);

  // Force simulation (no boundary clamping for infinite canvas)
  const tick = useCallback(() => {
    const ns = nodesRef.current, es = edgesRef.current;
    if (ns.length === 0) return;
    const nodeMap = new Map(ns.map(n => [n.id, n]));
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], b = ns[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 1200 / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    for (const e of es) {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 140) * 0.015;
      a.vx += (dx / dist) * force; a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force; b.vy -= (dy / dist) * force;
    }
    const cx = WORLD_SIZE / 2, cy = WORLD_SIZE / 2;
    let totalV = 0;
    for (const n of ns) {
      n.vx += (cx - n.x) * 0.0005; n.vy += (cy - n.y) * 0.0005;
      if (draggingNode.current?.id === n.id) { n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
      totalV += Math.abs(n.vx) + Math.abs(n.vy);
    }
    setNodes([...ns]);
    if (totalV > 0.3) animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (nodesRef.current.length > 0) { cancelAnimationFrame(animRef.current); animRef.current = requestAnimationFrame(tick); }
    return () => cancelAnimationFrame(animRef.current);
  }, [edges, tick]);

  // Zoom (wheel)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setCamera(prev => {
      const newScale = Math.max(0.15, Math.min(5, prev.scale * factor));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      return {
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
        scale: newScale,
      };
    });
  }, []);

  // Pan (background drag)
  const handleBgMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).tagName !== "svg" && !(e.target as SVGElement).classList.contains("graph-bg")) return;
    panning.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y };
    const onMove = (ev: MouseEvent) => {
      const p = panning.current;
      if (!p) return;
      setCamera(prev => ({
        ...prev,
        x: p.camX + (ev.clientX - p.startX),
        y: p.camY + (ev.clientY - p.startY),
      }));
    };
    const onUp = () => { panning.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [camera.x, camera.y]);

  // Node drag
  const onNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startScreenX = e.clientX, startScreenY = e.clientY;
    const startNodeX = node.x, startNodeY = node.y;
    draggingNode.current = { id: nodeId, startX: startScreenX, startY: startScreenY };

    const onMove = (ev: MouseEvent) => {
      if (!draggingNode.current) return;
      const n = nodesRef.current.find(nd => nd.id === nodeId);
      if (!n) return;
      n.x = startNodeX + (ev.clientX - startScreenX) / camera.scale;
      n.y = startNodeY + (ev.clientY - startScreenY) / camera.scale;
      setNodes([...nodesRef.current]);
      cancelAnimationFrame(animRef.current); animRef.current = requestAnimationFrame(tick);
    };
    const onUp = () => { draggingNode.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [camera.scale, tick]);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const hoveredNode = hovered ? nodeMap.get(hovered) : null;

  if (loading) return (
    <div className="flex items-center justify-center" style={{ width: "100%", height: "100%", background: "var(--bg-deep)" }}>
      <span className="status-dot status-dot-building" style={{ width: 10, height: 10 }} />
      <span className="text-sm ml-2" style={{ color: "var(--text-muted)" }}>加载图谱...</span>
    </div>
  );

  if (nodes.length === 0) return (
    <div className="flex flex-col items-center justify-center" style={{ width: "100%", height: "100%", background: "var(--bg-deep)" }}>
      <svg width="64" height="64" viewBox="0 0 64 64" style={{ color: "var(--text-muted)", opacity: 0.15 }}>
        <circle cx="20" cy="20" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="44" cy="20" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="32" cy="44" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <line x1="26" y1="20" x2="38" y2="20" stroke="currentColor" strokeWidth="1" />
        <line x1="22" y1="26" x2="30" y2="38" stroke="currentColor" strokeWidth="1" />
        <line x1="42" y1="26" x2="34" y2="38" stroke="currentColor" strokeWidth="1" />
      </svg>
      <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>构建后自动生成图谱</p>
    </div>
  );

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: "var(--bg-deep)", cursor: panning.current ? "grabbing" : "grab" }}
      onWheel={handleWheel}
    >
      {/* Grid background */}
      <svg width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="0.5" fill="rgba(255,255,255,0.03)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Main SVG with camera transform */}
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block", position: "relative" }}
        onMouseDown={handleBgMouseDown}
      >
        <rect className="graph-bg" width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.scale})`}>
          {/* Edges */}
          {edges.map((e, i) => {
            const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
            if (!s || !t) return null;
            const hl = hovered === e.source || hovered === e.target;
            return (
              <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={hl ? "rgba(34,211,238,0.6)" : "rgba(255,255,255,0.06)"}
                strokeWidth={Math.max(0.8, Math.min(e.weight * 2, 4))}
              />
            );
          })}
          {/* Nodes */}
          {nodes.map(n => {
            const isH = hovered === n.id;
            const c = graphColor(n.entity_type);
            const r = isH ? 10 : 7;
            return (
              <g key={n.id}
                onMouseDown={ev => onNodeMouseDown(ev, n.id)}
                onClick={() => setSelected(prev => prev === n.id ? null : n.id)}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                {isH && <circle cx={n.x} cy={n.y} r={24} fill={c} opacity={0.08} />}
                <circle cx={n.x} cy={n.y} r={r} fill={c} fillOpacity={0.8}
                  stroke={isH ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.1)"}
                  strokeWidth={isH ? 2 : 0.8}
                />
                <text x={n.x} y={n.y - r - 5} textAnchor="middle"
                  fill={isH ? "#e2e8f0" : "#94a3b8"}
                  fontSize={isH ? 12 : 10}
                  fontFamily="'Chakra Petch', sans-serif"
                  fontWeight={isH ? 600 : 400}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >{n.name}</text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredNode?.summary && (
        <div style={{
          position: "absolute",
          left: hoveredNode.x * camera.scale + camera.x + 16,
          top: hoveredNode.y * camera.scale + camera.y + 16,
          background: "rgba(6,8,13,0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "8px 12px",
          maxWidth: 220,
          pointerEvents: "none",
          zIndex: 20,
          backdropFilter: "blur(8px)",
        }}>
          <p className="text-xs font-semibold" style={{ color: graphColor(hoveredNode.entity_type), fontFamily: "var(--font-chakra)" }}>{hoveredNode.name}</p>
          <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>{hoveredNode.summary}</p>
        </div>
      )}

      {/* Node Detail Panel */}
      {selected && (() => {
        const sn = nodeMap.get(selected);
        if (!sn) return null;
        const connEdges = edges.filter(e => e.source === selected || e.target === selected);
        return (
          <div style={{
            position: "absolute", top: 16, right: 16, width: 280,
            background: "rgba(6,8,13,0.92)", border: "1px solid rgba(34,211,238,0.15)",
            borderRadius: 12, padding: "16px", zIndex: 30, backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: graphColor(sn.entity_type), display: "inline-block" }} />
                <span className="text-sm font-bold" style={{ color: "#e2e8f0", fontFamily: "'Chakra Petch', sans-serif" }}>{sn.name}</span>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: graphColor(sn.entity_type) + "22", color: graphColor(sn.entity_type), fontFamily: "'Chakra Petch', sans-serif", fontSize: 9 }}>{sn.entity_type}</span>
                {sn.is_agent && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", fontSize: 9 }}>AGENT</span>}
                {sn.source && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "#475569", fontSize: 9 }}>{sn.source}</span>}
              </div>
              {sn.summary && (
                <div>
                  <span className="text-xs" style={{ color: "#475569", fontFamily: "'Chakra Petch', sans-serif", letterSpacing: "0.06em" }}>SUMMARY</span>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#94a3b8" }}>{sn.summary}</p>
                </div>
              )}
              {(sn.first_seen != null || sn.last_updated != null) && (
                <div className="flex gap-3">
                  {sn.first_seen != null && sn.first_seen > 0 && (
                    <div>
                      <span className="text-xs" style={{ color: "#475569", fontFamily: "'Chakra Petch', sans-serif", letterSpacing: "0.06em", fontSize: 9 }}>FIRST SEEN</span>
                      <p className="text-xs mt-0.5" style={{ color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" }}>Day {sn.first_seen}</p>
                    </div>
                  )}
                  {sn.last_updated != null && sn.last_updated > 0 && (
                    <div>
                      <span className="text-xs" style={{ color: "#475569", fontFamily: "'Chakra Petch', sans-serif", letterSpacing: "0.06em", fontSize: 9 }}>LAST UPDATED</span>
                      <p className="text-xs mt-0.5" style={{ color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" }}>Day {sn.last_updated}</p>
                    </div>
                  )}
                </div>
              )}
              {sn.properties && Object.keys(sn.properties).length > 0 && (
                <div>
                  <span className="text-xs" style={{ color: "#475569", fontFamily: "'Chakra Petch', sans-serif", letterSpacing: "0.06em" }}>PROPERTIES</span>
                  <div className="mt-1 space-y-0.5">
                    {Object.entries(sn.properties).map(([k, v]) => (
                      <div key={k} className="flex gap-1 text-xs">
                        <span style={{ color: "#475569" }}>{k}:</span>
                        <span style={{ color: "#94a3b8" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {connEdges.length > 0 && (
                <div>
                  <span className="text-xs" style={{ color: "#475569", fontFamily: "'Chakra Petch', sans-serif", letterSpacing: "0.06em" }}>RELATIONS · {connEdges.length}</span>
                  <div className="mt-1 space-y-1" style={{ maxHeight: 160, overflowY: "auto" }}>
                    {connEdges.map((ce, ci) => {
                      const other = ce.source === selected ? nodeMap.get(ce.target) : nodeMap.get(ce.source);
                      const direction = ce.source === selected ? "→" : "←";
                      return (
                        <div key={ci} className="flex items-center gap-1 text-xs" style={{ color: "#94a3b8" }}>
                          <span>{direction}</span>
                          <span style={{ color: other ? graphColor(other.entity_type) : "#475569" }}>{other?.name || "?"}</span>
                          <span style={{ color: "#475569" }}>({ce.relation})</span>
                          <span style={{ color: "#475569", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>{ce.weight.toFixed(1)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Zoom indicator */}
      <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", gap: 4, zIndex: 10 }}>
        <button onClick={() => setCamera(p => ({ ...p, scale: Math.min(5, p.scale * 1.3) }))}
          style={{ width: 28, height: 28, borderRadius: 6, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
        <button onClick={() => setCamera(p => ({ ...p, scale: Math.max(0.15, p.scale * 0.7) }))}
          style={{ width: 28, height: 28, borderRadius: 6, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
        <span style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#475569", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center" }}>
          {Math.round(camera.scale * 100)}%
        </span>
      </div>
    </div>
  );
}
