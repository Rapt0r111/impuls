import { describe, expect, it } from "vitest";
import {
  taskPointsSchema,
  taskXpSchema,
  TASK_POINTS_MAX,
  TASK_XP_MAX,
} from "./points";

describe("task points", () => {
  it("is a whole number from 0 to the cap, which is 100", () => {
    expect(TASK_POINTS_MAX).toBe(100);
    expect(taskPointsSchema.safeParse(0).success).toBe(true);
    expect(taskPointsSchema.safeParse(100).success).toBe(true);
    expect(taskPointsSchema.safeParse(101).success).toBe(false);
    expect(taskPointsSchema.safeParse(-1).success).toBe(false);
    expect(taskPointsSchema.safeParse(12.5).success).toBe(false);
  });
  it("caps XP at the same 0–100 scale, with the same edges", () => {
    expect(TASK_XP_MAX).toBe(100);
    expect(taskXpSchema.safeParse(0).success).toBe(true);
    expect(taskXpSchema.safeParse(100).success).toBe(true);
    expect(taskXpSchema.safeParse(101).success).toBe(false);
    expect(taskXpSchema.safeParse(-1).success).toBe(false);
    expect(taskXpSchema.safeParse(12.5).success).toBe(false);
  });
});
