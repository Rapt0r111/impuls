import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { consumeTaskMutationAttempt } from "../../packages/domain/src/tasks/rate-limit";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("F03 shared PostgreSQL mutation limit", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const first = new Pool({
    connectionString: databaseUrl,
    options: "-c role=impuls_app",
    max: 6,
  });
  const second = new Pool({
    connectionString: databaseUrl,
    options: "-c role=impuls_app",
    max: 6,
  });
  const users: string[] = [];

  async function actor() {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,'Synthetic mutation limit',true)",
      [id, randomInt(8_000_000_000_000, 9_000_000_000_000)],
    );
    users.push(id);
    return id;
  }
  afterAll(async () => {
    try {
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await Promise.all([admin.end(), first.end(), second.end()]);
    }
  });

  it("allows exactly 30 of 40 concurrent attempts across independent pools", async () => {
    const id = await actor();
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        consumeTaskMutationAttempt(i % 2 ? first : second, id),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(30);
    const denied = results.filter((result) => !result.allowed);
    expect(denied).toHaveLength(10);
    for (const result of denied) {
      if (result.allowed) throw new Error("Expected rate limit rejection");
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    }
    expect(
      (
        await admin.query(
          "SELECT attempts FROM impuls.task_mutation_limits WHERE actor_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ attempts: 31 }]);
  });

  it("does not extend a denied window and starts a new window after expiry", async () => {
    const id = await actor();
    await admin.query(
      "INSERT INTO impuls.task_mutation_limits VALUES ($1,30,clock_timestamp()+interval '15 seconds')",
      [id],
    );
    const before = (
      await admin.query(
        "SELECT expires_at FROM impuls.task_mutation_limits WHERE actor_id=$1",
        [id],
      )
    ).rows[0];
    for (let i = 0; i < 3; i++)
      expect(await consumeTaskMutationAttempt(first, id)).toMatchObject({
        allowed: false,
      });
    expect(
      (
        await admin.query(
          "SELECT expires_at FROM impuls.task_mutation_limits WHERE actor_id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual(before);
    const other = await actor();
    expect(await consumeTaskMutationAttempt(second, other)).toEqual({
      allowed: true,
    });
    await admin.query(
      "UPDATE impuls.task_mutation_limits SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_id=$1",
      [id],
    );
    expect(await consumeTaskMutationAttempt(second, id)).toEqual({
      allowed: true,
    });
    const row = (
      await admin.query(
        "SELECT attempts, expires_at>clock_timestamp()+interval '59 seconds' AS fresh FROM impuls.task_mutation_limits WHERE actor_id=$1",
        [id],
      )
    ).rows[0];
    expect(row).toEqual({ attempts: 1, fresh: true });
  });

  it("samples time after waiting for a row lock across the expiry boundary", async () => {
    const id = await actor();
    await admin.query(
      "INSERT INTO impuls.task_mutation_limits VALUES ($1,30,clock_timestamp()+interval '1 hour')",
      [id],
    );
    const lock = await admin.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await lock.query("BEGIN");
      await lock.query(
        "UPDATE impuls.task_mutation_limits SET expires_at=clock_timestamp()+interval '0.2 seconds' WHERE actor_id=$1",
        [id],
      );
      pending = consumeTaskMutationAttempt(second, id);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%impuls.task_mutation_limits%' AND pid<>pg_backend_pid()",
        );
        if (result.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await lock.query("SELECT pg_sleep(0.25)");
      await lock.query("COMMIT");
      expect(await pending).toEqual({ allowed: true });
      expect(
        (
          await admin.query(
            "SELECT attempts FROM impuls.task_mutation_limits WHERE actor_id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ attempts: 1 });
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      await pending;
    }
  });

  it("rolls back a failed write and releases its client for the next actor", async () => {
    await expect(
      consumeTaskMutationAttempt(first, randomUUID()),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await consumeTaskMutationAttempt(first, await actor())).toEqual({
      allowed: true,
    });
  });

  it("enables RLS, restricts counter privileges and leaves no public grants", async () => {
    const row = (
      await admin.query(`SELECT relrowsecurity AS rls,
      has_table_privilege('impuls_app','impuls.task_mutation_limits','SELECT') AS readable,
      has_table_privilege('impuls_app','impuls.task_mutation_limits','DELETE') AS deletable,
      has_column_privilege('impuls_app','impuls.task_mutation_limits','actor_id','UPDATE') AS rekeyable,
      EXISTS (SELECT 1 FROM aclexplode(relacl) WHERE grantee=0) AS public_grants
      FROM pg_class WHERE oid='impuls.task_mutation_limits'::regclass`)
    ).rows[0];
    expect(row).toEqual({
      rls: true,
      readable: true,
      deletable: false,
      rekeyable: false,
      public_grants: false,
    });
    const roles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')",
    );
    for (const { rolname } of roles.rows) {
      expect(
        (
          await admin.query(
            "SELECT has_table_privilege($1,'impuls.task_mutation_limits','SELECT,INSERT,UPDATE,DELETE') AS allowed",
            [rolname],
          )
        ).rows[0],
      ).toEqual({ allowed: false });
    }
    const id = await actor();
    await consumeTaskMutationAttempt(first, id);
    await admin.query("DELETE FROM impuls.users WHERE id=$1", [id]);
    expect(
      (
        await admin.query(
          "SELECT actor_id FROM impuls.task_mutation_limits WHERE actor_id=$1",
          [id],
        )
      ).rowCount,
    ).toBe(0);
  });
});
