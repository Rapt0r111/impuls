import { describe, expect, it } from "vitest";
import { redactSpeedEvent } from "./redact-speed-event";

describe("Speed Insights URL redaction", () => {
  it("removes credentials, object IDs, query and Telegram launch fragment", () => {
    const result = redactSpeedEvent({
      type: "vital",
      url: "https://user:password@impuls.example/tasks/private-id?report=secret#tgWebAppData=secret",
      route: "/tasks/private-id",
    });
    expect(result).toEqual({
      type: "vital",
      url: "https://impuls.example/",
      route: "/",
    });
  });

  it.each(["invalid", "javascript:alert(1)", "file:///private"])(
    "drops an invalid or unsupported URL: %s",
    (url) => expect(redactSpeedEvent({ type: "vital", url })).toBeNull(),
  );
});
