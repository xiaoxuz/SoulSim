"use client";

export const AGENT_COLORS = ["cyan", "amber", "emerald", "violet", "rose"] as const;

export function AgentResponseCard({ r, color, expanded, onToggle, infoReleaseStatus }: {
  r: { name: string; action_detail?: string; speech: string; thought?: string; stance_delta?: string; emotion_delta?: string };
  color: string;
  expanded: boolean;
  onToggle: () => void;
  infoReleaseStatus?: { received: boolean; responded: boolean };
}) {
  return (
    <div
      className="rounded-lg p-3 transition-all"
      style={{
        background: "rgba(0,0,0,0.25)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid var(--accent-${color})`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold" style={{ color: `var(--accent-${color})`, fontFamily: "var(--font-chakra)" }}>
          {r.name}
        </span>
        <div className="flex items-center gap-2">
          {infoReleaseStatus?.received && (
            <span
              className="text-xs"
              style={{
                color: infoReleaseStatus.responded ? "var(--accent-violet)" : "var(--accent-amber)",
                border: `1px solid ${infoReleaseStatus.responded ? "var(--accent-violet)" : "rgba(251,191,36,0.45)"}`,
                background: infoReleaseStatus.responded ? "rgba(167,139,250,0.1)" : "rgba(251,191,36,0.08)",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 9,
                fontFamily: "var(--font-chakra)",
                letterSpacing: "0.06em",
              }}
            >
              {infoReleaseStatus.responded ? "已响应干预" : "收到干预"}
            </span>
          )}
          <button
            onClick={onToggle}
            className="text-xs transition-colors"
            style={{ color: "var(--text-muted)", cursor: "pointer", background: "none", border: "none", padding: "2px 4px" }}
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {r.action_detail && (
        <div className="mb-2">
          <span className="text-xs" style={{ color: "var(--text-muted)", fontSize: 9 }}>🎬 具体行动</span>
          <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--text-secondary)" }}>{r.action_detail}</p>
        </div>
      )}

      <div className="mb-1">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>💬 </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{r.speech}</span>
      </div>

      {(r.stance_delta || r.emotion_delta) && (
        <div className="flex gap-3 mt-1">
          {r.stance_delta && r.stance_delta !== "无变化" && r.stance_delta !== "无" && r.stance_delta !== "" && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>⚖️ {r.stance_delta}</span>
          )}
          {r.emotion_delta && r.emotion_delta !== "无变化" && r.emotion_delta !== "无" && r.emotion_delta !== "" && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>🎭 {r.emotion_delta}</span>
          )}
        </div>
      )}

      {expanded && r.thought && (
        <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>💭 内心想法</span>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-secondary)", opacity: 0.8 }}>
            {r.thought}
          </p>
        </div>
      )}
    </div>
  );
}
