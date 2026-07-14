"use client";

const STEP_NAMES = ["种子输入", "世界构建", "模拟推演", "报告生成", "深度互动"];

export function StepIndicator({ current, maxReached, onStepClick }: { current: number; maxReached?: number; onStepClick?: (step: number) => void }) {
  const reached = maxReached ?? current;
  return (
    <div className="flex items-center justify-center gap-0 py-4 px-6" style={{ fontFamily: "var(--font-chakra)" }}>
      {STEP_NAMES.map((name, i) => {
        const step = i + 1;
        const isAvailable = step <= reached;
        const isCompleted = step < current && isAvailable;
        const isActive = step === current;
        const isNextAvailable = step > current && isAvailable;
        const clickable = isAvailable && step !== current && onStepClick;

        return (
          <div key={step} className="flex items-center">
            {i > 0 && (
              <div
                className="mx-1"
                style={{
                  width: 32,
                  height: 1,
                  background: step <= reached
                    ? "linear-gradient(90deg, var(--accent-emerald), var(--accent-cyan))"
                    : "var(--border)",
                }}
              />
            )}
            <div
              className="flex items-center gap-1.5 px-2 py-1 transition-all"
              style={{
                borderRadius: 8,
                background: isActive ? "rgba(34,211,238,0.08)" : isNextAvailable ? "rgba(251,191,36,0.06)" : "transparent",
                border: isActive ? "1px solid rgba(34,211,238,0.22)" : isNextAvailable ? "1px solid rgba(251,191,36,0.18)" : "1px solid transparent",
                cursor: clickable ? "pointer" : "default",
              }}
              onClick={() => clickable && onStepClick?.(step)}
            >
              <div
                className="flex items-center justify-center text-xs font-bold"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  fontSize: 10,
                  background: isCompleted
                    ? "var(--accent-emerald)"
                    : isActive
                    ? "var(--accent-cyan)"
                    : "transparent",
                  color: isCompleted || isActive ? "var(--bg-deep)" : isNextAvailable ? "var(--accent-amber)" : "var(--text-muted)",
                  border: !isCompleted && !isActive ? `1px solid ${isNextAvailable ? "rgba(251,191,36,0.5)" : "var(--text-muted)"}` : "none",
                  boxShadow: isActive ? "0 0 12px rgba(34,211,238,0.3)" : isNextAvailable ? "0 0 10px rgba(251,191,36,0.12)" : "none",
                }}
              >
                {isCompleted ? "✓" : step}
              </div>
              <span
                className="text-xs tracking-wide whitespace-nowrap"
                style={{
                  color: isActive ? "var(--accent-cyan)" : isCompleted ? "var(--accent-emerald)" : isNextAvailable ? "var(--accent-amber)" : "var(--text-muted)",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                }}
              >
                {name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
