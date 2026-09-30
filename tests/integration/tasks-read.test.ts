import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAssignedTask,
  listAssignedTasks,
} from "../../packages/domain/src/tasks/read";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("F03 assigned-task visibility in PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  const ownerTelegramId = String(
    randomInt(3_000_000_000_000, 4_000_000_000_000),
  );
  const otherTelegramId = String(
    randomInt(4_000_000_000_000, 5_000_000_000_000),
  );
  let ownerId: string;
  let otherId: string;
  let scopeId: string;
  let ruleSetId: string;

  beforeAll(async () => {
    const owner = await pool.query<{ id: string }>(
      "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, 'Synthetic owner', true) RETURNING id",
      [ownerTelegramId],
    );
    ownerId = owner.rows[0]!.id;
    const other = await pool.query<{ id: string }>(
      "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, 'Synthetic other', true) RETURNING id",
      [otherTelegramId],
    );
    otherId = other.rows[0]!.id;
    const scope = await pool.query<{ id: string }>(
      "INSERT INTO impuls.access_scopes (kind, name) VALUES ('project', 'Synthetic task scope') RETURNING id",
    );
    scopeId = scope.rows[0]!.id;
    const rules = await pool.query<{ id: string }>(
      `INSERT INTO impuls.rule_sets
         (version_number, definition, effective_from, created_by)
       VALUES ($1, '{}'::jsonb, now(), $2) RETURNING id`,
      [randomInt(1_000_000, 2_000_000_000), ownerId],
    );
    ruleSetId = rules.rows[0]!.id;

    for (const [index, taskId] of ids.entries()) {
      await pool.query(
        `INSERT INTO impuls.tasks
           (id, scope_id, rule_set_id, created_by, title, criteria,
            category_code, priority, status, due_at, fund_xp, fund_points)
         VALUES ($1, $2, $3, $4, $5, 'Synthetic criteria', 'test',
                 'normal', $6, now() + interval '1 day', 0, 0)`,
        [
          taskId,
          scopeId,
          ruleSetId,
          ownerId,
          `Synthetic task ${index + 1}`,
          index === 1 ? "in_review" : "assigned",
        ],
      );
      await pool.query(
        "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
        [taskId, index === 2 ? otherId : ownerId],
      );
    }
  });

  afterAll(async () => {
    if (ids.length) {
      await pool.query(
        "DELETE FROM impuls.task_assignments WHERE task_id = ANY($1::uuid[])",
        [ids],
      );
      await pool.query("DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])", [
        ids,
      ]);
    }
    if (ruleSetId) {
      await pool.query("DELETE FROM impuls.rule_sets WHERE id = $1", [
        ruleSetId,
      ]);
    }
    if (scopeId) {
      await pool.query("DELETE FROM impuls.access_scopes WHERE id = $1", [
        scopeId,
      ]);
    }
    if (ownerId && otherId) {
      await pool.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        [ownerId, otherId],
      ]);
    }
    await pool.end();
  });

  it("returns only the active user's assignments and hides a foreign detail", async () => {
    const list = await listAssignedTasks(pool, ownerId);
    expect(list.items.map((task) => task.id)).toEqual(ids.slice(0, 2));
    expect(await getAssignedTask(pool, ownerId, ids[2]!)).toBeNull();
    expect(await getAssignedTask(pool, otherId, ids[2]!)).toMatchObject({
      id: ids[2],
      criteria: "Synthetic criteria",
    });
  });

  it("filters by status, keeps a stable cursor, and removes access on deactivation", async () => {
    const first = await listAssignedTasks(pool, ownerId, { limit: 1 });
    expect(first.items.map((task) => task.id)).toEqual([ids[0]]);
    expect(first.nextCursor).toBe(ids[0]);
    const second = await listAssignedTasks(pool, ownerId, {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((task) => task.id)).toEqual([ids[1]]);
    expect(second.nextCursor).toBeNull();
    const review = await listAssignedTasks(pool, ownerId, {
      status: "in_review",
    });
    expect(review.items.map((task) => task.id)).toEqual([ids[1]]);

    await pool.query(
      "UPDATE impuls.users SET active = false, version = version + 1, updated_at = now() WHERE id = $1",
      [ownerId],
    );
    expect(await listAssignedTasks(pool, ownerId)).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await getAssignedTask(pool, ownerId, ids[0]!)).toBeNull();
  });

  it("grants the runtime role read access without task mutations", async () => {
    const result = await pool.query<{
      read_allowed: boolean;
      insert_allowed: boolean;
      rls_enabled: boolean;
    }>(`SELECT has_table_privilege('impuls_app', 'impuls.tasks', 'SELECT') AS read_allowed,
              has_table_privilege('impuls_app', 'impuls.tasks', 'INSERT') AS insert_allowed,
              relrowsecurity AS rls_enabled
         FROM pg_class WHERE oid = 'impuls.tasks'::regclass`);
    expect(result.rows[0]).toEqual({
      read_allowed: true,
      insert_allowed: false,
      rls_enabled: true,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE impuls_app");
      const visible = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM impuls.tasks WHERE rule_set_id = $1",
        [ruleSetId],
      );
      expect(Number(visible.rows[0]!.count)).toBe(3);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
