import { describe, it, expect } from "vitest";
import {
  levelProgress,
  levelTitle,
  syntheticLevelNames,
  syntheticLevelThresholds,
} from "./progression";

describe("synthetic versioned level thresholds", () => {
  it("uses independent boundary results, zero, maximum and safe integer XP", () => {
    const steps = [0, 100, 250];
    for (const [xp, level, left] of [
      [0, 1, 100],
      [99, 1, 1],
      [100, 2, 150],
      [249, 2, 1],
      [250, 3, 150],
      [399, 3, 1],
      [400, 4, 150],
    ]) {
      expect(levelProgress(xp!, steps)).toMatchObject({
        level,
        remainingXp: left,
      });
    }
    expect(levelProgress(125, steps)).toEqual({
      level: 2,
      minimumXp: 100,
      nextLevelXp: 250,
      remainingXp: 125,
      progressXp: 25,
      spanXp: 150,
    });
    // Beyond the table every level costs the last configured span (150 here).
    expect(levelProgress(1000, steps)).toEqual({
      level: 8,
      minimumXp: 1000,
      nextLevelXp: 1150,
      remainingXp: 150,
      progressXp: 0,
      spanXp: 150,
    });
    const huge = levelProgress(1_000_000_000_000, steps);
    expect(huge.level).toBeGreaterThan(8);
    expect(huge.minimumXp).toBeLessThanOrEqual(1_000_000_000_000);
    expect(huge.progressXp + huge.remainingXp).toBe(huge.spanXp);
    expect(levelProgress(0, [0])).toEqual({
      level: 1,
      minimumXp: 0,
      nextLevelXp: null,
      remainingXp: 0,
      progressXp: 0,
      spanXp: null,
    });
  });
  it("rejects missing, real, unsorted, duplicate, unsafe, fractional and oversized rules", () => {
    for (const thresholds of [
      [],
      [1],
      [0, 0],
      [0, -1],
      [0, 1.5],
      [0, Infinity],
      [0, Number.MAX_SAFE_INTEGER + 1],
      [0, "100"],
      Array.from({ length: 101 }, (_, i) => i),
    ])
      expect(
        syntheticLevelThresholds({
          progression: { levelThresholds: thresholds },
        }),
      ).toBeNull();
    for (const rule of [null, {}, { progression: null }])
      expect(syntheticLevelThresholds(rule)).toBeNull();
    expect(
      syntheticLevelNames({ progression: { levelNames: ["Новичок", 5] } }),
    ).toEqual(["Новичок", ""]);
    expect(levelTitle(["Новичок", ""], 1)).toBe("Новичок");
    expect(levelTitle(["Новичок", ""], 2)).toBeNull();
    expect(levelTitle([], 1)).toBeNull();
    expect(() => levelProgress(-1, [0])).toThrow();
    expect(() => levelProgress(0, [0, 0])).toThrow();
  });
});
