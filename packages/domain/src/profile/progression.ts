export type LevelProgress = {
  level: number;
  minimumXp: number;
  nextLevelXp: number | null;
  remainingXp: number;
  progressXp: number;
  spanXp: number | null;
};

export function syntheticLevelThresholds(definition: unknown): number[] | null {
  if (typeof definition !== "object" || definition === null) return null;
  const rule = definition as Record<string, unknown>;
  if (
    rule.mode !== "synthetic" ||
    typeof rule.progression !== "object" ||
    rule.progression === null
  )
    return null;
  const thresholds = (rule.progression as Record<string, unknown>)
    .levelThresholds;
  if (
    !Array.isArray(thresholds) ||
    thresholds.length < 1 ||
    thresholds.length > 100 ||
    thresholds[0] !== 0
  )
    return null;
  const result: number[] = [];
  for (const threshold of thresholds) {
    if (
      typeof threshold !== "number" ||
      !Number.isSafeInteger(threshold) ||
      threshold < 0 ||
      (result.length > 0 && threshold <= result[result.length - 1]!)
    )
      return null;
    result.push(threshold);
  }
  return result;
}

export function levelProgress(
  xp: number,
  thresholds: readonly number[],
): LevelProgress {
  if (
    !Number.isSafeInteger(xp) ||
    xp < 0 ||
    !syntheticLevelThresholds({
      mode: "synthetic",
      progression: { levelThresholds: thresholds },
    })
  )
    throw new Error("Invalid level inputs");
  let index = 0;
  while (index + 1 < thresholds.length && xp >= thresholds[index + 1]!) index++;
  const minimumXp = thresholds[index]!;
  const nextLevelXp = thresholds[index + 1] ?? null;
  return {
    level: index + 1,
    minimumXp,
    nextLevelXp,
    remainingXp: nextLevelXp === null ? 0 : nextLevelXp - xp,
    progressXp: xp - minimumXp,
    spanXp: nextLevelXp === null ? null : nextLevelXp - minimumXp,
  };
}
