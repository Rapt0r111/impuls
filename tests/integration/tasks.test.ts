import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignTask,
  createTask,
  getTaskDetail,
  listTasks,
  returnSubmission,
  startTask,
  submitTask,
} from "../../packages/domain/src/tasks/service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("F03 assigned task and report lifecycle", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const users: string[] = [];
  const scopes: string[] = [];
  let creator: string;
  let reviewer: string;
  let secondReviewer: string;
  let assignee: string;
  let outsider: string;
  let scopeId: string;
  let otherScopeId: string;
  let ruleSetId: string;
  let taskId: string;

  beforeAll(async () => {
    for (const name of [
      "Creator",
      "Reviewer",
      "Second reviewer",
      "Assignee",
      "Outsider",
    ]) {
      const result = await pool.query<{ id: string }>(
        "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
        [
          String(randomInt(2_000_000_000_000, 3_000_000_000_000)),
          `Synthetic ${name}`,
        ],
      );
      users.push(result.rows[0]!.id);
    }
    [creator, reviewer, secondReviewer, assignee, outsider] = users;
    for (const name of ["Synthetic task A", "Synthetic task B"]) {
      const result = await pool.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', $1) RETURNING id",
        [name],
      );
      scopes.push(result.rows[0]!.id);
    }
    [scopeId, otherScopeId] = scopes;
    await pool.query(
      `INSERT INTO impuls.role_bindings (user_id, action, scope_id, granted_by, reason)
       VALUES ($1, 'task.create', $4, $1, 'Synthetic test'),
              ($1, 'task.assign', $4, $1, 'Synthetic test'),
              ($2, 'task.review', $4, $1, 'Synthetic test'),
              ($3, 'task.review', $4, $1, 'Synthetic test'),
              ($5, 'task.review', $4, $1, 'Synthetic self-review check')`,
      [creator, reviewer, secondReviewer, scopeId, assignee],
    );
    const rules = await pool.query<{ id: string }>(
      `INSERT INTO impuls.rule_sets
       (version, label, active_from, max_task_xp, max_task_points)
       VALUES ($1, 'Synthetic test only', now() - interval '1 day', 100, 30)
       RETURNING id`,
      [randomInt(100_000, 2_000_000_000)],
    );
    ruleSetId = rules.rows[0]!.id;
  });

  afterAll(async () => {
    if (users.length) {
      await pool.query(
        "DELETE FROM impuls.mutation_receipts WHERE actor_id = ANY($1::uuid[])",
        [users],
      );
      if (taskId) {
        await pool.query(
          "UPDATE impuls.tasks SET current_submission_id = NULL WHERE id = $1",
          [taskId],
        );
        await pool.query(
          "DELETE FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id = $1)",
          [taskId],
        );
        await pool.query("DELETE FROM impuls.submissions WHERE task_id = $1", [
          taskId,
        ]);
        await pool.query(
          "DELETE FROM impuls.task_assignments WHERE task_id = $1",
          [taskId],
        );
        await pool.query("DELETE FROM impuls.tasks WHERE id = $1", [taskId]);
      }
      await pool.query(
        "DELETE FROM impuls.role_bindings WHERE user_id = ANY($1::uuid[])",
        [users],
      );
      await pool.query(
        "DELETE FROM impuls.sessions WHERE user_id = ANY($1::uuid[])",
        [users],
      );
      await pool.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        users,
      ]);
    }
    if (ruleSetId)
      await pool.query("DELETE FROM impuls.rule_sets WHERE id = $1", [
        ruleSetId,
      ]);
    if (scopes.length)
      await pool.query(
        "DELETE FROM impuls.access_scopes WHERE id = ANY($1::uuid[])",
        [scopes],
      );
    await pool.end();
  });

  it("enforces scope, versions, idempotency and a single return decision", async () => {
    const body = {
      scopeId,
      ruleSetId,
      title: "Synthetic research result",
      criteria: "Describe the checked result",
      category: "Synthetic",
      priority: "normal" as const,
      dueAt: null,
      baseXp: 40,
      basePoints: 12,
    };
    await expect(
      createTask(pool, outsider, randomUUID(), body),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createTask(pool, creator, randomUUID(), {
        ...body,
        scopeId: otherScopeId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createTask(pool, creator, randomUUID(), { ...body, baseXp: 101 }),
    ).rejects.toMatchObject({ code: "FUND_OUT_OF_RANGE" });

    const key = randomUUID();
    const created = await createTask(pool, creator, key, body);
    expect(created.status).toBe(201);
    taskId = created.data.task.id;
    expect(await createTask(pool, creator, key, body)).toEqual(created);
    await expect(
      createTask(pool, creator, key, { ...body, title: "Changed" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await listTasks(pool, outsider)).tasks).toEqual([]);

    const assigned = await assignTask(pool, creator, taskId, randomUUID(), {
      assigneeId: assignee,
      expectedVersion: 1,
    });
    expect(assigned.data.task).toMatchObject({
      status: "assigned",
      version: 2,
    });
    await expect(
      assignTask(pool, creator, taskId, randomUUID(), {
        assigneeId: assignee,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", currentVersion: 2 });
    await expect(
      startTask(pool, outsider, taskId, randomUUID(), { expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const started = await startTask(pool, assignee, taskId, randomUUID(), {
      expectedVersion: 2,
    });
    expect(started.data.task.status).toBe("in_progress");
    const submitted = await submitTask(pool, assignee, taskId, randomUUID(), {
      expectedVersion: 3,
      report: "Synthetic report with evidence",
    });
    expect(submitted.data.task).toMatchObject({
      status: "in_review",
      version: 4,
    });
    expect(
      (await getTaskDetail(pool, assignee, taskId)).submission?.report,
    ).toBe("Synthetic report with evidence");
    await expect(
      returnSubmission(
        pool,
        assignee,
        submitted.data.submissionId,
        randomUUID(),
        {
          decision: "return",
          expectedVersion: 4,
          reason: "Self review",
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const decisions = await Promise.allSettled([
      returnSubmission(
        pool,
        reviewer,
        submitted.data.submissionId,
        randomUUID(),
        {
          decision: "return",
          expectedVersion: 4,
          reason: "Please add source",
        },
      ),
      returnSubmission(
        pool,
        secondReviewer,
        submitted.data.submissionId,
        randomUUID(),
        {
          decision: "return",
          expectedVersion: 4,
          reason: "Please add details",
        },
      ),
    ]);
    expect(
      decisions.filter((item) => item.status === "fulfilled"),
    ).toHaveLength(1);
    expect(decisions.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    const returns = await pool.query(
      "SELECT reason FROM impuls.reviews WHERE submission_id = $1",
      [submitted.data.submissionId],
    );
    expect(returns.rowCount).toBe(1);
    expect((await getTaskDetail(pool, assignee, taskId)).task).toMatchObject({
      status: "needs_work",
      version: 5,
    });
    const restarted = await startTask(pool, assignee, taskId, randomUUID(), {
      expectedVersion: 5,
    });
    expect(restarted.data.task.version).toBe(6);
    const second = await submitTask(pool, assignee, taskId, randomUUID(), {
      expectedVersion: 6,
      report: "Synthetic report with added source",
    });
    expect(second.data.task).toMatchObject({ status: "in_review", version: 7 });
    await expect(
      returnSubmission(
        pool,
        reviewer,
        submitted.data.submissionId,
        randomUUID(),
        {
          decision: "return",
          expectedVersion: 7,
          reason: "Old report",
        },
      ),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });
});
