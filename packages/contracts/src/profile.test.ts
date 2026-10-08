import { describe, it, expect } from "vitest";
import { participantProfileResponseSchema } from "./profile";
const data = {
  mode: "synthetic",
  user: {
    id: "a1111111-1111-4111-8111-111111111111",
    displayName: "Synthetic",
  },
  balance: {
    lifetimeXp: 125,
    availablePoints: 400,
    reservedPoints: 0,
    version: 1,
    updatedAt: null,
  },
  progression: {
    state: "configured",
    ruleVersion: 1,
    level: {
      level: 2,
      minimumXp: 100,
      nextLevelXp: 250,
      remainingXp: 125,
      progressXp: 25,
      spanXp: 150,
    },
  },
  firstResult: null,
  asOf: "2026-10-02T10:00:00.000Z",
};
describe("profile wire contract", () => {
  it("accepts configured, absent and invalid explicit configuration", () => {
    expect(participantProfileResponseSchema.safeParse(data).success).toBe(true);
    expect(
      participantProfileResponseSchema.safeParse({
        ...data,
        progression: { state: "unconfigured", ruleVersion: null, level: null },
      }).success,
    ).toBe(true);
    expect(
      participantProfileResponseSchema.safeParse({
        ...data,
        progression: { state: "invalid", ruleVersion: 2, level: null },
      }).success,
    ).toBe(true);
  });
  it("rejects contradictory state and invented XP progress", () => {
    expect(
      participantProfileResponseSchema.safeParse({
        ...data,
        progression: { ...data.progression, state: "unconfigured" },
      }).success,
    ).toBe(false);
    expect(
      participantProfileResponseSchema.safeParse({
        ...data,
        progression: {
          ...data.progression,
          level: { ...data.progression.level, remainingXp: 10 },
        },
      }).success,
    ).toBe(false);
    expect(
      participantProfileResponseSchema.safeParse({
        ...data,
        balance: { ...data.balance, lifetimeXp: 99 },
      }).success,
    ).toBe(false);
  });
});
