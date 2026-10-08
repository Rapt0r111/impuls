import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { logFailure } from "./http";

afterEach(() => vi.restoreAllMocks());

describe("F01 failure logging", () => {
  it("records stage, error class and code without the message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(
      new Error("connect ECONNREFUSED postgres://user:secret@db.internal:5432"),
      { code: "ECONNREFUSED" },
    );
    logFailure("req-1", "rate_limit_ip", error);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      level: "error",
      event: "api_failure",
      requestId: "req-1",
      stage: "rate_limit_ip",
      errorName: "Error",
      errorCode: "ECONNREFUSED",
    });
    expect(line).not.toContain("secret");
  });

  it("handles non-Error throwables", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logFailure("req-2", "create_session", "boom");
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
      errorName: "string",
    });
  });
});
