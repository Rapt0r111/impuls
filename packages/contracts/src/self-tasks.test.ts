import { describe, expect, it } from "vitest";
import {
  selfTaskDecideRequestSchema,
  selfTaskProposeRequestSchema,
  selfTaskVerifyRequestSchema,
} from "./self-tasks";

const scopeId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const verifierId = "4b2b1c7e-2f1a-4c8e-9d0b-6a1f2e3d4c5b";

describe("self-submitted task requests", () => {
  const proposal = {
    scopeId,
    title: "Synthetic report",
    text: "Synthetic result",
    requestedPoints: 30,
    requestedXp: null,
    verifierIds: [verifierId],
  };

  it("needs one to five verifiers, a non-negative points request, and optional XP", () => {
    expect(selfTaskProposeRequestSchema.safeParse(proposal).success).toBe(true);
    expect(
      selfTaskProposeRequestSchema.safeParse({ ...proposal, verifierIds: [] })
        .success,
    ).toBe(false);
    expect(
      selfTaskProposeRequestSchema.safeParse({
        ...proposal,
        verifierIds: Array(6).fill(verifierId),
      }).success,
    ).toBe(false);
    expect(
      selfTaskProposeRequestSchema.safeParse({
        ...proposal,
        requestedPoints: -1,
      }).success,
    ).toBe(false);
    expect(
      selfTaskProposeRequestSchema.safeParse({ ...proposal, extra: true })
        .success,
    ).toBe(false);
  });

  it("requires a reason to decline in both verification and decision", () => {
    const base = { expectedVersion: 1 };
    expect(
      selfTaskVerifyRequestSchema.safeParse({ ...base, decision: "approve" })
        .success,
    ).toBe(true);
    expect(
      selfTaskVerifyRequestSchema.safeParse({ ...base, decision: "decline" })
        .success,
    ).toBe(false);
    expect(
      selfTaskVerifyRequestSchema.safeParse({
        ...base,
        decision: "decline",
        reason: "   ",
      }).success,
    ).toBe(false);
    expect(
      selfTaskDecideRequestSchema.safeParse({
        ...base,
        decision: "decline",
        reason: "Synthetic",
      }).success,
    ).toBe(true);
  });

  it("requires the commander's points and XP to forward a report", () => {
    const base = { expectedVersion: 2, decision: "forward" };
    expect(
      selfTaskDecideRequestSchema.safeParse({
        ...base,
        fundPoints: 25,
        fundXp: 0,
      }).success,
    ).toBe(true);
    expect(
      selfTaskDecideRequestSchema.safeParse({ ...base, fundPoints: 25 })
        .success,
    ).toBe(false);
  });
});
