import { describe, expect, it } from "vitest";
import {
  accessGrantRequestSchema,
  accessRevocationRequestSchema,
} from "./access-management";

const grant = {
  scope: crypto.randomUUID(),
  subjectId: crypto.randomUUID(),
  action: "task.review",
  validUntil: null,
  reason: "Synthetic delegation",
};
describe("access management contracts", () => {
  it("accepts a strict grant and revocation", () => {
    expect(accessGrantRequestSchema.safeParse(grant).success).toBe(true);
    expect(
      accessRevocationRequestSchema.safeParse({
        scope: grant.scope,
        bindingId: grant.subjectId,
        expectedVersion: 1,
        reason: "Synthetic revocation",
      }).success,
    ).toBe(true);
  });
  it("rejects delegating access rights, extra fields and blank reasons", () => {
    for (const bad of [
      { ...grant, action: "admin.access" },
      { ...grant, action: "admin.access.manage" },
      { ...grant, extra: 1 },
      { ...grant, reason: "   " },
      { ...grant, validUntil: "tomorrow" },
    ])
      expect(accessGrantRequestSchema.safeParse(bad).success).toBe(false);
  });
});
