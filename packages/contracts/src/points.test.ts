import { describe, expect, it } from "vitest";
import { taskPointsSchema, TASK_POINTS_MAX } from "./points";

describe("task points", () => {
  it("is a whole number from 0 to the cap, which is 100", () => {
    expect(TASK_POINTS_MAX).toBe(100);
    expect(taskPointsSchema.safeParse(0).success).toBe(true);
    expect(taskPointsSchema.safeParse(100).success).toBe(true);
    expect(taskPointsSchema.safeParse(101).success).toBe(false);
    expect(taskPointsSchema.safeParse(-1).success).toBe(false);
    expect(taskPointsSchema.safeParse(12.5).success).toBe(false);
  });
});
