import { createHmac, randomInt } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const origin = process.env.TEST_APP_ORIGIN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const integration =
  origin && databaseUrl && botToken ? describe : describe.skip;

integration("F01 real HTTP session cookie and PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const telegramId = randomInt(8_000_000_000_000, 9_000_000_000_000);
  let userId: string;

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(origin!).hostname))
      throw new Error("Auth HTTP fixture requires a local test server");
    const row = await pool.query<{ id: string }>(
      "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
      [telegramId, "Synthetic HTTP login"],
    );
    userId = row.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (userId) {
        await pool.query("DELETE FROM impuls.sessions WHERE user_id = $1", [
          userId,
        ]);
        await pool.query("DELETE FROM impuls.users WHERE id = $1", [userId]);
      }
    } finally {
      await pool.end();
    }
  });

  function initData(authDate = Math.floor(Date.now() / 1000)) {
    const params = new URLSearchParams({
      auth_date: String(authDate),
      user: JSON.stringify({ id: telegramId, first_name: "Synthetic" }),
    });
    const check = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const key = createHmac("sha256", "WebAppData").update(botToken!).digest();
    params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
    return params.toString();
  }

  function login(data: string, requestOrigin = origin!) {
    return fetch(`${origin}/api/v1/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      body: JSON.stringify({ initData: data }),
    });
  }

  it("issues the partitioned cookie, reads the server session and revokes it on guarded logout", async () => {
    const response = await login(initData());
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie")!;
    expect(header).toMatch(/; SameSite=none/i);
    expect(header).toContain("; Partitioned");
    expect(header).toContain("; HttpOnly");
    expect(header).toContain("; Secure");
    expect(header).toContain("; Max-Age=43200");
    const cookie = header.split(";")[0]!;
    const body = await response.json();
    expect(body.user.id).toBe(userId);
    expect(body).not.toHaveProperty("sessionToken");
    const me = await fetch(`${origin}/api/v1/me`, {
      headers: { Cookie: cookie },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe(userId);

    for (const [requestOrigin, csrf] of [
      ["https://other-site.test", body.csrfToken],
      [origin!, "invalid"],
    ]) {
      const denied = await fetch(`${origin}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: requestOrigin,
          "X-CSRF-Token": csrf,
        },
      });
      expect(denied.status).toBe(403);
    }
    const logout = await fetch(`${origin}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin!,
        "X-CSRF-Token": body.csrfToken,
      },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toMatch(
      /Max-Age=0.*SameSite=none.*Partitioned/i,
    );
    expect(
      (await fetch(`${origin}/api/v1/me`, { headers: { Cookie: cookie } }))
        .status,
    ).toBe(403);
    expect((await fetch(`${origin}/api/v1/me`)).status).toBe(401);
  });

  it("rejects untrusted origins and invalid or expired launch data without creating a session", async () => {
    expect((await login(initData(), "https://other-site.test")).status).toBe(
      403,
    );
    for (const [data, code] of [
      [`${initData()}&hash=invalid`, "AUTH_INVALID"],
      [initData(Math.floor(Date.now() / 1000) - 3600), "AUTH_EXPIRED"],
    ]) {
      const response = await login(data!);
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe(code);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
