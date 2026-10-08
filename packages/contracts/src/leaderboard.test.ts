import { describe, expect, it } from "vitest";
import { leaderboardQuerySchema, leaderboardSeasonSchema } from "./leaderboard";

describe("monthly ranking contract", () => {
  it("requires a real calendar month and bounded pagination", () => {
    for (const value of [
      "2026-00",
      "2026-13",
      "2026-1",
      "0000-01",
      "2026-10-01",
    ])
      expect(leaderboardSeasonSchema.safeParse(value).success).toBe(false);
    expect(leaderboardQuerySchema.parse({ season: "2026-10" }).limit).toBe(20);
    for (const query of [
      { limit: 0 },
      { limit: 51 },
      { scope: "no" },
      { extra: "x" },
      { cursor: "x" },
    ])
      expect(leaderboardQuerySchema.safeParse(query).success).toBe(false);
  });
});
