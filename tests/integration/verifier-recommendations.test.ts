import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignTask,
  createTask,
  readTaskManagementOptions,
} from "../../packages/domain/src/tasks/manage";
import { recommendTaskSubmission } from "../../packages/domain/src/tasks/recommend";
import {
  listReviewQueue,
  returnTaskSubmission,
  reviewTaskSubmission,
} from "../../packages/domain/src/tasks/reviews";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("ordinary task verifier", () => {
  const admin = new Pool({ connectionString: url });
  const runtime = new Pool({
    connectionString: url,
    options: "-c role=impuls_app",
    max: 4,
  });
  const names = ["commander", "participant", "verifier", "stranger"] as const;
  type Name = (typeof names)[number];
  const people = {} as Record<Name, string>;
  const hashes = {} as Record<Name, Buffer>;
  let scope: string;
  let rules: string;

  beforeAll(async () => {
    for (const name of names) {
      people[name] = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
          [
            randomInt(8_000_000_000_000, 9_000_000_000_000),
            `Synthetic ${name}`,
          ],
        )
      ).rows[0]!.id;
      hashes[name] = randomBytes(32);
    }
    scope = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('project', 'Synthetic verifier scope') RETURNING id",
      )
    ).rows[0]!.id;
    rules = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, '{}', now() - interval '1 minute', $2) RETURNING id",
        [randomInt(1_000_000, 2_000_000_000), people.commander],
      )
    ).rows[0]!.id;
    const grants: [Name, string[]][] = [
      ["commander", ["task.review", "task.create", "task.assign"]],
      ["verifier", ["task.verify"]],
      ["stranger", ["task.verify"]],
    ];
    for (const [name, actions] of grants)
      for (const action of actions)
        await admin.query(
          "INSERT INTO impuls.role_bindings (user_id, action, scope_id, granted_by, reason) VALUES ($1, $2, $3, $4, 'Synthetic verifier permission')",
          [people[name], action, scope, people.commander],
        );
    await admin.query(
      "INSERT INTO impuls.task_scope_members (scope_id, user_id) VALUES ($1, $2)",
      [scope, people.participant],
    );
    // Sessions last: granting a binding revokes the user's open sessions.
    for (const name of names)
      await admin.query(
        "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [people[name], hashes[name]],
      );
  });
  afterAll(async () => {
    await runtime.end();
    await admin.end();
  });

  function base(name: Name) {
    return {
      actorId: people[name],
      sessionHash: hashes[name],
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      enabled: true,
    };
  }
  function draftData() {
    return {
      scopeId: scope,
      ruleSetId: rules,
      title: "Synthetic verifier task",
      criteria: "Synthetic criteria",
      categoryCode: "test",
      priority: "normal" as const,
      dueAt: new Date(Date.now() + 864e5).toISOString(),
      fundXp: 40,
      fundPoints: 20,
      openForClaim: false,
    };
  }
  async function draftTask() {
    const created = await createTask(runtime, {
      ...base("commander"),
      data: draftData(),
    });
    if (created.kind !== "ok") throw new Error(created.kind);
    return created.response.task;
  }
  async function reviewFixture() {
    const taskId = randomUUID();
    await admin.query(
      `INSERT INTO impuls.tasks (id, scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at, fund_xp, fund_points)
       VALUES ($1, $2, $3, $4, 'Synthetic review', 'Synthetic criteria', 'test', 'normal', 'in_review', now(), 40, 20)`,
      [taskId, scope, rules, people.commander],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
      [taskId, people.participant],
    );
    await admin.query(
      "INSERT INTO impuls.task_verifiers (task_id, user_id) VALUES ($1, $2)",
      [taskId, people.verifier],
    );
    const submissionId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.submissions (task_id, author_id, attempt_number, text) VALUES ($1, $2, 1, 'Synthetic report') RETURNING id",
        [taskId, people.participant],
      )
    ).rows[0]!.id;
    return { taskId, submissionId };
  }

  it("lets the commander pick a verifier at assignment and refuses an invalid one", async () => {
    const task = await draftTask();
    const assign = (verifierId: string) =>
      assignTask(runtime, {
        ...base("commander"),
        taskId: task.id,
        data: {
          assigneeId: people.participant,
          expectedVersion: task.version,
          verifierId,
        },
      });
    expect((await assign(people.participant)).kind).toBe("verifier_invalid");
    expect((await assign(people.commander)).kind).toBe("verifier_invalid");

    const options = await readTaskManagementOptions(runtime, people.commander, {
      enabled: true,
    });
    const verifiers = options.scopes[0]!.verifiers.map((v) => v.id);
    expect(verifiers.sort()).toEqual([people.verifier, people.stranger].sort());

    const assigned = await assign(people.stranger);
    expect(assigned.kind).toBe("ok");
    if (assigned.kind !== "ok") return;
    expect(assigned.response.task.status).toBe("assigned");
    expect(assigned.response.task.verifier?.id).toBe(people.stranger);
  });

  it("lets only the chosen verifier recommend points and XP and return the report", async () => {
    const { submissionId } = await reviewFixture();
    const recommend = (name: Name, xp: number) =>
      recommendTaskSubmission(runtime, {
        actorId: people[name],
        sessionHash: hashes[name],
        submissionId,
        expectedVersion: 1,
        recommendedXp: xp,
        recommendedPoints: 25,
      });
    expect((await recommend("stranger", 30)).kind).toBe("not_found");
    expect((await recommend("participant", 30)).kind).toBe("not_found");
    expect((await recommend("verifier", 30)).kind).toBe("ok");

    const queue = await listReviewQueue(runtime, people.verifier);
    const item = queue.items.find((i) => i.submissionId === submissionId)!;
    expect(item.canRecommend).toBe(true);
    expect(item.acceptance.enabled).toBe(false);
    expect(item.recommendation).toEqual({
      verifierName: "Synthetic verifier",
      xp: 30,
      points: 25,
    });

    const accept = await reviewTaskSubmission(runtime, {
      actorId: people.verifier,
      sessionHash: hashes.verifier,
      submissionId,
      expectedVersion: 1,
      reason: "Synthetic acceptance attempt",
      idempotencyKey: randomUUID(),
      action: "accept",
      allowSyntheticAccrual: true,
      baseXp: 30,
      basePoints: 25,
    });
    expect(accept.kind).toBe("not_found");

    const stranger = await returnTaskSubmission(runtime, {
      actorId: people.stranger,
      sessionHash: hashes.stranger,
      submissionId,
      expectedVersion: 1,
      reason: "Synthetic return",
      idempotencyKey: randomUUID(),
    });
    expect(stranger.kind).toBe("not_found");

    const returned = await returnTaskSubmission(runtime, {
      actorId: people.verifier,
      sessionHash: hashes.verifier,
      submissionId,
      expectedVersion: 1,
      reason: "Synthetic return by verifier",
      idempotencyKey: randomUUID(),
    });
    expect(returned.kind).toBe("ok");
    if (returned.kind !== "ok") return;
    expect(returned.response.task.status).toBe("needs_work");
  });
});
