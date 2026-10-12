import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimTask,
  listOpenTasks,
} from "../../packages/domain/src/tasks/claim";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("free tasks: listing and claiming in PostgreSQL", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  // The runtime role, never a superuser path.
  const runtime = new Pool({
    connectionString: databaseUrl,
    options: "-c role=impuls_app",
    max: 8,
  });
  const users: Record<
    "a" | "b" | "c" | "d" | "e" | "outsider" | "inactive",
    string
  > = {
    a: "",
    b: "",
    c: "",
    d: "",
    e: "",
    outsider: "",
    inactive: "",
  };
  const hashes = {
    a: randomBytes(32),
    b: randomBytes(32),
    c: randomBytes(32),
    d: randomBytes(32),
    e: randomBytes(32),
    outsider: randomBytes(32),
    inactive: randomBytes(32),
  };
  let scopeId: string;
  let otherScopeId: string;
  let rulesId: string;
  const taskIds: string[] = [];

  beforeAll(async () => {
    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      users[key] = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, $3) RETURNING id",
          [
            randomInt(6_000_000_000_000, 7_000_000_000_000),
            `Synthetic claim ${key}`,
            key !== "inactive",
          ],
        )
      ).rows[0]!.id;
      await admin.query(
        "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [users[key], hashes[key]],
      );
    }
    scopeId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', 'Synthetic claim scope') RETURNING id",
      )
    ).rows[0]!.id;
    otherScopeId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', 'Synthetic other scope') RETURNING id",
      )
    ).rows[0]!.id;
    for (const key of ["a", "b", "c", "d", "e", "inactive"] as const)
      await admin.query(
        "INSERT INTO impuls.task_scope_members (scope_id, user_id, valid_from) VALUES ($1, $2, clock_timestamp() - interval '1 day')",
        [scopeId, users[key]],
      );
    await admin.query(
      "INSERT INTO impuls.task_scope_members (scope_id, user_id, valid_from) VALUES ($1, $2, clock_timestamp() - interval '1 day')",
      [otherScopeId, users.outsider],
    );
    rulesId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, '{}', now(), $2) RETURNING id",
        [randomInt(1_000_000, 2_000_000_000), users.a],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    try {
      const ids = Object.values(users);
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id = ANY($1::uuid[])",
        [ids],
      );
      await admin.query(
        "DELETE FROM impuls.notification_outbox WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await admin.query(
        "DELETE FROM impuls.task_events WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await admin.query(
        "DELETE FROM impuls.task_assignments WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await admin.query("DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])", [
        taskIds,
      ]);
      await admin.query(
        "DELETE FROM impuls.task_scope_members WHERE scope_id = ANY($1::uuid[])",
        [[scopeId, otherScopeId]],
      );
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id = ANY($1::uuid[])",
        [[scopeId, otherScopeId]],
      );
      await admin.query("DELETE FROM impuls.rule_sets WHERE id = $1", [
        rulesId,
      ]);
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id = ANY($1::uuid[])",
        [ids],
      );
      await admin.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        ids,
      ]);
    } finally {
      await Promise.all([runtime.end(), admin.end()]);
    }
  });

  async function task(
    patch: { open?: boolean; status?: string; due?: string } = {},
  ) {
    const id = randomUUID();
    taskIds.push(id);
    await admin.query(
      `INSERT INTO impuls.tasks (id, scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at, fund_xp, fund_points, open_for_claim)
       VALUES ($1, $2, $3, $4, 'Synthetic free task', 'Synthetic criteria', 'test', 'normal', $5, now() + $6::interval, 100, 30, $7)`,
      [
        id,
        scopeId,
        rulesId,
        users.a,
        patch.status ?? "draft",
        patch.due ?? "1 day",
        patch.open ?? true,
      ],
    );
    return id;
  }
  const claim = (
    taskId: string,
    who: keyof typeof users,
    over: { expectedVersion?: number; idempotencyKey?: string } = {},
  ) =>
    claimTask(runtime, {
      taskId,
      actorId: users[who],
      sessionHash: hashes[who],
      expectedVersion: over.expectedVersion ?? 1,
      idempotencyKey: over.idempotencyKey ?? randomUUID(),
      enabled: true,
    });
  const state = async (id: string) =>
    (
      await admin.query<{
        status: string;
        version: number;
        assignees: string[];
        kinds: string[];
      }>(
        `SELECT t.status, t.version,
           coalesce((SELECT array_agg(user_id::text) FROM impuls.task_assignments WHERE task_id = t.id), '{}') AS assignees,
           coalesce((SELECT array_agg(kind ORDER BY task_version) FROM impuls.task_events WHERE task_id = t.id), '{}') AS kinds
         FROM impuls.tasks t WHERE t.id = $1`,
        [id],
      )
    ).rows[0]!;

  it("lists only open drafts of the member's own scope that nobody has taken", async () => {
    const open = await task();
    const plain = await task({ open: false });
    const assigned = await task({ status: "assigned" });
    const overdue = await task({ due: "-1 hour" });
    const ids = (await listOpenTasks(runtime, users.a, { enabled: true })).map(
      (item) => item.id,
    );
    expect(ids).toContain(open);
    for (const hidden of [plain, assigned, overdue])
      expect(ids).not.toContain(hidden);
    expect(
      (await listOpenTasks(runtime, users.outsider, { enabled: true })).map(
        (item) => item.id,
      ),
    ).not.toContain(open);
    expect(
      await listOpenTasks(runtime, users.inactive, { enabled: true }),
    ).toEqual([]);
    expect(await listOpenTasks(runtime, users.a, { enabled: false })).toEqual(
      [],
    );
  });

  it("takes a free task once: assignment, status, version and a self-assignment event", async () => {
    const id = await task();
    const key = randomUUID();
    const result = await claim(id, "a", { idempotencyKey: key });
    expect(result).toMatchObject({ kind: "ok", status: 200 });
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.response.task).toMatchObject({
      id,
      status: "assigned",
      version: 2,
      fundXp: 100,
      fundPoints: 30,
    });
    expect(await state(id)).toMatchObject({
      status: "assigned",
      version: 2,
      assignees: [users.a],
    });
    const event = (
      await admin.query<{
        kind: string;
        actor_id: string;
        assignee_id: string;
      }>(
        "SELECT kind, actor_id, assignee_id FROM impuls.task_events WHERE task_id = $1 AND task_version = 2",
        [id],
      )
    ).rows[0];
    expect(event).toEqual({
      kind: "assigned",
      actor_id: users.a,
      assignee_id: users.a,
    });
    // The same key replays the saved answer without a second assignment.
    const replay = await claim(id, "a", { idempotencyKey: key });
    expect(replay).toMatchObject({ kind: "ok", response: result.response });
    expect((await state(id)).assignees).toEqual([users.a]);
    // It left the list for everyone.
    expect(
      (await listOpenTasks(runtime, users.b, { enabled: true })).map(
        (item) => item.id,
      ),
    ).not.toContain(id);
  });

  it("lets exactly one of eight simultaneous claimers win", async () => {
    const id = await task();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) => claim(id, index % 2 ? "a" : "b")),
    );
    expect(attempts.filter((item) => item.kind === "ok")).toHaveLength(1);
    expect(attempts.filter((item) => item.kind === "conflict")).toHaveLength(7);
    const finalState = await state(id);
    expect(finalState.assignees).toHaveLength(1);
    expect(finalState.version).toBe(2);
    expect(finalState.kinds).toEqual(["assigned"]);
  });

  it("refuses a stale version, an assigned or non-open task, an overdue task and a reused key with another body", async () => {
    const open = await task();
    expect(await claim(open, "a", { expectedVersion: 2 })).toMatchObject({
      kind: "conflict",
      currentVersion: 1,
    });
    for (const blocked of [
      await task({ open: false }),
      await task({ status: "assigned" }),
      await task({ due: "-1 minute" }),
    ])
      expect(await claim(blocked, "a")).toMatchObject({ kind: "conflict" });
    expect((await state(open)).assignees).toEqual([]);
    const key = randomUUID();
    expect(await claim(open, "a", { idempotencyKey: key })).toMatchObject({
      kind: "ok",
    });
    const another = await task();
    expect(await claim(another, "a", { idempotencyKey: key })).toEqual({
      kind: "idempotency_conflict",
    });
  });

  it("hides the task from outsiders, ends revoked sessions and honours the off switch", async () => {
    const id = await task();
    expect(await claim(id, "outsider")).toEqual({ kind: "not_found" });
    expect(await claim(randomUUID(), "a")).toEqual({ kind: "not_found" });
    expect(await claim(id, "inactive")).toEqual({ kind: "revoked" });
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at = now() WHERE user_id = $1",
      [users.b],
    );
    expect(await claim(id, "b")).toEqual({ kind: "unauthorized" });
    expect(
      await claimTask(runtime, {
        taskId: id,
        actorId: users.a,
        sessionHash: hashes.a,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        enabled: false,
      }),
    ).toEqual({ kind: "disabled" });
    expect((await state(id)).assignees).toEqual([]);
  });

  it("cannot be flagged or unflagged by the application role", async () => {
    const id = await task({ open: false });
    await expect(
      runtime.query(
        "UPDATE impuls.tasks SET open_for_claim = true WHERE id = $1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("tells the creator when someone else takes the task, and stays quiet on a self-take", async () => {
    const own = await task();
    expect(await claim(own, "a")).toMatchObject({ kind: "ok" });
    const taken = await task();
    expect(await claim(taken, "d")).toMatchObject({ kind: "ok" });
    const rows = await admin.query<{ task_id: string; recipient_id: string }>(
      "SELECT task_id, recipient_id FROM impuls.notification_outbox WHERE task_id = ANY($1::uuid[]) AND kind = 'task.claimed'",
      [[own, taken]],
    );
    expect(rows.rows).toEqual([{ task_id: taken, recipient_id: users.a }]);
    // A replay with the same key does not queue a second message.
    const key = randomUUID();
    const again = await task();
    await claim(again, "d", { idempotencyKey: key });
    await claim(again, "d", { idempotencyKey: key });
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.notification_outbox WHERE task_id = $1 AND kind = 'task.claimed'",
          [again],
        )
      ).rowCount,
    ).toBe(1);
    await admin.query(
      "DELETE FROM impuls.notification_outbox WHERE task_id = ANY($1::uuid[])",
      [[own, taken, again]],
    );
  });

  it("enforces the commander's limit on unfinished self-taken tasks, and none when unset", async () => {
    // Above every version other test files create, so this is the newest while it exists.
    const version = 2_100_000_000 + randomInt(0, 1_000_000);
    const limitRule = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, $2::jsonb, clock_timestamp() - interval '1 second', $3) RETURNING id",
        [
          version,
          JSON.stringify({ mode: "synthetic", openTaskLimit: 2 }),
          users.a,
        ],
      )
    ).rows[0]!.id;
    try {
      const [one, two, three, four] = [
        await task(),
        await task(),
        await task(),
        await task(),
      ] as [string, string, string, string];
      expect(await claim(one, "c")).toMatchObject({ kind: "ok" });
      expect(await claim(two, "c")).toMatchObject({ kind: "ok" });
      expect(await claim(three, "c")).toEqual({
        kind: "limit_reached",
        limit: 2,
      });
      expect((await state(three)).assignees).toEqual([]);
      // Someone else is not affected by c's count.
      expect(await claim(three, "e")).toMatchObject({ kind: "ok" });
      // Finishing one frees a place.
      await admin.query(
        "UPDATE impuls.tasks SET status = 'accepted' WHERE id = $1",
        [one],
      );
      expect(await claim(four, "c")).toMatchObject({ kind: "ok" });
      // Two simultaneous taps by one member cannot both pass the count.
      await admin.query(
        "UPDATE impuls.tasks SET status = 'accepted' WHERE id = ANY($1::uuid[])",
        [[two, four]],
      );
      const racers = [await task(), await task(), await task(), await task()];
      const results = await Promise.all(racers.map((id) => claim(id, "c")));
      expect(results.filter((r) => r.kind === "ok")).toHaveLength(2);
      expect(results.filter((r) => r.kind === "limit_reached")).toHaveLength(2);
    } finally {
      await admin.query("DELETE FROM impuls.rule_sets WHERE id = $1", [
        limitRule,
      ]);
    }
    // Without a limit in the newest settings the same member takes any number.
    const free = [await task(), await task(), await task()];
    for (const id of free)
      expect(await claim(id, "c")).toMatchObject({ kind: "ok" });
  });
});
