import "./points-scale-hint.css";

// The XP cap for one task, shown next to every field where XP is set (ADR-0042).
export function XpLimitHint() {
  return (
    <p className="points-scale-hint">
      XP за задачу — не больше 100, с учётом надбавки.
    </p>
  );
}
