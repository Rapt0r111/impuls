import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listReviewQueue,
  returnTaskSubmission,
  reviewTaskSubmission,
  type TaskReturnInput,
} from "../../packages/domain/src/tasks/reviews";

const url = process.env.TEST_DATABASE_URL;

// ADR-0045: task.return sends a report back for rework but never accepts it; accepting
// (points and XP) stays with task.review.
(url ? describe : describe.skip)("task.return right", () => {
  const admin = new Pool({ connectionString: url });
  const runtime = new Pool({
    connectionString: url,
    options: "-c role=impuls_app",
    max: 4,
  });
  const verifierToken = randomBytes(32).toString("base64url");
  const verifierHash = createHash("sha256").update(verifierToken).digest();
  const users: string[] = [];
  const tasks: string[] = [];
  let scope: string;
  let rules: string;
  let verifier: string;
  let commander: string;
  let participant: string;
  let outsider: string;

  beforeAll(async () => {
    for (const name of ["Verifier", "Commander", "Participant", "Outsider"])
      users.push(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
            [
              randomInt(8_000_000_000_000, 9_000_000_000_000),
              `Synthetic ${name}`,
            ],
          )
        ).rows[0]!.id,
      );
    [verifier, commander, participant, outsider] = users as [
      string,
      string,
      string,
      string,
    ];
    scope = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('project', 'Synthetic return scope') RETURNING id",
      )
    ).rows[0]!.id;
    rules = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, '{}', now(), $2) RETURNING id",
        [randomInt(1_000_000, 2_000_000_000), commander],
      )
    ).rows[0]!.id;
    for (const [user, action] of [
      [verifier, "task.return"],
      [commander, "task.review"],
    ] as const)
      await admin.query(
        "INSERT INTO impuls.role_bindings (user_id, action, scope_id, granted_by, reason) VALUES ($1, $2, $3, $4, 'Synthetic return permission')",
        [user, action, scope, commander],
      );
    await admin.query(
      "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [verifier, verifierHash],
    );
  });

  async function fixture() {
    const taskId = randomUUID();
    tasks.push(taskId);
    await admin.query(
      `INSERT INTO impuls.tasks (id, scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at, fund_xp, fund_points) VALUES ($1, $2, $3, $4, $5, 'Independent evidence', 'test', 'normal', 'in_review', now(), 100, 30)`,
      [taskId, scope, rules, commander, `Synthetic return task ${taskId}`],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
      [taskId, participant],
    );
    const submissionId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.submissions (task_id, author_id, attempt_number, text) VALUES ($1, $2, 1, 'Synthetic report') RETURNING id",
        [taskId, participant],
      )
    ).rows[0]!.id;
    return {
      taskId,
      input: {
        actorId: verifier,
        sessionHash: verifierHash,
        submissionId,
        expectedVersion: 1,
        reason: "Criteria are not met: add the missing evidence",
        idempotencyKey: randomUUID(),
      } satisfies TaskReturnInput,
    };
  }
  async function status(taskId: string) {
    return (
      await admin.query(
        `SELECT status, (SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id = r.submission_id WHERE s.task_id = t.id) AS decisions FROM impuls.tasks t WHERE id = $1`,
        [taskId],
      )
    ).rows[0];
  }

  afterAll(async () => {
    try {
      await admin.query(
        "DELETE FROM impuls.audit_events WHERE review_id IN (SELECT r.id FROM impuls.reviews r JOIN impuls.submissions s ON s.id = r.submission_id WHERE s.task_id = ANY($1::uuid[]))",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.notification_outbox WHERE review_id IN (SELECT r.id FROM impuls.reviews r JOIN impuls.submissions s ON s.id = r.submission_id WHERE s.task_id = ANY($1::uuid[]))",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id = ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id = ANY($1::uuid[]))",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.submissions WHERE task_id = ANY($1::uuid[])",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.task_assignments WHERE task_id = ANY($1::uuid[])",
        [tasks],
      );
      await admin.query("DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])", [
        tasks,
      ]);
      await admin.query("DELETE FROM impuls.rule_sets WHERE id = $1", [rules]);
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id = ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.access_scopes WHERE id = $1", [
        scope,
      ]);
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id = ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await Promise.all([admin.end(), runtime.end()]);
    }
  });

  it("shows the queue to a return-only holder without offering acceptance", async () => {
    const { input } = await fixture();
    const queue = await listReviewQueue(runtime, verifier, {
      allowSyntheticAccrual: true,
    });
    const item = queue.items.find((i) => i.submissionId === input.submissionId);
    expect(item?.acceptance).toEqual({
      enabled: false,
      options: { adjustment: null, bonuses: [] },
    });
  });

  it("lets a return-only holder return a report", async () => {
    const { taskId, input } = await fixture();
    const result = await returnTaskSubmission(runtime, input);
    expect(result.kind).toBe("ok");
    expect(await status(taskId)).toEqual({
      status: "needs_work",
      decisions: 1,
    });
  });

  it("refuses to let a return-only holder accept", async () => {
    const { taskId, input } = await fixture();
    expect(
      await reviewTaskSubmission(runtime, {
        ...input,
        action: "accept",
        allowSyntheticAccrual: true,
      }),
    ).toEqual({ kind: "not_found" });
    expect(await status(taskId)).toEqual({
      status: "in_review",
      decisions: 0,
    });
  });

  it("gives nothing to a user without either right", async () => {
    const { taskId, input } = await fixture();
    expect((await listReviewQueue(runtime, outsider)).items).toEqual([]);
    expect(
      await returnTaskSubmission(runtime, { ...input, actorId: outsider }),
    ).toEqual({ kind: "not_found" });
    expect(await status(taskId)).toEqual({
      status: "in_review",
      decisions: 0,
    });
  });
});
