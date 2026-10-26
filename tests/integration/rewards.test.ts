import { createHash, randomUUID, randomBytes, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { Pool } from "pg";
import { chromium } from "playwright";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  readRewardCatalog,
  readMyRedemptions,
} from "../../packages/domain/src/rewards/read";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import { readAccountLedger } from "../../packages/domain/src/ledger/read";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import {
  rewardCatalogResponseSchema,
  redemptionListResponseSchema,
  redemptionMutationResponseSchema,
  redemptionCursorSchema,
  rewardCursorSchema,
} from "../../packages/contracts/src/rewards";
import { accountLedgerResponseSchema } from "../../packages/contracts/src/ledger";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F06 cosmetic reservations under runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        max: 8,
      });
    const users = Array.from({ length: 7 }, () => randomUUID()),
      scope = randomUUID(),
      foreignScope = randomUUID();
    const tokens = users.map(() => randomBytes(32).toString("base64url")),
      hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    const rewardIds: string[] = [],
      quotaIds: string[] = [];
    const common = (i = 0) => ({
      actorId: users[i]!,
      sessionHash: hashes[i]!,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowSyntheticRewards: true,
    });
    const catalog = (i = 0, options = {}) =>
      readRewardCatalog(runtime, users[i]!, hashes[i]!, {
        allowSyntheticRewards: true,
        scope,
        ...options,
      });
    const mine = (i = 0, options = {}) =>
      readMyRedemptions(runtime, users[i]!, hashes[i]!, {
        allowSyntheticRewards: true,
        ...options,
      });
    beforeAll(async () => {
      for (const [i, user] of users.entries()) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
          [user, randomInt(6e12, 7e12), `Synthetic reward ${i}`],
        );
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
          [user, hashes[i]],
        );
        await admin.query(
          "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
          [user],
        );
      }
      for (const id of [scope, foreignScope])
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic reward scope')",
          [id],
        );
      for (const user of users.slice(0, 6))
        await admin.query(
          "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
          [user, scope],
        );
    });
    async function fixture(
      price = 30,
      capacity = 1,
      opts: {
        rewardId?: string;
        version?: number;
        enabled?: boolean;
        scope?: string;
        start?: Date;
        end?: Date;
      } = {},
    ) {
      const rewardId = opts.rewardId ?? randomUUID(),
        id = randomUUID(),
        q = randomUUID(),
        s = opts.scope ?? scope;
      if (!rewardIds.includes(rewardId)) rewardIds.push(rewardId);
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from) VALUES($1,$2,$3,$4,$7,'Косметика; синтетические условия', $5,'cosmetic',$6,clock_timestamp()-interval '1 second')",
        [
          id,
          rewardId,
          s,
          opts.version ?? 1,
          price,
          opts.enabled ?? true,
          `Тестовый знак ${id}`,
        ],
      );
      const existing = (
        await admin.query<{ id: string }>(
          "SELECT id FROM impuls.quota_periods WHERE reward_id=$1 AND scope_id=$2",
          [rewardId, s],
        )
      ).rows[0];
      if (existing)
        return { id, rewardId, quota: existing.id, version: opts.version ?? 1 };
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,$4,$5,$6)",
        [
          q,
          rewardId,
          s,
          opts.start ?? new Date(Date.now() - 60000),
          opts.end ?? new Date(Date.now() + 3600000),
          capacity,
        ],
      );
      quotaIds.push(q);
      return { id, rewardId, quota: q, version: opts.version ?? 1 };
    }
    const reserve = (f: Awaited<ReturnType<typeof fixture>>, i = 0) => ({
      ...common(i),
      action: "reserve" as const,
      rewardVersionId: f.id,
      quotaPeriodId: f.quota,
      expectedVersion: f.version,
    });
    const cancel = (id: string, i = 0, version = 1) => ({
      ...common(i),
      action: "cancel" as const,
      redemptionId: id,
      expectedVersion: version,
      reason: "Синтетическая добровольная отмена",
    });
    async function balance(i = 0) {
      return (
        await admin.query(
          "SELECT lifetime_xp,available_points,reserved_points FROM impuls.account_balances WHERE user_id=$1",
          [users[i]],
        )
      ).rows[0];
    }
    async function counts(f: Awaited<ReturnType<typeof fixture>>) {
      return (
        await admin.query(
          `SELECT q.reserved,(SELECT count(*)::int FROM impuls.redemptions WHERE quota_period_id=q.id) requests,
      (SELECT count(*)::int FROM impuls.ledger_entries l JOIN impuls.redemptions d ON d.id=l.redemption_id WHERE d.quota_period_id=q.id) entries,
      (SELECT count(*)::int FROM impuls.audit_events a JOIN impuls.redemptions d ON d.id=a.redemption_id WHERE d.quota_period_id=q.id) audit,
      (SELECT count(*)::int FROM impuls.notification_outbox o JOIN impuls.redemptions d ON d.id=o.redemption_id WHERE d.quota_period_id=q.id) outbox
      FROM impuls.quota_periods q WHERE q.id=$1`,
          [f.quota],
        )
      ).rows[0];
    }
    it("does not create catalog data, grants or economics when disabled", async () => {
      expect(await catalog(0, { allowSyntheticRewards: false })).toEqual({
        kind: "disabled",
      });
      expect(await mine(0, { allowSyntheticRewards: false })).toEqual({
        kind: "disabled",
      });
      expect((await catalog(6)).kind).toBe("not_found");
      expect((await catalog(0, { scope: foreignScope })).kind).toBe(
        "not_found",
      );
      const noScope = await readRewardCatalog(runtime, users[6]!, hashes[6]!, {
        allowSyntheticRewards: true,
      });
      if (noScope.kind !== "ok") throw new Error(noScope.kind);
      expect(rewardCatalogResponseSchema.parse(noScope.response)).toMatchObject(
        { scope: null, items: [] },
      );
    });
    it("reserves exactly 30 points and one quota place; replay adds nothing", async () => {
      const f = await fixture(),
        input = reserve(f),
        r = await mutateRedemption(runtime, input);
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(redemptionMutationResponseSchema.parse(r.response)).toMatchObject({
        redemption: { price: 30, status: "pending", rewardVersion: 1 },
        balance: { lifetimeXp: 300, availablePoints: 90, reservedPoints: 30 },
      });
      expect(await mutateRedemption(runtime, input)).toEqual(r);
      expect(
        await mutateRedemption(runtime, { ...input, expectedVersion: 2 }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect(await counts(f)).toEqual({
        reserved: 1,
        requests: 1,
        entries: 1,
        audit: 1,
        outbox: 1,
      });
      const c = await catalog();
      if (c.kind !== "ok") throw new Error(c.kind);
      expect(c.response.items.find((x) => x.id === f.id)).toMatchObject({
        hasPendingRequest: true,
        quota: { available: 0 },
      });
      const ending = cancel(r.response.redemption.id),
        done = await mutateRedemption(runtime, ending);
      if (done.kind !== "ok") throw new Error(done.kind);
      expect(done.response.balance).toMatchObject({
        lifetimeXp: 300,
        availablePoints: 120,
        reservedPoints: 0,
      });
      expect(await mutateRedemption(runtime, ending)).toEqual(done);
      expect(
        (await mutateRedemption(runtime, cancel(r.response.redemption.id)))
          .kind,
      ).toBe("conflict");
      expect(await counts(f)).toEqual({
        reserved: 0,
        requests: 1,
        entries: 2,
        audit: 2,
        outbox: 2,
      });
      const journal = await readAccountLedger(runtime, users[0]!, hashes[0]!);
      if (journal.kind !== "ok") throw new Error(journal.kind);
      const entries = accountLedgerResponseSchema.parse(
        journal.response,
      ).entries;
      expect(entries.map((e) => [e.kind, e.amount, e.reservedDelta])).toEqual([
        ["reward_cancellation", 30, -30],
        ["reward_reservation", -30, 30],
      ]);
    });
    it("serializes two users competing for the last place", async () => {
      const f = await fixture(17),
        a = reserve(f, 1),
        b = reserve(f, 2);
      const result = await Promise.all([
        mutateRedemption(runtime, a),
        mutateRedemption(runtime, b),
      ]);
      expect(result.map((r) => r.kind).sort()).toEqual(["ok", "quota_full"]);
      const winner = result.findIndex((r) => r.kind === "ok"),
        r = result[winner]!;
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(await counts(f)).toEqual({
        reserved: 1,
        requests: 1,
        entries: 1,
        audit: 1,
        outbox: 1,
      });
      expect(await balance(winner + 1)).toMatchObject({
        available_points: "103",
        reserved_points: "17",
        lifetime_xp: "300",
      });
      await mutateRedemption(
        runtime,
        cancel(r.response.redemption.id, winner + 1),
      );
    });
    it("serializes two purchases against the same balance without overspend", async () => {
      const a = await fixture(80, 3),
        b = await fixture(80, 3);
      const results = await Promise.all([
        mutateRedemption(runtime, reserve(a, 3)),
        mutateRedemption(runtime, reserve(b, 3)),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual([
        "insufficient_points",
        "ok",
      ]);
      expect(await balance(3)).toMatchObject({
        available_points: "40",
        reserved_points: "80",
      });
      const r = results.find((r) => r.kind === "ok")!;
      if (r.kind !== "ok") throw new Error(r.kind);
      await mutateRedemption(runtime, cancel(r.response.redemption.id, 3));
    });
    it("serializes duplicate intentions and prevents duplicate pending requests", async () => {
      const f = await fixture(9, 3),
        input = reserve(f, 4);
      const [a, b] = await Promise.all([
        mutateRedemption(runtime, input),
        mutateRedemption(runtime, input),
      ]);
      expect(a).toEqual(b);
      if (a!.kind !== "ok") throw new Error(a!.kind);
      expect((await mutateRedemption(runtime, reserve(f, 4))).kind).toBe(
        "already_pending",
      );
      const cancellations = await Promise.all([
        mutateRedemption(runtime, cancel(a!.response.redemption.id, 4)),
        mutateRedemption(runtime, cancel(a!.response.redemption.id, 4)),
      ]);
      expect(cancellations.map((r) => r.kind).sort()).toEqual([
        "conflict",
        "ok",
      ]);
      expect(await counts(f)).toEqual({
        reserved: 0,
        requests: 1,
        entries: 2,
        audit: 2,
        outbox: 2,
      });
      expect(await balance(4)).toMatchObject({
        available_points: "120",
        reserved_points: "0",
      });
    });
    it("uses a new immutable price version with the same quota and preserves old request terms", async () => {
      const f = await fixture(13, 3),
        r = await mutateRedemption(runtime, reserve(f));
      if (r.kind !== "ok") throw new Error(r.kind);
      const next = await fixture(19, 3, { rewardId: f.rewardId, version: 2 });
      const c = await catalog();
      if (c.kind !== "ok") throw new Error(c.kind);
      expect(
        c.response.items.filter((x) => x.rewardId === f.rewardId),
      ).toMatchObject([
        { id: next.id, price: 19, version: 2, quota: { available: 2 } },
      ]);
      expect((await mutateRedemption(runtime, reserve(f, 1))).kind).toBe(
        "conflict",
      );
      const privateList = await mine();
      if (privateList.kind !== "ok") throw new Error(privateList.kind);
      expect(
        privateList.response.items.find(
          (d) => d.id === r.response.redemption.id,
        ),
      ).toMatchObject({ price: 13, rewardVersion: 1 });
      const done = await mutateRedemption(
        runtime,
        cancel(r.response.redemption.id),
      );
      if (done.kind !== "ok") throw new Error(done.kind);
      expect(done.response.redemption.price).toBe(13);
      expect(done.response.balance.availablePoints).toBe(120);
      await expect(
        admin.query("UPDATE impuls.reward_versions SET price=1 WHERE id=$1", [
          f.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("hides disabled latest versions, expired periods and foreign scope", async () => {
      const f = await fixture();
      await fixture(31, 1, {
        rewardId: f.rewardId,
        version: 2,
        enabled: false,
      });
      const expired = await fixture(7, 2, {
        start: new Date(Date.now() - 60000),
        end: new Date(Date.now() - 1000),
      });
      const foreign = await fixture(5, 1, { scope: foreignScope });
      const c = await catalog();
      if (c.kind !== "ok") throw new Error(c.kind);
      expect(
        c.response.items.some((x) =>
          [f.rewardId, expired.rewardId, foreign.rewardId].includes(x.rewardId),
        ),
      ).toBe(false);
      expect((await mutateRedemption(runtime, reserve(expired))).kind).toBe(
        "conflict",
      );
      expect((await mutateRedemption(runtime, reserve(foreign))).kind).toBe(
        "not_found",
      );
      expect(
        (
          await mutateRedemption(runtime, {
            ...reserve(f),
            quotaPeriodId: foreign.quota,
          })
        ).kind,
      ).toBe("not_found");
    });
    it("rejects overlapping periods and freezes quota terms and runtime catalog writes", async () => {
      const f = await fixture();
      await expect(
        admin.query(
          "INSERT INTO impuls.quota_periods(reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,now(),now()+interval '1 hour',1)",
          [f.rewardId, scope],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        admin.query(
          "UPDATE impuls.quota_periods SET capacity=999 WHERE id=$1",
          [f.quota],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        runtime.query(
          "UPDATE impuls.reward_versions SET enabled=false WHERE id=$1",
          [f.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      const security = (
        await admin.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid IN ('impuls.reward_versions'::regclass,'impuls.quota_periods'::regclass,'impuls.redemptions'::regclass)",
        )
      ).rows;
      expect(security).toEqual([
        { relrowsecurity: true },
        { relrowsecurity: true },
        { relrowsecurity: true },
      ]);
    });
    it("keeps ownership private and allows owner cancellation after losing scope membership", async () => {
      const f = await fixture(),
        input = reserve(f, 5),
        r = await mutateRedemption(runtime, input);
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(
        (await mutateRedemption(runtime, cancel(r.response.redemption.id, 1)))
          .kind,
      ).toBe("not_found");
      const other = await mine(1);
      if (other.kind !== "ok") throw new Error(other.kind);
      expect(
        other.response.items.some((d) => d.id === r.response.redemption.id),
      ).toBe(false);
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=now() WHERE user_id=$1 AND scope_id=$2",
        [users[5], scope],
      );
      expect((await mutateRedemption(runtime, input)).kind).toBe("not_found");
      expect(
        (await mutateRedemption(runtime, cancel(r.response.redemption.id, 5)))
          .kind,
      ).toBe("ok");
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=NULL WHERE user_id=$1 AND scope_id=$2",
        [users[5], scope],
      );
    });
    it("rechecks access before idempotent replay", async () => {
      const f = await fixture(),
        input = reserve(f, 5),
        r = await mutateRedemption(runtime, input);
      if (r.kind !== "ok") throw new Error(r.kind);
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        users[5],
      ]);
      expect(await mutateRedemption(runtime, input)).toEqual({
        kind: "revoked",
      });
      expect(await mine(5)).toEqual({ kind: "revoked" });
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        users[5],
      ]);
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=now() WHERE user_id=$1",
        [users[5]],
      );
      expect(await mutateRedemption(runtime, input)).toEqual({
        kind: "unauthorized",
      });
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [users[5]],
      );
      await mutateRedemption(runtime, cancel(r.response.redemption.id, 5));
    });
    it("rolls back all effects if outbox insertion fails", async () => {
      const f = await fixture(),
        input = reserve(f, 5),
        suffix = randomUUID().replaceAll("-", "");
      await admin.query(
        `CREATE FUNCTION impuls.fail_reward_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.recipient_id='${users[5]}'::uuid THEN RAISE EXCEPTION 'Synthetic outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_reward_${suffix} BEFORE INSERT ON impuls.notification_outbox FOR EACH ROW EXECUTE FUNCTION impuls.fail_reward_${suffix}()`,
      );
      try {
        await expect(mutateRedemption(runtime, input)).rejects.toThrow(
          "Synthetic outbox failure",
        );
        expect(await counts(f)).toEqual({
          reserved: 0,
          requests: 0,
          entries: 0,
          audit: 0,
          outbox: 0,
        });
        expect(await balance(5)).toMatchObject({
          available_points: "120",
          reserved_points: "0",
        });
        expect(
          (
            await admin.query(
              "SELECT 1 FROM impuls.idempotency_records WHERE actor_id=$1 AND key=$2",
              [users[5], input.idempotencyKey],
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        await admin.query(
          `DROP TRIGGER fail_reward_${suffix} ON impuls.notification_outbox; DROP FUNCTION impuls.fail_reward_${suffix}()`,
        );
      }
    });
    it("rechecks session expiry after waiting for a quota lock", async () => {
      const f = await fixture(),
        locker = await admin.connect();
      await admin.query(
        "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE user_id=$1",
        [users[5]],
      );
      try {
        await locker.query("BEGIN");
        await locker.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [f.quota],
        );
        const pending = mutateRedemption(runtime, reserve(f, 5));
        await new Promise((resolve) => setTimeout(resolve, 550));
        await locker.query("COMMIT");
        expect(await pending).toEqual({ kind: "unauthorized" });
        expect((await counts(f)).requests).toBe(0);
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
        await admin.query(
          "UPDATE impuls.sessions SET expires_at=now()+interval '1 hour' WHERE user_id=$1",
          [users[5]],
        );
      }
    });
    it("cancels an old period without modifying a new period's stock", async () => {
      const f = await fixture(11, 1, { end: new Date(Date.now() + 400) }),
        r = await mutateRedemption(runtime, reserve(f));
      if (r.kind !== "ok") throw new Error(r.kind);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const next = randomUUID();
      quotaIds.push(next);
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '1 hour',2)",
        [next, f.rewardId, scope],
      );
      const done = await mutateRedemption(
        runtime,
        cancel(r.response.redemption.id),
      );
      if (done.kind !== "ok") throw new Error(done.kind);
      expect(done.response.balance.availablePoints).toBe(120);
      expect(
        (
          await admin.query(
            "SELECT reserved,used,capacity FROM impuls.quota_periods WHERE id=$1",
            [next],
          )
        ).rows[0],
      ).toEqual({ reserved: 0, used: 0, capacity: 2 });
    });
    it("paginates private requests without repeats or someone else's records", async () => {
      const all: string[] = [];
      let cursor: ReturnType<typeof redemptionCursorSchema.parse> | undefined;
      do {
        const page = await mine(0, { limit: 2, cursor });
        if (page.kind !== "ok") throw new Error(page.kind);
        const parsed = redemptionListResponseSchema.parse(page.response);
        all.push(...parsed.items.map((d) => d.id));
        cursor = parsed.nextCursor
          ? redemptionCursorSchema.parse(parsed.nextCursor)
          : undefined;
      } while (cursor);
      expect(new Set(all).size).toBe(all.length);
      expect(all.length).toBe(
        (
          await admin.query(
            "SELECT 1 FROM impuls.redemptions WHERE user_id=$1",
            [users[0]],
          )
        ).rowCount,
      );
    });
    it("paginates scoped catalog by stable reward ids without duplicates", async () => {
      const all: string[] = [];
      let cursor: ReturnType<typeof rewardCursorSchema.parse> | undefined;
      do {
        const page = await catalog(0, { limit: 2, cursor });
        if (page.kind !== "ok") throw new Error(page.kind);
        all.push(...page.response.items.map((i) => i.rewardId));
        cursor = page.response.nextCursor
          ? rewardCursorSchema.parse(page.response.nextCursor)
          : undefined;
      } while (cursor);
      const full = await catalog(0, { limit: 50 });
      if (full.kind !== "ok") throw new Error(full.kind);
      expect(all).toEqual(full.response.items.map((i) => i.rewardId));
      expect(new Set(all).size).toBe(all.length);
    });
    it("blocks a schema downgrade and preserves financial records", async () => {
      const sql: string[] = [];
      createRequire(import.meta.url)(
        "../../db/migrations/000017_reward_reservations.js",
      ).down({ sql: (value: string) => sql.push(value) });
      await expect(admin.query(sql.join("\n"))).rejects.toThrow(
        "Keep reservation schema",
      );
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.redemptions WHERE user_id=ANY($1::uuid[])",
            [users],
          )
        ).rows[0].n,
      ).toBeGreaterThan(0);
    });
    it.runIf(Boolean(origin))(
      "real HTTP validation and Chromium→API→PostgreSQL reserve/cancel",
      async () => {
        const f = await fixture(23, 2),
          headers = {
            cookie: `impuls_session=${tokens[0]}`,
            origin: origin!,
            "content-type": "application/json",
            "x-csrf-token": createCsrfToken(
              tokens[0]!,
              process.env.CSRF_SECRET!,
            ),
          };
        expect((await fetch(`${origin}/api/v1/rewards`)).status).toBe(401);
        for (const q of ["?userId=x", "?scope=x&scope=x", "?limit=51"])
          expect(
            (await fetch(`${origin}/api/v1/rewards${q}`, { headers })).status,
          ).toBe(400);
        const response = await fetch(
          `${origin}/api/v1/rewards?scope=${scope}`,
          { headers },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const body = {
          rewardVersionId: f.id,
          quotaPeriodId: f.quota,
          expectedVersion: 1,
        };
        expect(
          (
            await fetch(`${origin}/api/v1/redemptions`, {
              method: "POST",
              headers: { ...headers, "idempotency-key": randomUUID() },
              body: JSON.stringify({ ...body, price: 1 }),
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await fetch(`${origin}/api/v1/redemptions`, {
              method: "POST",
              headers: {
                ...headers,
                "x-csrf-token": "wrong",
                "idempotency-key": randomUUID(),
              },
              body: JSON.stringify(body),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(`${origin}/api/v1/redemptions`, {
              method: "POST",
              headers: {
                ...headers,
                origin: "https://wrong.example",
                "idempotency-key": randomUUID(),
              },
              body: JSON.stringify(body),
            })
          ).status,
        ).toBe(403);
        const browser = await chromium.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 390, height: 850 },
            reducedMotion: "reduce",
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
          rewardCatalogResponseSchema.parse(await response.json());
          await page.locator(".reward-list").waitFor();
          const row = page.locator(".reward-list li").filter({
            has: page.getByRole("heading", {
              name: `Тестовый знак ${f.id}`,
              exact: true,
            }),
          });
          while ((await row.count()) === 0) {
            const nextResponse = page.waitForResponse(
              (r) =>
                r.url().includes("/api/v1/rewards?") &&
                r.request().method() === "GET",
            );
            await page
              .getByRole("button", { name: "Ещё позиции", exact: true })
              .click();
            await nextResponse;
          }
          await row
            .getByRole("button", { name: "Получить", exact: true })
            .click();
          await page
            .getByRole("button", {
              name: /^Получить за \d+ баллов$/,
            })
            .click();
          await page.getByText(/Заявка сохранена/).waitFor();
          const pending = (
            await admin.query<{ id: string }>(
              "SELECT id FROM impuls.redemptions WHERE user_id=$1 AND status='pending'",
              [users[0]],
            )
          ).rows[0]!;
          await page
            .getByRole("button", { name: "Отменить заявку", exact: true })
            .click();
          await page
            .getByLabel("Причина отмены", { exact: true })
            .fill("Browser cancellation evidence");
          await page
            .getByRole("button", {
              name: "Отменить и вернуть баллы",
              exact: true,
            })
            .click();
          await page.getByText(/Заявка отменена/).waitFor();
          expect(
            (
              await admin.query(
                "SELECT status,cancellation_reason FROM impuls.redemptions WHERE id=$1",
                [pending.id],
              )
            ).rows[0],
          ).toEqual({
            status: "cancelled",
            cancellation_reason: "Browser cancellation evidence",
          });
          expect(await balance()).toMatchObject({
            available_points: "120",
            reserved_points: "0",
            lifetime_xp: "300",
          });
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
      await admin.query(
        "DELETE FROM impuls.audit_events WHERE actor_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.notification_outbox WHERE recipient_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.ledger_entries WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.redemptions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.quota_periods WHERE id=ANY($1::uuid[])",
        [quotaIds],
      );
      await admin.query(
        "DELETE FROM impuls.reward_versions WHERE reward_id=ANY($1::uuid[])",
        [rewardIds],
      );
      for (const table of [
        "idempotency_records",
        "account_balances",
        "sessions",
        "task_scope_members",
      ])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE ${table === "idempotency_records" ? "actor_id" : "user_id"}=ANY($1::uuid[])`,
          [users],
        );
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [[scope, foreignScope]],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
      await runtime.end();
      await admin.end();
    });
  },
);
