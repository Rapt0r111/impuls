import { randomInt } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLoginSession,
  readSession,
  revokeSession,
} from "../../packages/domain/src/auth/service";
import { hashSessionToken } from "../../packages/domain/src/auth/session";
import { consumeLoginAttempt } from "../../packages/domain/src/auth/rate-limit";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("F01 PostgreSQL sessions", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const telegramId = String(randomInt(1_000_000_000_000, 2_000_000_000_000));
  let userId: string;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
      [telegramId, "Тестовый участник"],
    );
    userId = result.rows[0]!.id;
  });

  afterAll(async () => {
    if (userId) {
      await pool.query("DELETE FROM impuls.sessions WHERE user_id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM impuls.users WHERE id = $1", [userId]);
    }
    await pool.end();
  });

  it("stores a hash, expires access on logout and revokes sessions when the allowlist is disabled", async () => {
    const first = await createLoginSession(pool, telegramId);
    expect(first.kind).toBe("authorized");
    if (first.kind !== "authorized") return;
    expect(await readSession(pool, first.sessionToken)).toEqual({
      kind: "authorized",
      user: { id: userId, displayName: "Тестовый участник" },
    });
    const stored = await pool.query<{ session_hash: Buffer }>(
      "SELECT session_hash FROM impuls.sessions WHERE user_id = $1",
      [userId],
    );
    expect(
      stored.rows[0]?.session_hash.equals(hashSessionToken(first.sessionToken)),
    ).toBe(true);
    expect(stored.rows[0]?.session_hash.toString("utf8")).not.toBe(
      first.sessionToken,
    );

    await revokeSession(pool, first.sessionToken);
    expect(await readSession(pool, first.sessionToken)).toEqual({
      kind: "revoked",
    });

    const second = await createLoginSession(pool, telegramId);
    expect(second.kind).toBe("authorized");
    if (second.kind !== "authorized") return;
    await pool.query(
      "UPDATE impuls.users SET active = false, updated_at = now(), version = version + 1 WHERE id = $1",
      [userId],
    );
    expect(await readSession(pool, second.sessionToken)).toEqual({
      kind: "revoked",
    });
    expect(await createLoginSession(pool, telegramId)).toEqual({
      kind: "denied",
    });
  });
});

integration("F01 shared PostgreSQL login limit", () => {
  const firstPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const secondPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const identity = `test-${randomInt(1_000_000_000, 2_000_000_000)}`;
  const secret = "synthetic-test-secret";

  afterAll(async () => {
    await firstPool.end();
    await secondPool.end();
  });

  it("enforces one limit across concurrent function pools and resets an expired window", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        consumeLoginAttempt(
          index % 2 ? firstPool : secondPool,
          "login-ip",
          identity,
          secret,
          3,
        ),
      ),
    );
    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(3);
    expect(attempts.filter((attempt) => !attempt.allowed)).toHaveLength(2);
    expect(
      attempts.every((attempt) => attempt.allowed || attempt.retryAfter > 0),
    ).toBe(true);

    const row = await firstPool.query<{ key_hash: Buffer }>(
      "SELECT key_hash FROM impuls.auth_rate_limits",
    );
    expect(
      row.rows.some((item) => item.key_hash.toString("utf8") === identity),
    ).toBe(false);

    const { createHmac } = await import("node:crypto");
    const keyHash = createHmac("sha256", secret)
      .update(`login-ip:${identity}`)
      .digest();
    await firstPool.query(
      "UPDATE impuls.auth_rate_limits SET expires_at = now() - interval '1 second' WHERE key_hash = $1",
      [keyHash],
    );
    expect(
      await consumeLoginAttempt(firstPool, "login-ip", identity, secret, 3),
    ).toEqual({ allowed: true });
    await firstPool.query(
      "DELETE FROM impuls.auth_rate_limits WHERE key_hash = $1",
      [keyHash],
    );
  });
});
