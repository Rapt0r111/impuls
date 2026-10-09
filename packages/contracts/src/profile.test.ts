import { describe, it, expect } from "vitest";
import {
  participantProfileResponseSchema,
  profileNameRequestSchema,
  profileNameResponseSchema,
  profileNameSchema,
} from "./profile";
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

describe("profileNameSchema", () => {
  const cp = (...codes: number[]) => String.fromCodePoint(...codes);
  it.each([
    ["Анна", "Анна"],
    ["  Анна   Петрова  ", "Анна Петрова"],
    ["O'Neil-Smith Jr.", "O'Neil-Smith Jr."],
    ["Иван_2", "Иван_2"],
    ["Ab", "Ab"],
    ["x".repeat(40), "x".repeat(40)],
    // Any whitespace run, including a pasted line break, becomes one space; edges are trimmed.
    [`a${cp(10)}b`, "a b"],
    [`ab${cp(0xa0, 0xa0)}`, "ab"],
    // Decomposed e + combining acute is composed by NFC into one letter and accepted.
    [`e${cp(0x301)}a`, `${cp(0xe9)}a`],
  ])("normalises %j", (input, expected) => {
    const parsed = profileNameSchema.safeParse(input);
    expect(parsed.success && parsed.data).toBe(expected);
  });
  it.each([
    ["empty", ""],
    ["one character", "a"],
    ["one character with spaces", " a "],
    ["41 characters", "x".repeat(41)],
    ["leading hyphen", "-Имя"],
    ["NUL", `ab${cp(0)}cd`],
    ["bidi override", `ab${cp(0x202e)}cd`],
    ["zero-width space", `ab${cp(0x200b)}cd`],
    ["combining marks only", `a${cp(0x301, 0x302, 0x303, 0x304)}`],
    ["emoji", cp(0x1f600, 0x1f600)],
    ["markup", "<b>x</b>"],
    ["slash", "a/b"],
  ])("rejects %s", (_label, input) => {
    expect(profileNameSchema.safeParse(input).success).toBe(false);
  });
  it("rejects very long input before normalising", () => {
    expect(profileNameSchema.safeParse("a".repeat(201)).success).toBe(false);
  });
  it("accepts only the display name in a request", () => {
    expect(
      profileNameRequestSchema.safeParse({ displayName: "Анна" }).success,
    ).toBe(true);
    expect(
      profileNameRequestSchema.safeParse({ displayName: "Анна", active: true })
        .success,
    ).toBe(false);
    expect(profileNameRequestSchema.safeParse({}).success).toBe(false);
  });
  it("answers with the saved name and whether it changed", () => {
    const id = "a1111111-1111-4111-8111-111111111111";
    expect(
      profileNameResponseSchema.safeParse({
        mode: "synthetic",
        user: { id, displayName: "Старое длинное имя" },
        changed: false,
      }).success,
    ).toBe(true);
    expect(
      profileNameResponseSchema.safeParse({
        mode: "synthetic",
        user: { id, displayName: "x" },
      }).success,
    ).toBe(false);
  });
});
