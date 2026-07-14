"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type World = {
  world_id: string;
  title: string;
  simulation_goal: string;
  status: string;
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "var(--text-muted)" },
  building: { label: "构建中", color: "var(--accent-cyan)" },
  ready: { label: "就绪", color: "var(--accent-emerald)" },
  running: { label: "推演中", color: "var(--accent-cyan)" },
  paused: { label: "已暂停", color: "var(--accent-amber)" },
  finished: { label: "已完成", color: "var(--accent-amber)" },
  build_failed: { label: "构建失败", color: "var(--accent-rose)" },
};

const CAPABILITIES = [
  {
    no: "01",
    title: "可插拔灵魂",
    desc: "SkillProfile 定义人格操作系统，从价值观、心智模型到决策规则，热插拔到任意 Agent。",
    accent: "var(--accent-cyan)",
  },
  {
    no: "02",
    title: "上帝干预",
    desc: "在任意时间点插入世界事件或定向信息释放，观察 Agent 群体的反应链与稳态漂移。",
    accent: "var(--accent-violet)",
  },
  {
    no: "03",
    title: "实体图谱",
    desc: "从种子材料自动抽取实体与关系，构建可查询的知识图谱，供 Agent 决策与报告引用。",
    accent: "var(--accent-emerald)",
  },
  {
    no: "04",
    title: "ReACT 报告",
    desc: "Report Agent 自主调用图谱工具采访、检索、洞察，分章节流式生成可阅读的分析报告。",
    accent: "var(--accent-amber)",
  },
  {
    no: "05",
    title: "深度互动",
    desc: "推演完成后开启 1v1 对话或群聊，@提及任意 Agent，观察他们如何在你的提问下表态。",
    accent: "var(--accent-rose)",
  },
  {
    no: "06",
    title: "实时推演",
    desc: "SSE 流式输出每日事件、Agent 反应与内心独白，可见即所得地观察世界演化。",
    accent: "var(--accent-cyan)",
  },
];

function HeroGraph() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(34,211,238,0.8)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
        </radialGradient>
      </defs>
      {/* edges */}
      <g stroke="rgba(34,211,238,0.25)" strokeWidth="1" fill="none">
        <line className="graph-edge" x1="200" y1="180" x2="380" y2="120" />
        <line className="graph-edge" x1="380" y1="120" x2="560" y2="220" />
        <line className="graph-edge" x1="560" y1="220" x2="780" y2="160" />
        <line className="graph-edge" x1="780" y1="160" x2="960" y2="280" />
        <line className="graph-edge" x1="380" y1="120" x2="460" y2="380" />
        <line className="graph-edge" x1="560" y1="220" x2="660" y2="450" />
        <line className="graph-edge" x1="780" y1="160" x2="880" y2="420" />
        <line className="graph-edge" x1="200" y1="180" x2="320" y2="320" />
        <line className="graph-edge" x1="320" y1="320" x2="460" y2="380" />
        <line className="graph-edge" x1="460" y1="380" x2="660" y2="450" />
        <line className="graph-edge" x1="660" y1="450" x2="880" y2="420" />
        <line className="graph-edge" x1="880" y1="420" x2="960" y2="280" />
      </g>
      {/* nodes */}
      <g className="graph-node" style={{ transformOrigin: "200px 180px" }}>
        <circle cx="200" cy="180" r="6" fill="var(--accent-cyan)" />
        <circle cx="200" cy="180" r="14" fill="url(#nodeGlow)" />
      </g>
      <g className="graph-node" style={{ transformOrigin: "380px 120px" }}>
        <circle cx="380" cy="120" r="5" fill="var(--accent-violet)" />
      </g>
      <g className="graph-node-main" style={{ transformOrigin: "560px 220px" }}>
        <circle cx="560" cy="220" r="10" fill="var(--accent-cyan)" />
        <circle cx="560" cy="220" r="10" fill="none" stroke="var(--accent-cyan)" strokeWidth="1" />
      </g>
      <g className="graph-node" style={{ transformOrigin: "780px 160px" }}>
        <circle cx="780" cy="160" r="5" fill="var(--accent-amber)" />
      </g>
      <g className="graph-node" style={{ transformOrigin: "960px 280px" }}>
        <circle cx="960" cy="280" r="6" fill="var(--accent-emerald)" />
      </g>
      <g className="graph-node" style={{ transformOrigin: "320px 320px" }}>
        <circle cx="320" cy="320" r="4" fill="var(--text-muted)" />
      </g>
      <g className="graph-node" style={{ transformOrigin: "460px 380px" }}>
        <circle cx="460" cy="380" r="5" fill="var(--accent-rose)" />
      </g>
      <g className="graph-node" style={{ transformOrigin: "660px 450px" }}>
        <circle cx="660" cy="450" r="7" fill="var(--accent-cyan)" />
      </g>
      <g className="graph-node" style={{ transformOrigin: "880px 420px" }}>
        <circle cx="880" cy="420" r="4" fill="var(--accent-violet)" />
      </g>
    </svg>
  );
}

export default function Home() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .listWorlds()
      .then(setWorlds)
      .catch(() => setWorlds([]))
      .finally(() => setLoaded(true));
  }, []);

  const finishedCount = worlds.filter((w) => w.status === "finished").length;
  const activeCount = worlds.filter((w) =>
    ["running", "paused", "building", "ready"].includes(w.status)
  ).length;

  return (
    <main className="relative">
      {/* ════════ HERO ════════ */}
      <section className="relative overflow-hidden" style={{ minHeight: "calc(100vh - 64px)" }}>
        <div className="absolute inset-0 hero-grid-bg" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 60% 40%, rgba(34,211,238,0.08), transparent 60%)" }} />
        <HeroGraph />
        <div className="hero-scanline" style={{ top: "30%" }} />
        <div className="hero-scanline" style={{ top: "70%", animationDelay: "3s" }} />

        <div className="relative z-10 mx-auto max-w-6xl px-8 py-20 flex flex-col justify-center" style={{ minHeight: "calc(100vh - 64px)" }}>
          <div className="flex items-center gap-3 mb-6 hero-rise-1">
            <span className="status-dot status-dot-live" />
            <span
              className="text-xs tracking-[0.3em] uppercase"
              style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
            >
              SOULSIM // MULTI-AGENT WORLD SIMULATION
            </span>
          </div>

          <h1 className="hero-title hero-rise-1" style={{ fontSize: "clamp(48px, 7vw, 92px)" }}>
            可插拔灵魂的
            <br />
            通用多 Agent 世界模拟引擎
          </h1>

          <p
            className="mt-8 max-w-2xl text-base leading-relaxed hero-rise-2"
            style={{ color: "var(--text-secondary)", fontSize: 17 }}
          >
            为每个 Agent 注入独立的人格操作系统，设定世界协议与种子材料，让它们自主感知、决策、互动。
            在任意时刻以「上帝视角」介入，观察群体如何在你的设定下演化出你意料之外的故事。
          </p>

          <div className="mt-10 flex items-center gap-4 hero-rise-3">
            <Link href="/worlds/new" className="btn-primary" style={{ padding: "12px 24px" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              创建世界
            </Link>
            {worlds.length > 0 && (
              <a
                href="#worlds"
                className="text-sm transition-colors"
                style={{ fontFamily: "var(--font-chakra)", color: "var(--text-secondary)" }}
              >
                浏览 {worlds.length} 个已有世界 →
              </a>
            )}
          </div>

          {/* 底部 stats ticker */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-6 hero-rise-4">
            <div className="stat-block">
              <div className="stat-value">{String(worlds.length).padStart(2, "0")}</div>
              <div className="stat-label">WORLDS</div>
            </div>
            <div className="stat-block">
              <div className="stat-value">{String(activeCount).padStart(2, "0")}</div>
              <div className="stat-label">ACTIVE</div>
            </div>
            <div className="stat-block">
              <div className="stat-value">{String(finishedCount).padStart(2, "0")}</div>
              <div className="stat-label">FINISHED</div>
            </div>
            <div className="stat-block">
              <div className="stat-value">∞</div>
              <div className="stat-label">POSSIBILITIES</div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════ CAPABILITIES ════════ */}
      <section className="relative py-24 px-8" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="mx-auto max-w-6xl">
          <div className="flex items-end justify-between mb-12">
            <div>
              <p className="step-kicker" style={{ color: "var(--accent-cyan)" }}>
                CAPABILITIES
              </p>
              <h2
                className="text-3xl font-bold mt-2"
                style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
              >
                引擎能力矩阵
              </h2>
            </div>
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)" }}
            >
              06 / MODULES
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {CAPABILITIES.map((cap, i) => (
              <div
                key={cap.no}
                className="capability-card"
                style={{ animationDelay: `${0.1 + i * 0.05}s` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="cap-no">{cap.no}</span>
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: cap.accent }}
                  />
                </div>
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
                >
                  {cap.title}
                </h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.7 }}
                >
                  {cap.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ WORLDS ════════ */}
      <section
        id="worlds"
        className="relative py-24 px-8"
        style={{ borderTop: "1px solid var(--border)", background: "linear-gradient(180deg, transparent, rgba(11,15,26,0.4))" }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="flex items-end justify-between mb-12">
            <div>
              <p className="step-kicker" style={{ color: "var(--accent-amber)" }}>
                EXISTING WORLDS
              </p>
              <h2
                className="text-3xl font-bold mt-2"
                style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
              >
                已有世界
              </h2>
            </div>
            <Link href="/worlds/new" className="text-sm transition-colors hover:underline" style={{ fontFamily: "var(--font-chakra)", color: "var(--accent-cyan)" }}>
              + 新建世界
            </Link>
          </div>

          {!loaded ? (
            <div className="text-center py-20" style={{ color: "var(--text-muted)" }}>
              <div className="status-dot status-dot-building" style={{ width: 8, height: 8, margin: "0 auto 12px" }} />
              加载世界中
            </div>
          ) : worlds.length === 0 ? (
            <div
              className="capability-card text-center py-16"
              style={{ padding: "64px 24px" }}
            >
              <div
                className="text-5xl mb-4 opacity-30"
                style={{ fontFamily: "var(--font-chakra)", color: "var(--accent-cyan)" }}
              >
                ◇
              </div>
              <p
                className="text-sm mb-2"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-chakra)" }}
              >
                还没有世界
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                创建你的第一个模拟世界，注入灵魂，开始观察
              </p>
              <Link
                href="/worlds/new"
                className="btn-primary inline-flex mt-6"
                style={{ padding: "10px 20px" }}
              >
                创建第一个世界
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {worlds.map((w) => {
                const meta = STATUS_META[w.status] || STATUS_META.draft;
                return (
                  <Link
                    key={w.world_id}
                    href={`/worlds/${w.world_id}`}
                    className="world-card group block"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className="text-xs tracking-[0.15em] uppercase"
                        style={{ fontFamily: "var(--font-jetbrains)", color: meta.color }}
                      >
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle"
                          style={{ background: meta.color }}
                        />
                        {meta.label}
                      </span>
                      <span
                        className="text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ fontFamily: "var(--font-jetbrains)", color: "var(--accent-cyan)" }}
                      >
                        ENTER →
                      </span>
                    </div>
                    <h3
                      className="text-xl font-semibold mb-2"
                      style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
                    >
                      {w.title}
                    </h3>
                    <p
                      className="text-sm leading-relaxed line-clamp-2"
                      style={{ color: "var(--text-secondary)", minHeight: 40 }}
                    >
                      {w.simulation_goal || "未设定推演目标"}
                    </p>
                  </Link>
                );
              })}

              {/* 创建新世界卡片 */}
              <Link
                href="/worlds/new"
                className="world-card group flex items-center justify-center text-center"
                style={{ minHeight: 130, borderStyle: "dashed" }}
              >
                <div>
                  <div
                    className="text-3xl mb-2 opacity-40 group-hover:opacity-80 transition-opacity"
                    style={{ color: "var(--accent-cyan)" }}
                  >
                    +
                  </div>
                  <p
                    className="text-sm"
                    style={{ fontFamily: "var(--font-chakra)", color: "var(--text-secondary)" }}
                  >
                    创建新世界
                  </p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ════════ FOOTER ════════ */}
      <footer
        className="py-10 px-8 text-center"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <p
          className="text-xs"
          style={{ fontFamily: "var(--font-jetbrains)", color: "var(--text-muted)", letterSpacing: "0.1em" }}
        >
          SOULSIM · DIGITAL OBSERVATORY · v0.1
        </p>
      </footer>
    </main>
  );
}
