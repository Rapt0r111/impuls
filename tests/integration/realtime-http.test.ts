import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realtimeResponseSchema } from "../../packages/contracts/src/realtime";

const origin = process.env.TEST_APP_ORIGIN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const secret = process.env.CSRF_SECRET;
const integration = origin && databaseUrl && secret ? describe : describe.skip;

integration("GET /api/v1/me/realtime over real HTTP (ADR-0038)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const users = [randomUUID(), randomUUID()];
  const tokens = users.map(() => randomBytes(32).toString("base64url"));

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(origin!).hostname))
      throw new Error("Local test server required");
    for (const [i, user] of users.entries()) {
      await pool.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,$3,true)",
        [
          user,
          randomInt(7_000_000_000_000, 8_000_000_000_000),
          `Synthetic realtime user ${i}`,
        ],
      );
      await pool.query(
        "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [user, createHash("sha256").update(tokens[i]!).digest()],
      );
    }
  });
  afterAll(async () => {
    try {
      await pool.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await pool.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await pool.end();
    }
  });
  const get = (token?: string) =>
    fetch(`${origin}/api/v1/me/realtime`, {
      headers: token ? { Cookie: `impuls_session=${token}` } : {},
    });
  const topicOf = async (user: string) =>
    (
      await pool.query<{ t: string }>("SELECT impuls.realtime_topic($1) AS t", [
        user,
      ])
    ).rows[0]!.t;

  it("требует вход", async () => {
    expect((await get()).status).toBe(401);
  });

  it("выдаёт участнику его собственную тему, адрес и публикуемый ключ", async () => {
    const response = await get(tokens[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = realtimeResponseSchema.parse(await response.json());
    expect(body).toEqual({
      enabled: true,
      url: "https://realtime.example.test",
      key: "sb_publishable_test_only",
      topic: await topicOf(users[0]!),
    });
    const other = realtimeResponseSchema.parse(
      await (await get(tokens[1])).json(),
    );
    expect(other.enabled && other.topic).toBe(await topicOf(users[1]!));
    expect(other.enabled && other.topic).not.toBe(body.enabled && body.topic);
  });
});
