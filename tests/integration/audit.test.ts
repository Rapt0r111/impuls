import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readAudit } from "../../packages/domain/src/admin/audit";
import {
  createTask,
  editTask,
  assignTask,
  cancelTask,
  type CreateTaskData,
  type TaskManagementResult,
} from "../../packages/domain/src/tasks/manage";
import { mutateAssignedTask } from "../../packages/domain/src/tasks/write";
import { reviewTaskSubmission } from "../../packages/domain/src/tasks/reviews";
import { reverseAcceptance } from "../../packages/domain/src/ledger/corrections";
import {
  auditQuerySchema,
  auditResponseSchema,
} from "../../packages/contracts/src/audit";
import { selectOption } from "../browser/select-option.mjs";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)("F07 exact-scope synthetic audit", () => {
  const admin = new Pool({ connectionString: url }),
    runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
    });
  const users = Array.from({ length: 4 }, () => randomUUID()),
    scopes = Array.from({ length: 3 }, () => randomUUID());
  const actor = users[0]!,
    participant = users[1]!,
    scope = scopes[0]!,
    neighbour = scopes[1]!,
    parent = scopes[2]!;
  const tokens = users.map(() => randomBytes(32).toString("base64url")),
    hashes = tokens.map((t) => createHash("sha256").update(t).digest());
  const rule = randomUUID(),
    realRule = randomUUID(),
    tasks: string[] = [];
  let expectedIds: string[] = [],
    correctionId = "";
  const read = (extra: Parameters<typeof readAudit>[3] = {}, index = 0) =>
    readAudit(runtime, users[index]!, hashes[index]!, {
      allowSyntheticAudit: true,
      scope,
      ...extra,
    });
  const base = () => ({
    actorId: actor,
    sessionHash: hashes[0]!,
    enabled: true,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
  });
  const data = (title: string, atScope = scope): CreateTaskData => ({
    scopeId: atScope,
    ruleSetId: rule,
    title,
    criteria: "Independent audit criterion",
    categoryCode: "test",
    priority: "normal",
    dueAt: "2035-01-01T00:00:00.000Z",
    fundXp: 17,
    fundPoints: 9,
  });
  function taskResult(r: TaskManagementResult) {
    if (r.kind !== "ok") throw new Error(r.kind);
    return r.response.task;
  }
  beforeAll(async () => {
    for (const [i, u] of users.entries())
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
        [u, randomInt(6e12, 7e12), `Synthetic auditor ${i}`],
      );
    for (const [i, s] of scopes.entries())
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,$2,$3)",
        [s, i === 2 ? "rota" : "group", `Synthetic audit area ${i}`],
      );
    for (const s of [scope, neighbour])
      for (const action of [
        "task.create",
        "task.assign",
        "task.edit",
        "task.cancel",
        "task.review",
        "ledger.correct",
      ])
        await admin.query(
          "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic audit fixture')",
          [actor, action, s],
        );
    for (const [u, s] of [
      [actor, scope],
      [users[3], neighbour],
      [users[3], parent],
    ])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'admin.audit',$2,$1,'Synthetic audit fixture')",
        [u, s],
      );
    for (const action of [
      "admin.access",
      "admin.rules",
      "admin.catalog",
      "task.view",
      "task.review",
      "ledger.correct",
    ])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Does not grant audit')",
        [users[2], action, scope],
      );
    await admin.query(
      "INSERT INTO impuls.task_scope_members(scope_id,user_id) VALUES($1,$2)",
      [scope, participant],
    );
    for (const [r, mode] of [
      [rule, "synthetic"],
      [realRule, "production"],
    ])
      await admin.query(
        "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,$3::jsonb,now()-interval '1 minute',$4)",
        [
          r,
          randomInt(1e6, 2e9),
          JSON.stringify({
            mode,
            timeZone: "Europe/Moscow",
            acceptance: { enabled: true },
          }),
          actor,
        ],
      );
    for (const [i, u] of users.entries())
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [u, hashes[i]],
      );
    for (let i = 0; i < 25; i++)
      tasks.push(
        taskResult(
          await createTask(runtime, {
            ...base(),
            data: data(`Synthetic audit task ${i}`),
          }),
        ).id,
      );
    let current = taskResult(
      await editTask(runtime, {
        ...base(),
        taskId: tasks[0]!,
        data: {
          ...data("Synthetic revised title"),
          expectedVersion: 1,
          reason: "Recorded draft change",
        },
      }),
    );
    current = taskResult(
      await assignTask(runtime, {
        ...base(),
        taskId: current.id,
        data: { expectedVersion: current.version, assigneeId: participant },
      }),
    );
    let write = await mutateAssignedTask(runtime, {
      action: "start",
      taskId: current.id,
      actorId: participant,
      sessionHash: hashes[1]!,
      expectedVersion: current.version,
      idempotencyKey: randomUUID(),
    });
    if (write.kind !== "ok") throw new Error(write.kind);
    let taskVersion = write.response.task.version;
    for (const action of ["return", "accept"] as const) {
      if (action === "accept") {
        write = await mutateAssignedTask(runtime, {
          action: "start",
          taskId: current.id,
          actorId: participant,
          sessionHash: hashes[1]!,
          expectedVersion: taskVersion,
          idempotencyKey: randomUUID(),
        });
        if (write.kind !== "ok") throw new Error(write.kind);
        taskVersion = write.response.task.version;
      }
      write = await mutateAssignedTask(runtime, {
        action: "submit",
        taskId: current.id,
        actorId: participant,
        sessionHash: hashes[1]!,
        expectedVersion: taskVersion,
        idempotencyKey: randomUUID(),
        text: "Synthetic report for audit evidence",
      });
      if (write.kind !== "ok" || !write.response.submission)
        throw new Error(write.kind);
      const review = await reviewTaskSubmission(runtime, {
        actorId: actor,
        sessionHash: hashes[0]!,
        submissionId: write.response.submission.id,
        expectedVersion: write.response.task.version,
        idempotencyKey: randomUUID(),
        reason: `Recorded ${action}`,
        action,
        allowSyntheticAccrual: true,
      });
      if (review.kind !== "ok") throw new Error(review.kind);
      taskVersion = review.response.task.version;
      if (action === "accept") {
        const reversed = await reverseAcceptance(runtime, {
          actorId: actor,
          sessionHash: hashes[0]!,
          reviewId: review.response.review.id,
          expectedVersion: 1,
          reason: "Recorded correction",
          idempotencyKey: randomUUID(),
          allowSyntheticCorrections: true,
        });
        if (reversed.kind !== "ok") throw new Error(reversed.kind);
        correctionId = reversed.response.correction.id;
      }
    }
    taskResult(
      await cancelTask(runtime, {
        ...base(),
        taskId: tasks[1]!,
        data: { expectedVersion: 1, reason: "Recorded cancellation" },
      }),
    );
    const primary = (
      await admin.query<{ id: string }>(
        "SELECT id FROM impuls.audit_events WHERE actor_id=$1",
        [actor],
      )
    ).rows
      .map((r) => r.id)
      .sort();
    expect(primary).toHaveLength(31);
    await admin.query(
      "UPDATE impuls.audit_events SET created_at='2026-10-02T09:00:00.123000Z' WHERE id=ANY($1::uuid[])",
      [primary],
    );
    await admin.query(
      "UPDATE impuls.audit_events SET created_at='2026-10-02T09:00:00.123002Z' WHERE id=$1",
      [primary[0]],
    );
    await admin.query(
      "UPDATE impuls.audit_events SET created_at='2026-10-02T09:00:00.123001Z' WHERE id=$1",
      [primary[1]],
    );
    expectedIds = [primary[0]!, primary[1]!, ...primary.slice(2).reverse()];
    // Fixture owner injects an unknown secret and malformed known values. Runtime cannot modify audit.
    await admin.query(
      "UPDATE impuls.audit_events SET diff=diff || $2::jsonb WHERE id=$1",
      [
        primary[0],
        JSON.stringify({
          token: "MUST_STAY_PRIVATE",
          sessionHash: "MUST_STAY_PRIVATE",
          xp: { raw: "private" },
          ruleVersion: 1.5,
        }),
      ],
    );
    tasks.push(
      taskResult(
        await createTask(runtime, {
          ...base(),
          data: data("Hidden neighbouring evidence", neighbour),
        }),
      ).id,
    );
    const nonSynthetic = randomUUID();
    tasks.push(nonSynthetic);
    await admin.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,'Non-synthetic hidden','Criterion','test','normal','draft',now(),0,0)",
      [nonSynthetic, scope, realRule, actor],
    );
    await admin.query(
      "INSERT INTO impuls.audit_events(actor_id,task_id,action,request_id,reason,diff,created_at,updated_at) VALUES($1,$2,'task.create',$3,'Non-synthetic hidden','{}',now(),now())",
      [actor, nonSynthetic, randomUUID()],
    );
  }, 30000);
  it("reads all seven committed actions with separate scope and typed evidence", async () => {
    const r = await read({ limit: 50 });
    if (r.kind !== "ok") throw new Error(r.kind);
    const page = auditResponseSchema.parse(r.response);
    expect(page.scopes).toEqual([
      { id: scope, name: "Synthetic audit area 0" },
    ]);
    expect(page.items.map((v) => v.id)).toEqual(expectedIds);
    expect(new Set(page.items.map((v) => v.action))).toEqual(
      new Set([
        "task.create",
        "task.edit",
        "task.assign",
        "task.return",
        "task.accept",
        "task.cancel",
        "ledger.correct",
      ]),
    );
    const correction = page.items.find((v) => v.correctionId === correctionId)!;
    expect(correction.values).toContainEqual({ field: "xpDelta", value: -17 });
    expect(correction.values).toContainEqual({
      field: "pointsDelta",
      value: -9,
    });
    const edit = page.items.find((v) => v.action === "task.edit")!;
    expect(edit.reason).toBe("Recorded draft change");
    expect(edit.values).toContainEqual({
      field: "title",
      value: "Synthetic revised title",
    });
    expect(edit.values.some((v) => v.field === "from")).toBe(false);
    expect(JSON.stringify(page)).not.toContain("MUST_STAY_PRIVATE");
    expect(
      page.items[0]!.values.some(
        (v) => v.field === "xp" || v.field === "ruleVersion",
      ),
    ).toBe(false);
  });
  it("paginates exact microseconds and equal timestamps without omissions or duplicates", async () => {
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const r = await read(
        auditQuerySchema.parse({
          scope,
          limit: "3",
          ...(cursor ? { cursor } : {}),
        }),
      );
      if (r.kind !== "ok") throw new Error(r.kind);
      ids.push(...r.response.items.map((v) => v.id));
      cursor = r.response.nextCursor;
    } while (cursor);
    expect(ids).toEqual(expectedIds);
    expect(new Set(ids).size).toBe(31);
  });
  it("filters actions and binds cursor to actor, exact scope, action and existing anchor", async () => {
    const filtered = await read({ action: "task.create", limit: 2 });
    if (filtered.kind !== "ok") throw new Error(filtered.kind);
    expect(filtered.response.items).toHaveLength(2);
    expect(
      filtered.response.items.every((v) => v.action === "task.create"),
    ).toBe(true);
    const cursor = auditQuerySchema.parse({
      cursor: filtered.response.nextCursor,
    }).cursor!;
    for (const modified of [
      { ...cursor, actor: users[1]! },
      { ...cursor, scope: neighbour },
      { ...cursor, action: "all" as const },
      { ...cursor, id: randomUUID() },
    ])
      expect(await read({ action: "task.create", cursor: modified })).toEqual({
        kind: "invalid_cursor",
      });
    expect(await read({ scope: neighbour })).toEqual({ kind: "not_found" });
    expect(await read({ scope: parent }, 3)).toMatchObject({
      kind: "ok",
      response: { items: [] },
    });
    expect(await read({}, 3)).toEqual({ kind: "not_found" });
  });
  it("does not infer audit from administrative, task, correction or participant authority", async () => {
    for (const index of [1, 2, 3])
      expect(await read({}, index)).toEqual({ kind: "not_found" });
    expect(await read({ allowSyntheticAudit: false })).toEqual({
      kind: "disabled",
    });
    expect(await readAudit(runtime, actor, hashes[0]!)).toEqual({
      kind: "disabled",
    });
    await expect(
      runtime.query(
        "UPDATE impuls.audit_events SET reason='not allowed' WHERE false",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("DELETE FROM impuls.audit_events WHERE false"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await admin.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='impuls.audit_events'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true });
  });
  it("rechecks future/expired bindings, revoked permissions, access and session ownership", async () => {
    expect(
      await readAudit(runtime, actor, hashes[1]!, {
        scope,
        allowSyntheticAudit: true,
      }),
    ).toEqual({ kind: "unauthorized" });
    for (const change of [
      "valid_from=now()+interval '1 day'",
      "valid_from=now()-interval '2 days',valid_until=now()-interval '1 day'",
      "revoked_at=now()",
    ]) {
      await admin.query(
        `UPDATE impuls.role_bindings SET ${change} WHERE user_id=$1 AND action='admin.audit'`,
        [actor],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [actor],
      );
      expect(await read()).toEqual({ kind: "not_found" });
      await admin.query(
        "UPDATE impuls.role_bindings SET valid_from=now()-interval '1 minute',valid_until=NULL,revoked_at=NULL WHERE user_id=$1 AND action='admin.audit'",
        [actor],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [actor],
      );
    }
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()+interval '1 hour',revoked_at=now() WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "revoked" });
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      actor,
    ]);
    expect(await read()).toEqual({ kind: "revoked" });
    await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
      actor,
    ]);
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
  });
  it.skipIf(!origin)(
    "serves protected no-store HTTP and Chromium to real PostgreSQL",
    async () => {
      const headers = { cookie: `impuls_session=${tokens[0]}` };
      const endpoint = `${origin}/api/v1/admin/audit`;
      const valid = await fetch(`${endpoint}?scope=${scope}`, { headers });
      expect(valid.status).toBe(200);
      expect(valid.headers.get("cache-control")).toBe("private, no-store");
      expect(auditResponseSchema.parse(await valid.json()).items).toHaveLength(
        20,
      );
      for (const query of [
        `scope=${scope}&scope=${scope}`,
        `scope=${scope}&actor=${actor}`,
        "limit=51",
        "action=admin.access",
        "cursor=bad",
      ])
        expect((await fetch(`${endpoint}?${query}`, { headers })).status).toBe(
          400,
        );
      expect(
        (await fetch(`${endpoint}?scope=${neighbour}`, { headers })).status,
      ).toBe(404);
      expect((await fetch(endpoint)).status).toBe(401);
      expect(
        (
          await fetch(endpoint, {
            headers: { cookie: `impuls_session=${tokens[2]}` },
          })
        ).status,
      ).toBe(404);
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 850 },
        });
        await context.addCookies([
          {
            name: "impuls_session",
            value: tokens[0]!,
            url: origin!,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
          r.fulfill({
            contentType: "application/javascript",
            body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
          }),
        );
        await page.goto(origin!);
        await page.getByRole("button", { name: "Ещё", exact: true }).click();
        await page
          .getByRole("button", { name: "Журнал действий", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Журнал действий", exact: true })
          .waitFor();
        await page.locator(".audit-list > li").first().waitFor();
        expect(await page.locator(".audit-list > li").count()).toBe(20);
        await page
          .getByRole("button", { name: "Более ранние действия" })
          .click();
        await page
          .getByRole("button", { name: "Более ранние действия" })
          .waitFor({ state: "hidden" });
        // The button label changes to loading before the next page arrives.
        await expect
          .poll(() => page.locator(".audit-list > li").count())
          .toBe(31);
        await selectOption(page, "Действие", "ledger.correct");
        await page.getByText("Recorded correction", { exact: false }).waitFor();
        expect(await page.locator(".audit-list > li").count()).toBe(1);
        await admin.query(
          "UPDATE impuls.role_bindings SET revoked_at=now() WHERE user_id=$1 AND action='admin.audit'",
          [actor],
        );
        await page.getByRole("button", { name: "Обновить журнал" }).click();
        await page.getByRole("heading", { name: "Доступ отозван" }).waitFor();
        expect(await page.locator(".audit-list").count()).toBe(0);
      } finally {
        await browser.close();
        await admin.query(
          "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND action='admin.audit'",
          [actor],
        );
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [actor],
        );
      }
    },
    30000,
  );
  afterAll(async () => {
    try {
      await admin.query(
        "DELETE FROM impuls.notification_outbox WHERE recipient_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.audit_events WHERE actor_id=$1", [
        actor,
      ]);
      await admin.query(
        "DELETE FROM impuls.user_achievements WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.ledger_entries WHERE task_id=ANY($1::uuid[]) AND kind='acceptance_reversal'",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.ledger_corrections WHERE user_id=ANY($1::uuid[])",
        [users],
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
        "DELETE FROM impuls.task_events WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.reviews WHERE submission_id IN(SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[]))",
        [tasks],
      );
      for (const table of ["submissions", "task_assignments"])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE task_id=ANY($1::uuid[])`,
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
        "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.task_scope_members WHERE scope_id=ANY($1::uuid[])",
        [scopes],
      );
      await admin.query(
        "DELETE FROM impuls.rule_sets WHERE id=ANY($1::uuid[])",
        [[rule, realRule]],
      );
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [scopes],
      );
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await runtime.end();
      await admin.end();
    }
  });
});
