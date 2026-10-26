import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelScheduledCatalogTerms } from "../../packages/domain/src/admin/cancel-schedule";
import { readAdminCatalogHistory } from "../../packages/domain/src/admin/catalog-history";
import { catalogCancellationResponseSchema } from "../../packages/contracts/src/catalog-cancellation";
import { publishCatalogTerms } from "../../packages/domain/src/admin/publish";
import { readAdminCatalog } from "../../packages/domain/src/admin/catalog";
import { readAudit } from "../../packages/domain/src/admin/audit";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import { readRewardCatalog } from "../../packages/domain/src/rewards/read";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import { catalogPublicationResponseSchema } from "../../packages/contracts/src/catalog-publication";
import { auditResponseSchema } from "../../packages/contracts/src/audit";
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F07 future cancellation under runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        application_name: "catalog-cancellation-tests",
        max: 8,
      });
    const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
      scope = randomUUID(),
      foreign = randomUUID(),
      rewards: string[] = [];
    const tokens = users.map(() => randomBytes(32).toString("base64url")),
      hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    beforeAll(async () => {
      for (const [i, u] of users.entries()) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic publisher',true)",
          [u, randomInt(6e12, 7e12)],
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
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic publication scope')",
          [s],
        );
      for (const [u, actions] of [
        [
          users[0],
          [
            "admin.catalog",
            "admin.catalog.publish",
            "admin.catalog.schedule",
            "admin.catalog.schedule.cancel",
            "admin.audit",
          ],
        ],
        [users[1], ["admin.catalog"]],
        [users[3], ["admin.catalog", "admin.catalog.schedule"]],
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
    async function fixture(firstPage = false) {
      const rewardId = firstPage
          ? `00000000${randomUUID().slice(8)}`
          : randomUUID(),
        id = randomUUID(),
        quota = randomUUID();
      rewards.push(rewardId);
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds) VALUES($1,$2,$3,1,'Original synthetic title','Original synthetic conditions',30,'cosmetic',true,clock_timestamp()-interval '1 minute',3600)",
        [id, rewardId, scope],
      );
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',9)",
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
      expectedVersion: 1,
      title: `Published synthetic ${f.rewardId}`,
      conditions: "Published conditions",
      price: 19,
      enabled: false,
      reservationSeconds: null,
      reason: "Explicit synthetic publication",
    });
    const reserve = (f: Awaited<ReturnType<typeof fixture>>) => ({
      actorId: users[2]!,
      sessionHash: hashes[2]!,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowSyntheticRewards: true,
      action: "reserve" as const,
      rewardVersionId: f.id,
      quotaPeriodId: f.quota,
      expectedVersion: 1,
    });
    async function state(f: Awaited<ReturnType<typeof fixture>>) {
      return (
        await admin.query(
          `SELECT (SELECT jsonb_agg(to_jsonb(v) ORDER BY version) FROM impuls.reward_versions v WHERE reward_id=$1) versions,(SELECT to_jsonb(q) FROM impuls.quota_periods q WHERE id=$2) quota,(SELECT count(*)::int FROM impuls.catalog_publications p JOIN impuls.reward_versions v ON v.id=p.published_version_id WHERE v.reward_id=$1) publications`,
          [f.rewardId, f.quota],
        )
      ).rows[0];
    }
    async function waitForBlock(pid: number) {
      for (let n = 0; n < 100; n++) {
        const r = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name='catalog-cancellation-tests' AND $1=ANY(pg_blocking_pids(pid))",
          [pid],
        );
        if (r.rowCount) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("transaction did not reach expected lock");
    }
    async function future(seconds = 60) {
      return (
        await admin.query<{ at: string }>(
          "SELECT to_char((clock_timestamp()+$1*interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') at",
          [seconds],
        )
      ).rows[0]!.at;
    }

    async function scheduled(seconds = 60) {
      const f = await fixture(true),
        body = {
          ...input(f),
          enabled: true,
          effectiveFrom: await future(seconds),
        };
      const publication = await publishCatalogTerms(runtime, body);
      if (publication.kind !== "ok") throw Error(publication.kind);
      return {
        ...f,
        terms: publication.response.catalog.published,
        publishBody: body,
      };
    }
    const cancelInput = (f: Awaited<ReturnType<typeof scheduled>>) => ({
      actorId: users[0]!,
      sessionHash: hashes[0]!,
      rewardId: f.rewardId,
      scope,
      versionId: f.terms.id,
      expectedVersion: 2,
      reason: "Synthetic cancellation reason",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowCancellation: true,
    });
    it("appends immutable evidence, preserves reserves/resources and reads cancelled history/audit; replay is exact", async () => {
      const f = await scheduled();
      const reserveResult = await mutateRedemption(runtime, reserve(f));
      expect(reserveResult.kind).toBe("ok");
      const before = await state(f),
        balance = (
          await admin.query(
            "SELECT * FROM impuls.account_balances WHERE user_id=$1",
            [users[2]],
          )
        ).rows;
      const body = cancelInput(f),
        result = await cancelScheduledCatalogTerms(runtime, body);
      if (result.kind !== "ok") throw Error(result.kind);
      expect(catalogCancellationResponseSchema.parse(result.response)).toEqual(
        result.response,
      );
      expect(result.response.cancellation.cancelled).toEqual(f.terms);
      expect(await cancelScheduledCatalogTerms(runtime, body)).toEqual(result);
      expect(
        await cancelScheduledCatalogTerms(runtime, {
          ...body,
          reason: "Changed",
        }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect(
        await cancelScheduledCatalogTerms(runtime, {
          ...body,
          idempotencyKey: randomUUID(),
        }),
      ).toEqual({ kind: "conflict" });
      expect(await state(f)).toEqual(before);
      expect(
        (
          await admin.query(
            "SELECT * FROM impuls.account_balances WHERE user_id=$1",
            [users[2]],
          )
        ).rows,
      ).toEqual(balance);
      const read = await readAdminCatalog(runtime, users[0]!, hashes[0]!, {
        enabled: true,
        allowCancellation: true,
        scope,
        limit: 50,
      });
      if (read.kind !== "ok") throw Error(read.kind);
      expect(read.response.canCancelSchedule).toBe(true);
      expect(
        read.response.items.find((i) => i.rewardId === f.rewardId),
      ).toMatchObject({ current: { version: 1, price: 30 }, scheduled: null });
      const history = await readAdminCatalogHistory(
        runtime,
        users[0]!,
        hashes[0]!,
        f.rewardId,
        { enabled: true, scope },
      );
      if (history.kind !== "ok") throw Error(history.kind);
      expect(history.response.items.map((i) => [i.version, i.state])).toEqual([
        [2, "cancelled"],
        [1, "current"],
      ]);
      const audit = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "catalog.cancel",
      });
      if (audit.kind !== "ok") throw Error(audit.kind);
      expect(auditResponseSchema.safeParse(audit.response).success).toBe(true);
      expect(
        audit.response.items.find(
          (i) => i.id === result.response.cancellationId,
        ),
      ).toMatchObject({
        reason: body.reason,
        cancellation: {
          rewardId: f.rewardId,
          cancelled: { version: 2, price: 19 },
        },
      });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.catalog_cancellations WHERE version_id=$1",
            [f.terms.id],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(
        runtime.query(
          "UPDATE impuls.catalog_cancellations SET reason='tampered' WHERE version_id=$1",
          [f.terms.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.query(
          "DELETE FROM impuls.catalog_cancellations WHERE version_id=$1",
          [f.terms.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await admin.query(
            "SELECT has_table_privilege('impuls_worker','impuls.catalog_cancellations','INSERT') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    });
    it("allocates version 3 after cancellation and preserves both publication replays", async () => {
      const f = await scheduled();
      expect(
        (await cancelScheduledCatalogTerms(runtime, cancelInput(f))).kind,
      ).toBe("ok");
      const published = await publishCatalogTerms(runtime, {
        ...input(f),
        enabled: true,
      });
      if (published.kind !== "ok") throw Error(published.kind);
      expect(published.response.catalog).toMatchObject({
        previousVersion: 1,
        published: { version: 3 },
      });
      expect(
        catalogPublicationResponseSchema.safeParse(published.response).success,
      ).toBe(true);
      expect((await publishCatalogTerms(runtime, f.publishBody)).kind).toBe(
        "ok",
      );
      const audit = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "catalog.publish",
      });
      if (audit.kind !== "ok") throw Error(audit.kind);
      expect(auditResponseSchema.safeParse(audit.response).success).toBe(true);
    });
    it("rejects missing exact authority, foreign scope/target, disabled flags and stale version without evidence", async () => {
      const f = await scheduled(),
        body = cancelInput(f);
      for (const overrides of [
        { actorId: users[1]!, sessionHash: hashes[1]! },
        { actorId: users[3]!, sessionHash: hashes[3]! },
        { scope: foreign },
        { rewardId: randomUUID() },
        { versionId: f.id },
      ])
        expect(
          await cancelScheduledCatalogTerms(runtime, { ...body, ...overrides }),
        ).toEqual({ kind: "not_found" });
      expect(
        await cancelScheduledCatalogTerms(runtime, {
          ...body,
          allowCancellation: false,
        }),
      ).toEqual({ kind: "disabled" });
      expect(
        await cancelScheduledCatalogTerms(runtime, {
          ...body,
          expectedVersion: 1,
        }),
      ).toEqual({ kind: "conflict" });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.catalog_cancellations WHERE version_id=$1",
            [f.terms.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("rolls back an invalid database insertion together with its idempotency intent", async () => {
      const f = await scheduled(),
        body = { ...cancelInput(f), reason: "" };
      await expect(
        cancelScheduledCatalogTerms(runtime, body),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.catalog_cancellations WHERE version_id=$1",
            [f.terms.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='catalog.cancel' AND key=$2",
            [users[0], body.idempotencyKey],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("serializes competing cancellations and permits publication only after confirmed cancellation", async () => {
      const f = await scheduled();
      const results = await Promise.all([
        cancelScheduledCatalogTerms(runtime, cancelInput(f)),
        cancelScheduledCatalogTerms(runtime, cancelInput(f)),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      const published = await publishCatalogTerms(runtime, {
        ...input(f),
        effectiveFrom: await future(120),
      });
      if (published.kind !== "ok") throw Error(published.kind);
      expect(published.response.catalog.published.version).toBe(3);
    });
    it("rechecks server time after quota wait and leaves no intent or evidence when terms start", async () => {
      const f = await scheduled(1),
        body = cancelInput(f),
        lock = await admin.connect();
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [f.quota],
        );
        const pending = cancelScheduledCatalogTerms(runtime, body);
        await waitForBlock(
          (await lock.query("SELECT pg_backend_pid() pid")).rows[0].pid,
        );
        await new Promise((r) => setTimeout(r, 1200));
        await lock.query("COMMIT");
        expect(await pending).toEqual({ kind: "started" });
        expect(
          (
            await admin.query(
              "SELECT count(*)::int n FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='catalog.cancel' AND key=$2",
              [users[0], body.idempotencyKey],
            )
          ).rows[0].n,
        ).toBe(0);
        await expect(
          runtime.query(
            "INSERT INTO impuls.catalog_cancellations(version_id,actor_id,request_id,reason) VALUES($1,$2,$3,'Direct late insert')",
            [f.terms.id, users[0], randomUUID()],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
    });
    it("never activates cancelled terms after their date; replay after date remains exact", async () => {
      const f = await scheduled(1),
        body = cancelInput(f),
        result = await cancelScheduledCatalogTerms(runtime, body);
      expect(result.kind).toBe("ok");
      await new Promise((r) => setTimeout(r, 1200));
      const read = await readRewardCatalog(runtime, users[2]!, hashes[2]!, {
        allowSyntheticRewards: true,
        scope,
        limit: 50,
      });
      if (read.kind !== "ok") throw Error(read.kind);
      expect(
        read.response.items.find((i) => i.rewardId === f.rewardId),
      ).toMatchObject({ version: 1, price: 30 });
      expect(
        await mutateRedemption(runtime, {
          ...reserve(f),
          rewardVersionId: f.terms.id,
          expectedVersion: 2,
        }),
      ).toEqual({ kind: "not_found" });
      expect((await mutateRedemption(runtime, reserve(f))).kind).toBe("ok");
      expect(await cancelScheduledCatalogTerms(runtime, body)).toEqual(result);
    });
    it("rechecks expired permission after wait and rejects replay after revocation", async () => {
      const f = await scheduled(),
        body = cancelInput(f);
      await admin.query(
        "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '1 second' WHERE user_id=$1 AND action='admin.catalog.schedule.cancel'",
        [users[0]],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [users[0]],
      );
      const lock = await admin.connect();
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [f.quota],
        );
        const pending = cancelScheduledCatalogTerms(runtime, body);
        await waitForBlock(
          (await lock.query("SELECT pg_backend_pid() pid")).rows[0].pid,
        );
        await new Promise((r) => setTimeout(r, 1200));
        await lock.query("COMMIT");
        expect(await pending).toEqual({ kind: "not_found" });
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
        await admin.query(
          "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1 AND action='admin.catalog.schedule.cancel'",
          [users[0]],
        );
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
      }
      const saved = await cancelScheduledCatalogTerms(runtime, body);
      expect(saved.kind).toBe("ok");
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [users[0]],
      );
      expect(await cancelScheduledCatalogTerms(runtime, body)).toEqual({
        kind: "unauthorized",
      });
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [users[0]],
      );
    });
    it.skipIf(!origin)(
      "checks real HTTP Origin/CSRF/strict payload and browser-to-database cancellation",
      async () => {
        const f = await scheduled(),
          body = cancelInput(f),
          csrf = createCsrfToken(tokens[0]!, process.env.CSRF_SECRET!);
        const payload = {
          scope,
          versionId: f.terms.id,
          expectedVersion: 2,
          reason: body.reason,
        };
        const endpoint =
          origin +
          "/api/v1/admin/rewards/" +
          f.rewardId +
          "/scheduled-versions/cancel";
        const headers = {
          "Content-Type": "application/json",
          Origin: origin!,
          Cookie: "impuls_session=" + tokens[0],
          "X-CSRF-Token": csrf,
          "Idempotency-Key": body.idempotencyKey,
        };
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, Origin: "https://foreign.invalid" },
              body: JSON.stringify(payload),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, "X-CSRF-Token": "invalid" },
              body: JSON.stringify(payload),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...payload, price: 1 }),
            })
          ).status,
        ).toBe(400);
        const browser = await chromium.launch();
        try {
          const context = await browser.newContext({
              viewport: { width: 390, height: 844 },
            }),
            page = await context.newPage();
          // Подробности карточки каталога свёрнуты; сценарию нужны все кнопки.
          await page.addInitScript(() => {
            new MutationObserver(() => {
              for (const d of document.querySelectorAll<HTMLDetailsElement>(
                "details.admin-catalog-more:not([open])",
              ))
                d.open = true;
            }).observe(document, { childList: true, subtree: true });
          });
          await context.addCookies([
            { name: "impuls_session", value: tokens[0]!, url: origin! },
          ]);
          await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
            r.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{ready(){},expand(){},onEvent(){},offEvent(){}}}",
            }),
          );
          await page.goto(origin!);
          await page.getByRole("button", { name: "Ещё", exact: true }).click();
          await page
            .getByRole("button", { name: "Управление каталогом", exact: true })
            .click();
          const item = page
            .locator(".admin-catalog-items > li")
            .filter({ hasText: f.terms.title });
          await item
            .getByRole("button", {
              name: "Отменить будущие условия",
              exact: true,
            })
            .click();
          await item
            .getByLabel("Основание отмены", { exact: true })
            .fill(payload.reason);
          await item
            .getByRole("button", { name: "Проверить отмену", exact: true })
            .click();
          const responsePromise = page.waitForResponse(
            (r) => r.url() === endpoint && r.request().method() === "POST",
          );
          await item
            .getByRole("button", { name: "Подтвердить отмену", exact: true })
            .click();
          const response = await responsePromise;
          expect(response.status()).toBe(201);
          expect(response.headers()["cache-control"]).toContain("no-store");
          const saved = catalogCancellationResponseSchema.parse(
            await response.json(),
          );
          expect(saved.cancellation.cancelled.id).toBe(f.terms.id);
          expect(
            (
              await admin.query(
                "SELECT count(*)::int n FROM impuls.catalog_cancellations WHERE version_id=$1",
                [f.terms.id],
              )
            ).rows[0].n,
          ).toBe(1);
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
        await cleanup.query(
          "DELETE FROM impuls.catalog_cancellations WHERE actor_id=ANY($1::uuid[])",
          [users],
        );
        await cleanup.query(
          "DELETE FROM impuls.catalog_publications WHERE actor_id=ANY($1::uuid[])",
          [users],
        );
        for (const table of ["audit_events", "idempotency_records"])
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
