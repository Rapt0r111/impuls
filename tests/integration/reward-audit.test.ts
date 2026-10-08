import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readAudit } from "../../packages/domain/src/admin/audit";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import { decideRedemption } from "../../packages/domain/src/rewards/decisions";
import { fulfillRedemption } from "../../packages/domain/src/rewards/fulfillment";
import { createTask } from "../../packages/domain/src/tasks/manage";
import {
  auditQuerySchema,
  auditResponseSchema,
} from "../../packages/contracts/src/audit";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F06/F07 reward audit under runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
      });
    const users = Array.from({ length: 4 }, () => randomUUID()),
      scopes = Array.from({ length: 3 }, () => randomUUID());
    const auditor = users[0]!,
      owner = users[1]!,
      operator = users[2]!,
      outsider = users[3]!;
    const scope = scopes[0]!,
      neighbour = scopes[1]!,
      parent = scopes[2]!;
    const tokens = users.map(() => randomBytes(32).toString("base64url")),
      hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    const rewards: string[] = [],
      quotas: string[] = [],
      redemptions: string[] = [],
      rule = randomUUID();
    let taskId = "",
      fulfilledId = "",
      entitlementId = "",
      expectedIds: string[] = [],
      bindingId = "";
    const common = (index: number) => ({
      actorId: users[index]!,
      sessionHash: hashes[index]!,
      allowSyntheticRewards: true,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    const read = (options: Parameters<typeof readAudit>[3] = {}, index = 0) =>
      readAudit(runtime, users[index]!, hashes[index]!, {
        allowSyntheticAudit: true,
        scope,
        ...options,
      });
    async function fixture(atScope = scope) {
      const reward = randomUUID(),
        version = randomUUID(),
        quota = randomUUID();
      rewards.push(reward);
      quotas.push(quota);
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,1,'Сохранённый знак','Исходные синтетические условия',30,'cosmetic','synthetic',true,now()-interval '1 minute')",
        [version, reward, atScope],
      );
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,now()-interval '1 hour',now()+interval '1 day',3)",
        [quota, reward, atScope],
      );
      const r = await mutateRedemption(runtime, {
        ...common(1),
        action: "reserve",
        rewardVersionId: version,
        quotaPeriodId: quota,
        expectedVersion: 1,
      });
      if (r.kind !== "ok") throw new Error(r.kind);
      redemptions.push(r.response.redemption.id);
      return { id: r.response.redemption.id, reward, version, quota };
    }
    beforeAll(async () => {
      for (const [i, id] of users.entries())
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
          [id, randomInt(7e12, 8e12), `Synthetic reward auditor ${i}`],
        );
      for (const [i, id] of scopes.entries())
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,$2,$3)",
          [id, i === 2 ? "rota" : "group", `Synthetic reward audit area ${i}`],
        );
      for (const [user, action, area] of [
        [auditor, "admin.audit", scope],
        [outsider, "admin.audit", neighbour],
        [outsider, "admin.audit", parent],
        [operator, "reward.decide", scope],
        [operator, "reward.fulfill", scope],
        [operator, "admin.catalog", scope],
        [operator, "task.create", scope],
      ]) {
        const r = await admin.query<{ id: string }>(
          "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic reward audit fixture') RETURNING id",
          [user, action, area],
        );
        if (user === auditor) bindingId = r.rows[0]!.id;
      }
      for (const s of [scope, neighbour])
        await admin.query(
          "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
          [owner, s],
        );
      for (const [i, user] of users.entries())
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
          [user, hashes[i]],
        );
      await admin.query(
        "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
        [owner],
      );
      await admin.query(
        "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,'{\"mode\":\"synthetic\"}',now()-interval '1 minute',$3)",
        [rule, randomInt(2e6, 2e9), operator],
      );
      const task = await createTask(runtime, {
        actorId: operator,
        sessionHash: hashes[2]!,
        enabled: true,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        data: {
          scopeId: scope,
          ruleSetId: rule,
          title: "Синтетическая задача смешанного журнала",
          criteria: "Synthetic audit criterion",
          categoryCode: "test",
          priority: "normal",
          dueAt: "2035-01-01T00:00:00.000Z",
          fundXp: 0,
          fundPoints: 0,
        },
      });
      if (task.kind !== "ok") throw new Error(task.kind);
      taskId = task.response.task.id;
      const cancelled = await fixture();
      expect(
        (
          await mutateRedemption(runtime, {
            ...common(1),
            action: "cancel",
            redemptionId: cancelled.id,
            expectedVersion: 1,
            reason: "Отменена владельцем",
          })
        ).kind,
      ).toBe("ok");
      const rejected = await fixture();
      expect(
        (
          await decideRedemption(runtime, {
            ...common(2),
            redemptionId: rejected.id,
            expectedVersion: 1,
            decision: "reject",
            reason: "Тестовый отказ",
          })
        ).kind,
      ).toBe("ok");
      const fulfilled = await fixture();
      fulfilledId = fulfilled.id;
      expect(
        (
          await decideRedemption(runtime, {
            ...common(2),
            redemptionId: fulfilledId,
            expectedVersion: 1,
            decision: "approve",
            reason: "Тестовое одобрение",
          })
        ).kind,
      ).toBe("ok");
      const issued = await fulfillRedemption(runtime, {
        ...common(2),
        redemptionId: fulfilledId,
        expectedVersion: 2,
        reason: "Тестовая выдача",
      });
      if (issued.kind !== "ok") throw new Error(issued.kind);
      entitlementId = issued.response.redemption.fulfillment!.entitlementId;
      // A later catalog version must not rewrite the historical request snapshot.
      await admin.query(
        "INSERT INTO impuls.reward_versions(reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,2,'Новая позиция','Новые условия',99,'cosmetic','synthetic',true,now())",
        [fulfilled.reward, scope],
      );
      const primary = (
        await admin.query<{ id: string }>(
          "SELECT id FROM impuls.audit_events WHERE redemption_id=ANY($1::uuid[]) OR task_id=$2",
          [redemptions, taskId],
        )
      ).rows
        .map((r) => r.id)
        .sort();
      expect(primary).toHaveLength(8);
      await admin.query(
        "UPDATE impuls.audit_events SET created_at='2026-10-04T09:00:00.123000Z' WHERE id=ANY($1::uuid[])",
        [primary],
      );
      for (const [i, timestamp] of [
        "2026-10-04T09:00:00.123002Z",
        "2026-10-04T09:00:00.123001Z",
      ].entries())
        await admin.query(
          "UPDATE impuls.audit_events SET created_at=$2 WHERE id=$1",
          [primary[i], timestamp],
        );
      expectedIds = [primary[0]!, primary[1]!, ...primary.slice(2).reverse()];
      await fixture(neighbour);
      await admin.query(
        "UPDATE impuls.users SET display_name='Текущий псевдоним' WHERE id=$1",
        [owner],
      );
      // Owner-only fixtures inject malformed/unknown evidence; runtime cannot modify it.
      await admin.query(
        "UPDATE impuls.audit_events SET diff=diff || $2::jsonb WHERE redemption_id=$1 AND action='reward.fulfill'",
        [
          fulfilledId,
          JSON.stringify({
            token: "MUST_STAY_PRIVATE",
            sessionHash: "MUST_STAY_PRIVATE",
            criteria: "MUST_STAY_PRIVATE",
            availableDelta: 999,
            price: -2,
            reservedDelta: { secret: true },
            quotaPeriodId: "MUST_STAY_PRIVATE",
          }),
        ],
      );
    }, 30000);
    it("reads five real actions, historical terms and typed movements without rewriting financial state", async () => {
      const before = (
        await admin.query(
          "SELECT lifetime_xp,available_points,reserved_points,version FROM impuls.account_balances WHERE user_id=$1",
          [owner],
        )
      ).rows[0];
      expect(before).toMatchObject({
        lifetime_xp: "300",
        available_points: "60",
        reserved_points: "30",
      });
      const r = await read({ limit: 50 });
      if (r.kind !== "ok") throw new Error(r.kind);
      const page = auditResponseSchema.parse(r.response);
      expect(page.items.map((i) => i.id)).toEqual(expectedIds);
      expect(new Set(page.items.map((i) => i.action))).toEqual(
        new Set([
          "task.create",
          "reward.reserve",
          "reward.cancel",
          "reward.approve",
          "reward.reject",
          "reward.fulfill",
        ]),
      );
      for (const item of page.items.filter((i) => i.reward)) {
        expect(item).toMatchObject({
          task: null,
          reviewId: null,
          correctionId: null,
          reward: {
            title: "Сохранённый знак",
            conditions: "Исходные синтетические условия",
            price: 30,
            rewardVersion: 1,
            recipient: { id: owner, displayName: "Текущий псевдоним" },
          },
        });
      }
      const entry = (action: string) =>
        page.items.find((i) => i.action === action)!;
      expect(entry("reward.reserve").values).toEqual(
        expect.arrayContaining([
          { field: "status", value: "pending" },
          { field: "availableDelta", value: -30 },
          { field: "reservedDelta", value: 30 },
        ]),
      );
      for (const action of ["reward.cancel", "reward.reject"])
        expect(entry(action).values).toEqual(
          expect.arrayContaining([
            { field: "availableDelta", value: 30 },
            { field: "reservedDelta", value: -30 },
          ]),
        );
      expect(entry("reward.approve").values).toEqual(
        expect.arrayContaining([
          { field: "availableDelta", value: 0 },
          { field: "reservedDelta", value: -30 },
          { field: "to", value: "approved" },
        ]),
      );
      expect(entry("reward.fulfill").values).toEqual([
        { field: "from", value: "approved" },
        { field: "to", value: "fulfilled" },
        { field: "entitlementId", value: entitlementId },
        { field: "version", value: 3 },
      ]);
      expect(entry("reward.fulfill").reason).toBe("Тестовая выдача");
      expect(JSON.stringify(page)).not.toContain("MUST_STAY_PRIVATE");
      expect(JSON.stringify(page)).not.toContain("Новая позиция");
      expect(
        (
          await admin.query(
            "SELECT lifetime_xp,available_points,reserved_points,version FROM impuls.account_balances WHERE user_id=$1",
            [owner],
          )
        ).rows[0],
      ).toEqual(before);
    });
    it("paginates mixed events with microseconds/equal timestamps and binds reward cursors", async () => {
      let cursor: string | null = null;
      const ids: string[] = [];
      do {
        const r = await read(
          auditQuerySchema.parse({
            scope,
            limit: 2,
            ...(cursor ? { cursor } : {}),
          }),
        );
        if (r.kind !== "ok") throw new Error(r.kind);
        ids.push(...r.response.items.map((i) => i.id));
        cursor = r.response.nextCursor;
      } while (cursor);
      expect(ids).toEqual(expectedIds);
      expect(new Set(ids).size).toBe(8);
      const r = await read({ action: "reward.reserve", limit: 1 });
      if (r.kind !== "ok") throw new Error(r.kind);
      const c = auditQuerySchema.parse({
        cursor: r.response.nextCursor,
      }).cursor!;
      for (const modified of [
        { ...c, actor: owner },
        { ...c, scope: neighbour },
        { ...c, action: "all" as const },
        { ...c, id: randomUUID() },
      ])
        expect(
          await read({ action: "reward.reserve", cursor: modified }),
        ).toEqual({ kind: "invalid_cursor" });
      expect(
        (
          await read({
            action: "reward.reserve",
            ...auditQuerySchema.parse({ cursor: r.response.nextCursor }),
          })
        ).kind,
      ).toBe("ok");
    });
    it("needs exact audit authority and preserves history after membership/catalog changes", async () => {
      for (const i of [1, 2, 3])
        expect(await read({}, i)).toEqual({ kind: "not_found" });
      expect(await read({ scope: neighbour })).toEqual({ kind: "not_found" });
      expect(await read({ scope: parent }, 3)).toMatchObject({
        kind: "ok",
        response: { items: [] },
      });
      const neighbourPage = await read({ scope: neighbour }, 3);
      if (neighbourPage.kind !== "ok") throw new Error(neighbourPage.kind);
      expect(neighbourPage.response.items).toHaveLength(1);
      expect(await read({ allowSyntheticAudit: false })).toEqual({
        kind: "disabled",
      });
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=now() WHERE user_id=$1",
        [owner],
      );
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        owner,
      ]);
      const r = await read();
      expect(r).toMatchObject({
        kind: "ok",
        response: { items: expect.any(Array) },
      });
      if (r.kind === "ok") expect(r.response.items).toHaveLength(8);
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        owner,
      ]);
    });
    it("omits malformed signed values and rechecks current authority before a cursor page", async () => {
      await admin.query(
        "UPDATE impuls.audit_events SET diff=diff || $2::jsonb WHERE redemption_id=$1 AND action='reward.reserve'",
        [
          fulfilledId,
          JSON.stringify({
            availableDelta: 0.5,
            reservedDelta: "secret",
            price: 0,
            rewardVersion: 0,
            quotaPeriodId: "secret",
            criteria: "secret",
          }),
        ],
      );
      const r = await read({ action: "reward.reserve", limit: 1 });
      if (r.kind !== "ok") throw new Error(r.kind);
      const c = auditQuerySchema.parse({
        cursor: r.response.nextCursor,
      }).cursor!;
      const all = await read({ action: "reward.reserve", limit: 50 });
      if (all.kind !== "ok") throw new Error(all.kind);
      expect(
        all.response.items.find((i) => i.reward!.redemptionId === fulfilledId)!
          .values,
      ).toEqual([{ field: "status", value: "pending" }]);
      for (const change of [
        "valid_from=now()+interval '1 day'",
        "valid_from=now()-interval '2 days',valid_until=now()-interval '1 day'",
        "revoked_at=now()",
      ]) {
        await admin.query(
          `UPDATE impuls.role_bindings SET ${change} WHERE id=$1`,
          [bindingId],
        );
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [auditor],
        );
        expect(await read({ action: "reward.reserve", cursor: c })).toEqual({
          kind: "not_found",
        });
        await admin.query(
          "UPDATE impuls.role_bindings SET valid_from=now()-interval '1 minute',valid_until=NULL,revoked_at=NULL WHERE id=$1",
          [bindingId],
        );
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [auditor],
        );
      }
      expect(
        await readAudit(runtime, auditor, hashes[1]!, {
          allowSyntheticAudit: true,
          scope,
        }),
      ).toEqual({ kind: "unauthorized" });
      await admin.query(
        "UPDATE impuls.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [auditor],
      );
      expect(await read()).toEqual({ kind: "unauthorized" });
      await admin.query(
        "UPDATE impuls.sessions SET expires_at=now()+interval '1 hour',revoked_at=now() WHERE user_id=$1",
        [auditor],
      );
      expect(await read()).toEqual({ kind: "revoked" });
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [auditor],
      );
    });
    it.skipIf(!origin)(
      "reads saved reward evidence through no-store HTTP and Chromium to PostgreSQL",
      async () => {
        const endpoint = `${origin}/api/v1/admin/audit`,
          headers = { cookie: `impuls_session=${tokens[0]}` };
        for (const action of [
          "reward.reserve",
          "reward.cancel",
          "reward.approve",
          "reward.reject",
          "reward.fulfill",
        ]) {
          const response = await fetch(
            `${endpoint}?scope=${scope}&action=${action}`,
            { headers },
          );
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          const body = auditResponseSchema.parse(await response.json());
          expect(body.items.length).toBeGreaterThan(0);
          expect(
            body.items.every((i) => i.action === action && i.reward && !i.task),
          ).toBe(true);
        }
        for (const query of [
          `scope=${scope}&action=reward.fulfill&action=reward.reserve`,
          `scope=${scope}&recipient=${owner}`,
          "action=reward.unknown",
          "cursor=bad",
        ])
          expect(
            (await fetch(`${endpoint}?${query}`, { headers })).status,
          ).toBe(400);
        expect((await fetch(endpoint)).status).toBe(401);
        expect(
          (await fetch(`${endpoint}?scope=${neighbour}`, { headers })).status,
        ).toBe(404);
        expect(
          (
            await fetch(`${endpoint}?scope=${scope}`, {
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
          await page
            .getByRole("button", { name: "Журнал действий", exact: true })
            .click();
          await page
            .getByLabel("Действие", { exact: true })
            .selectOption("reward.fulfill");
          const entry = page.locator(".audit-list > li");
          await entry
            .getByText("Позиция при подаче: Сохранённый знак", { exact: true })
            .waitFor();
          expect(await entry.count()).toBe(1);
          await entry.locator("summary").press("Enter");
          await entry
            .getByText("Исходные синтетические условия", { exact: true })
            .waitFor();
          await entry.getByText(entitlementId, { exact: true }).waitFor();
          expect(await entry.innerText()).toContain(
            "Получатель сейчас: Текущий псевдоним",
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
          ).toBe(false);
        } finally {
          await browser.close();
        }
      },
      20000,
    );
    afterAll(async () => {
      try {
        for (const [table, column] of [
          ["entitlements", "user_id"],
          ["audit_events", "actor_id"],
          ["notification_outbox", "recipient_id"],
          ["ledger_entries", "user_id"],
          ["redemptions", "user_id"],
          ["idempotency_records", "actor_id"],
          ["role_bindings", "user_id"],
          ["task_mutation_limits", "actor_id"],
          ["account_balances", "user_id"],
          ["sessions", "user_id"],
          ["task_scope_members", "user_id"],
        ])
          await admin.query(
            `DELETE FROM impuls.${table} WHERE ${column}=ANY($1::uuid[])`,
            [users],
          );
        await admin.query("DELETE FROM impuls.task_events WHERE task_id=$1", [
          taskId || null,
        ]);
        await admin.query("DELETE FROM impuls.tasks WHERE id=$1", [
          taskId || null,
        ]);
        await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rule]);
        await admin.query(
          "DELETE FROM impuls.quota_periods WHERE id=ANY($1::uuid[])",
          [quotas],
        );
        await admin.query(
          "DELETE FROM impuls.reward_versions WHERE reward_id=ANY($1::uuid[])",
          [rewards],
        );
        await admin.query(
          "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
          [scopes],
        );
        await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
          users,
        ]);
      } finally {
        await runtime.end();
        await admin.end();
      }
    });
  },
);
