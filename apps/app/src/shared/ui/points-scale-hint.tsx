import "./points-scale-hint.css";

// The scale for a task's points, shown next to every field where points are set (owner, 23.10.2026).
export function PointsScaleHint() {
  return (
    <p className="points-scale-hint">
      Максимум 100 баллов. 0–40: выполнено некачественно или не в срок. 40–80: в
      срок, но не идеально. 80–100: без замечаний.
    </p>
  );
}
