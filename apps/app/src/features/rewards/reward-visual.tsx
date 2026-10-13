// Картинка поощрения без загрузки файлов: значок по смыслу названия и свой цвет,
// стабильный для одного и того же названия.
const ICONS: [RegExp, string][] = [
  [/рамк/i, "🖼️"],
  [/корон|звани|титул/i, "👑"],
  [/кубок|приз/i, "🏆"],
  [/медал|знач|знак|бейдж/i, "🏅"],
  [/фон|цвет|тем[аы]|оформлен/i, "🎨"],
  [/звезд/i, "⭐"],
  [/стикер|наклейк|эмодзи/i, "✨"],
  [/огон|пламя/i, "🔥"],
  [/ракет/i, "🚀"],
];

export function rewardIcon(title: string): string {
  return ICONS.find(([pattern]) => pattern.test(title))?.[1] ?? "🎁";
}

function hue(title: string): number {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return Math.abs(hash) % 360;
}

export function RewardBadge({
  title,
  size = "md",
}: {
  title: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={`reward-badge reward-badge--${size}`}
      style={{ "--reward-hue": hue(title) } as React.CSSProperties}
      aria-hidden="true"
    >
      {rewardIcon(title)}
    </span>
  );
}
