export type LevelProgress = {
  level: number;
  minimumXp: number;
  nextLevelXp: number | null;
  remainingXp: number;
  progressXp: number;
  spanXp: number | null;
};

export const LEVEL_NAME_MAX = 40;

export function syntheticLevelThresholds(definition: unknown): number[] | null {
  if (typeof definition !== "object" || definition === null) return null;
  const rule = definition as Record<string, unknown>;
  if (typeof rule.progression !== "object" || rule.progression === null)
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

// Names of the configured levels, from the first one. An empty string means "no name".
export function syntheticLevelNames(definition: unknown): string[] {
  if (typeof definition !== "object" || definition === null) return [];
  const progression = (definition as Record<string, unknown>).progression;
  if (typeof progression !== "object" || progression === null) return [];
  const names = (progression as Record<string, unknown>).levelNames;
  if (!Array.isArray(names) || names.length > 100) return [];
  return names.map((name) =>
    typeof name === "string" && name.trim().length <= LEVEL_NAME_MAX
      ? name.trim()
      : "",
  );
}

// The name shown for a level, or null when the rules give it none.
export function levelTitle(names: readonly string[], level: number) {
  const name = names[level - 1]?.trim();
  return name ? name : null;
}

export function levelProgress(
  xp: number,
  thresholds: readonly number[],
): LevelProgress {
  if (
    !Number.isSafeInteger(xp) ||
    xp < 0 ||
    !syntheticLevelThresholds({
      progression: { levelThresholds: thresholds },
    })
  )
    throw new Error("Invalid level inputs");
  const last = thresholds.length - 1;
  let index = 0;
  while (index + 1 < thresholds.length && xp >= thresholds[index + 1]!) index++;
  // Levels have no ceiling: after the last configured level every further level costs
  // the same XP as the last configured span.
  if (index === last && last >= 1) {
    const step = thresholds[last]! - thresholds[last - 1]!;
    const beyond = Math.floor((xp - thresholds[last]!) / step);
    const minimumXp = thresholds[last]! + beyond * step;
    const nextLevelXp = minimumXp + step;
    return {
      level: thresholds.length + beyond,
      minimumXp,
      nextLevelXp,
      remainingXp: nextLevelXp - xp,
      progressXp: xp - minimumXp,
      spanXp: step,
    };
  }
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
