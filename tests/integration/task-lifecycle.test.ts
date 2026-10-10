import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTask,
  assignTask,
  listManagedTasks,
  readTaskManagementOptions,
} from "../../packages/domain/src/tasks/manage";
import { mutateAssignedTask } from "../../packages/domain/src/tasks/write";
import { reviewTaskSubmission } from "../../packages/domain/src/tasks/reviews";
import { readTaskTimeline } from "../../packages/domain/src/tasks/timeline";
import { readAssignedTaskHistory } from "../../packages/domain/src/tasks/history";
import { taskTimelineResponseSchema } from "../../packages/contracts/src/task-timeline";
import { createCsrfToken } from "../../packages/domain/src/auth/session";

const url = process.env.TEST_DATABASE_URL;
const origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F02/F03 immutable lifecycle and independent scoped view",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
      max: 8,
    });
    const users = Array.from({ length: 5 }, () => randomUUID());
    const [manager, owner, viewer, neighbourViewer, adminOnly] = users as [
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
    const scopes = [randomUUID(), randomUUID()];
    const scope = scopes[0]!;
    const rules = randomUUID(),
      ruleVersion = randomInt(1_000_000, 2_000_000_000);
    const tasks: string[] = [];
    let acceptedTask: string;
    async function sessions() {
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      for (const [i, user] of users.entries())
        await admin.query(
          "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
          [user, hashes[i]],
        );
    }
    beforeAll(async () => {
      for (const [i, user] of users.entries())
        await admin.query(
          "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,$3,true)",
          [
            user,
            randomInt(7_000_000_000_000, 8_000_000_000_000),
            `Synthetic lifecycle user ${i}`,
          ],
        );
      for (const id of scopes)
        await admin.query(
          "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'group','Synthetic lifecycle scope')",
          [id],
        );
      await admin.query(
        `INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by)
      VALUES ($1,$2,'{"mode":"synthetic","timeZone":"Europe/Moscow","acceptance":{"enabled":true}}',clock_timestamp()-interval '1 minute',$3)`,
        [rules, ruleVersion, manager],
      );
      await admin.query(
        `INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason) VALUES
      ($1,'task.create',$2,$1,'Synthetic'),($1,'task.assign',$2,$1,'Synthetic'),($1,'task.review',$2,$1,'Synthetic'),
      ($3,'task.view',$2,$1,'Synthetic'),($4,'task.view',$5,$1,'Synthetic'),($6,'admin.access',$2,$1,'Synthetic')`,
        [manager, scope, viewer, neighbourViewer, scopes[1], adminOnly],
      );
      await admin.query(
        "INSERT INTO impuls.task_scope_members (user_id,scope_id) VALUES ($1,$2)",
        [owner, scope],
      );
      await sessions();
    });
    afterAll(async () => {
      try {
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
          "DELETE FROM impuls.task_scope_members WHERE scope_id=ANY($1::uuid[])",
          [scopes],
        );
        await admin.query(
          "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
          [users],
        );
        await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rules]);
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
        await Promise.all([admin.end(), runtime.end()]);
      }
    });
    function createInput() {
      return {
        actorId: manager,
        sessionHash: hashes[0]!,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        enabled: true,
        data: {
          scopeId: scope,
          ruleSetId: rules,
          title: "Synthetic lifecycle task",
          criteria: "Independent completion proof",
          categoryCode: "test",
          priority: "normal" as const,
          dueAt: "2035-01-01T00:00:00.000Z",
          fundXp: 23,
          fundPoints: 11,
        },
      };
    }
    async function makeTask() {
      const result = await createTask(runtime, createInput());
      if (result.kind !== "ok")
        throw new Error(`Create failed: ${result.kind}`);
      tasks.push(result.response.task.id);
      return result.response.task.id;
    }
    async function assign(taskId: string) {
      const result = await assignTask(runtime, {
        actorId: manager,
        sessionHash: hashes[0]!,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        enabled: true,
        taskId,
        data: { assigneeId: owner, expectedVersion: 1 },
      });
      expect(result.kind).toBe("ok");
    }
    function mutation(taskId: string, expectedVersion: number) {
      return {
        taskId,
        expectedVersion,
        actorId: owner,
        sessionHash: hashes[1]!,
        idempotencyKey: randomUUID(),
      };
    }
    async function timeline(
      taskId: string,
      actor = 1,
      cursor?: number,
      limit = 50,
    ) {
      const result = await readTaskTimeline(
        runtime,
        users[actor]!,
        hashes[actor]!,
        taskId,
        { cursor, limit },
      );
      if (result.kind !== "ok")
        throw new Error(`Timeline failed: ${result.kind}`);
      return taskTimelineResponseSchema.parse(result.response);
    }
    it("records the independent eight-transition cycle once, including repeated starts, saved funds and actors", async () => {
      const taskId = (acceptedTask = await makeTask());
      await assign(taskId);
      expect(
        (
          await mutateAssignedTask(runtime, {
            ...mutation(taskId, 2),
            action: "start",
          })
        ).kind,
      ).toBe("ok");
      for (const [expectedVersion, action] of [
        [3, "return"],
        [6, "accept"],
      ] as const) {
        const submit = {
          ...mutation(taskId, expectedVersion),
          action: "submit" as const,
          text: `Independent report ${expectedVersion}`,
        };
        const result = await mutateAssignedTask(runtime, submit);
        expect(result.kind).toBe("ok");
        expect(await mutateAssignedTask(runtime, submit)).toEqual(result);
        if (result.kind !== "ok" || !result.response.submission)
          throw new Error("No submission");
        const review = {
          actorId: manager,
          sessionHash: hashes[0]!,
          submissionId: result.response.submission.id,
          expectedVersion: expectedVersion + 1,
          reason: `Independent ${action} reason`,
          idempotencyKey: randomUUID(),
          requestId: randomUUID(),
          action,
          allowSyntheticAccrual: true,
        };
        const decision = await reviewTaskSubmission(runtime, review);
        expect(decision.kind).toBe("ok");
        expect(await reviewTaskSubmission(runtime, review)).toEqual(decision);
        if (action === "return")
          expect(
            (
              await mutateAssignedTask(runtime, {
                ...mutation(taskId, 5),
                action: "start",
              })
            ).kind,
          ).toBe("ok");
      }
      const data = await timeline(taskId);
      expect(
        data.items.map((e) => [e.taskVersion, e.kind, e.status, e.actor?.id]),
      ).toEqual([
        [8, "accepted", "accepted", manager],
        [7, "submitted", "in_review", owner],
        [6, "started", "in_progress", owner],
        [5, "returned", "needs_work", manager],
        [4, "submitted", "in_review", owner],
        [3, "started", "in_progress", owner],
        [2, "assigned", "assigned", manager],
        [1, "created", "draft", manager],
      ]);
      expect(
        data.items.every(
          (e) =>
            e.fundXp === 23 &&
            e.fundPoints === 11 &&
            e.ruleVersion === ruleVersion,
        ),
      ).toBe(true);
      expect(data.items.at(-1)!.assignee).toBeNull();
      expect(data.items[0]!.assignee?.id).toBe(owner);
      const ledger = await admin.query(
        "SELECT currency,amount FROM impuls.ledger_entries WHERE task_id=$1 ORDER BY currency",
        [taskId],
      );
      expect(ledger.rows).toEqual([
        { currency: "points", amount: 11 },
        { currency: "xp", amount: 23 },
      ]);
      const history = await readAssignedTaskHistory(
        runtime,
        viewer,
        hashes[2]!,
        taskId,
      );
      expect(history.kind).toBe("ok");
      if (history.kind === "ok")
        expect(
          history.response.items.map((e) => [e.text, e.review?.reason]),
        ).toEqual([
          ["Independent report 6", "Independent accept reason"],
          ["Independent report 3", "Independent return reason"],
        ]);
    });
    it("paginates deterministically by version when event timestamps are equal", async () => {
      await admin.query(
        "UPDATE impuls.task_events SET created_at='2026-10-01T10:00:00Z' WHERE task_id=$1",
        [acceptedTask],
      );
      let cursor: number | undefined;
      const versions: number[] = [];
      do {
        const page = await timeline(acceptedTask, 2, cursor, 3);
        versions.push(...page.items.map((e) => e.taskVersion));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(versions).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
      expect((await timeline(acceptedTask, 2, 1)).items).toEqual([]);
    });
    it("requires view for another participant history and exposes view-only choices without mutation rights", async () => {
      for (const actor of [0, 3, 4]) {
        expect(
          await readTaskTimeline(
            runtime,
            users[actor]!,
            hashes[actor]!,
            acceptedTask,
          ),
        ).toEqual({ kind: "not_found" });
        expect(
          await readAssignedTaskHistory(
            runtime,
            users[actor]!,
            hashes[actor]!,
            acceptedTask,
          ),
        ).toEqual({ kind: "not_found" });
      }
      expect(
        await readTaskTimeline(runtime, viewer, hashes[2]!, randomUUID()),
      ).toEqual({ kind: "not_found" });
      const options = await readTaskManagementOptions(runtime, viewer, {
        enabled: true,
      });
      expect(options).toMatchObject({
        scopes: [
          { id: scope, canCreate: false, canAssign: false, assignees: [] },
        ],
        ruleSets: [],
      });
      expect(
        (await listManagedTasks(runtime, viewer)).items.map((t) => t.id),
      ).toContain(acceptedTask);
      expect(
        await createTask(runtime, {
          ...createInput(),
          actorId: viewer,
          sessionHash: hashes[2]!,
        }),
      ).toEqual({ kind: "not_found" });
    });
    it("checks expiry/revocation/actor-session pairing on every history read", async () => {
      expect(
        await readTaskTimeline(runtime, viewer, hashes[1]!, acceptedTask),
      ).toEqual({ kind: "unauthorized" });
      for (const [change, kind] of [
        ["expires_at=clock_timestamp()-interval '1 second'", "unauthorized"],
        ["revoked_at=clock_timestamp()", "revoked"],
      ]) {
        await admin.query(
          `UPDATE impuls.sessions SET ${change} WHERE user_id=$1`,
          [viewer],
        );
        expect(
          await readTaskTimeline(runtime, viewer, hashes[2]!, acceptedTask),
        ).toEqual({ kind });
        await sessions();
      }
      await admin.query(
        "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()-interval '1 second',valid_from=clock_timestamp()-interval '1 day' WHERE user_id=$1",
        [viewer],
      );
      await sessions();
      expect(
        await readTaskTimeline(runtime, viewer, hashes[2]!, acceptedTask),
      ).toEqual({ kind: "not_found" });
      await admin.query(
        "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1",
        [viewer],
      );
      await sessions();
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [viewer],
      );
      expect(
        await readTaskTimeline(runtime, viewer, hashes[2]!, acceptedTask),
      ).toEqual({ kind: "revoked" });
      await sessions();
      expect(
        await readTaskTimeline(runtime, viewer, hashes[2]!, acceptedTask),
      ).toEqual({ kind: "not_found" });
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1",
        [viewer],
      );
      await sessions();
    });
    it("has immutable runtime ACL/RLS and prevents runtime from fabricating migration snapshots", async () => {
      const acl =
        await runtime.query(`SELECT has_table_privilege(current_user,'impuls.task_events','SELECT') AS read,
      has_table_privilege(current_user,'impuls.task_events','INSERT') AS insert,
      has_table_privilege(current_user,'impuls.task_events','UPDATE') AS update,
      has_table_privilege(current_user,'impuls.task_events','DELETE') AS delete,
      has_table_privilege(current_user,'impuls.task_events','TRUNCATE') AS truncate,
      (SELECT relrowsecurity FROM pg_class WHERE oid='impuls.task_events'::regclass) AS rls`);
      expect(acl.rows[0]).toEqual({
        read: true,
        insert: true,
        update: false,
        delete: false,
        truncate: false,
        rls: true,
      });
      for (const sql of [
        "UPDATE impuls.task_events SET fund_xp=999",
        "DELETE FROM impuls.task_events",
        "TRUNCATE impuls.task_events",
      ])
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      await expect(
        runtime.query(
          `INSERT INTO impuls.task_events (task_id,task_version,kind,status,rule_set_id,fund_xp,fund_points)
      VALUES ($1,99,'snapshot','accepted',$2,0,0)`,
          [acceptedTask, rules],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("serializes simultaneous start intents and keeps replay from adding events", async () => {
      const taskId = await makeTask();
      await assign(taskId);
      const input = { ...mutation(taskId, 2), action: "start" as const };
      const results = await Promise.all([
        mutateAssignedTask(runtime, input),
        mutateAssignedTask(runtime, input),
      ]);
      expect(results[0]!.kind).toBe("ok");
      expect(results[1]).toEqual(results[0]);
      const secondTask = await makeTask();
      await assign(secondTask);
      const competing = await Promise.all([
        mutateAssignedTask(runtime, {
          ...mutation(secondTask, 2),
          action: "start",
        }),
        mutateAssignedTask(runtime, {
          ...mutation(secondTask, 2),
          action: "start",
        }),
      ]);
      expect(competing.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      expect((await timeline(taskId)).items.map((e) => e.kind)).toEqual([
        "started",
        "assigned",
        "created",
      ]);
    });
    it("rolls back task, event and idempotency when an event cannot be inserted", async () => {
      const taskId = await makeTask();
      await assign(taskId);
      // Admin creates a version collision independently of the business operation.
      await admin.query(
        `INSERT INTO impuls.task_events (task_id,task_version,kind,actor_id,status,rule_set_id,fund_xp,fund_points)
      VALUES ($1,3,'started',$2,'in_progress',$3,23,11)`,
        [taskId, owner, rules],
      );
      const input = { ...mutation(taskId, 2), action: "start" as const };
      await expect(mutateAssignedTask(runtime, input)).rejects.toMatchObject({
        code: "23505",
      });
      expect(
        (
          await admin.query(
            "SELECT status,version FROM impuls.tasks WHERE id=$1",
            [taskId],
          )
        ).rows[0],
      ).toEqual({ status: "assigned", version: 2 });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM impuls.idempotency_records WHERE key=$1",
            [input.idempotencyKey],
          )
        ).rows[0],
      ).toEqual({ n: 0 });
      await admin.query(
        "DELETE FROM impuls.task_events WHERE task_id=$1 AND task_version=3",
        [taskId],
      );
      expect((await mutateAssignedTask(runtime, input)).kind).toBe("ok");
    });
    it("refuses a saved start response after session expiry during a real task-lock wait", async () => {
      const taskId = await makeTask();
      await assign(taskId);
      const input = { ...mutation(taskId, 2), action: "start" as const };
      expect((await mutateAssignedTask(runtime, input)).kind).toBe("ok");
      const blocker = await admin.connect();
      let pending: ReturnType<typeof mutateAssignedTask> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM impuls.tasks WHERE id=$1 FOR UPDATE",
          [taskId],
        );
        await admin.query(
          "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
          [owner],
        );
        pending = mutateAssignedTask(runtime, input);
        let waited = false;
        for (let i = 0; i < 100; i++) {
          if (
            (
              await admin.query(
                "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF t%' AND pid<>pg_backend_pid()",
              )
            ).rowCount
          ) {
            waited = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waited).toBe(true);
        await admin.query("SELECT pg_sleep(1.1)");
        await blocker.query("ROLLBACK");
        expect(await pending).toEqual({ kind: "unauthorized" });
        expect(
          (
            await admin.query(
              "SELECT count(*)::int n FROM impuls.task_events WHERE task_id=$1",
              [taskId],
            )
          ).rows[0],
        ).toEqual({ n: 3 });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
        await sessions();
      }
    });
    it.skipIf(!origin)(
      "serves real HTTP contracts, refuses invalid/hidden reads without data, and never trusts query actors",
      async () => {
        const get = (path: string, actor = 2) =>
          fetch(`${origin}/api/v1/tasks/${path}`, {
            headers: { Cookie: `impuls_session=${tokens[actor]}` },
          });
        const response = await get(`${acceptedTask}/timeline?limit=3`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-request-id")).toBeTruthy();
        const first = taskTimelineResponseSchema.parse(await response.json());
        expect(first.items.map((e) => e.taskVersion)).toEqual([8, 7, 6]);
        expect((await get(`${acceptedTask}/history`)).status).toBe(200);
        for (const query of [
          "userId=any",
          "cursor=0",
          "cursor=1.5",
          "limit=51",
          "limit=2&limit=3",
          "cursor=2147483648",
        ])
          expect((await get(`${acceptedTask}/timeline?${query}`)).status).toBe(
            400,
          );
        for (const path of ["bad-id/timeline", `${randomUUID()}/timeline`])
          expect((await get(path)).status).toBe(404);
        for (const actor of [0, 3, 4]) {
          const denied = await get(`${acceptedTask}/timeline`, actor);
          expect(denied.status).toBe(404);
          expect(await denied.json()).toMatchObject({ code: "NOT_FOUND" });
        }
        expect(
          (await fetch(`${origin}/api/v1/tasks/${acceptedTask}/timeline`))
            .status,
        ).toBe(401);
        const csrf = createCsrfToken(tokens[2]!, process.env.CSRF_SECRET!);
        const post = await fetch(`${origin}/api/v1/tasks`, {
          method: "POST",
          headers: {
            Cookie: `impuls_session=${tokens[2]}`,
            Origin: origin!,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(createInput().data),
        });
        expect(post.status).toBe(404);
      },
    );
    it.skipIf(!origin)(
      "renders database-backed view-only history and clears protected records after access revocation",
      async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          viewport: { width: 390, height: 740 },
          reducedMotion: "reduce",
        });
        try {
          await context.addCookies([
            { name: "impuls_session", value: tokens[2]!, url: origin! },
          ]);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.route(
            "https://telegram.org/js/telegram-web-app.js",
            (route) =>
              route.fulfill({
                contentType: "application/javascript",
                body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}",
              }),
          );
          await page.goto(origin!);
          await page.getByRole("button", { name: "Ещё", exact: true }).click();
          await page
            .getByRole("button", { name: "Задачи и история", exact: true })
            .click();
          const row = page
            .locator(".task-mgmt__item")
            .filter({ has: page.getByText("Принята", { exact: true }) });
          await row
            .getByRole("button", { name: "История задачи", exact: true })
            .click();
          await row
            .getByRole("heading", {
              name: "Результат принят · версия 8",
              exact: true,
            })
            .waitFor();
          expect(await row.locator(".task-timeline li").count()).toBe(8);
          expect(
            await page
              .getByRole("button", { name: "Создать черновик", exact: true })
              .count(),
          ).toBe(0);
          await row
            .getByRole("button", {
              name: "История отчётов и решений",
              exact: true,
            })
            .click();
          await row
            .getByText("Independent accept reason", { exact: false })
            .waitFor();
          await admin.query(
            "UPDATE impuls.users SET active=false WHERE id=$1",
            [viewer],
          );
          await row
            .getByRole("button", { name: "Обновить события", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Доступ отозван", exact: true })
            .waitFor();
          expect(await page.locator(".task-timeline").count()).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
            viewer,
          ]);
          await context.close();
          await browser.close();
        }
      },
      25000,
    );
  },
);
