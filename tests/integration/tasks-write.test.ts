import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  taskStartResponseSchema,
  taskSubmissionResponseSchema,
} from "../../packages/contracts/src/tasks";
import {
  mutateAssignedTask,
  type TaskMutation,
} from "../../packages/domain/src/tasks/write";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("F03 start and submission transactions in PostgreSQL", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  // Exercise the actual runtime grants and RLS, never superuser mutation paths.
  const runtime = new Pool({
    connectionString: databaseUrl,
    options: "-c role=impuls_app",
    max: 4,
  });
  const sessionHash = randomBytes(32);
  let actorId: string;
  let otherId: string;
  let scopeId: string;
  let rulesId: string;
  const taskIds: string[] = [];

  beforeAll(async () => {
    for (const name of ["Synthetic writer", "Synthetic stranger"]) {
      const result = await admin.query<{ id: string }>(
        "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
        [randomInt(6_000_000_000_000, 7_000_000_000_000), name],
      );
      if (!actorId) actorId = result.rows[0]!.id;
      else otherId = result.rows[0]!.id;
    }
    await admin.query(
      "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [actorId, sessionHash],
    );
    scopeId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('project', 'Synthetic submission scope') RETURNING id",
      )
    ).rows[0]!.id;
    rulesId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, '{}', now(), $2) RETURNING id",
        [randomInt(1_000_000, 2_000_000_000), actorId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    try {
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id = ANY($1::uuid[])",
        [[actorId, otherId]],
      );
      await admin.query(
        "DELETE FROM impuls.submissions WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await admin.query(
        "DELETE FROM impuls.task_assignments WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await admin.query("DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])", [
        taskIds,
      ]);
      if (rulesId)
        await admin.query("DELETE FROM impuls.rule_sets WHERE id = $1", [
          rulesId,
        ]);
      if (scopeId)
        await admin.query("DELETE FROM impuls.access_scopes WHERE id = $1", [
          scopeId,
        ]);
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id = ANY($1::uuid[])",
        [[actorId, otherId]],
      );
      await admin.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        [actorId, otherId],
      ]);
    } finally {
      await Promise.all([runtime.end(), admin.end()]);
    }
  });

  async function task(status = "assigned") {
    const taskId = randomUUID();
    taskIds.push(taskId);
    await admin.query(
      `INSERT INTO impuls.tasks (id, scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at, fund_xp, fund_points)
      VALUES ($1, $2, $3, $4, 'Synthetic task', 'Synthetic criteria', 'test', 'normal', $5, now() + interval '1 day', 100, 30)`,
      [taskId, scopeId, rulesId, otherId, status],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
      [taskId, actorId],
    );
    return taskId;
  }

  function start(taskId: string): TaskMutation {
    return {
      action: "start",
      taskId,
      actorId,
      sessionHash,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
    };
  }
  function submit(taskId: string): TaskMutation {
    return {
      action: "submit",
      taskId,
      actorId,
      sessionHash,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      text: "Synthetic completed result",
    };
  }
  async function counts(taskId: string) {
    return (
      await admin.query<{ status: string; version: number; reports: number }>(
        `SELECT status, version, (SELECT count(*)::int FROM impuls.submissions WHERE task_id = t.id) AS reports FROM impuls.tasks t WHERE id = $1`,
        [taskId],
      )
    ).rows[0];
  }

  it("starts an assignment, submits once, returns readable detail and never changes its fund", async () => {
    const id = await task();
    const started = await mutateAssignedTask(runtime, start(id));
    expect(started.kind).toBe("ok");
    if (started.kind !== "ok") throw new Error("Start rejected");
    expect(taskStartResponseSchema.parse(started.response).task).toMatchObject({
      id,
      status: "in_progress",
      version: 2,
      fundXp: 100,
      fundPoints: 30,
      latestSubmission: null,
    });
    const submitted = await mutateAssignedTask(runtime, {
      ...submit(id),
      expectedVersion: 2,
    });
    expect(submitted.kind).toBe("ok");
    if (submitted.kind !== "ok") throw new Error("Submission rejected");
    expect(submitted.status).toBe(201);
    const response = taskSubmissionResponseSchema.parse(submitted.response);
    expect(response.task).toMatchObject({
      status: "in_review",
      version: 3,
      fundXp: 100,
      fundPoints: 30,
    });
    expect(response.task.latestSubmission?.id).toBe(response.submission.id);
    expect(await counts(id)).toEqual({
      status: "in_review",
      version: 3,
      reports: 1,
    });
  });

  it("requires start before submission and rejects closed states without saving an intent", async () => {
    for (const status of [
      "assigned",
      "needs_work",
      "accepted",
      "cancelled",
      "in_review",
    ]) {
      const id = await task(status);
      const input = submit(id);
      expect(await mutateAssignedTask(runtime, input)).toEqual({
        kind: "conflict",
        currentVersion: 1,
      });
      expect(await counts(id)).toEqual({ status, version: 1, reports: 0 });
      const record = await admin.query(
        "SELECT id FROM impuls.idempotency_records WHERE key = $1",
        [input.idempotencyKey],
      );
      expect(record.rowCount).toBe(0);
    }
    const id = await task("needs_work");
    expect((await mutateAssignedTask(runtime, start(id))).kind).toBe("ok");
  });

  it("hides foreign tasks and rejects stale versions without a partial change", async () => {
    const id = await task("in_progress");
    await admin.query(
      "UPDATE impuls.task_assignments SET user_id = $2 WHERE task_id = $1",
      [id, otherId],
    );
    expect(await mutateAssignedTask(runtime, submit(id))).toEqual({
      kind: "not_found",
    });
    await admin.query(
      "UPDATE impuls.task_assignments SET user_id = $2 WHERE task_id = $1",
      [id, actorId],
    );
    expect(
      await mutateAssignedTask(runtime, { ...submit(id), expectedVersion: 9 }),
    ).toEqual({ kind: "conflict", currentVersion: 1 });
    expect(await counts(id)).toEqual({
      status: "in_progress",
      version: 1,
      reports: 0,
    });
  });

  it("replays the exact response and rejects a changed body or target under the same key", async () => {
    const id = await task("in_progress");
    const input = submit(id);
    const first = await mutateAssignedTask(runtime, input);
    expect(await mutateAssignedTask(runtime, input)).toEqual(first);
    expect(
      await mutateAssignedTask(runtime, {
        ...input,
        action: "submit",
        text: "Changed",
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    expect(
      await mutateAssignedTask(runtime, {
        ...input,
        taskId: await task("in_progress"),
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    expect(await counts(id)).toEqual({
      status: "in_review",
      version: 2,
      reports: 1,
    });
  });

  it("serializes concurrent repeats into one report and one version increment", async () => {
    const id = await task("in_progress");
    const input = submit(id);
    const [a, b] = await Promise.all([
      mutateAssignedTask(runtime, input),
      mutateAssignedTask(runtime, input),
    ]);
    expect(a.kind).toBe("ok");
    expect(b).toEqual(a);
    expect(await counts(id)).toEqual({
      status: "in_review",
      version: 2,
      reports: 1,
    });
  });

  it("gives only one winner to concurrent submissions with different keys", async () => {
    const id = await task("in_progress");
    const results = await Promise.all([
      mutateAssignedTask(runtime, submit(id)),
      mutateAssignedTask(runtime, submit(id)),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
    expect(await counts(id)).toEqual({
      status: "in_review",
      version: 2,
      reports: 1,
    });
  });

  it("rolls back intent and task when PostgreSQL rejects the report", async () => {
    const id = await task("in_progress");
    const input = {
      ...submit(id),
      action: "submit" as const,
      text: "x".repeat(4001),
    };
    await expect(mutateAssignedTask(runtime, input)).rejects.toMatchObject({
      code: "23514",
    });
    expect(await counts(id)).toEqual({
      status: "in_progress",
      version: 1,
      reports: 0,
    });
    expect(
      (
        await admin.query(
          "SELECT id FROM impuls.idempotency_records WHERE key = $1",
          [input.idempotencyKey],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("keeps reports immutable and freezes assigned funds despite draft field grants", async () => {
    const result = await admin.query(`SELECT
      has_table_privilege('impuls_app', 'impuls.submissions', 'SELECT') AS read_report,
      has_table_privilege('impuls_app', 'impuls.submissions', 'INSERT') AS insert_report,
      has_table_privilege('impuls_app', 'impuls.submissions', 'UPDATE') AS update_report,
      has_table_privilege('impuls_app', 'impuls.submissions', 'DELETE') AS delete_report,
      has_column_privilege('impuls_app', 'impuls.tasks', 'fund_xp', 'UPDATE') AS update_fund,
      (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('impuls.submissions'::regclass, 'impuls.idempotency_records'::regclass)) AS rls,
      EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE c.oid IN ('impuls.submissions'::regclass, 'impuls.idempotency_records'::regclass) AND a.grantee = 0) AS public_access`);
    expect(result.rows[0]).toEqual({
      read_report: true,
      insert_report: true,
      update_report: false,
      delete_report: false,
      update_fund: true,
      rls: true,
      public_access: false,
    });
    const id = await task();
    await expect(
      runtime.query("UPDATE impuls.tasks SET fund_xp=fund_xp+1 WHERE id=$1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.query("UPDATE impuls.tasks SET title='Rewrite' WHERE id=$1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("checks session and allowlist before returning a saved response", async () => {
    const id = await task();
    const input = start(id);
    expect((await mutateAssignedTask(runtime, input)).kind).toBe("ok");
    expect(
      await mutateAssignedTask(runtime, {
        ...input,
        sessionHash: randomBytes(32),
      }),
    ).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1",
      [actorId],
    );
    expect(await mutateAssignedTask(runtime, input)).toEqual({
      kind: "unauthorized",
    });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at = now() + interval '1 hour', revoked_at = now() WHERE user_id = $1",
      [actorId],
    );
    expect(await mutateAssignedTask(runtime, input)).toEqual({
      kind: "unauthorized",
    });
    await admin.query("UPDATE impuls.users SET active = false WHERE id = $1", [
      actorId,
    ]);
    expect(await mutateAssignedTask(runtime, input)).toEqual({
      kind: "revoked",
    });
    expect(await counts(id)).toEqual({
      status: "in_progress",
      version: 2,
      reports: 0,
    });
  });
});
