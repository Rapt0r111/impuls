import { describe, expect, it } from "vitest";
import { neutralNotification } from "./simulation";

describe("neutral notification allowlist", () => {
  it("covers all ten saved kinds using fixed text without source data", () => {
    const kinds = [
      "task.assigned",
      "task.returned",
      "task.accepted",
      "ledger.corrected",
      "reward.reserved",
      "reward.cancelled",
      "reward.approved",
      "reward.rejected",
      "reward.fulfilled",
      "reward.expired",
    ];
    for (const kind of kinds) {
      const text = neutralNotification(kind);
      expect(text).toMatch(/^В приложении /);
      expect(text!.length).toBeLessThan(100);
    }
    expect(neutralNotification("reward.approved")).toContain(
      "Выдача ещё не подтверждена",
    );
  });
  it("rejects unknown kinds and inherited object keys", () => {
    for (const kind of [
      "task.secret",
      "__proto__",
      "constructor",
      "toString",
      "",
    ])
      expect(neutralNotification(kind)).toBeNull();
  });
});
