import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishQuotaPeriod } from "../../packages/domain/src/admin/publish-quota";
import { readAdminCatalog } from "../../packages/domain/src/admin/catalog";
import { readAudit } from "../../packages/domain/src/admin/audit";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import { quotaPublicationResponseSchema } from "../../packages/contracts/src/quota-publication";
import { auditResponseSchema } from "../../packages/contracts/src/audit";
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F07 quota publication under runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        application_name: "quota-publication-tests",
        max: 8,
      });
    const users = [randomUUID(), randomUUID(), randomUUID()],
      scope = randomUUID(),
      foreign = randomUUID();
    const tokens = users.map(() => randomBytes(32).toString("base64url")),
      hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    beforeAll(async () => {
      for (const [i, u] of users.entries()) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic quota operator',true)",
          [u, randomInt(7e12, 8e12)],
        );
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [u, hashes[i]],
        );
        await admin.query(
          "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
          [u],
        );
      }
      for (const s of [scope, foreign])
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic quota scope')",
          [s],
        );
      for (const [u, actions] of [
        [
          users[0],
          ["admin.catalog", "admin.catalog.quota.publish", "admin.audit"],
        ],
        [users[1], ["admin.catalog", "admin.catalog.publish"]],
      ] as const)
        for (const action of actions)
          await admin.query(
            "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fixture')",
            [u, scope, action],
          );
      await admin.query(
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
        [users[2], scope],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=ANY($1::uuid[])",
        [users],
      );
    });
    async function fixture() {
      const rewardId = randomUUID(),
        id = randomUUID(),
        quota = randomUUID();
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,1,$4,'Synthetic conditions',30,'cosmetic','synthetic',true,clock_timestamp()-interval '1 minute')",
        [id, rewardId, scope, `Quota fixture ${rewardId}`],
      );
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute','2039-01-01T00:00:00.000Z',9)",
        [quota, rewardId, scope],
      );
      return { rewardId, id, quota };
    }
    const input = (f: Awaited<ReturnType<typeof fixture>>) => ({
      actorId: users[0]!,
      sessionHash: hashes[0]!,
      rewardId: f.rewardId,
      scope,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowPublication: true,
      startsAt: "2040-01-01T00:00:00.000Z",
      endsAt: "2040-02-01T00:00:00.000Z",
      capacity: 3,
      reason: "Explicit synthetic future quota",
    });
    async function state(f: Awaited<ReturnType<typeof fixture>>) {
      return (
        await admin.query(
          `SELECT
    (SELECT jsonb_agg(to_jsonb(q) ORDER BY starts_at) FROM impuls.quota_periods q WHERE reward_id=$1) quotas,
    (SELECT count(*)::int FROM impuls.quota_publications WHERE reward_id=$1) publications,
    (SELECT jsonb_agg(to_jsonb(d)) FROM impuls.redemptions d WHERE reward_id=$1) redemptions,
    (SELECT to_jsonb(b) FROM impuls.account_balances b WHERE user_id=$2) balance`,
          [f.rewardId, users[2]],
        )
      ).rows[0];
    }
    async function waitForBlock(pid: number) {
      for (let n = 0; n < 150; n++) {
        const r = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name='quota-publication-tests' AND $1=ANY(pg_blocking_pids(pid))",
          [pid],
        );
        if (r.rowCount) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("expected lock not reached");
    }
    it("appends one period and audit, replays exactly, preserves a pending old reserve and balance", async () => {
      const f = await fixture();
      expect(
        (
          await mutateRedemption(runtime, {
            actorId: users[2]!,
            sessionHash: hashes[2]!,
            idempotencyKey: randomUUID(),
            requestId: randomUUID(),
            allowSyntheticRewards: true,
            action: "reserve",
            rewardVersionId: f.id,
            quotaPeriodId: f.quota,
            expectedVersion: 1,
          })
        ).kind,
      ).toBe("ok");
      const before = await state(f),
        body = input(f),
        r = await publishQuotaPeriod(runtime, body);
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(
        quotaPublicationResponseSchema.parse(r.response).quota,
      ).toMatchObject({
        rewardId: f.rewardId,
        capacity: 3,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      });
      expect(await publishQuotaPeriod(runtime, body)).toEqual(r);
      expect(
        await publishQuotaPeriod(runtime, { ...body, capacity: 4 }),
      ).toEqual({ kind: "idempotency_conflict" });
      const after = await state(f);
      expect(after.quotas).toHaveLength(2);
      expect(after.quotas[0]).toEqual(before.quotas[0]);
      expect(after.quotas[1]).toMatchObject({
        capacity: 3,
        reserved: 0,
        used: 0,
        version: 1,
      });
      expect(after.redemptions).toEqual(before.redemptions);
      expect(after.balance).toEqual(before.balance);
      expect(after.publications).toBe(1);
      const audit = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "quota.publish",
      });
      if (audit.kind !== "ok") throw new Error(audit.kind);
      expect(auditResponseSchema.parse(audit.response).items[0]).toMatchObject({
        action: "quota.publish",
        quota: r.response.quota,
        reason: body.reason,
        task: null,
        reward: null,
        catalog: null,
        values: [],
      });
      expect(
        await readAudit(runtime, users[0]!, hashes[0]!, {
          allowSyntheticAudit: true,
          scope: foreign,
          action: "quota.publish",
        }),
      ).toEqual({ kind: "not_found" });
      await admin.query(
        "UPDATE impuls.quota_periods SET reserved=1,version=version+1 WHERE id=$1",
        [r.response.quota.periodId],
      );
      expect(await publishQuotaPeriod(runtime, body)).toEqual(r);
      const reread = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "quota.publish",
      });
      if (reread.kind !== "ok") throw new Error(reread.kind);
      expect(reread.response.items[0]?.quota).toEqual(r.response.quota);
    });
    it("requires independent exact authority, active session and both flags even for replay", async () => {
      const f = await fixture(),
        body = input(f);
      for (const [i, allowPublication, expected] of [
        [1, true, "not_found"],
        [2, true, "not_found"],
        [0, false, "disabled"],
      ] as const)
        expect(
          await publishQuotaPeriod(runtime, {
            ...body,
            actorId: users[i]!,
            sessionHash: hashes[i]!,
            allowPublication,
          }),
        ).toEqual({ kind: expected });
      expect(
        await publishQuotaPeriod(runtime, { ...body, scope: foreign }),
      ).toEqual({ kind: "not_found" });
      expect(
        await publishQuotaPeriod(runtime, { ...body, rewardId: randomUUID() }),
      ).toEqual({ kind: "not_found" });
      expect(
        await publishQuotaPeriod(runtime, {
          ...body,
          sessionHash: Buffer.alloc(32),
        }),
      ).toEqual({ kind: "unauthorized" });
      expect((await publishQuotaPeriod(runtime, body)).kind).toBe("ok");
      expect(
        await publishQuotaPeriod(runtime, { ...body, allowPublication: false }),
      ).toEqual({ kind: "disabled" });
      for (const [i, flag, expected] of [
        [0, true, true],
        [1, true, false],
        [0, false, false],
      ] as const) {
        const read = await readAdminCatalog(runtime, users[i]!, hashes[i]!, {
          enabled: true,
          scope,
          allowQuotaPublication: flag,
        });
        if (read.kind !== "ok") throw new Error(read.kind);
        expect(read.response.canPublishQuota).toBe(expected);
      }
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        users[0],
      ]);
      expect(await publishQuotaPeriod(runtime, body)).toEqual({
        kind: "revoked",
      });
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        users[0],
      ]);
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [users[0]],
      );
    });
    it("rejects overlap/past, accepts adjacency and zero, and serializes two publishers", async () => {
      const f = await fixture(),
        body = input(f);
      expect(
        await publishQuotaPeriod(runtime, {
          ...body,
          startsAt: "2038-01-01T00:00:00.000Z",
        }),
      ).toEqual({ kind: "overlap" });
      expect(
        await publishQuotaPeriod(runtime, {
          ...body,
          startsAt: "2000-01-01T00:00:00.000Z",
        }),
      ).toEqual({ kind: "invalid_period" });
      const results = await Promise.all([
        publishQuotaPeriod(runtime, body),
        publishQuotaPeriod(runtime, { ...body, idempotencyKey: randomUUID() }),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["ok", "overlap"]);
      expect((await state(f)).publications).toBe(1);
      expect(
        (
          await publishQuotaPeriod(runtime, {
            ...body,
            idempotencyKey: randomUUID(),
            startsAt: body.endsAt,
            endsAt: "2040-03-01T00:00:00.000Z",
            capacity: 0,
          })
        ).kind,
      ).toBe("ok");
    });
    it("replays after the period begins and allows a reserve without resetting any earlier period", async () => {
      const f = await fixture(),
        body = input(f);
      await admin.query("DELETE FROM impuls.quota_periods WHERE id=$1", [
        f.quota,
      ]);
      body.startsAt = new Date(Date.now() + 2000).toISOString();
      body.endsAt = new Date(Date.now() + 60000).toISOString();
      body.capacity = 1;
      const replies = await Promise.all([
        publishQuotaPeriod(runtime, body),
        publishQuotaPeriod(runtime, body),
      ]);
      expect(replies[1]).toEqual(replies[0]);
      const result = replies[0]!;
      if (result.kind !== "ok") throw new Error(result.kind);
      await new Promise((r) => setTimeout(r, 2100));
      expect(await publishQuotaPeriod(runtime, body)).toEqual(result);
      const reserve = await mutateRedemption(runtime, {
        actorId: users[2]!,
        sessionHash: hashes[2]!,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        allowSyntheticRewards: true,
        action: "reserve",
        rewardVersionId: f.id,
        quotaPeriodId: result.response.quota.periodId,
        expectedVersion: 1,
      });
      expect(reserve.kind).toBe("ok");
      const after = await state(f);
      expect(after.publications).toBe(1);
      expect(after.quotas).toHaveLength(1);
      expect(after.quotas[0]).toMatchObject({
        capacity: 1,
        reserved: 1,
        used: 0,
      });
      expect(await publishQuotaPeriod(runtime, body)).toEqual(result);
      const first = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "quota.publish",
        limit: 1,
      });
      if (first.kind !== "ok" || !first.response.nextCursor)
        throw new Error("missing audit cursor");
      const [, , , anchor] = first.response.nextCursor.split("|");
      const next = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "quota.publish",
        limit: 1,
        cursor: {
          actor: users[0]!,
          scope,
          action: "quota.publish",
          id: anchor!,
        },
      });
      if (next.kind !== "ok") throw new Error(next.kind);
      expect(next.response.items[0]?.id).not.toBe(first.response.items[0]?.id);
      expect(next.response.items[0]?.quota).toBeTruthy();
    });
    it("waits for the reserve quota barrier and rechecks expired authority/session and dates", async () => {
      for (const kind of ["permission", "session", "date"] as const) {
        const f = await fixture(),
          body = input(f),
          blocker = await admin.connect();
        try {
          if (kind === "permission")
            await admin.query(
              "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '1 second' WHERE user_id=$1 AND action='admin.catalog.quota.publish'",
              [users[0]],
            );
          if (kind === "session")
            await admin.query(
              "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
              [users[0]],
            );
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
            [users[0]],
          );
          if (kind === "date")
            body.startsAt = new Date(Date.now() + 1000).toISOString();
          await blocker.query("BEGIN");
          await blocker.query(
            "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
            [f.quota],
          );
          const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
              .rows[0].pid,
            pending = publishQuotaPeriod(runtime, body);
          await waitForBlock(pid);
          await new Promise((r) => setTimeout(r, 1100));
          await blocker.query("COMMIT");
          expect(await pending).toEqual({
            kind:
              kind === "permission"
                ? "not_found"
                : kind === "session"
                  ? "unauthorized"
                  : "invalid_period",
          });
          expect((await state(f)).publications).toBe(0);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await admin.query(
            "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1 AND action='admin.catalog.quota.publish'",
            [users[0]],
          );
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL,expires_at=clock_timestamp()+interval '1 hour' WHERE user_id=$1",
            [users[0]],
          );
        }
      }
    });
    it("rolls back quota and intent on audit failure; runtime cannot rewrite terms/history or initialize counters", async () => {
      const f = await fixture(),
        body = input(f),
        before = await state(f);
      await admin.query(
        "ALTER TABLE impuls.quota_publications ADD CONSTRAINT quota_test_failure CHECK (reason<>'Rollback quota')",
      );
      try {
        await expect(
          publishQuotaPeriod(runtime, { ...body, reason: "Rollback quota" }),
        ).rejects.toThrow();
        expect(await state(f)).toEqual(before);
      } finally {
        await admin.query(
          "ALTER TABLE impuls.quota_publications DROP CONSTRAINT quota_test_failure",
        );
      }
      const r = await publishQuotaPeriod(runtime, body);
      if (r.kind !== "ok") throw new Error(r.kind);
      for (const sql of [
        "UPDATE impuls.quota_periods SET capacity=capacity+1 WHERE id=$1",
        "DELETE FROM impuls.quota_periods WHERE id=$1",
      ])
        await expect(
          runtime.query(sql, [r.response.quota.periodId]),
        ).rejects.toMatchObject({ code: "42501" });
      await expect(
        runtime.query(
          "UPDATE impuls.quota_publications SET reason='Changed' WHERE id=$1",
          [r.response.publicationId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.query(
          "UPDATE impuls.quota_publications SET reason='Changed' WHERE id=$1",
          [r.response.publicationId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        admin.query(
          "UPDATE impuls.quota_periods SET capacity=capacity+1 WHERE id=$1",
          [r.response.quota.periodId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        runtime.query(
          "INSERT INTO impuls.quota_periods(reward_id,scope_id,starts_at,ends_at,capacity,reserved) VALUES($1,$2,'2042-01-01','2043-01-01',9,1)",
          [f.rewardId, scope],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      const acl = (
        await admin.query(
          "SELECT has_table_privilege('impuls_worker','impuls.quota_publications','SELECT') worker,has_function_privilege('public','impuls.guard_quota_publication()','EXECUTE') public",
        )
      ).rows[0];
      expect(acl).toEqual({ worker: false, public: false });
    });
    it.skipIf(!origin)(
      "real HTTP boundaries, replay and browser-to-database publication",
      async () => {
        const f = await fixture(),
          body = input(f),
          endpoint = `${origin}/api/v1/admin/rewards/${f.rewardId}/quotas`;
        const idempotencyKey = body.idempotencyKey;
        const data = {
          scope: body.scope,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          capacity: body.capacity,
          reason: body.reason,
        };
        const headers = {
          Origin: origin!,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-CSRF-Token": createCsrfToken(tokens[0]!, process.env.CSRF_SECRET!),
          Cookie: `impuls_session=${tokens[0]}`,
        };
        for (const [change, expected] of [
          [{ Origin: "https://foreign.invalid" }, 403],
          [{ "X-CSRF-Token": "wrong" }, 403],
          [{ "Content-Type": "text/plain" }, 400],
          [{ "Idempotency-Key": "bad" }, 400],
        ] as const)
          expect(
            (
              await fetch(endpoint, {
                method: "POST",
                headers: { ...headers, ...change },
                body: JSON.stringify(data),
              })
            ).status,
          ).toBe(expected);
        for (const [change, expected] of [
          [{ reserved: 1 }, 400],
          [{ reason: "x".repeat(20000) }, 413],
          [{ startsAt: "2000-01-01T00:00:00.000Z" }, 422],
        ] as const)
          expect(
            (
              await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...data, ...change }),
              })
            ).status,
          ).toBe(expected);
        expect(
          (
            await fetch(`${endpoint}?extra=1`, {
              method: "POST",
              headers,
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(400);
        expect((await fetch(endpoint, { method: "PUT", headers })).status).toBe(
          405,
        );
        const first = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        });
        expect(first.status).toBe(201);
        expect(first.headers.get("cache-control")).toBe("private, no-store");
        const saved = await first.json();
        expect(
          await (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify(data),
            })
          ).json(),
        ).toEqual(saved);
        const browser = await chromium.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 360, height: 844 },
          });
          await context.addCookies([
            { name: "impuls_session", value: tokens[0]!, url: origin! },
          ]);
          const page = await context.newPage();
          await page.goto(origin!);
          await page
            .getByRole("button", { name: "Управление каталогом", exact: true })
            .click();
          await page.getByLabel("Область", { exact: true }).selectOption(scope);
          const row = page
            .locator(".admin-catalog-items > li")
            .filter({ hasText: `Quota fixture ${f.rewardId}` });
          await row
            .getByRole("button", {
              name: "Опубликовать период квоты",
              exact: true,
            })
            .click();
          await row
            .getByLabel("Дата начала, UTC", { exact: true })
            .fill("2041-01-01");
          await row
            .getByLabel("Время начала, UTC", { exact: true })
            .fill("00:00");
          await row
            .getByLabel("Дата конца, UTC", { exact: true })
            .fill("2041-02-01");
          await row
            .getByLabel("Время конца, UTC", { exact: true })
            .fill("00:00");
          await row.getByLabel("Всего мест", { exact: true }).fill("4");
          await row
            .getByLabel("Основание публикации периода", { exact: true })
            .fill("Real browser synthetic quota");
          await row
            .getByRole("button", { name: "Проверить период", exact: true })
            .click();
          await row
            .getByRole("button", { name: "Подтвердить период", exact: true })
            .click();
          await page
            .getByText("Период подтверждён сервером. Перечитываем квоты.")
            .waitFor();
          const after = await state(f);
          expect(after.publications).toBe(2);
          expect(after.quotas.at(-1)).toMatchObject({
            capacity: 4,
            reserved: 0,
            used: 0,
          });
        } finally {
          await browser.close();
        }
      },
      30000,
    );
    afterAll(async () => {
      const cleanup = await admin.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("SET LOCAL session_replication_role=replica");
        for (const table of [
          "quota_publications",
          "audit_events",
          "idempotency_records",
        ])
          await cleanup.query(
            `DELETE FROM impuls.${table} WHERE actor_id=ANY($1::uuid[])`,
            [users],
          );
        for (const table of [
          "notification_outbox",
          "ledger_entries",
          "redemptions",
          "account_balances",
          "sessions",
          "task_scope_members",
          "role_bindings",
        ])
          await cleanup.query(
            `DELETE FROM impuls.${table} WHERE ${table === "notification_outbox" ? "recipient_id" : "user_id"}=ANY($1::uuid[])`,
            [users],
          );
        await cleanup.query(
          "DELETE FROM impuls.quota_periods WHERE scope_id=$1",
          [scope],
        );
        await cleanup.query(
          "DELETE FROM impuls.reward_versions WHERE scope_id=$1",
          [scope],
        );
        await cleanup.query(
          "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
          [[scope, foreign]],
        );
        await cleanup.query(
          "DELETE FROM impuls.users WHERE id=ANY($1::uuid[])",
          [users],
        );
        await cleanup.query("COMMIT");
      } catch (e) {
        await cleanup.query("ROLLBACK");
        throw e;
      } finally {
        cleanup.release();
        await runtime.end();
        await admin.end();
      }
    });
  },
);
