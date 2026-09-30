import { describe, expect, it } from "vitest";
import { acceptanceSeason, syntheticEconomyZone } from "./economy";

describe("synthetic acceptance policy and server month", () => {
  it("requires an explicitly enabled synthetic version and valid timezone", () => {
    expect(
      syntheticEconomyZone({
        mode: "synthetic",
        timeZone: "Europe/Moscow",
        acceptance: { enabled: true },
      }),
    ).toBe("Europe/Moscow");
    for (const rules of [
      null,
      {},
      { mode: "production", timeZone: "UTC", acceptance: { enabled: true } },
      {
        mode: "synthetic",
        timeZone: "Invalid/Zone",
        acceptance: { enabled: true },
      },
      { mode: "synthetic", timeZone: "UTC", acceptance: { enabled: false } },
    ])
      expect(syntheticEconomyZone(rules)).toBeNull();
  });
  it("places a UTC timestamp on the correct side of the Moscow month boundary", () => {
    expect(
      acceptanceSeason(new Date("2026-09-30T20:59:59.999Z"), "Europe/Moscow"),
    ).toBe("2026-09");
    expect(
      acceptanceSeason(new Date("2026-09-30T21:00:00.000Z"), "Europe/Moscow"),
    ).toBe("2026-10");
    expect(acceptanceSeason(new Date("2026-09-30T21:00:00.000Z"), "UTC")).toBe(
      "2026-09",
    );
    expect(
      acceptanceSeason(new Date("2026-12-31T21:00:00.000Z"), "Europe/Moscow"),
    ).toBe("2027-01");
  });
});
