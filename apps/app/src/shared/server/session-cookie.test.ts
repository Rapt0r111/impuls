import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "./session-cookie";

describe("F01 session cookie transport", () => {
  it("serializes a host-only, HttpOnly, partitioned cookie for an embedded HTTPS app", () => {
    const response = NextResponse.json({});
    response.cookies.set(SESSION_COOKIE, "synthetic-session", {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 43_200,
    });
    const header = response.headers.get("set-cookie")!;
    for (const attribute of [
      "impuls_session=synthetic-session",
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=none",
      "Partitioned",
      "Max-Age=43200",
    ]) {
      expect(header.split("; ")).toContain(attribute);
    }
    expect(header).not.toMatch(/Domain=/i);
  });

  it("expires the same partitioned cookie on logout", () => {
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(SESSION_COOKIE, "", {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 0,
    });
    const header = response.headers.get("set-cookie")!;
    expect(header.split("; ")).toEqual(
      expect.arrayContaining([
        "impuls_session=",
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=none",
        "Partitioned",
        "Max-Age=0",
      ]),
    );
  });
});
