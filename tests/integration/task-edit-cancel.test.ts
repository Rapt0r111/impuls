import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  createTask,
  assignTask,
  editTask,
  cancelTask,
  readTaskManagementOptions,
  listManagedTasks,
  type ManagedTask,
} from "../../packages/domain/src/tasks/manage";
import { mutateAssignedTask } from "../../packages/domain/src/tasks/write";
import {
  reviewTaskSubmission,
  listReviewQueue,
} from "../../packages/domain/src/tasks/reviews";
import { readTaskTimeline } from "../../packages/domain/src/tasks/timeline";
import {
  taskManagementOptionsResponseSchema,
  taskTimelineResponseSchema,
} from "../../packages/contracts/src/index";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import { chromium } from "playwright";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("F03 draft editing and cancellation", () => {
  const admin = new Pool({ connectionString: url });
  const runtime = new Pool({
    connectionString: url,
    options: "-c role=impuls_app",
    max: 8,
  });
  const users = Array.from({ length: 5 }, () => randomUUID());
  const [manager, participant, creator, outsider, viewer] = users as [
    string,
    string,
    string,
    string,
    string,
  ];
  const tokens = users.map(() => randomBytes(32).toString("base64url"));
  const hashes = tokens.map((token) =>
    createHash("sha256").update(token).digest(),
  );
  const scope = randomUUID(),
    neighbour = randomUUID(),
    rule = randomUUID();
  const tasks: string[] = [];
  const base = () => ({
    actorId: manager,
    sessionHash: hashes[0]!,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    enabled: true,
  });
  const fields = {
    title: "Original synthetic task",
    criteria: "Original criterion",
    categoryCode: "test",
    priority: "normal" as const,
    dueAt: "2035-01-01T12:00:00.000Z",
    fundXp: 17,
    fundPoints: 9,
  };
  beforeAll(async () => {
    for (const [i, id] of users.entries()) {
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES ($1,$2,$3,true)",
        [
          id,
          randomInt(8_000_000_000_000, 9_000_000_000_000),
          `Synthetic edit fixture ${i}`,
        ],
      );
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [id, hashes[i]],
      );
    }
    for (const id of [scope, neighbour])
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES ($1,'group','Synthetic edit scope')",
        [id],
      );
    await admin.query(
      `INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{"mode":"synthetic","timeZone":"Europe/Moscow","acceptance":{"enabled":true}}',clock_timestamp()-interval '1 day',$3)`,
      [rule, randomInt(1_000_000, 1_500_000_000), manager],
    );
    for (const action of [
      "task.create",
      "task.assign",
      "task.edit",
      "task.cancel",
      "task.review",
      "task.view",
    ])
      await grant(manager, action, scope);
    await grant(creator, "task.create", scope);
    await grant(outsider, "task.edit", neighbour);
    await grant(outsider, "task.cancel", neighbour);
    await grant(viewer, "task.view", scope);
    await admin.query(
      "INSERT INTO impuls.task_scope_members(scope_id,user_id) VALUES ($1,$2)",
      [scope, participant],
    );
    await admin.query(
      "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
      [users],
    );
    for (const [i, id] of users.entries())
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [id, hashes[i]],
      );
  });
  async function grant(user: string, action: string, scopeId: string) {
    await admin.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES ($1,$2,$3,$1,'Synthetic fixture')",
      [user, action, scopeId],
    );
  }
  async function draft(title = fields.title): Promise<ManagedTask> {
    const r = await createTask(runtime, {
      ...base(),
      data: { ...fields, title, scopeId: scope, ruleSetId: rule },
    });
    if (r.kind !== "ok") throw new Error(r.kind);
    tasks.push(r.response.task.id);
    return r.response.task;
  }
  const editInput = (t: ManagedTask) => ({
    ...base(),
    taskId: t.id,
    data: {
      ...fields,
      title: "Changed synthetic title",
      criteria: "New independent criterion",
      fundXp: 23,
      fundPoints: 11,
      expectedVersion: t.version,
      reason: "Correct synthetic requirements",
    },
  });
  const cancelInput = (t: ManagedTask) => ({
    ...base(),
    taskId: t.id,
    data: {
      expectedVersion: t.version,
      reason: "Synthetic task no longer needed",
    },
  });
  async function assigned() {
    const t = await draft();
    const r = await assignTask(runtime, {
      ...base(),
      taskId: t.id,
      data: { assigneeId: participant, expectedVersion: t.version },
    });
    if (r.kind !== "ok") throw new Error(r.kind);
    return r.response.task;
  }
  async function submitted() {
    const t = await assigned();
    const actor = {
      actorId: participant,
      sessionHash: hashes[1]!,
      taskId: t.id,
    };
    const start = await mutateAssignedTask(runtime, {
      ...actor,
      action: "start",
      expectedVersion: 2,
      idempotencyKey: randomUUID(),
    });
    if (start.kind !== "ok") throw new Error(start.kind);
    const r = await mutateAssignedTask(runtime, {
      ...actor,
      action: "submit",
      expectedVersion: 3,
      idempotencyKey: randomUUID(),
      text: "Synthetic report",
    });
    if (r.kind !== "ok") throw new Error(r.kind);
    return {
      task: { ...t, version: 4, status: "in_review" as const },
      submissionId: r.response.submission!.id,
    };
  }
  const reviewInput = (
    f: Awaited<ReturnType<typeof submitted>>,
    action: "return" | "accept",
  ) => ({
    actorId: manager,
    sessionHash: hashes[0]!,
    submissionId: f.submissionId,
    expectedVersion: 4,
    reason: "Independent synthetic review",
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    action,
    allowSyntheticAccrual: true,
  });
  async function count(table: string, taskId: string) {
    if (table === "reviews")
      return Number(
        (
          await admin.query(
            "SELECT count(*) FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id=$1)",
            [taskId],
          )
        ).rows[0].count,
      );
    return Number(
      (
        await admin.query(
          `SELECT count(*) FROM impuls.${table} WHERE task_id=$1`,
          [taskId],
        )
      ).rows[0].count,
    );
  }
  it("edits a draft once and preserves both immutable condition snapshots and audit reason", async () => {
    const t = await draft(),
      input = editInput(t);
    const first = await editTask(runtime, input);
    expect(first).toMatchObject({
      kind: "ok",
      response: {
        task: {
          status: "draft",
          version: 2,
          title: "Changed synthetic title",
          fundXp: 23,
          fundPoints: 11,
          ruleSetId: rule,
          scope: { id: scope },
        },
      },
    });
    expect(await editTask(runtime, input)).toEqual(first);
    expect(
      await editTask(runtime, {
        ...input,
        data: { ...input.data, reason: "Different intent" },
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    const timeline = await readTaskTimeline(runtime, manager, hashes[0]!, t.id);
    if (timeline.kind !== "ok") throw new Error(timeline.kind);
    taskTimelineResponseSchema.parse(timeline.response);
    expect(
      timeline.response.items.map((e) => [e.kind, e.taskSnapshot?.title]),
    ).toEqual([
      ["edited", "Changed synthetic title"],
      ["created", fields.title],
    ]);
    expect(timeline.response.items[0]?.reason).toBe(input.data.reason);
    expect(await count("task_events", t.id)).toBe(2);
    expect(
      (
        await admin.query(
          "SELECT reason,diff FROM impuls.audit_events WHERE task_id=$1 AND action='task.edit'",
          [t.id],
        )
      ).rows,
    ).toMatchObject([
      {
        reason: input.data.reason,
        diff: { title: input.data.title, fundXp: 23 },
      },
    ]);
    expect(await count("ledger_entries", t.id)).toBe(0);
  });
  it("does not inherit edit/cancel from create, view, or neighbouring scope; hidden IDs never disclose versions", async () => {
    const t = await draft();
    for (const id of [creator, outsider, viewer]) {
      const credentials = {
        actorId: id,
        sessionHash: hashes[users.indexOf(id)]!,
      };
      expect(
        await editTask(runtime, { ...editInput(t), ...credentials }),
      ).toEqual({ kind: "not_found" });
      expect(
        await cancelTask(runtime, { ...cancelInput(t), ...credentials }),
      ).toEqual({ kind: "not_found" });
    }
    expect(await count("task_events", t.id)).toBe(1);
  });
  it("exposes independent edit/cancel options and list access with no create/assign permission", async () => {
    await grant(outsider, "task.edit", scope);
    await grant(outsider, "task.cancel", scope);
    await admin.query("DELETE FROM impuls.sessions WHERE user_id=$1", [
      outsider,
    ]);
    await admin.query(
      "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
      [outsider, hashes[3]],
    );
    try {
      const options = taskManagementOptionsResponseSchema.parse(
        await readTaskManagementOptions(runtime, outsider, { enabled: true }),
      );
      expect(options.scopes.find((s) => s.id === scope)).toMatchObject({
        canEdit: true,
        canCancel: true,
        canCreate: false,
        canAssign: false,
        assignees: [],
      });
      expect(
        (await listManagedTasks(runtime, outsider)).items.length,
      ).toBeGreaterThan(0);
      const t = await draft();
      expect(
        (await readTaskTimeline(runtime, outsider, hashes[3]!, t.id)).kind,
      ).toBe("not_found");
    } finally {
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2",
        [outsider, scope],
      );
    }
  });
  it("rejects disabled mode and stale edit; denied requests leave no idempotency record", async () => {
    const t = await draft(),
      input = editInput(t);
    expect(await editTask(runtime, { ...input, enabled: false })).toEqual({
      kind: "disabled",
    });
    expect(
      await editTask(runtime, {
        ...input,
        data: { ...input.data, expectedVersion: 99 },
      }),
    ).toEqual({ kind: "conflict", currentVersion: 1 });
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.idempotency_records WHERE actor_id=$1 AND key=$2",
          [manager, input.idempotencyKey],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("only edits drafts; cancels each open status without touching immutable reports or balances", async () => {
    for (const status of [
      "draft",
      "assigned",
      "in_progress",
      "in_review",
      "needs_work",
    ] as const) {
      const t = status === "draft" ? await draft() : await assigned();
      if (status !== "draft")
        await admin.query("UPDATE impuls.tasks SET status=$2 WHERE id=$1", [
          t.id,
          status,
        ]);
      const current = { ...t, status };
      if (status !== "draft")
        expect(await editTask(runtime, editInput(current))).toEqual({
          kind: "conflict",
          currentVersion: t.version,
        });
      const r = await cancelTask(runtime, cancelInput(current));
      expect(r).toMatchObject({
        kind: "ok",
        response: { task: { status: "cancelled", version: t.version + 1 } },
      });
      expect(await count("ledger_entries", t.id)).toBe(0);
      expect(await count("task_assignments", t.id)).toBe(
        status === "draft" ? 0 : 1,
      );
    }
  });
  it("cancelled review leaves its report readable and blocks start/submit/review with no credit", async () => {
    const f = await submitted(),
      input = cancelInput(f.task);
    const r = await cancelTask(runtime, input);
    expect(r.kind).toBe("ok");
    expect(await cancelTask(runtime, input)).toEqual(r);
    expect(
      (await listReviewQueue(runtime, manager)).items.map(
        (i) => i.submissionId,
      ),
    ).not.toContain(f.submissionId);
    expect(
      (await reviewTaskSubmission(runtime, reviewInput(f, "accept"))).kind,
    ).toBe("conflict");
    expect(
      (
        await mutateAssignedTask(runtime, {
          action: "start",
          actorId: participant,
          sessionHash: hashes[1]!,
          taskId: f.task.id,
          expectedVersion: 5,
          idempotencyKey: randomUUID(),
        })
      ).kind,
    ).toBe("conflict");
    expect(
      (
        await mutateAssignedTask(runtime, {
          action: "submit",
          actorId: participant,
          sessionHash: hashes[1]!,
          taskId: f.task.id,
          expectedVersion: 5,
          idempotencyKey: randomUUID(),
          text: "late",
        })
      ).kind,
    ).toBe("conflict");
    expect(await count("submissions", f.task.id)).toBe(1);
    expect(await count("reviews", f.task.id)).toBe(0);
    expect(await count("ledger_entries", f.task.id)).toBe(0);
    const timeline = await readTaskTimeline(
      runtime,
      participant,
      hashes[1]!,
      f.task.id,
    );
    if (timeline.kind !== "ok") throw new Error(timeline.kind);
    expect(timeline.response.items[0]).toMatchObject({
      kind: "cancelled",
      reason: input.data.reason,
    });
  });
  it("accepted and already cancelled tasks reject new cancellations; acceptance balances stay intact", async () => {
    const f = await submitted();
    expect(
      (await reviewTaskSubmission(runtime, reviewInput(f, "accept"))).kind,
    ).toBe("ok");
    expect(
      (
        await cancelTask(
          runtime,
          cancelInput({ ...f.task, status: "accepted", version: 5 }),
        )
      ).kind,
    ).toBe("conflict");
    expect(await count("ledger_entries", f.task.id)).toBe(2);
    const t = await draft();
    await cancelTask(runtime, cancelInput(t));
    expect(
      (
        await cancelTask(
          runtime,
          cancelInput({ ...t, status: "cancelled", version: 2 }),
        )
      ).kind,
    ).toBe("conflict");
  });
  it("serializes concurrent edit versus assignment with one winner", async () => {
    const t = await draft();
    const results = await Promise.all([
      editTask(runtime, editInput(t)),
      assignTask(runtime, {
        ...base(),
        taskId: t.id,
        data: { assigneeId: participant, expectedVersion: 1 },
      }),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
    expect(await count("task_events", t.id)).toBe(2);
  });
  it.each(["return", "accept"] as const)(
    "serializes cancellation versus %s with one complete transaction",
    async (action) => {
      const f = await submitted();
      const results = await Promise.all([
        cancelTask(runtime, cancelInput(f.task)),
        reviewTaskSubmission(runtime, reviewInput(f, action)),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      const cancelled = results[0].kind === "ok";
      expect(await count("task_events", f.task.id)).toBe(5);
      expect(await count("reviews", f.task.id)).toBe(cancelled ? 0 : 1);
      expect(await count("ledger_entries", f.task.id)).toBe(
        !cancelled && action === "accept" ? 2 : 0,
      );
    },
  );
  it("checks access before replay after session revocation", async () => {
    const t = await draft(),
      input = cancelInput(t);
    expect((await cancelTask(runtime, input)).kind).toBe("ok");
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1",
      [manager],
    );
    try {
      expect((await cancelTask(runtime, input)).kind).toBe("unauthorized");
    } finally {
      await admin.query("DELETE FROM impuls.sessions WHERE user_id=$1", [
        manager,
      ]);
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [manager, hashes[0]],
      );
    }
    expect(await count("task_events", t.id)).toBe(2);
  });
  it("cannot rewrite/delete lifecycle or audit records as runtime", async () => {
    const t = await draft();
    await editTask(runtime, editInput(t));
    for (const table of ["task_events", "audit_events"]) {
      await expect(
        runtime.query(`DELETE FROM impuls.${table} WHERE task_id=$1`, [t.id]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        runtime.query(
          `UPDATE impuls.${table} SET reason='rewrite' WHERE task_id=$1`,
          [t.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("serializes cancellation against participant start/submit", async () => {
    for (const action of ["start", "submit"] as const) {
      let t = await assigned();
      if (action === "submit") {
        const r = await mutateAssignedTask(runtime, {
          actorId: participant,
          sessionHash: hashes[1]!,
          taskId: t.id,
          action: "start",
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
        });
        if (r.kind !== "ok") throw new Error(r.kind);
        t = { ...t, status: "in_progress", version: 3 };
      }
      const input = {
        actorId: participant,
        sessionHash: hashes[1]!,
        taskId: t.id,
        expectedVersion: t.version,
        idempotencyKey: randomUUID(),
      };
      const results = await Promise.all([
        cancelTask(runtime, cancelInput(t)),
        mutateAssignedTask(
          runtime,
          action === "start"
            ? { ...input, action }
            : { ...input, action, text: "Synthetic report" },
        ),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      expect(await count("submissions", t.id)).toBe(
        action === "submit" && results[1].kind === "ok" ? 1 : 0,
      );
    }
  });
  it("rolls back task/version/event/audit/idempotency when mandatory event insertion fails", async () => {
    const t = await draft(),
      input = editInput(t);
    const trigger = `edit_rollback_${randomUUID().replaceAll("-", "")}`;
    await admin.query(
      `CREATE FUNCTION impuls.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_id='${t.id}'::uuid AND NEW.kind='edited' THEN RAISE EXCEPTION 'Synthetic rollback test'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON impuls.task_events FOR EACH ROW EXECUTE FUNCTION impuls.${trigger}()`,
    );
    try {
      await expect(editTask(runtime, input)).rejects.toThrow(
        "Synthetic rollback test",
      );
    } finally {
      await admin.query(
        `DROP TRIGGER ${trigger} ON impuls.task_events; DROP FUNCTION impuls.${trigger}()`,
      );
    }
    expect(
      (
        await admin.query(
          "SELECT title,version FROM impuls.tasks WHERE id=$1",
          [t.id],
        )
      ).rows[0],
    ).toEqual({ title: fields.title, version: 1 });
    expect(await count("task_events", t.id)).toBe(1);
    expect(await count("audit_events", t.id)).toBe(1);
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.idempotency_records WHERE actor_id=$1 AND key=$2",
          [manager, input.idempotencyKey],
        )
      ).rowCount,
    ).toBe(0);
    expect((await editTask(runtime, input)).kind).toBe("ok");
  });
  it("rejects permission expiry after waiting for a task lock without leaving changes", async () => {
    const t = await draft(),
      input = cancelInput(t);
    const blocker = await admin.connect();
    await admin.query(
      "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '1 second' WHERE user_id=$1 AND action='task.cancel'",
      [manager],
    );
    // Changes to rights revoke old sessions, so create a fresh session after setting expiry.
    await admin.query("DELETE FROM impuls.sessions WHERE user_id=$1", [
      manager,
    ]);
    await admin.query(
      "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
      [manager, hashes[0]],
    );
    let waiting: Promise<Awaited<ReturnType<typeof cancelTask>>> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM impuls.tasks WHERE id=$1 FOR UPDATE",
        [t.id],
      );
      waiting = cancelTask(runtime, input);
      for (let i = 0; i < 100; i++) {
        const locked = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%SELECT t.scope_id%' AND pid<>pg_backend_pid()",
        );
        if (locked.rowCount) break;
        if (i === 99) throw new Error("No task lock wait observed");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await blocker.query("ROLLBACK");
      expect((await waiting).kind).toBe("not_found");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (waiting) await waiting;
      await admin.query(
        "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1 AND action='task.cancel'",
        [manager],
      );
      await admin.query("DELETE FROM impuls.sessions WHERE user_id=$1", [
        manager,
      ]);
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [manager, hashes[0]],
      );
    }
    expect(
      (
        await admin.query(
          "SELECT status,version FROM impuls.tasks WHERE id=$1",
          [t.id],
        )
      ).rows[0],
    ).toEqual({ status: "draft", version: 1 });
  });
  it.skipIf(!process.env.TEST_APP_ORIGIN || !process.env.CSRF_SECRET)(
    "HTTP validates Origin/CSRF/body/key, replay, conflict and shared rate limit",
    async () => {
      const origin = process.env.TEST_APP_ORIGIN!;
      const t = await draft();
      const headers = {
        Origin: origin,
        Cookie: `impuls_session=${tokens[0]}`,
        "X-CSRF-Token": createCsrfToken(tokens[0]!, process.env.CSRF_SECRET!),
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      };
      const send = async (
        action: string,
        data: unknown,
        h: Record<string, string> = headers,
      ) =>
        fetch(`${origin}/api/v1/tasks/${t.id}/${action}`, {
          method: "POST",
          headers: h,
          body: JSON.stringify(data),
        });
      expect(
        (
          await send("cancel", cancelInput(t).data, {
            ...headers,
            Origin: "https://invalid.example",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await send("edit", editInput(t).data, {
            ...headers,
            "X-CSRF-Token": "wrong",
          })
        ).status,
      ).toBe(403);
      expect(
        (await send("edit", { ...editInput(t).data, scopeId: neighbour }))
          .status,
      ).toBe(400);
      expect(
        (await send("cancel", { expectedVersion: 1, reason: " " })).status,
      ).toBe(400);
      expect(
        (
          await send("cancel", cancelInput(t).data, {
            ...headers,
            "Idempotency-Key": "bad",
          })
        ).status,
      ).toBe(400);
      const body = editInput(t).data;
      const first = await send("edit", body);
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toContain("no-store");
      const payload = await first.json();
      expect(await (await send("edit", body)).json()).toEqual(payload);
      expect(
        (await send("edit", { ...body, reason: "Other body" })).status,
      ).toBe(409);
      const cancelBody = {
        expectedVersion: 2,
        reason: "Synthetic HTTP cancellation",
      };
      const cancelHeaders = { ...headers, "Idempotency-Key": randomUUID() };
      expect((await send("cancel", cancelBody, cancelHeaders)).status).toBe(
        200,
      );
      expect((await send("cancel", cancelBody, cancelHeaders)).status).toBe(
        200,
      );
      await admin.query(
        "UPDATE impuls.task_mutation_limits SET attempts=30 WHERE actor_id=$1",
        [manager],
      );
      const limited = await send("cancel", cancelBody, cancelHeaders);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await count("task_events", t.id)).toBe(3);
    },
  );
  it.skipIf(!process.env.TEST_APP_ORIGIN)(
    "browser edits and cancels through real API and confirms persisted snapshots",
    async () => {
      const t = await draft(`Synthetic browser draft ${randomUUID()}`);
      // Reset the synthetic limit consumed by the preceding HTTP limit test.
      await admin.query(
        "DELETE FROM impuls.task_mutation_limits WHERE actor_id=$1",
        [manager],
      );
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 820 },
          reducedMotion: "reduce",
        });
        const origin = process.env.TEST_APP_ORIGIN!;
        await context.addCookies([
          {
            name: "impuls_session",
            value: tokens[0]!,
            url: origin,
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        // Подробности задачи свёрнуты; сценарию нужны кнопки правки и отмены.
        await page.addInitScript(() => {
          new MutationObserver(() => {
            for (const d of document.querySelectorAll(
              "details.task-mgmt__details:not([open])",
            ))
              d.open = true;
          }).observe(document, { childList: true, subtree: true });
        });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("dialog", (d) => d.accept());
        await page.route(
          "https://telegram.org/js/telegram-web-app.js",
          (route) =>
            route.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){}}}",
            }),
        );
        await page.goto(origin);
        await page
          .getByRole("heading", { name: "Доступ подтверждён", exact: true })
          .waitFor()
          .catch(async (error) => {
            throw new Error(
              `${String(error)}; visible screen: ${await page.locator("main").innerText()}`,
            );
          });
        await page.getByRole("button", { name: "Ещё", exact: true }).click();
        await page
          .getByRole("button", { name: "Постановка задач", exact: true })
          .click();
        await page
          .getByRole("heading", {
            name: "Все задачи",
            exact: true,
          })
          .waitFor();
        await page
          .getByRole("heading", { name: "Новая задача", exact: true })
          .waitFor();
        await page.locator(".task-mgmt__item").first().waitFor();
        if (
          (await page
            .getByRole("heading", { name: t.title, exact: true })
            .count()) === 0
        )
          await page
            .getByRole("button", { name: "Показать ещё", exact: true })
            .click();
        const row = page
          .locator(".task-mgmt__item")
          .filter({
            has: page.getByRole("heading", { name: t.title, exact: true }),
          })
          .first();
        await row
          .getByRole("button", { name: "Редактировать черновик", exact: true })
          .click();
        const form = row.getByRole("form", {
          name: "Редактирование черновика",
          exact: true,
        });
        const title = `Synthetic browser edit ${t.id}`;
        await form.getByLabel("Название", { exact: true }).fill(title);
        await form.getByLabel("Фонд XP", { exact: true }).fill("31");
        await form
          .getByLabel("Причина изменения", { exact: true })
          .fill("Synthetic browser correction");
        await form
          .getByRole("button", { name: "Сохранить изменения", exact: true })
          .click();
        await page
          .getByText("Изменения черновика сохранены.", { exact: true })
          .waitFor();
        const edited = page.locator(".task-mgmt__item").filter({
          has: page.getByRole("heading", { name: title, exact: true }),
        });
        await edited
          .getByRole("button", { name: "Отменить задачу", exact: true })
          .click();
        await edited
          .getByLabel("Причина отмены", { exact: true })
          .fill("Synthetic browser cancellation");
        await edited
          .getByRole("button", { name: "Подтвердить отмену", exact: true })
          .click();
        await page.getByText(/Задача отменена\. Отчёты/).waitFor();
        expect(
          (
            await admin.query(
              "SELECT title,status,version,fund_xp FROM impuls.tasks WHERE id=$1",
              [t.id],
            )
          ).rows[0],
        ).toEqual({ title, status: "cancelled", version: 3, fund_xp: 31 });
        expect(
          (
            await admin.query(
              "SELECT kind,reason FROM impuls.task_events WHERE task_id=$1 ORDER BY task_version",
              [t.id],
            )
          ).rows,
        ).toEqual([
          { kind: "created", reason: null },
          { kind: "edited", reason: "Synthetic browser correction" },
          { kind: "cancelled", reason: "Synthetic browser cancellation" },
        ]);
        expect(await count("ledger_entries", t.id)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    30000,
  );
  afterAll(async () => {
    await admin.query(
      "DELETE FROM impuls.notification_outbox WHERE task_id=ANY($1::uuid[]) OR review_id IN (SELECT id FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[])))",
      [tasks],
    );
    await admin.query(
      "DELETE FROM impuls.audit_events WHERE task_id=ANY($1::uuid[]) OR review_id IN (SELECT id FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[])))",
      [tasks],
    );
    await admin.query(
      "DELETE FROM impuls.ledger_entries WHERE task_id=ANY($1::uuid[])",
      [tasks],
    );
    await admin.query(
      "DELETE FROM impuls.account_balances WHERE user_id=ANY($1::uuid[])",
      [users],
    );
    await admin.query(
      "DELETE FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[]))",
      [tasks],
    );
    await admin.query(
      "DELETE FROM impuls.submissions WHERE task_id=ANY($1::uuid[])",
      [tasks],
    );
    await admin.query(
      "DELETE FROM impuls.task_assignments WHERE task_id=ANY($1::uuid[])",
      [tasks],
    );
    await admin.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
      tasks,
    ]);
    await admin.query(
      "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
      [users],
    );
    await admin.query(
      "DELETE FROM impuls.task_mutation_limits WHERE actor_id=ANY($1::uuid[])",
      [users],
    );
    await admin.query(
      "DELETE FROM impuls.task_scope_members WHERE scope_id=$1",
      [scope],
    );
    await admin.query(
      "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
      [users],
    );
    await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rule]);
    await admin.query(
      "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
      [[scope, neighbour]],
    );
    await admin.query(
      "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
      [users],
    );
    await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
      users,
    ]);
    await runtime.end();
    await admin.end();
  });
});
