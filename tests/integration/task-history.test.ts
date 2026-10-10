import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAssignedTaskHistory } from "../../packages/domain/src/tasks/history";
import { taskHistoryResponseSchema } from "../../packages/contracts/src/task-history";

const url = process.env.TEST_DATABASE_URL;
const origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F03 owned report history in PostgreSQL",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
    });
    const users = [randomUUID(), randomUUID(), randomUUID()];
    const [owner, other, reviewer] = users as [string, string, string];
    const tokens = users.map(() => randomBytes(32).toString("base64url"));
    const hashes = tokens.map((token) =>
      createHash("sha256").update(token).digest(),
    );
    const scope = randomUUID(),
      rules = randomUUID();
    const tasks = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const attempts: string[] = [];

    async function addAttempt(
      taskId: string,
      number: number,
      decision: "accept" | "return" | null,
    ) {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO impuls.submissions (id,task_id,author_id,attempt_number,text,created_at)
      VALUES ($1,$2,$3,$4,$5,'2026-09-30T08:00:00Z')`,
        [id, taskId, owner, number, `Synthetic attempt ${number}`],
      );
      if (decision)
        await admin.query(
          `INSERT INTO impuls.reviews (submission_id,reviewer_id,decision,reason,fund_xp,fund_points,base_xp,base_points,bonus_xp,bonus_points,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$5,$6,$7,$7,'2026-09-30T09:00:00Z')`,
          [
            id,
            reviewer,
            decision,
            `Independent reason ${number}`,
            decision === "accept" ? 19 : null,
            decision === "accept" ? 7 : null,
            decision === "accept" ? 0 : null,
          ],
        );
      return id;
    }
    beforeAll(async () => {
      for (const [i, id] of users.entries()) {
        await admin.query(
          "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,$3,true)",
          [
            id,
            randomInt(7_000_000_000_000, 8_000_000_000_000),
            `Synthetic history user ${i}`,
          ],
        );
        await admin.query(
          "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
          [id, hashes[i]],
        );
      }
      await admin.query(
        "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic history scope')",
        [scope],
      );
      await admin.query(
        `INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{"mode":"synthetic"}',now(),$3)`,
        [rules, randomInt(1_000_000, 2_000_000_000), reviewer],
      );
      for (const [i, id] of tasks.entries()) {
        await admin.query(
          `INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points)
        VALUES ($1,$2,$3,$4,$5,'Independent criteria','test','normal',$6,'2035-01-01',19,7)`,
          [
            id,
            scope,
            rules,
            reviewer,
            `Synthetic history task ${i}`,
            i === 0 ? "accepted" : i === 2 ? "needs_work" : "assigned",
          ],
        );
        await admin.query(
          "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
          [id, i === 3 ? other : owner],
        );
      }
      for (const number of [1, 2, 3])
        attempts.push(
          await addAttempt(
            tasks[0]!,
            number,
            number === 3 ? "accept" : "return",
          ),
        );
      for (const number of [1, 2, 3])
        await addAttempt(tasks[2]!, number, "return");
    });
    afterAll(async () => {
      try {
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
        await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rules]);
        await admin.query("DELETE FROM impuls.access_scopes WHERE id=$1", [
          scope,
        ]);
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
    async function read(taskId = tasks[0]!, cursor?: number, limit = 2) {
      const result = await readAssignedTaskHistory(
        runtime,
        owner,
        hashes[0]!,
        taskId,
        { cursor, limit },
      );
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("Expected history");
      return taskHistoryResponseSchema.parse(result.response);
    }
    it("orders equal-timestamp reports by attempt, with independent reasons and saved accepted funds", async () => {
      const first = await read();
      expect(first.items.map((item) => item.id)).toEqual([
        attempts[2],
        attempts[1],
      ]);
      expect(first.items[0]).toMatchObject({
        attemptNumber: 3,
        text: "Synthetic attempt 3",
        review: {
          decision: "accept",
          reason: "Independent reason 3",
          fundXp: 19,
          fundPoints: 7,
          reviewer: { id: reviewer },
        },
      });
      expect(first.items[1]!.review).toMatchObject({
        decision: "return",
        reason: "Independent reason 2",
        fundXp: null,
        fundPoints: null,
      });
      expect(first.nextCursor).toBe(2);
      const last = await read(tasks[0], first.nextCursor!);
      expect(last.items.map((item) => item.attemptNumber)).toEqual([1]);
      expect(last.nextCursor).toBeNull();
      expect((await read(tasks[1])).items).toEqual([]);
      expect((await read(tasks[0], 1)).items).toEqual([]);
    });
    it("keeps pagination without duplicates when a newer report arrives, and refresh finds it", async () => {
      const first = await read(tasks[2]);
      await addAttempt(tasks[2]!, 4, null);
      await admin.query(
        "UPDATE impuls.tasks SET status='in_review' WHERE id=$1",
        [tasks[2]],
      );
      const last = await read(tasks[2], first.nextCursor!);
      expect(
        [...first.items, ...last.items].map((item) => item.attemptNumber),
      ).toEqual([3, 2, 1]);
      const refreshed = await read(tasks[2]);
      expect(refreshed.items[0]).toMatchObject({
        attemptNumber: 4,
        review: null,
      });
    });
    it("hides foreign tasks, nonexistent tasks, inactive users, and draft objects even with reports", async () => {
      for (const id of [tasks[3]!, randomUUID()])
        expect(
          await readAssignedTaskHistory(runtime, owner, hashes[0]!, id),
        ).toEqual({ kind: "not_found" });
      await admin.query("UPDATE impuls.tasks SET status='draft' WHERE id=$1", [
        tasks[2],
      ]);
      try {
        expect(
          await readAssignedTaskHistory(runtime, owner, hashes[0]!, tasks[2]!),
        ).toEqual({ kind: "not_found" });
      } finally {
        await admin.query(
          "UPDATE impuls.tasks SET status='in_review' WHERE id=$1",
          [tasks[2]],
        );
      }
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        owner,
      ]);
      try {
        expect(
          await readAssignedTaskHistory(runtime, owner, hashes[0]!, tasks[0]!),
        ).toEqual({ kind: "revoked" });
      } finally {
        await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
          owner,
        ]);
      }
    });
    it("does not expose history using another actor's session or after expiry/revocation", async () => {
      expect(
        await readAssignedTaskHistory(runtime, owner, hashes[1]!, tasks[0]!),
      ).toEqual({ kind: "unauthorized" });
      for (const change of [
        "revoked_at=clock_timestamp()",
        "expires_at=clock_timestamp()-interval '1 second'",
      ]) {
        await admin.query(
          `UPDATE impuls.sessions SET ${change} WHERE session_hash=$1`,
          [hashes[0]],
        );
        try {
          expect(
            await readAssignedTaskHistory(
              runtime,
              owner,
              hashes[0]!,
              tasks[0]!,
            ),
          ).toEqual({
            kind: change.startsWith("revoked_at") ? "revoked" : "unauthorized",
          });
        } finally {
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL,expires_at=clock_timestamp()+interval '1 hour' WHERE session_hash=$1",
            [hashes[0]],
          );
        }
      }
    });
    it.skipIf(!origin)(
      "validates real HTTP pagination, no-store and non-disclosing refusals",
      async () => {
        const get = (path: string, actor = 0) =>
          fetch(`${origin}/api/v1/tasks/${path}`, {
            headers: { Cookie: `impuls_session=${tokens[actor]}` },
          });
        const response = await get(`${tasks[0]}/history?limit=2`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-request-id")).toBeTruthy();
        const first = taskHistoryResponseSchema.parse(await response.json());
        expect(first.items.map((item) => item.attemptNumber)).toEqual([3, 2]);
        const last = await get(
          `${tasks[0]}/history?cursor=${first.nextCursor}`,
        );
        expect(
          taskHistoryResponseSchema
            .parse(await last.json())
            .items.map((item) => item.attemptNumber),
        ).toEqual([1]);
        for (const query of [
          "userId=any",
          "cursor=0",
          "cursor=1.5",
          "cursor=2147483648",
          "limit=51",
          "limit=2&limit=3",
          "cursor=2&cursor=1",
        ])
          expect((await get(`${tasks[0]}/history?${query}`)).status).toBe(400);
        for (const taskId of [tasks[3], randomUUID(), "bad-id"]) {
          const denied = await get(`${taskId}/history`);
          expect(denied.status).toBe(404);
          const body = await denied.json();
          expect(body.code).toBe("NOT_FOUND");
          expect(body.currentVersion).toBeUndefined();
          expect(body.items).toBeUndefined();
        }
        expect((await get(`${tasks[0]}/history`, 2)).status).toBe(404);
        expect(
          (await fetch(`${origin}/api/v1/tasks/${tasks[0]}/history`)).status,
        ).toBe(401);
        await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
          owner,
        ]);
        try {
          expect((await get(`${tasks[0]}/history`)).status).toBe(403);
        } finally {
          await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
            owner,
          ]);
        }
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=now() WHERE session_hash=$1",
          [hashes[0]],
        );
        try {
          expect((await get(`${tasks[0]}/history`)).status).toBe(403);
        } finally {
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL WHERE session_hash=$1",
            [hashes[0]],
          );
        }
      },
    );
    it.skipIf(!origin)(
      "shows PostgreSQL-backed reports through the actual browser API, then removes them after access revocation",
      async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          viewport: { width: 390, height: 740 },
          reducedMotion: "reduce",
        });
        const errors: string[] = [];
        try {
          await context.addCookies([
            { name: "impuls_session", value: tokens[0]!, url: origin! },
          ]);
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          await page.route(
            "https://telegram.org/js/telegram-web-app.js",
            (route) =>
              route.fulfill({
                contentType: "application/javascript",
                body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}",
              }),
          );
          await page.goto(origin!);
          // Участник открывается на «Главной»; задачи — в отдельной вкладке.
          await page
            .getByRole("button", { name: "Мои задачи", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Готово", exact: true })
            .click();
          await page
            .getByRole("button", { name: /Synthetic history task 0/ })
            .click();
          await page
            .getByRole("button", {
              name: "История отчётов и решений",
              exact: true,
            })
            .click();
          await page
            .getByRole("heading", { name: "Попытка 3 · Принята", exact: true })
            .waitFor();
          expect(await page.locator(".task-history-list li").count()).toBe(3);
          expect(await page.locator(".task-history").innerText()).toContain(
            "Independent reason 1",
          );
          expect(await page.locator(".task-history").innerText()).toContain(
            "Начислено 19 XP и 7 баллов",
          );
          await admin.query(
            "UPDATE impuls.users SET active=false WHERE id=$1",
            [owner],
          );
          await page
            .getByRole("button", { name: "Обновить историю", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Доступ отозван", exact: true })
            .waitFor();
          expect(await page.locator(".task-history").count()).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
            owner,
          ]);
          await context.close();
          await browser.close();
        }
      },
      20000,
    );
  },
);
