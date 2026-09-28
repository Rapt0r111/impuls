import { describe, expect, it } from "vitest";
import {
  createCsrfToken,
  createSessionToken,
  hashSessionToken,
  isSessionToken,
  verifyCsrfToken,
} from "./session";

describe("session secrets", () => {
  it("issues distinct 256-bit tokens and stores only their hashes", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    expect(isSessionToken(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(hashSessionToken(first)).toHaveLength(32);
    expect(hashSessionToken(first).equals(hashSessionToken(second))).toBe(
      false,
    );
    expect(hashSessionToken(first).toString("utf8")).not.toBe(first);
  });

  it("binds the CSRF token to a session and secret", () => {
    const session = createSessionToken();
    const csrf = createCsrfToken(session, "secret-one");
    expect(verifyCsrfToken(session, "secret-one", csrf)).toBe(true);
    expect(verifyCsrfToken(createSessionToken(), "secret-one", csrf)).toBe(
      false,
    );
    expect(verifyCsrfToken(session, "secret-two", csrf)).toBe(false);
    expect(verifyCsrfToken(session, "secret-one", null)).toBe(false);
  });
});
