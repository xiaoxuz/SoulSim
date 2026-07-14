"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type WorldOverview = {
  world_id: string;
  title: string | null;
  simulation_goal: string | null;
  status: string | null;
  created_at: string;
  counts: Record<string, number>;
};

type ColMeta = {
  type: string;
  readonly?: boolean;
  widget?: "text" | "textarea" | "json" | "select" | "number" | "boolean";
  options?: string[];
  fk?: string;
};
type TableMeta = {
  label: string;
  pk: string;
  order_by?: string;
  columns: Record<string, ColMeta>;
};
type TableSummary = { table: string; label: string; pk: string; count: number };

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--text-muted)",
  building: "var(--accent-amber)",
  ready: "var(--accent-cyan)",
  running: "var(--accent-emerald)",
  paused: "var(--accent-amber)",
  finished: "var(--accent-violet)",
  build_failed: "var(--accent-rose)",
};

const COUNT_LABELS: { key: string; label: string }[] = [
  { key: "agents", label: "Agent" },
  { key: "simulation_runs", label: "运行" },
  { key: "events", label: "事件" },
  { key: "memories", label: "记忆" },
  { key: "interventions", label: "干预" },
  { key: "reports", label: "报告" },
  { key: "graph_nodes", label: "节点" },
  { key: "graph_edges", label: "关系" },
  { key: "chat_sessions", label: "会话" },
  { key: "chat_messages", label: "消息" },
];

const WORLD_TABS = [
  { key: "agents", label: "Agents" },
  { key: "simulation_runs", label: "运行" },
  { key: "events", label: "事件" },
  { key: "memories", label: "记忆" },
  { key: "interventions", label: "干预" },
  { key: "graph_nodes", label: "节点" },
  { key: "graph_edges", label: "关系" },
  { key: "chat_sessions", label: "会话" },
];

export default function AdminPage() {
  const [view, setView] = useState<"worlds" | "raw">("worlds");

  return (
    <main className="relative" style={{ minHeight: "calc(100vh - 64px)" }}>
      <div
        className="flex items-center gap-1 px-6 py-3"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-deep)" }}
      >
        <p
          className="text-xs tracking-[0.25em] uppercase mr-4"
          style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
        >
          Admin
        </p>
        {(["worlds", "raw"] as const).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-3 py-1.5 text-sm rounded transition-colors"
              style={{
                background: active ? "rgba(34,211,238,0.08)" : "transparent",
                color: active ? "var(--accent-cyan)" : "var(--text-secondary)",
                border: `1px solid ${active ? "rgba(34,211,238,0.3)" : "var(--border)"}`,
                fontFamily: "var(--font-chakra)",
              }}
            >
              {v === "worlds" ? "世界管理" : "原始数据表"}
            </button>
          );
        })}
      </div>

      {view === "worlds" ? <WorldManager /> : <RawTableBrowser />}
    </main>
  );
}

// ============================ 世界管理 ============================

function WorldManager() {
  const [worlds, setWorlds] = useState<WorldOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<WorldOverview | null>(null);
  const [deleting, setDeleting] = useState<WorldOverview | null>(null);

  const load = () => {
    setLoading(true);
    setError("");
    api
      .adminWorldsOverview()
      .then((w: WorldOverview[]) => setWorlds(w))
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const totalAgents = worlds.reduce((s, w) => s + w.counts.agents, 0);
  const totalRuns = worlds.reduce((s, w) => s + w.counts.simulation_runs, 0);
  const totalEvents = worlds.reduce((s, w) => s + w.counts.events, 0);
  const totalMemories = worlds.reduce((s, w) => s + w.counts.memories, 0);

  if (selected) {
    return (
      <WorldDetail
        world={selected}
        onBack={() => setSelected(null)}
        onChanged={load}
      />
    );
  }

  return (
    <div>
      {/* 统计栏 */}
      <div
        className="grid grid-cols-5 gap-3 px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <StatCard label="世界总数" value={worlds.length} />
        <StatCard label="Agent 总数" value={totalAgents} />
        <StatCard label="运行总数" value={totalRuns} />
        <StatCard label="事件总数" value={totalEvents} />
        <StatCard label="记忆总数" value={totalMemories} />
      </div>

      {error && (
        <div
          className="px-6 py-2 text-xs"
          style={{
            background: "rgba(244,63,94,0.08)",
            color: "var(--accent-rose)",
            fontFamily: "var(--font-jetbrains)",
          }}
        >
          {error}
        </div>
      )}

      {/* 世界列表 */}
      <div className="px-6 py-4">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            加载中...
          </p>
        ) : worlds.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            还没有世界。去首页创建一个吧。
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {worlds.map((w) => (
              <WorldCard
                key={w.world_id}
                world={w}
                onView={() => setSelected(w)}
                onDelete={() => setDeleting(w)}
              />
            ))}
          </div>
        )}
      </div>

      {deleting && (
        <DeleteWorldDialog
          world={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.adminDeleteWorld(deleting.world_id);
              setDeleting(null);
              load();
            } catch (e: any) {
              setError(String(e.message || e));
              setDeleting(null);
            }
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}
    >
      <p
        className="text-xs tracking-wider uppercase mb-1"
        style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
      >
        {label}
      </p>
      <p
        className="text-2xl font-semibold"
        style={{ fontFamily: "var(--font-chakra)", color: "var(--accent-cyan)" }}
      >
        {value}
      </p>
    </div>
  );
}

function WorldCard({
  world,
  onView,
  onDelete,
}: {
  world: WorldOverview;
  onView: () => void;
  onDelete: () => void;
}) {
  const statusColor = STATUS_COLORS[world.status || ""] || "var(--text-muted)";
  const total =
    world.counts.agents +
    world.counts.simulation_runs +
    world.counts.events +
    world.counts.memories +
    world.counts.interventions +
    world.counts.reports +
    world.counts.graph_nodes +
    world.counts.graph_edges +
    world.counts.chat_sessions +
    world.counts.chat_messages;

  return (
    <div
      className="rounded-lg p-5 transition-all"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: statusColor }}
            />
            <span
              className="text-xs uppercase tracking-wider"
              style={{ fontFamily: "var(--font-jetbrains)", color: statusColor }}
            >
              {world.status || "unknown"}
            </span>
          </div>
          <h3
            className="text-lg font-semibold truncate"
            style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
          >
            {world.title || "(未命名)"}
          </h3>
          {world.simulation_goal && (
            <p
              className="text-xs mt-1 line-clamp-2"
              style={{ color: "var(--text-muted)" }}
            >
              {world.simulation_goal}
            </p>
          )}
        </div>
        <span
          className="text-xs ml-3 flex-shrink-0"
          style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
        >
          {world.created_at.replace("T", " ").slice(0, 10)}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2 my-4">
        {COUNT_LABELS.map(({ key, label }) => (
          <div
            key={key}
            className="text-center rounded px-2 py-1.5"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <p
              className="text-sm font-semibold"
              style={{
                fontFamily: "var(--font-jetbrains)",
                color: world.counts[key] > 0 ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {world.counts[key] || 0}
            </p>
            <p
              className="text-[10px] uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {label}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span
          className="text-xs"
          style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
        >
          共 {total} 条关联数据
        </span>
        <div className="flex gap-2">
          <button
            onClick={onView}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              color: "var(--accent-cyan)",
              border: "1px solid rgba(34,211,238,0.3)",
              fontFamily: "var(--font-chakra)",
            }}
          >
            查看详情
          </button>
          <button
            onClick={onDelete}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              color: "var(--accent-rose)",
              border: "1px solid rgba(244,63,94,0.3)",
              fontFamily: "var(--font-chakra)",
            }}
          >
            删除
          </button>
        </div>
      </div>

      <div
        className="mt-3 pt-3 text-[10px] font-mono truncate"
        style={{
          borderTop: "1px solid var(--border)",
          color: "var(--text-muted)",
          opacity: 0.6,
        }}
      >
        {world.world_id}
      </div>
    </div>
  );
}

function DeleteWorldDialog({
  world,
  onCancel,
  onConfirm,
}: {
  world: WorldOverview;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const total = COUNT_LABELS.reduce(
    (s, { key }) => s + (world.counts[key] || 0),
    0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg w-full mx-4"
        style={{
          maxWidth: 480,
          background: "var(--bg-deep)",
          border: "1px solid rgba(244,63,94,0.3)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <p
            className="text-xs tracking-[0.25em] uppercase mb-1"
            style={{ fontFamily: "var(--font-jetbrains)", color: "var(--accent-rose)" }}
          >
            危险操作 · 不可恢复
          </p>
          <h3
            className="text-lg font-semibold"
            style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
          >
            删除世界「{world.title || "(未命名)"}」
          </h3>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
            删除后，以下数据将被级联清除（共 {total} 条）：
          </p>
          <div className="grid grid-cols-2 gap-2">
            {COUNT_LABELS.filter(({ key }) => world.counts[key] > 0).map(
              ({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between px-3 py-1.5 rounded text-xs"
                  style={{ background: "rgba(244,63,94,0.05)" }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains)",
                      color: "var(--accent-rose)",
                    }}
                  >
                    {world.counts[key]}
                  </span>
                </div>
              )
            )}
            {total === 0 && (
              <p className="text-xs col-span-2" style={{ color: "var(--text-muted)" }}>
                无关联数据，仅删除世界本身。
              </p>
            )}
          </div>
          <p
            className="text-xs mt-4"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}
          >
            ID: {world.world_id}
          </p>
        </div>

        <div
          className="flex justify-end gap-2 px-6 py-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm rounded"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-chakra)",
            }}
          >
            取消
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
            disabled={busy}
            className="px-4 py-2 text-sm rounded"
            style={{
              background: "var(--accent-rose)",
              color: "white",
              fontFamily: "var(--font-chakra)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================ 世界详情 ============================

function WorldDetail({
  world,
  onBack,
  onChanged,
}: {
  world: WorldOverview;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<string>("agents");
  const [tool, setTool] = useState<null | "reset_runs" | "reset_reports">(null);
  const [toolBusy, setToolBusy] = useState(false);
  const [toolError, setToolError] = useState("");

  const runTool = async (kind: "reset_runs" | "reset_reports") => {
    setToolBusy(true);
    setToolError("");
    try {
      if (kind === "reset_runs") await api.adminResetWorldRuns(world.world_id);
      else await api.adminResetWorldReports(world.world_id);
      setTool(null);
      onChanged();
    } catch (e: any) {
      setToolError(String(e.message || e));
    } finally {
      setToolBusy(false);
    }
  };

  return (
    <div>
      <div
        className="px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-deep)" }}
      >
        <button
          onClick={onBack}
          className="text-xs mb-3"
          style={{ color: "var(--text-muted)", fontFamily: "var(--font-jetbrains)" }}
        >
          ← 返回世界列表
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: STATUS_COLORS[world.status || ""] || "var(--text-muted)" }}
              />
              <span
                className="text-xs uppercase tracking-wider"
                style={{
                  fontFamily: "var(--font-jetbrains)",
                  color: STATUS_COLORS[world.status || ""] || "var(--text-muted)",
                }}
              >
                {world.status || "unknown"}
              </span>
            </div>
            <h2
              className="text-xl font-semibold"
              style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
            >
              {world.title || "(未命名)"}
            </h2>
            {world.simulation_goal && (
              <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                {world.simulation_goal}
              </p>
            )}
            <p
              className="text-xs mt-2"
              style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
            >
              {world.world_id}
            </p>
          </div>
        </div>

        {/* 工具栏 */}
        <div
          className="flex items-center gap-2 mt-4 pt-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <p
            className="text-xs tracking-[0.25em] uppercase mr-2"
            style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
          >
            工具
          </p>
          <button
            onClick={() => setTool("reset_runs")}
            disabled={toolBusy}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              color: "var(--accent-amber)",
              border: "1px solid rgba(245,158,11,0.3)",
              fontFamily: "var(--font-chakra)",
              opacity: toolBusy ? 0.5 : 1,
            }}
          >
            重置推演
          </button>
          <button
            onClick={() => setTool("reset_reports")}
            disabled={toolBusy}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              color: "var(--accent-violet)",
              border: "1px solid rgba(167,139,250,0.3)",
              fontFamily: "var(--font-chakra)",
              opacity: toolBusy ? 0.5 : 1,
            }}
          >
            重置报告
          </button>
          {toolError && (
            <span
              className="text-xs ml-2"
              style={{ color: "var(--accent-rose)", fontFamily: "var(--font-jetbrains)" }}
            >
              {toolError}
            </span>
          )}
        </div>
      </div>

      <div
        className="flex items-center gap-1 px-6 border-b overflow-x-auto"
        style={{ borderColor: "var(--border)" }}
      >
        {WORLD_TABS.map((t) => {
          const active = tab === t.key;
          const cnt = world.counts[t.key] || 0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-3 py-2.5 text-sm transition-colors flex items-center gap-2 whitespace-nowrap"
              style={{
                borderBottom: active ? "2px solid var(--accent-cyan)" : "2px solid transparent",
                color: active ? "var(--accent-cyan)" : "var(--text-secondary)",
                fontFamily: "var(--font-chakra)",
              }}
            >
              {t.label}
              <span
                className="text-xs px-1.5 rounded"
                style={{
                  fontFamily: "var(--font-jetbrains)",
                  color: active ? "var(--accent-cyan)" : "var(--text-muted)",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {cnt}
              </span>
            </button>
          );
        })}
      </div>

      <div className="px-6 py-4">
        <WorldTabTable worldId={world.world_id} table={tab} />
      </div>

      {tool && (
        <ToolConfirmDialog
          kind={tool}
          world={world}
          busy={toolBusy}
          onCancel={() => {
            setTool(null);
            setToolError("");
          }}
          onConfirm={() => runTool(tool)}
        />
      )}
    </div>
  );
}

function ToolConfirmDialog({
  kind,
  world,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: "reset_runs" | "reset_reports";
  world: WorldOverview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isResetRuns = kind === "reset_runs";
  const accent = isResetRuns ? "var(--accent-amber)" : "var(--accent-violet)";
  const title = isResetRuns ? "重置推演" : "重置报告";
  const desc = isResetRuns
    ? "清空该世界的所有推演产物（运行、事件、记忆、干预、报告、聊天），保留世界构建（Agent、图谱、协议）。世界将回到 ready 状态，可重新开始推演。"
    : "清空该世界所有运行的报告，保留推演产物（事件、记忆、运行记录等）。可重新生成报告。";
  const affected = isResetRuns
    ? [
        { key: "simulation_runs", label: "运行" },
        { key: "events", label: "事件" },
        { key: "memories", label: "记忆" },
        { key: "interventions", label: "干预" },
        { key: "reports", label: "报告" },
        { key: "chat_sessions", label: "会话" },
        { key: "chat_messages", label: "消息" },
      ]
    : [{ key: "reports", label: "报告" }];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg w-full mx-4"
        style={{
          maxWidth: 480,
          background: "var(--bg-deep)",
          border: `1px solid ${accent}`,
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <p
            className="text-xs tracking-[0.25em] uppercase mb-1"
            style={{ fontFamily: "var(--font-jetbrains)", color: accent }}
          >
            危险操作 · 不可恢复
          </p>
          <h3
            className="text-lg font-semibold"
            style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
          >
            {title}「{world.title || "(未命名)"}」
          </h3>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
            {desc}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {affected
              .filter(({ key }) => (world.counts[key] || 0) > 0)
              .map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between px-3 py-1.5 rounded text-xs"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                  <span style={{ fontFamily: "var(--font-jetbrains)", color: accent }}>
                    {world.counts[key]}
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div
          className="flex justify-end gap-2 px-6 py-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm rounded"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-chakra)",
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm rounded"
            style={{
              background: accent,
              color: "white",
              fontFamily: "var(--font-chakra)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "执行中..." : `确认${title}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorldTabTable({ worldId, table }: { worldId: string; table: string }) {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .adminList(table, { limit: 100, world_id: worldId })
      .then((res: any) => {
        setRows(res.rows || []);
        setMeta(res.meta);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [worldId, table]);

  if (loading)
    return <p className="text-sm py-4" style={{ color: "var(--text-muted)" }}>加载中...</p>;
  if (error)
    return <p className="text-sm py-4" style={{ color: "var(--accent-rose)" }}>{error}</p>;
  if (rows.length === 0)
    return (
      <p className="text-sm py-4" style={{ color: "var(--text-muted)" }}>
        没有 {table} 数据
      </p>
    );

  const cols = meta ? Object.keys(meta.columns) : [];
  const displayCols = cols.filter(
    (c) =>
      !["world_id", "birth_context", "current_internal_state", "memory_summary"].includes(c)
  );

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.02)" }}>
            {displayCols.map((c) => (
              <th
                key={c}
                className="text-left px-3 py-2 text-xs uppercase tracking-wider font-medium"
                style={{
                  fontFamily: "var(--font-jetbrains)",
                  color: "var(--text-muted)",
                  borderBottom: "1px solid var(--border)",
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row[meta!.pk] || i}
              style={{
                borderBottom: "1px solid var(--border)",
                background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
              }}
            >
              {displayCols.map((c) => (
                <td
                  key={c}
                  className="px-3 py-2 text-sm align-top"
                  style={{
                    color: "var(--text-secondary)",
                    maxWidth: 320,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {renderCell(row[c], meta!.columns[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(v: any, col: ColMeta): React.ReactNode {
  if (v == null)
    return <span style={{ color: "var(--text-muted)", opacity: 0.5 }}>-</span>;
  if (col.type === "jsonb" || col.widget === "json") {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return (
      <span
        className="text-xs"
        style={{
          fontFamily: "var(--font-jetbrains)",
          color: "var(--accent-violet)",
          display: "inline-block",
          maxWidth: 240,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={s}
      >
        {s}
      </span>
    );
  }
  if (col.widget === "boolean") {
    return v ? (
      <span style={{ color: "var(--accent-emerald)" }}>✓</span>
    ) : (
      <span style={{ color: "var(--text-muted)" }}>·</span>
    );
  }
  if (col.type === "timestamptz") {
    return (
      <span
        style={{
          fontFamily: "var(--font-jetbrains)",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        {String(v).replace("T", " ").slice(0, 19)}
      </span>
    );
  }
  const s = String(v);
  return s.length > 60 ? (
    <span title={s}>{s.slice(0, 60)}...</span>
  ) : (
    <span>{s}</span>
  );
}

// ============================ 原始数据表浏览器（保留原 CRUD） ============================

function RawTableBrowser() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [activeTable, setActiveTable] = useState<string>("");
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.adminMeta().then(setTables).catch(() => setTables([]));
  }, []);

  useEffect(() => {
    if (!activeTable) return;
    setLoading(true);
    setError("");
    api
      .adminList(activeTable, { limit: pageSize, offset: page * pageSize, q: search })
      .then((res: any) => {
        setRows(res.rows || []);
        setTotal(res.total || 0);
        setMeta(res.meta);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [activeTable, page, search]);

  const switchTable = (t: string) => {
    setActiveTable(t);
    setPage(0);
    setSearch("");
    setEditing(null);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSave = async (row: Record<string, any>) => {
    if (!activeTable || !meta) return;
    setError("");
    try {
      if (isNew) {
        await api.adminCreate(activeTable, row);
      } else {
        const pk = meta.pk;
        const { [pk]: _pk, ...rest } = row;
        await api.adminUpdate(activeTable, row[pk], rest);
      }
      setEditing(null);
      setIsNew(false);
      const res: any = await api.adminList(activeTable, {
        limit: pageSize,
        offset: page * pageSize,
        q: search,
      });
      setRows(res.rows || []);
      setTotal(res.total || 0);
      api.adminMeta().then(setTables).catch(() => {});
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const handleDelete = async (row: Record<string, any>) => {
    if (!activeTable || !meta) return;
    if (!confirm(`确认删除 ${meta.pk}=${row[meta.pk]}？关联数据会因外键 CASCADE 一起删除。`))
      return;
    setError("");
    try {
      await api.adminDelete(activeTable, row[meta.pk]);
      const res: any = await api.adminList(activeTable, {
        limit: pageSize,
        offset: page * pageSize,
        q: search,
      });
      setRows(res.rows || []);
      setTotal(res.total || 0);
      api.adminMeta().then(setTables).catch(() => {});
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const handleNew = () => {
    if (!meta) return;
    const empty: Record<string, any> = {};
    Object.entries(meta.columns).forEach(([k, c]) => {
      if (c.readonly) return;
      if (c.widget === "boolean") empty[k] = false;
      else if (c.widget === "number") empty[k] = 0;
      else if (c.widget === "json") empty[k] = {};
      else empty[k] = "";
    });
    setEditing(empty);
    setIsNew(true);
  };

  return (
    <div className="relative flex" style={{ minHeight: "calc(100vh - 120px)" }}>
      <aside
        className="overflow-y-auto"
        style={{
          width: 240,
          borderRight: "1px solid var(--border)",
          background: "rgba(11,15,26,0.5)",
          flexShrink: 0,
        }}
      >
        <div
          className="px-4 py-3 sticky top-0 z-10"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-deep)" }}
        >
          <p
            className="text-xs tracking-[0.25em] uppercase"
            style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
          >
            Raw Tables
          </p>
        </div>
        {tables.map((t) => {
          const active = t.table === activeTable;
          return (
            <button
              key={t.table}
              onClick={() => switchTable(t.table)}
              className="w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors"
              style={{
                background: active ? "rgba(34,211,238,0.08)" : "transparent",
                borderLeft: active ? "2px solid var(--accent-cyan)" : "2px solid transparent",
                cursor: "pointer",
              }}
            >
              <span
                className="text-sm"
                style={{
                  fontFamily: "var(--font-chakra)",
                  color: active ? "var(--accent-cyan)" : "var(--text-secondary)",
                }}
              >
                {t.label}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  fontFamily: "var(--font-jetbrains)",
                  color: active ? "var(--accent-cyan)" : "var(--text-muted)",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </aside>

      <section className="flex-1 overflow-hidden flex flex-col">
        <div
          className="flex items-center gap-3 px-6 py-3"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-deep)" }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
          >
            {meta?.label || "Raw"}
          </h2>
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{
              fontFamily: "var(--font-jetbrains)",
              color: "var(--text-muted)",
              background: "rgba(255,255,255,0.04)",
            }}
          >
            {activeTable || "-"}
          </span>
          <div className="flex-1" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="搜索..."
            className="px-3 py-1.5 text-sm rounded"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              width: 240,
              fontFamily: "var(--font-jetbrains)",
            }}
          />
          <button
            onClick={handleNew}
            disabled={!activeTable}
            className="btn-primary text-sm"
            style={{ padding: "6px 14px", opacity: activeTable ? 1 : 0.4 }}
          >
            + 新建
          </button>
        </div>

        {error && (
          <div
            className="px-6 py-2 text-xs"
            style={{
              background: "rgba(244,63,94,0.08)",
              color: "var(--accent-rose)",
              fontFamily: "var(--font-jetbrains)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {!activeTable ? (
            <div
              className="h-full flex items-center justify-center"
              style={{ color: "var(--text-muted)" }}
            >
              <p className="text-sm">从左侧选一张表</p>
            </div>
          ) : loading ? (
            <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>
              加载中...
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>
              没有数据
            </div>
          ) : (
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead className="sticky top-0 z-10">
                <tr style={{ background: "var(--bg-deep)" }}>
                  {meta &&
                    Object.keys(meta.columns).map((c) => (
                      <th
                        key={c}
                        className="text-left px-3 py-2 text-xs uppercase tracking-wider font-medium"
                        style={{
                          fontFamily: "var(--font-jetbrains)",
                          color: "var(--text-muted)",
                          borderBottom: "1px solid var(--border)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  <th
                    className="px-3 py-2 text-xs uppercase tracking-wider font-medium"
                    style={{
                      fontFamily: "var(--font-jetbrains)",
                      color: "var(--text-muted)",
                      borderBottom: "1px solid var(--border)",
                      position: "sticky",
                      right: 0,
                      background: "var(--bg-deep)",
                    }}
                  >
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row[meta!.pk] || i}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                    }}
                  >
                    {meta &&
                      Object.keys(meta.columns).map((c) => (
                        <td
                          key={c}
                          className="px-3 py-2 text-sm align-top"
                          style={{
                            color: "var(--text-secondary)",
                            maxWidth: 320,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {renderCell(row[c], meta.columns[c])}
                        </td>
                      ))}
                    <td
                      className="px-3 py-2 text-sm"
                      style={{
                        position: "sticky",
                        right: 0,
                        background: i % 2 === 0 ? "var(--bg-deep)" : "rgba(11,15,26,0.95)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => {
                            setEditing({ ...row });
                            setIsNew(false);
                          }}
                          className="text-xs px-2 py-1 rounded"
                          style={{
                            color: "var(--accent-cyan)",
                            border: "1px solid var(--border)",
                            fontFamily: "var(--font-jetbrains)",
                          }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          className="text-xs px-2 py-1 rounded"
                          style={{
                            color: "var(--accent-rose)",
                            border: "1px solid var(--border)",
                            fontFamily: "var(--font-jetbrains)",
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {activeTable && total > 0 && (
          <div
            className="flex items-center gap-4 px-6 py-2 text-xs"
            style={{
              borderTop: "1px solid var(--border)",
              background: "var(--bg-deep)",
              fontFamily: "var(--font-jetbrains)",
              color: "var(--text-muted)",
            }}
          >
            <span>
              共 {total} 条 · 第 {page + 1} / {totalPages} 页
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded"
              style={{
                border: "1px solid var(--border)",
                color: page === 0 ? "var(--text-muted)" : "var(--text-primary)",
                opacity: page === 0 ? 0.4 : 1,
              }}
            >
              上一页
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded"
              style={{
                border: "1px solid var(--border)",
                color: page >= totalPages - 1 ? "var(--text-muted)" : "var(--text-primary)",
                opacity: page >= totalPages - 1 ? 0.4 : 1,
              }}
            >
              下一页
            </button>
          </div>
        )}
      </section>

      {editing && meta && (
        <EditDrawer
          row={editing}
          meta={meta}
          isNew={isNew}
          onSave={handleSave}
          onClose={() => {
            setEditing(null);
            setIsNew(false);
          }}
        />
      )}
    </div>
  );
}

function EditDrawer({
  row,
  meta,
  isNew,
  onSave,
  onClose,
}: {
  row: Record<string, any>;
  meta: TableMeta;
  isNew: boolean;
  onSave: (row: Record<string, any>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, any>>({ ...row });
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  const update = (k: string, v: any) => setDraft((d) => ({ ...d, [k]: v }));

  const handleJsonChange = (k: string, raw: string) => {
    try {
      const parsed = raw.trim() === "" ? {} : JSON.parse(raw);
      update(k, parsed);
      setJsonErrors((e) => ({ ...e, [k]: "" }));
    } catch (e: any) {
      setJsonErrors((e) => ({ ...e, [k]: String(e.message) }));
    }
  };

  const submit = () => {
    if (Object.values(jsonErrors).some(Boolean)) return;
    onSave(draft);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="h-full overflow-y-auto"
        style={{
          width: "min(560px, 100vw)",
          background: "var(--bg-deep)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 flex items-center justify-between px-6 py-4"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-deep)",
            zIndex: 1,
          }}
        >
          <div>
            <p
              className="text-xs tracking-[0.25em] uppercase"
              style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
            >
              {isNew ? "Create" : "Edit"} · {meta.label}
            </p>
            <p
              className="text-sm mt-1"
              style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
            >
              {isNew ? "新建记录" : `${meta.pk} = ${row[meta.pk]}`}
            </p>
          </div>
          <button onClick={onClose} className="text-lg" style={{ color: "var(--text-muted)" }}>
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {Object.entries(meta.columns).map(([k, c]) => {
            const val = draft[k];
            const isPk = k === meta.pk;
            const showReadonly = c.readonly || (isPk && !isNew);
            return (
              <div key={k}>
                <label
                  className="flex items-center gap-2 mb-1.5"
                  style={{ fontFamily: "var(--font-jetbrains)", fontSize: 11 }}
                >
                  <span
                    className="uppercase tracking-wider"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {k}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {c.type}
                    {c.fk && ` -> ${c.fk}`}
                    {showReadonly && " · readonly"}
                  </span>
                </label>
                {showReadonly ? (
                  <div
                    className="px-3 py-2 text-sm rounded"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-jetbrains)",
                    }}
                  >
                    {val == null
                      ? "-"
                      : typeof val === "object"
                      ? JSON.stringify(val)
                      : String(val)}
                  </div>
                ) : c.widget === "textarea" ? (
                  <textarea
                    value={val ?? ""}
                    onChange={(e) => update(k, e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 text-sm rounded resize-vertical"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-jetbrains)",
                    }}
                  />
                ) : c.widget === "json" ? (
                  <div>
                    <textarea
                      defaultValue={
                        typeof val === "string"
                          ? val
                          : JSON.stringify(val ?? (c.type === "jsonb" ? {} : []), null, 2)
                      }
                      onBlur={(e) => handleJsonChange(k, e.target.value)}
                      rows={8}
                      className="w-full px-3 py-2 text-xs rounded resize-vertical"
                      style={{
                        background: "rgba(34,211,238,0.04)",
                        border: "1px solid var(--border)",
                        color: "var(--accent-violet)",
                        fontFamily: "var(--font-jetbrains)",
                      }}
                    />
                    {jsonErrors[k] && (
                      <p className="text-xs mt-1" style={{ color: "var(--accent-rose)" }}>
                        JSON 错误: {jsonErrors[k]}
                      </p>
                    )}
                  </div>
                ) : c.widget === "select" ? (
                  <select
                    value={val ?? ""}
                    onChange={(e) => update(k, e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-jetbrains)",
                    }}
                  >
                    <option value="">-</option>
                    {c.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : c.widget === "boolean" ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!val}
                      onChange={(e) => update(k, e.target.checked)}
                      style={{ accentColor: "var(--accent-cyan)" }}
                    />
                    <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      {val ? "true" : "false"}
                    </span>
                  </label>
                ) : c.widget === "number" ? (
                  <input
                    type="number"
                    value={val ?? 0}
                    onChange={(e) =>
                      update(k, e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="w-full px-3 py-2 text-sm rounded"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-jetbrains)",
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={val ?? ""}
                    onChange={(e) => update(k, e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-jetbrains)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div
          className="sticky bottom-0 flex items-center justify-end gap-2 px-6 py-4"
          style={{ borderTop: "1px solid var(--border)", background: "var(--bg-deep)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-chakra)",
            }}
          >
            取消
          </button>
          <button
            onClick={submit}
            className="btn-primary text-sm"
            style={{ padding: "8px 18px" }}
          >
            {isNew ? "创建" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
