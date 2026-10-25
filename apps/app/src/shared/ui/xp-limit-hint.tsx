import "./points-scale-hint.css";

// The base XP cap for one task, shown next to every field where XP is set (ADR-0042).
export function XpLimitHint() {
  return (
    <p className="points-scale-hint">
      Базовый XP за задачу — не больше 100. Надбавка сверху не ограничена.
    </p>
  );
}
