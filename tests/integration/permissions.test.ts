import { randomInt } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLoginSession,
  readSession,
} from "../../packages/domain/src/auth/service";
import {
  hasPermission,
  listActivePermissions,
} from "../../packages/domain/src/permissions/service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("F02 exact, time-limited permissions", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const telegramId = String(randomInt(2_000_000_000_000, 3_000_000_000_000));
  let userId: string;
  let allowedScope: string;
  let otherScope: string;

  beforeAll(async () => {
    const user = await pool.query<{ id: string }>(
      "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, 'Synthetic reviewer', true) RETURNING id",
      [telegramId],
    );
    userId = user.rows[0]!.id;
    const first = await pool.query<{ id: string }>(
      "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', 'Synthetic A') RETURNING id",
    );
    allowedScope = first.rows[0]!.id;
    const second = await pool.query<{ id: string }>(
      "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', 'Synthetic B') RETURNING id",
    );
    otherScope = second.rows[0]!.id;
  });

  afterAll(async () => {
    if (userId) {
      await pool.query("DELETE FROM impuls.role_bindings WHERE user_id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM impuls.sessions WHERE user_id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM impuls.users WHERE id = $1", [userId]);
    }
    if (allowedScope && otherScope) {
      await pool.query(
        "DELETE FROM impuls.access_scopes WHERE id = ANY($1::uuid[])",
        [[allowedScope, otherScope]],
      );
    }
    await pool.end();
  });

  it("grants only the listed action in the listed scope and revokes sessions on change", async () => {
    const login = await createLoginSession(pool, telegramId);
    expect(login.kind).toBe("authorized");
    if (login.kind !== "authorized") return;
    expect(await hasPermission(pool, userId, "task.review", allowedScope)).toBe(
      false,
    );

    const binding = await pool.query<{ id: string }>(
      `INSERT INTO impuls.role_bindings
         (user_id, action, scope_id, granted_by, reason)
       VALUES ($1, 'task.review', $2, $1, 'Synthetic integration test') RETURNING id`,
      [userId, allowedScope],
    );
    expect(await readSession(pool, login.sessionToken)).toEqual({
      kind: "revoked",
    });
    expect(await hasPermission(pool, userId, "task.review", allowedScope)).toBe(
      true,
    );
    expect(await hasPermission(pool, userId, "task.review", otherScope)).toBe(
      false,
    );
    expect(await hasPermission(pool, userId, "task.assign", allowedScope)).toBe(
      false,
    );
    expect(await listActivePermissions(pool, userId)).toMatchObject([
      {
        action: "task.review",
        scope: { id: allowedScope, kind: "group", name: "Synthetic A" },
        validUntil: null,
      },
    ]);

    const secondLogin = await createLoginSession(pool, telegramId);
    expect(secondLogin.kind).toBe("authorized");
    await pool.query(
      "UPDATE impuls.role_bindings SET revoked_at = now(), updated_at = now(), version = version + 1 WHERE id = $1",
      [binding.rows[0]!.id],
    );
    if (secondLogin.kind === "authorized") {
      expect(await readSession(pool, secondLogin.sessionToken)).toEqual({
        kind: "revoked",
      });
    }
    expect(await hasPermission(pool, userId, "task.review", allowedScope)).toBe(
      false,
    );
    expect(await listActivePermissions(pool, userId)).toEqual([]);
  });

  it("excludes future and expired grants", async () => {
    await pool.query(
      `INSERT INTO impuls.role_bindings
         (user_id, action, scope_id, valid_from, valid_until, granted_by, reason)
       VALUES ($1, 'task.assign', $2, now() + interval '1 day', now() + interval '2 days', $1, 'Synthetic future grant'),
              ($1, 'task.create', $2, now() - interval '2 days', now() - interval '1 day', $1, 'Synthetic expired grant')`,
      [userId, allowedScope],
    );
    expect(await hasPermission(pool, userId, "task.assign", allowedScope)).toBe(
      false,
    );
    expect(await hasPermission(pool, userId, "task.create", allowedScope)).toBe(
      false,
    );
    expect(await listActivePermissions(pool, userId)).toEqual([]);
  });
});
