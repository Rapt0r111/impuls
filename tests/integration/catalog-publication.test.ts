import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  "F07 immutable catalog publication under runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        application_name: "catalog-publication-tests",
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
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from,reservation_seconds) VALUES($1,$2,$3,1,'Original synthetic title','Original synthetic conditions',30,'cosmetic','synthetic',true,clock_timestamp()-interval '1 minute',3600)",
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
          "SELECT 1 FROM pg_stat_activity WHERE application_name='catalog-publication-tests' AND $1=ANY(pg_blocking_pids(pid))",
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
    it("schedules one immutable future version without changing current terms or resources; audit and replay preserve the date", async () => {
      const f = await fixture(),
        before = await state(f),
        body = { ...input(f), effectiveFrom: await future() };
      const balance = (
        await admin.query(
          "SELECT * FROM impuls.account_balances WHERE user_id=$1",
          [users[2]],
        )
      ).rows;
      const result = await publishCatalogTerms(runtime, body);
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(Date.parse(result.response.catalog.published.effectiveFrom)).toBe(
        Date.parse(body.effectiveFrom),
      );
      expect(Date.parse(result.response.updatedAt)).toBeLessThan(
        Date.parse(body.effectiveFrom),
      );
      expect((await state(f)).quota).toEqual(before.quota);
      expect(
        (
          await admin.query(
            "SELECT * FROM impuls.account_balances WHERE user_id=$1",
            [users[2]],
          )
        ).rows,
      ).toEqual(balance);
      expect(await publishCatalogTerms(runtime, body)).toEqual(result);
      expect((await state(f)).publications).toBe(1);
      const read = await readAdminCatalog(runtime, users[0]!, hashes[0]!, {
        enabled: true,
        allowScheduling: true,
        scope,
        limit: 50,
      });
      if (read.kind !== "ok") throw new Error(read.kind);
      expect(read.response.canSchedule).toBe(true);
      expect(
        read.response.items.find((i) => i.rewardId === f.rewardId),
      ).toMatchObject({
        current: { version: 1, price: 30 },
        scheduled: { version: 2, price: 19 },
      });
      const audit = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "catalog.publish",
        limit: 50,
      });
      if (audit.kind !== "ok") throw new Error(audit.kind);
      expect(
        audit.response.items.find((i) => i.id === result.response.publicationId)
          ?.catalog,
      ).toEqual(result.response.catalog);
      expect(
        (
          await publishCatalogTerms(runtime, {
            ...body,
            effectiveFrom: await future(120),
          })
        ).kind,
      ).toBe("idempotency_conflict");
    });
    it("requires separate exact schedule authority and flag; scheduling-only authority cannot publish immediately", async () => {
      const f = await fixture(),
        body = { ...input(f), effectiveFrom: await future() },
        before = await state(f);
      for (const changed of [
        { actorId: users[1]!, sessionHash: hashes[1]! },
        { scope: foreign },
        { allowPublication: false },
      ]) {
        expect(
          (await publishCatalogTerms(runtime, { ...body, ...changed })).kind,
        ).toBe("allowPublication" in changed ? "disabled" : "not_found");
      }
      expect(
        (
          await publishCatalogTerms(runtime, {
            ...input(f),
            actorId: users[3]!,
            sessionHash: hashes[3]!,
          })
        ).kind,
      ).toBe("not_found");
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE user_id=$1 AND action='admin.catalog.schedule'",
        [users[0]],
      );
      try {
        expect((await publishCatalogTerms(runtime, body)).kind).toBe(
          "not_found",
        );
        expect(await state(f)).toEqual(before);
      } finally {
        await admin.query(
          "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND action='admin.catalog.schedule'",
          [users[0]],
        );
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
      }
      const result = await publishCatalogTerms(runtime, {
        ...body,
        actorId: users[3]!,
        sessionHash: hashes[3]!,
      });
      expect(result.kind).toBe("ok");
      const read = await readAdminCatalog(runtime, users[3]!, hashes[3]!, {
        enabled: true,
        allowScheduling: true,
        allowPublication: true,
        scope,
      });
      if (read.kind !== "ok") throw new Error(read.kind);
      expect(read.response).toMatchObject({
        canSchedule: true,
        canPublish: false,
      });
      const disabled = await readAdminCatalog(runtime, users[3]!, hashes[3]!, {
        enabled: true,
        scope,
      });
      if (disabled.kind !== "ok") throw new Error(disabled.kind);
      expect(disabled.response.canSchedule).toBe(false);
    });
    it("rejects past dates, stale current versions and a second future version without partial writes", async () => {
      const f = await fixture(),
        before = await state(f);
      expect(
        (
          await publishCatalogTerms(runtime, {
            ...input(f),
            effectiveFrom: await future(-1),
          })
        ).kind,
      ).toBe("invalid_effective_time");
      expect(
        (
          await publishCatalogTerms(runtime, {
            ...input(f),
            expectedVersion: 2,
            effectiveFrom: await future(),
          })
        ).kind,
      ).toBe("conflict");
      expect(await state(f)).toEqual(before);
      expect(
        (
          await publishCatalogTerms(runtime, {
            ...input(f),
            effectiveFrom: await future(),
          })
        ).kind,
      ).toBe("ok");
      const saved = await state(f);
      expect(
        (
          await publishCatalogTerms(runtime, {
            ...input(f),
            effectiveFrom: await future(120),
          })
        ).kind,
      ).toBe("scheduled");
      expect((await publishCatalogTerms(runtime, input(f))).kind).toBe(
        "scheduled",
      );
      expect(await state(f)).toEqual(saved);
    });
    it("serializes schedule/schedule and schedule/immediate races with exactly one publication", async () => {
      for (const immediate of [false, true]) {
        const f = await fixture(),
          effectiveFrom = await future();
        const results = await Promise.all([
          publishCatalogTerms(runtime, { ...input(f), effectiveFrom }),
          publishCatalogTerms(runtime, {
            ...input(f),
            ...(immediate ? {} : { effectiveFrom }),
          }),
        ]);
        expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
        expect(["scheduled", "conflict"]).toContain(
          results.find((r) => r.kind !== "ok")?.kind,
        );
        expect((await state(f)).publications).toBe(1);
      }
    });
    it("rechecks the date after waiting on the quota barrier and rolls back the intent", async () => {
      const f = await fixture(),
        before = await state(f),
        blocker = await admin.connect();
      const body = { ...input(f), effectiveFrom: await future(0.4) };
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [f.quota],
        );
        const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid;
        const waiting = publishCatalogTerms(runtime, body);
        await waitForBlock(pid);
        await blocker.query("SELECT pg_sleep(0.5)");
        await blocker.query("COMMIT");
        expect((await waiting).kind).toBe("invalid_effective_time");
        expect(await state(f)).toEqual(before);
        expect(
          (
            await admin.query(
              "SELECT 1 FROM impuls.idempotency_records WHERE actor_id=$1 AND key=$2",
              [body.actorId, body.idempotencyKey],
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    });
    it("keeps old reservation snapshots and activates by PostgreSQL time; replay remains valid after activation", async () => {
      const f = await fixture(),
        body = {
          ...input(f),
          price: 19,
          enabled: true,
          effectiveFrom: await future(0.8),
        };
      const saved = await publishCatalogTerms(runtime, body);
      if (saved.kind !== "ok") throw new Error(saved.kind);
      const old = await mutateRedemption(runtime, reserve(f));
      if (old.kind !== "ok") throw new Error(old.kind);
      await admin.query(
        "SELECT pg_sleep(greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)",
        [body.effectiveFrom],
      );
      const catalog = await readRewardCatalog(runtime, users[2]!, hashes[2]!, {
        allowSyntheticRewards: true,
        scope,
        limit: 50,
      });
      if (catalog.kind !== "ok") throw new Error(catalog.kind);
      expect(
        catalog.response.items.find((i) => i.rewardId === f.rewardId),
      ).toMatchObject({ version: 2, price: 19 });
      expect((await mutateRedemption(runtime, reserve(f))).kind).toBe(
        "conflict",
      );
      expect(
        (
          await admin.query(
            "SELECT price,reward_version,conditions FROM impuls.redemptions WHERE id=$1",
            [old.response.redemption.id],
          )
        ).rows[0],
      ).toEqual({
        price: 30,
        reward_version: 1,
        conditions: "Original synthetic conditions",
      });
      expect(await publishCatalogTerms(runtime, body)).toEqual(saved);
      expect((await state(f)).publications).toBe(1);
      expect((await state(f)).quota).toMatchObject({
        capacity: 9,
        reserved: 1,
        used: 0,
      });
    });
    it("rechecks scheduling authority after lock waits, and denies replay after revocation", async () => {
      for (const kind of ["session", "permission"]) {
        const f = await fixture(),
          before = await state(f),
          blocker = await admin.connect();
        const body = { ...input(f), effectiveFrom: await future() };
        const change =
          kind === "session"
            ? "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '0.4 second' WHERE user_id=$1"
            : "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '0.4 second' WHERE user_id=$1 AND action='admin.catalog.schedule'";
        await admin.query(change, [users[0]]);
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
        try {
          await blocker.query("BEGIN");
          await blocker.query(
            "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
            [f.quota],
          );
          const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
            .rows[0].pid;
          const waiting = publishCatalogTerms(runtime, body);
          await waitForBlock(pid);
          await blocker.query("SELECT pg_sleep(0.5)");
          await blocker.query("COMMIT");
          expect((await waiting).kind).toBe(
            kind === "session" ? "unauthorized" : "not_found",
          );
          expect(await state(f)).toEqual(before);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await admin.query(
            kind === "session"
              ? "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE user_id=$1"
              : "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1 AND action='admin.catalog.schedule'",
            [users[0]],
          );
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
            [users[0]],
          );
        }
      }
      const f = await fixture(),
        body = { ...input(f), effectiveFrom: await future() };
      expect((await publishCatalogTerms(runtime, body)).kind).toBe("ok");
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE user_id=$1 AND action='admin.catalog.schedule'",
        [users[0]],
      );
      try {
        expect((await publishCatalogTerms(runtime, body)).kind).toBe(
          "not_found",
        );
      } finally {
        await admin.query(
          "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND action='admin.catalog.schedule'",
          [users[0]],
        );
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
      }
    });
    it("publishes one immutable sequential version, reason and exact audit evidence; replay adds nothing", async () => {
      const f = await fixture(),
        body = input(f),
        before = await state(f),
        r = await publishCatalogTerms(runtime, body);
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(catalogPublicationResponseSchema.parse(r.response)).toMatchObject({
        scope,
        catalog: {
          rewardId: f.rewardId,
          previousVersion: 1,
          published: {
            version: 2,
            price: 19,
            enabled: false,
            reservationSeconds: null,
          },
        },
      });
      expect(await publishCatalogTerms(runtime, body)).toEqual(r);
      expect(
        await publishCatalogTerms(runtime, { ...body, price: 20 }),
      ).toEqual({ kind: "idempotency_conflict" });
      const after = await state(f);
      expect(after.versions).toHaveLength(2);
      expect(after.versions[0]).toEqual(before.versions[0]);
      expect(after.quota).toEqual(before.quota);
      expect(after.publications).toBe(1);
      const audit = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "catalog.publish",
      });
      if (audit.kind !== "ok") throw new Error(audit.kind);
      expect(auditResponseSchema.parse(audit.response).items[0]).toMatchObject({
        action: "catalog.publish",
        reason: body.reason,
        catalog: r.response.catalog,
        task: null,
        reward: null,
        values: [],
      });
      for (const [i, allowPublication, canPublish] of [
        [0, true, true],
        [1, true, false],
        [0, false, false],
      ] as const) {
        const read = await readAdminCatalog(runtime, users[i]!, hashes[i]!, {
          enabled: true,
          scope,
          allowPublication,
        });
        if (read.kind !== "ok") throw new Error(read.kind);
        expect(read.response.canPublish).toBe(canPublish);
      }
    });
    it("requires both exact scoped rights and flag, including for saved replay", async () => {
      const f = await fixture(),
        body = input(f),
        before = await state(f);
      expect(
        await publishCatalogTerms(runtime, {
          ...body,
          actorId: users[1]!,
          sessionHash: hashes[1]!,
        }),
      ).toEqual({ kind: "not_found" });
      expect(
        await publishCatalogTerms(runtime, { ...body, scope: foreign }),
      ).toEqual({ kind: "not_found" });
      expect(
        await publishCatalogTerms(runtime, {
          ...body,
          allowPublication: false,
        }),
      ).toEqual({ kind: "disabled" });
      expect(await state(f)).toEqual(before);
      await publishCatalogTerms(runtime, body);
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE user_id=$1 AND action='admin.catalog.publish'",
        [users[0]],
      );
      try {
        expect(await publishCatalogTerms(runtime, body)).toEqual({
          kind: "not_found",
        });
      } finally {
        await admin.query(
          "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND action='admin.catalog.publish'",
          [users[0]],
        );
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
      }
    });
    it("rejects future, nonmonotonic and stale versions without extra writes", async () => {
      for (const mode of ["future", "nonmonotonic", "stale"]) {
        const f = await fixture(),
          body = input(f);
        if (mode !== "stale")
          await admin.query(
            "INSERT INTO impuls.reward_versions(reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,2,'Fixture','Synthetic conditions',17,'cosmetic','synthetic',true,clock_timestamp()+$3::interval)",
            [f.rewardId, scope, mode === "future" ? "1 hour" : "-2 minutes"],
          );
        const before = await state(f);
        expect(
          (
            await publishCatalogTerms(runtime, {
              ...body,
              expectedVersion: mode === "stale" ? 2 : 1,
            })
          ).kind,
        ).toBe(
          mode === "future"
            ? "scheduled"
            : mode === "stale"
              ? "conflict"
              : "configuration_invalid",
        );
        expect(await state(f)).toEqual(before);
      }
    });
    it("serializes racing publishers: one publication and one stale-version conflict", async () => {
      const f = await fixture();
      const results = await Promise.all([
        publishCatalogTerms(runtime, input(f)),
        publishCatalogTerms(runtime, input(f)),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      expect((await state(f)).publications).toBe(1);
    });
    it("keeps already reserved terms, and rejects stale reservations after publication", async () => {
      const f = await fixture(),
        r = await mutateRedemption(runtime, reserve(f));
      if (r.kind !== "ok") throw new Error(r.kind);
      await publishCatalogTerms(runtime, input(f));
      expect(
        (
          await admin.query(
            "SELECT price,reward_version,title,conditions FROM impuls.redemptions WHERE id=$1",
            [r.response.redemption.id],
          )
        ).rows[0],
      ).toEqual({
        price: 30,
        reward_version: 1,
        title: "Original synthetic title",
        conditions: "Original synthetic conditions",
      });
      expect((await mutateRedemption(runtime, reserve(f))).kind).toBe(
        "conflict",
      );
      expect((await state(f)).quota).toMatchObject({
        reserved: 1,
        used: 0,
        capacity: 9,
      });
    });
    it("waits for the same quota barrier and rejects an old reservation already waiting behind it", async () => {
      const f = await fixture(),
        blocker = await admin.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [f.quota],
        );
        const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid;
        const publication = publishCatalogTerms(runtime, input(f));
        await waitForBlock(pid);
        const reservation = mutateRedemption(runtime, reserve(f));
        await waitForBlock(pid);
        await blocker.query("COMMIT");
        expect((await publication).kind).toBe("ok");
        expect((await reservation).kind).toBe("conflict");
        expect((await state(f)).quota.reserved).toBe(0);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    });
    it("rechecks expired sessions and permissions after a quota wait", async () => {
      for (const kind of ["session", "permission"]) {
        const f = await fixture(),
          blocker = await admin.connect(),
          before = await state(f);
        const sql =
          kind === "session"
            ? "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '0.4 second' WHERE user_id=$1"
            : "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '0.4 second' WHERE user_id=$1 AND action='admin.catalog.publish'";
        await admin.query(sql, [users[0]]);
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
        try {
          await blocker.query("BEGIN");
          await blocker.query(
            "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
            [f.quota],
          );
          const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
              .rows[0].pid,
            publication = publishCatalogTerms(runtime, input(f));
          await waitForBlock(pid);
          await blocker.query("SELECT pg_sleep(0.5)");
          await blocker.query("COMMIT");
          expect((await publication).kind).toBe(
            kind === "session" ? "unauthorized" : "not_found",
          );
          expect(await state(f)).toEqual(before);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await admin.query(
            kind === "session"
              ? "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE user_id=$1"
              : "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1 AND action='admin.catalog.publish'",
            [users[0]],
          );
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
            [users[0]],
          );
        }
      }
    });
    it("rolls back new terms and idempotency when publication evidence cannot commit", async () => {
      const f = await fixture(),
        body = { ...input(f), reason: " ".repeat(2001) },
        before = await state(f);
      await expect(publishCatalogTerms(runtime, body)).rejects.toMatchObject({
        code: "23514",
      });
      expect(await state(f)).toEqual(before);
      expect(
        (
          await admin.query(
            "SELECT 1 FROM impuls.idempotency_records WHERE actor_id=$1 AND key=$2",
            [body.actorId, body.idempotencyKey],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("denies runtime edits/deletes and enforces immutable evidence even for table owner", async () => {
      const f = await fixture(),
        r = await publishCatalogTerms(runtime, input(f));
      if (r.kind !== "ok") throw new Error(r.kind);
      for (const statement of [
        "UPDATE impuls.catalog_publications SET reason='rewrite' WHERE id=$1",
        "DELETE FROM impuls.catalog_publications WHERE id=$1",
      ])
        await expect(
          runtime.query(statement, [r.response.publicationId]),
        ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.query("DELETE FROM impuls.catalog_publications WHERE id=$1", [
          r.response.publicationId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });
    (origin ? it : it.skip)(
      "serves strict HTTP, no-store, CSRF, scoped rejection, replay and actual UI submission",
      async () => {
        const f = await fixture(true),
          body = input(f),
          endpoint = `${origin}/api/v1/admin/rewards/${f.rewardId}/versions`,
          csrf = createCsrfToken(tokens[0]!, process.env.CSRF_SECRET!);
        const data = {
          scope,
          expectedVersion: 1,
          title: body.title,
          conditions: body.conditions,
          price: body.price,
          enabled: false,
          reservationSeconds: null,
          reason: body.reason,
        };
        const headers = {
          Origin: origin!,
          Cookie: `impuls_session=${tokens[0]}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": body.idempotencyKey,
        };
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, Origin: "https://invalid.example" },
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, "X-CSRF-Token": "bad" },
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint + "?scope=" + scope, {
              method: "POST",
              headers,
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...data, effectiveFrom: "2020-01-01" }),
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...data, reason: "a".repeat(20000) }),
            })
          ).status,
        ).toBe(413);
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
          // Подробности карточки каталога свёрнуты; сценарию нужны все кнопки.
          await page.addInitScript(() => {
            new MutationObserver(() => {
              for (const d of document.querySelectorAll<HTMLDetailsElement>(
                "details.admin-catalog-more:not([open])",
              ))
                d.open = true;
            }).observe(document, { childList: true, subtree: true });
          });
          page.setDefaultTimeout(5000);
          await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
            r.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{version:'8.0',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){}}}",
            }),
          );
          await page.goto(origin!, { waitUntil: "domcontentloaded" });
          await page.getByRole("button", { name: "Ещё", exact: true }).click();
          await page
            .getByRole("button", { name: "Управление каталогом", exact: true })
            .click();
          // При одной области списка нет: каталог сразу открыт в ней.
          await page
            .locator('.admin-catalog-section[aria-busy="false"]')
            .waitFor();
          const scopeField = page.getByLabel("Область", { exact: true });
          if (await scopeField.count()) await scopeField.selectOption(scope);
          const row = page
            .locator(".admin-catalog-items > li")
            .filter({ hasText: body.title });
          await row
            .getByRole("button", {
              name: "Опубликовать новые условия",
              exact: true,
            })
            .click();
          await row
            .getByLabel("Название", { exact: true })
            .fill("Actual synthetic browser publication");
          await row
            .getByLabel("Основание публикации", { exact: true })
            .fill("Actual browser evidence");
          await row
            .getByRole("button", { name: "Проверить изменения", exact: true })
            .click();
          await row
            .getByRole("button", {
              name: "Подтвердить публикацию",
              exact: true,
            })
            .click();
          await page
            .getByText(
              "Новая версия подтверждена сервером. Перечитываем каталог.",
            )
            .waitFor();
          expect((await state(f)).versions.at(-1)).toMatchObject({
            version: 3,
            title: "Actual synthetic browser publication",
          });
          expect((await state(f)).publications).toBe(2);
        } finally {
          await browser.close();
        }
      },
      30000,
    );
    (origin ? it : it.skip)(
      "validates scheduling HTTP and submits a scheduled version through the actual browser and database",
      async () => {
        const f = await fixture(),
          body = input(f),
          endpoint = `${origin}/api/v1/admin/rewards/${f.rewardId}/scheduled-versions`;
        const data = {
          scope,
          expectedVersion: 1,
          title: body.title,
          conditions: body.conditions,
          price: body.price,
          enabled: body.enabled,
          reservationSeconds: body.reservationSeconds,
          reason: body.reason,
          effectiveFrom: await future(120),
        };
        const headers = {
          Origin: origin!,
          Cookie: `impuls_session=${tokens[0]}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": createCsrfToken(tokens[0]!, process.env.CSRF_SECRET!),
          "Idempotency-Key": body.idempotencyKey,
        };
        for (const [change, code] of [
          [{ effectiveFrom: undefined }, 400],
          [{ effectiveFrom: "2040-01-01T12:00:00+03:00" }, 400],
          [{ effectiveFrom: await future(-1) }, 422],
          [{ mode: "real" }, 400],
          [{ scope: foreign }, 404],
        ] as const) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...data, ...change }),
          });
          expect(response.status).toBe(code);
        }
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, "X-CSRF-Token": "bad" },
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, Origin: "https://invalid.example" },
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(403);
        const deniedHeaders = {
          ...headers,
          Cookie: `impuls_session=${tokens[1]}`,
          "X-CSRF-Token": createCsrfToken(tokens[1]!, process.env.CSRF_SECRET!),
        };
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: deniedHeaders,
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(404);
        expect(
          (
            await fetch(endpoint.replace("scheduled-versions", "versions"), {
              method: "POST",
              headers,
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(400);
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
        const ui = await fixture(true),
          browser = await chromium.launch();
        const uiTerms = input(ui);
        expect((await publishCatalogTerms(runtime, uiTerms)).kind).toBe("ok");
        const uiDate = await future(600);
        try {
          const context = await browser.newContext({
            viewport: { width: 360, height: 844 },
          });
          await context.addCookies([
            { name: "impuls_session", value: tokens[0]!, url: origin! },
          ]);
          const page = await context.newPage();
          // Подробности карточки каталога свёрнуты; сценарию нужны все кнопки.
          await page.addInitScript(() => {
            new MutationObserver(() => {
              for (const d of document.querySelectorAll<HTMLDetailsElement>(
                "details.admin-catalog-more:not([open])",
              ))
                d.open = true;
            }).observe(document, { childList: true, subtree: true });
          });
          page.setDefaultTimeout(5000);
          await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
            r.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{version:'8.0',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){}}}",
            }),
          );
          await page.goto(origin!, { waitUntil: "domcontentloaded" });
          await page.getByRole("button", { name: "Ещё", exact: true }).click();
          await page
            .getByRole("button", { name: "Управление каталогом", exact: true })
            .click();
          // При одной области списка нет: каталог сразу открыт в ней.
          await page
            .locator('.admin-catalog-section[aria-busy="false"]')
            .waitFor();
          const scopeField = page.getByLabel("Область", { exact: true });
          if (await scopeField.count()) await scopeField.selectOption(scope);
          const row = page.locator(".admin-catalog-items > li").filter({
            has: page.getByRole("heading", {
              name: uiTerms.title,
              exact: true,
            }),
          });
          await row
            .getByRole("button", {
              name: "Запланировать новые условия",
              exact: true,
            })
            .click();
          await row
            .getByLabel("Название", { exact: true })
            .fill("Actual browser scheduled synthetic terms");
          await row
            .getByLabel("Начало действия, UTC", { exact: true })
            .fill(uiDate.slice(0, 19));
          await row
            .getByLabel("Основание публикации", { exact: true })
            .fill("Actual browser future publication evidence");
          await row
            .getByRole("button", { name: "Проверить изменения", exact: true })
            .click();
          await row
            .getByRole("button", {
              name: "Подтвердить публикацию",
              exact: true,
            })
            .click();
          await page
            .getByText(
              "Новая версия подтверждена сервером. Перечитываем каталог.",
            )
            .waitFor();
          const actual = await state(ui);
          expect(actual.versions.at(-1)).toMatchObject({
            version: 3,
            title: "Actual browser scheduled synthetic terms",
            enabled: false,
          });
          expect(
            new Date(actual.versions.at(-1).effective_from).toISOString(),
          ).toBe(`${uiDate.slice(0, 19)}.000Z`);
          expect(actual.publications).toBe(2);
          expect(actual.quota).toMatchObject({
            capacity: 9,
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
