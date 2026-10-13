import { createHash, randomUUID, randomBytes, randomInt } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { fulfillRedemption } from "../../packages/domain/src/rewards/fulfillment";
import {
  decideRedemption,
  readRedemptionReview,
} from "../../packages/domain/src/rewards/decisions";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import {
  readMyRedemptions,
  readRewardCatalog,
} from "../../packages/domain/src/rewards/read";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import {
  redemptionDecisionResponseSchema,
  redemptionListResponseSchema,
  rewardCatalogResponseSchema,
} from "../../packages/contracts/src/rewards";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F06 fulfillment under PostgreSQL runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        application_name: "impuls_fulfillment_tests",
        max: 8,
      });
    const scope = randomUUID(),
      foreign = randomUUID(),
      users: string[] = [],
      rewards: string[] = [],
      quotas: string[] = [];
    type User = { id: string; token: string; hash: Buffer };
    let approver: User, issuer: User, other: User, outsider: User;
    async function user(): Promise<User> {
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        hash = createHash("sha256").update(token).digest();
      users.push(id);
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Тестовый участник',true)",
        [id, randomInt(8e12, 9e12)],
      );
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [id, hash],
      );
      return { id, token, hash };
    }
    const common = (u: User) => ({
      actorId: u.id,
      sessionHash: u.hash,
      allowSyntheticRewards: true,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    async function permission(u: User, action = "reward.fulfill", s = scope) {
      const row = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fulfillment fixture') RETURNING id",
          [u.id, s, action],
        )
      ).rows[0]!;
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [u.id],
      );
      return row.id;
    }
    beforeAll(async () => {
      for (const id of [scope, foreign])
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Область тестовой выдачи')",
          [id],
        );
      approver = await user();
      issuer = await user();
      other = await user();
      outsider = await user();
      await permission(approver, "reward.decide");
      await permission(issuer);
      await permission(other);
      await permission(outsider, "reward.fulfill", foreign);
      await permission(outsider, "admin.catalog");
    });
    async function fixture(approve = true) {
      const owner = await user(),
        reward = randomUUID(),
        version = randomUUID(),
        quota = randomUUID();
      rewards.push(reward);
      quotas.push(quota);
      await admin.query(
        "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
        [owner.id],
      );
      await admin.query(
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
        [owner.id, scope],
      );
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,1,'Знак тестовой коллекции','Синтетическая косметика без служебных привилегий',30,'cosmetic','synthetic',true,clock_timestamp()-interval '1 minute')",
        [version, reward, scope],
      );
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',3)",
        [quota, reward, scope],
      );
      const reserved = await mutateRedemption(runtime, {
        ...common(owner),
        action: "reserve",
        rewardVersionId: version,
        quotaPeriodId: quota,
        expectedVersion: 1,
      });
      if (reserved.kind !== "ok") throw new Error(reserved.kind);
      const id = reserved.response.redemption.id;
      if (approve)
        expect(
          (
            await decideRedemption(runtime, {
              ...common(approver),
              redemptionId: id,
              expectedVersion: 1,
              decision: "approve",
              reason: "Проверены условия",
            })
          ).kind,
        ).toBe("ok");
      return { owner, reward, version, quota, id };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const input = (f: Fixture, u = issuer) => ({
      ...common(u),
      redemptionId: f.id,
      expectedVersion: 2,
      reason: "Синтетический предмет выдан",
    });
    async function state(f: Fixture) {
      return (
        await admin.query(
          `SELECT d.status,d.version,b.lifetime_xp,b.available_points,b.reserved_points,b.version AS balance_version,q.used,q.reserved,q.version AS quota_version,
      (SELECT count(*)::int FROM impuls.entitlements WHERE redemption_id=d.id) entitlements,
      (SELECT count(*)::int FROM impuls.ledger_entries WHERE redemption_id=d.id) ledger,
      (SELECT count(*)::int FROM impuls.audit_events WHERE redemption_id=d.id) audit,
      (SELECT count(*)::int FROM impuls.notification_outbox WHERE redemption_id=d.id) outbox
      FROM impuls.redemptions d JOIN impuls.account_balances b ON b.user_id=d.user_id JOIN impuls.quota_periods q ON q.id=d.quota_period_id WHERE d.id=$1`,
          [f.id],
        )
      ).rows[0];
    }
    it("issues once, preserves approval and every financial projection, exposes ownership and blocks repurchase", async () => {
      const f = await fixture(),
        before = await state(f),
        i = input(f),
        result = await fulfillRedemption(runtime, i);
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(
        redemptionDecisionResponseSchema.parse(result.response),
      ).toMatchObject({
        redemption: {
          status: "fulfilled",
          version: 3,
          decision: { actorId: approver.id, reason: "Проверены условия" },
          fulfillment: { actorId: issuer.id, reason: i.reason },
        },
      });
      expect(await state(f)).toEqual({
        ...before,
        status: "fulfilled",
        version: 3,
        entitlements: 1,
        audit: 3,
        outbox: 3,
      });
      expect(before).toMatchObject({
        lifetime_xp: "300",
        available_points: "90",
        reserved_points: "0",
        used: 1,
        reserved: 0,
        ledger: 2,
      });
      expect(await fulfillRedemption(runtime, i)).toEqual(result);
      expect(
        (await fulfillRedemption(runtime, { ...i, reason: "different" })).kind,
      ).toBe("idempotency_conflict");
      expect((await fulfillRedemption(runtime, input(f))).kind).toBe(
        "conflict",
      );
      const history = await readMyRedemptions(
        runtime,
        f.owner.id,
        f.owner.hash,
        { allowSyntheticRewards: true },
      );
      if (history.kind !== "ok") throw new Error(history.kind);
      expect(
        redemptionListResponseSchema.parse(history.response).items[0]
          ?.fulfillment?.entitlementId,
      ).toBe(result.response.redemption.fulfillment?.entitlementId);
      const catalog = await readRewardCatalog(
        runtime,
        f.owner.id,
        f.owner.hash,
        { allowSyntheticRewards: true, scope },
      );
      if (catalog.kind !== "ok") throw new Error(catalog.kind);
      expect(
        rewardCatalogResponseSchema
          .parse(catalog.response)
          .items.find((r) => r.rewardId === f.reward),
      ).toMatchObject({ owned: true, hasPendingRequest: false });
      expect(
        (
          await mutateRedemption(runtime, {
            ...common(f.owner),
            action: "reserve",
            rewardVersionId: f.version,
            quotaPeriodId: f.quota,
            expectedVersion: 1,
          })
        ).kind,
      ).toBe("already_pending");
    });
    it("serializes competing issuers to one entitlement, audit and outbox", async () => {
      const f = await fixture(),
        results = await Promise.all([
          fulfillRedemption(runtime, input(f)),
          fulfillRedemption(runtime, input(f, other)),
        ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      expect(await state(f)).toMatchObject({
        status: "fulfilled",
        entitlements: 1,
        ledger: 2,
        audit: 3,
        outbox: 3,
      });
    });
    it("requires exact independent authority and forbids self issuance even with permission", async () => {
      const f = await fixture();
      for (const actor of [approver, outsider, f.owner])
        expect((await fulfillRedemption(runtime, input(f, actor))).kind).toBe(
          "not_found",
        );
      await permission(f.owner);
      expect((await fulfillRedemption(runtime, input(f, f.owner))).kind).toBe(
        "not_found",
      );
      expect(
        (
          await fulfillRedemption(runtime, {
            ...input(f),
            allowSyntheticRewards: false,
          })
        ).kind,
      ).toBe("disabled");
      expect(
        (
          await fulfillRedemption(runtime, {
            ...input(f),
            sessionHash: Buffer.alloc(32),
          })
        ).kind,
      ).toBe("unauthorized");
      expect(
        (
          await readRedemptionReview(runtime, approver.id, approver.hash, {
            allowSyntheticRewards: true,
            purpose: "fulfill",
            scope,
          })
        ).kind,
      ).toBe("not_found");
      const queue = await readRedemptionReview(
        runtime,
        issuer.id,
        issuer.hash,
        { allowSyntheticRewards: true, purpose: "fulfill", scope, limit: 1 },
      );
      if (queue.kind !== "ok") throw new Error(queue.kind);
      expect(queue.response.items).toHaveLength(1);
      expect(queue.response.items[0]?.redemption.status).toBe("approved");
      expect(await state(f)).toMatchObject({
        status: "approved",
        entitlements: 0,
      });
    });
    it("rejects pending, rejected, cancelled and stale versions", async () => {
      for (const target of ["pending", "rejected", "cancelled"] as const) {
        const f = await fixture(false);
        if (target === "rejected")
          await decideRedemption(runtime, {
            ...common(approver),
            redemptionId: f.id,
            expectedVersion: 1,
            decision: "reject",
            reason: "test",
          });
        if (target === "cancelled")
          await mutateRedemption(runtime, {
            ...common(f.owner),
            action: "cancel",
            redemptionId: f.id,
            expectedVersion: 1,
            reason: "test",
          });
        expect((await fulfillRedemption(runtime, input(f))).kind).toBe(
          "conflict",
        );
      }
      const f = await fixture();
      expect(
        (await fulfillRedemption(runtime, { ...input(f), expectedVersion: 1 }))
          .kind,
      ).toBe("conflict");
    });
    it("refuses an inactive recipient; removed membership does not erase approved terms", async () => {
      const f = await fixture();
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        f.owner.id,
      ]);
      expect((await fulfillRedemption(runtime, input(f))).kind).toBe(
        "recipient_inactive",
      );
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        f.owner.id,
      ]);
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [f.owner.id],
      );
      expect((await fulfillRedemption(runtime, input(f))).kind).toBe("ok");
    });
    it("checks revoked authority before returning a saved response", async () => {
      const f = await fixture(),
        actor = await user(),
        binding = await permission(actor),
        i = input(f, actor);
      expect((await fulfillRedemption(runtime, i)).kind).toBe("ok");
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE id=$1",
        [binding],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [actor.id],
      );
      expect((await fulfillRedemption(runtime, i)).kind).toBe("not_found");
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        actor.id,
      ]);
      expect((await fulfillRedemption(runtime, i)).kind).toBe("revoked");
    });
    it.each(["session", "permission"])(
      "rechecks %s expiry after quota lock waits",
      async (what) => {
        const f = await fixture(),
          actor = await user(),
          binding = await permission(actor),
          locker = await admin.connect();
        try {
          await locker.query("BEGIN");
          await locker.query(
            "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
            [f.quota],
          );
          if (what === "session")
            await admin.query(
              "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '700 milliseconds' WHERE user_id=$1",
              [actor.id],
            );
          else
            await admin.query(
              "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '700 milliseconds' WHERE id=$1",
              [binding],
            );
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
            [actor.id],
          );
          const pending = fulfillRedemption(runtime, input(f, actor));
          let waiting = false;
          for (let attempt = 0; attempt < 20; attempt++) {
            waiting = (
              await admin.query<{ waiting: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='impuls_fulfillment_tests' AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM impuls.quota_periods%') AS waiting",
              )
            ).rows[0]!.waiting;
            if (waiting) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);
          await new Promise((resolve) => setTimeout(resolve, 950));
          await locker.query("COMMIT");
          expect((await pending).kind).toBe(
            what === "session" ? "unauthorized" : "not_found",
          );
          expect(await state(f)).toMatchObject({
            status: "approved",
            entitlements: 0,
            audit: 2,
            outbox: 2,
          });
        } finally {
          await locker.query("ROLLBACK");
          locker.release();
        }
      },
    );
    it("rolls back fulfillment, ownership and saved response when outbox fails", async () => {
      const f = await fixture(),
        i = input(f),
        name = `test_fulfillment_${randomUUID().replaceAll("-", "")}`;
      await admin.query(
        `ALTER TABLE impuls.notification_outbox ADD CONSTRAINT ${name} CHECK(redemption_id IS DISTINCT FROM '${f.id}'::uuid OR kind<>'reward.fulfilled')`,
      );
      try {
        await expect(fulfillRedemption(runtime, i)).rejects.toThrow();
        expect(await state(f)).toMatchObject({
          status: "approved",
          version: 2,
          entitlements: 0,
          audit: 2,
          outbox: 2,
        });
        expect(
          (
            await admin.query(
              "SELECT count(*)::int n FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='reward.fulfill' AND key=$2",
              [issuer.id, i.idempotencyKey],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await admin.query(
          `ALTER TABLE impuls.notification_outbox DROP CONSTRAINT ${name}`,
        );
      }
      expect((await fulfillRedemption(runtime, i)).kind).toBe("ok");
    });
    it("database refuses missing ownership, mismatched source, self issuance, terminal rewrites and ownership mutation", async () => {
      const f = await fixture();
      await expect(
        runtime.query(
          "UPDATE impuls.redemptions SET status='fulfilled',fulfillment_actor_id=$2,fulfillment_reason='test',fulfilled_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [f.id, issuer.id],
        ),
      ).rejects.toThrow("Missing fulfillment entitlement");
      await expect(
        runtime.query(
          "INSERT INTO impuls.entitlements(redemption_id,user_id,reward_id,scope_id,actor_id,reason,mode,created_at) VALUES($1,$2,$3,$4,$5,'test','synthetic',clock_timestamp())",
          [f.id, f.owner.id, f.reward, scope, issuer.id],
        ),
      ).rejects.toThrow("Invalid entitlement source");
      await expect(
        runtime.query(
          "UPDATE impuls.redemptions SET status='fulfilled',fulfillment_actor_id=user_id,fulfillment_reason='test',fulfilled_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [f.id],
        ),
      ).rejects.toThrow();
      expect((await fulfillRedemption(runtime, input(f))).kind).toBe("ok");
      await expect(
        runtime.query(
          "UPDATE impuls.redemptions SET fulfillment_reason='rewrite',version=version+1 WHERE id=$1",
          [f.id],
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query(
          "UPDATE impuls.entitlements SET reason='rewrite' WHERE redemption_id=$1",
          [f.id],
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query(
          "DELETE FROM impuls.entitlements WHERE redemption_id=$1",
          [f.id],
        ),
      ).rejects.toThrow();
    });
    it.runIf(Boolean(origin))(
      "real HTTP boundaries and Chromium to API to PostgreSQL issuance",
      async () => {
        const f = await fixture(),
          endpoint = `${origin}/api/v1/redemptions/${f.id}/fulfill`,
          body = JSON.stringify({
            expectedVersion: 2,
            reason: "Проверено через браузер",
          }),
          headers = {
            cookie: `impuls_session=${issuer.token}`,
            origin: origin!,
            "content-type": "application/json",
            "x-csrf-token": createCsrfToken(
              issuer.token,
              process.env.CSRF_SECRET!,
            ),
            "idempotency-key": randomUUID(),
          };
        const post = (h: Record<string, string>, b = body) =>
          fetch(endpoint, { method: "POST", headers: h, body: b });
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { origin: origin!, "content-type": "application/json" },
              body,
            })
          ).status,
        ).toBe(401);
        expect(
          (await post({ ...headers, origin: "https://invalid.example" }))
            .status,
        ).toBe(403);
        expect((await post({ ...headers, "x-csrf-token": "bad" })).status).toBe(
          403,
        );
        expect(
          (
            await post(
              headers,
              JSON.stringify({
                expectedVersion: 2,
                reason: "test",
                userId: f.owner.id,
              }),
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await post(
              headers,
              JSON.stringify({ expectedVersion: 2, reason: "x".repeat(9000) }),
            )
          ).status,
        ).toBe(400);
        const q = await fetch(
          `${origin}/api/v1/redemptions/fulfillment?scope=${scope}&limit=1`,
          { headers: { cookie: headers.cookie } },
        );
        expect(q.status).toBe(200);
        expect(q.headers.get("cache-control")).toContain("no-store");
        expect(
          (
            await fetch(
              `${origin}/api/v1/redemptions/fulfillment?scope=${foreign}`,
              { headers: { cookie: headers.cookie } },
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await fetch(
              `${origin}/api/v1/redemptions/fulfillment?limit=1&limit=2`,
              { headers: { cookie: headers.cookie } },
            )
          ).status,
        ).toBe(400);
        const browser = await chromium.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 390, height: 1100 },
            reducedMotion: "reduce",
          });
          await context.addCookies([
            { name: "impuls_session", value: issuer.token, url: origin! },
          ]);
          const page = await context.newPage();
          await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
            r.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
            }),
          );
          await page.goto(origin!);
          await page
            .getByRole("button", { name: "Поощрения", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Выдача поощрений", exact: true })
            .click();
          // Fixtures leave other approved requests; stable ID locates this request.
          await page
            .locator(`[data-redemption-id="${f.id}"]`)
            .getByRole("button", { name: "Подготовить выдачу" })
            .click();
          await page
            .getByLabel("Основание выдачи", { exact: true })
            .fill("Проверено через браузер");
          await page.getByRole("checkbox").check();
          await page
            .getByRole("button", { name: "Выдать поощрение", exact: true })
            .click();
          await page.getByText(/Поощрение выдано\./).waitFor();
          expect(await state(f)).toMatchObject({
            status: "fulfilled",
            entitlements: 1,
            available_points: "90",
            reserved_points: "0",
            used: 1,
          });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
          ).toBe(false);
        } finally {
          await browser.close();
        }
        const second = await fixture(),
          i = input(second),
          ep = `${origin}/api/v1/redemptions/${second.id}/fulfill`,
          h = { ...headers, "idempotency-key": i.idempotencyKey },
          b = JSON.stringify({ expectedVersion: 2, reason: i.reason });
        const first = await fetch(ep, { method: "POST", headers: h, body: b });
        expect(first.status).toBe(200);
        const response = await first.json();
        expect(first.headers.get("cache-control")).toContain("no-store");
        expect(
          await (
            await fetch(ep, { method: "POST", headers: h, body: b })
          ).json(),
        ).toEqual(response);
        expect(
          (
            await fetch(ep, {
              method: "POST",
              headers: h,
              body: JSON.stringify({ expectedVersion: 2, reason: "other" }),
            })
          ).status,
        ).toBe(409);
      },
      25000,
    );
    afterAll(async () => {
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
        [[scope, foreign]],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
      await runtime.end();
      await admin.end();
    });
  },
);
