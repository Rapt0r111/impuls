import { createHash, randomUUID, randomBytes, randomInt } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  decideRedemption,
  readRedemptionReview,
} from "../../packages/domain/src/rewards/decisions";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import {
  readMyRedemptions,
  readRewardCatalog,
} from "../../packages/domain/src/rewards/read";
import { readAccountLedger } from "../../packages/domain/src/ledger/read";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import {
  redemptionDecisionResponseSchema,
  redemptionReviewResponseSchema,
  redemptionCursorSchema,
} from "../../packages/contracts/src/rewards";
import { accountLedgerResponseSchema } from "../../packages/contracts/src/ledger";
import { readAudit } from "../../packages/domain/src/admin/audit";
import { auditResponseSchema } from "../../packages/contracts/src/audit";
import { selectOption } from "../browser/select-option.mjs";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F06 decisions with PostgreSQL runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        max: 8,
      });
    const scope = randomUUID(),
      foreign = randomUUID(),
      users: string[] = [],
      rewards: string[] = [],
      quotas: string[] = [];
    type User = { id: string; token: string; hash: Buffer };
    let reviewer: User, other: User, outsider: User;
    async function user(name: string): Promise<User> {
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        hash = createHash("sha256").update(token).digest();
      users.push(id);
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
        [id, randomInt(7e12, 8e12), name],
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
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowSyntheticRewards: true,
    });
    async function permission(u: User, s = scope, action = "reward.decide") {
      const binding = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic decision fixture') RETURNING id",
          [u.id, s, action],
        )
      ).rows[0]!.id;
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [u.id],
      );
      return binding;
    }
    beforeAll(async () => {
      for (const id of [scope, foreign])
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic decision scope')",
          [id],
        );
      reviewer = await user("Тестовый уполномоченный");
      other = await user("Резервный уполномоченный");
      outsider = await user("Посторонний");
      await permission(reviewer);
      await permission(other);
      await permission(outsider, foreign);
      await permission(outsider, scope, "task.review");
    });
    async function fixture(
      s = scope,
      price = 30,
      durationMs = 3600000,
      reservationSeconds: number | null = null,
    ) {
      const owner = await user("Синтетический получатель"),
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
        [owner.id, s],
      );
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds) VALUES($1,$2,$3,1,$4,'Синтетическая косметика', $5,'cosmetic',true,clock_timestamp()-interval '1 minute',$6)",
        [
          version,
          reward,
          s,
          `Тест решения ${reward}`,
          price,
          reservationSeconds,
        ],
      );
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+$4*interval '1 millisecond',3)",
        [quota, reward, s, durationMs],
      );
      const reservation = await mutateRedemption(runtime, {
        ...common(owner),
        action: "reserve",
        rewardVersionId: version,
        quotaPeriodId: quota,
        expectedVersion: 1,
      });
      if (reservation.kind !== "ok") throw new Error(reservation.kind);
      const id = reservation.response.redemption.id;
      return { owner, reward, quota, version, id, price };
    }
    const input = (
      f: Awaited<ReturnType<typeof fixture>>,
      decision: "approve" | "reject" | "expire" = "approve",
      u = reviewer,
    ) => ({
      ...common(u),
      redemptionId: f.id,
      expectedVersion: 1,
      decision,
      reason: "Проверены синтетические условия",
    });
    async function projection(f: Awaited<ReturnType<typeof fixture>>) {
      return (
        await admin.query(
          `SELECT b.lifetime_xp,b.available_points,b.reserved_points,q.reserved,q.used,d.status,d.version,
      (SELECT count(*)::int FROM impuls.ledger_entries WHERE redemption_id=d.id) entries,
      (SELECT count(*)::int FROM impuls.audit_events WHERE redemption_id=d.id) audit,
      (SELECT count(*)::int FROM impuls.notification_outbox WHERE redemption_id=d.id) outbox
      FROM impuls.redemptions d JOIN impuls.account_balances b ON b.user_id=d.user_id JOIN impuls.quota_periods q ON q.id=d.quota_period_id WHERE d.id=$1`,
          [f.id],
        )
      ).rows[0];
    }
    async function due(f: Awaited<ReturnType<typeof fixture>>) {
      await admin.query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.02) FROM impuls.redemptions WHERE id=$1",
        [f.id],
      );
    }
    it("saves an explicit deadline without deriving it from quota or subsequent terms", async () => {
      const f = await fixture(scope, 30, 3600000, 1);
      const saved = (
        await admin.query(
          "SELECT created_at,expires_at FROM impuls.redemptions WHERE id=$1",
          [f.id],
        )
      ).rows[0];
      expect(saved.expires_at.getTime() - saved.created_at.getTime()).toBe(
        1000,
      );
      await expect(
        admin.query(
          "UPDATE impuls.redemptions SET expires_at=expires_at+interval '1 second',status='cancelled',cancellation_reason='tamper',version=2 WHERE id=$1",
          [f.id],
        ),
      ).rejects.toThrow("Invalid redemption transition");
      const premature = await fixture(scope, 30, 3600000, 3600);
      await expect(
        runtime.query(
          "UPDATE impuls.redemptions SET status='expired',decision_actor_id=$2,decision_reason='early',decided_at=clock_timestamp(),version=2 WHERE id=$1",
          [premature.id, reviewer.id],
        ),
      ).rejects.toThrow("Reservation is not due");
      const catalog = await readRewardCatalog(
        runtime,
        premature.owner.id,
        premature.owner.hash,
        { allowSyntheticRewards: true, scope, limit: 50 },
      );
      if (catalog.kind !== "ok") throw new Error(catalog.kind);
      expect(
        catalog.response.items.find((r) => r.id === premature.version)
          ?.reservationSeconds,
      ).toBe(3600);
      await admin.query(
        "INSERT INTO impuls.reward_versions(reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds) VALUES($1,$2,2,'New','New',99,'cosmetic',false,clock_timestamp(),100)",
        [f.reward, scope],
      );
      expect(
        (
          await admin.query(
            "SELECT expires_at FROM impuls.redemptions WHERE id=$1",
            [f.id],
          )
        ).rows[0].expires_at,
      ).toEqual(saved.expires_at);
      const mine = await readMyRedemptions(runtime, f.owner.id, f.owner.hash, {
        allowSyntheticRewards: true,
      });
      expect(mine.kind === "ok" && mine.response.items[0]?.expiresAt).toBe(
        saved.expires_at.toISOString(),
      );
      const unset = await fixture();
      expect(await decideRedemption(runtime, input(unset, "expire"))).toEqual({
        kind: "reservation_not_due",
      });
      expect(
        (
          await admin.query(
            "SELECT expires_at FROM impuls.redemptions WHERE id=$1",
            [unset.id],
          )
        ).rows[0].expires_at,
      ).toBeNull();
    });
    it("rejects premature expiry and restores the original price/quota exactly once with evidence", async () => {
      const f = await fixture(scope, 23, 3600000, 1),
        i = input(f, "expire");
      expect(await decideRedemption(runtime, i)).toEqual({
        kind: "reservation_not_due",
      });
      expect(await projection(f)).toMatchObject({
        status: "pending",
        available_points: "97",
        reserved_points: "23",
        reserved: 1,
        entries: 1,
        audit: 1,
        outbox: 1,
      });
      await due(f);
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        f.owner.id,
      ]);
      const result = await decideRedemption(runtime, i);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(
        redemptionDecisionResponseSchema.parse(result.response).redemption,
      ).toMatchObject({
        status: "expired",
        version: 2,
        decision: { actorId: reviewer.id, reason: i.reason },
      });
      expect(await projection(f)).toEqual({
        lifetime_xp: "300",
        available_points: "120",
        reserved_points: "0",
        reserved: 0,
        used: 0,
        status: "expired",
        version: 2,
        entries: 2,
        audit: 2,
        outbox: 2,
      });
      expect(await decideRedemption(runtime, i)).toEqual(result);
      expect(
        await decideRedemption(runtime, { ...i, reason: "changed" }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect((await decideRedemption(runtime, input(f, "expire"))).kind).toBe(
        "conflict",
      );
      const rows = (
        await admin.query(
          "SELECT kind,amount,reserved_delta,season_key,original_entry_id FROM impuls.ledger_entries WHERE redemption_id=$1 ORDER BY created_at",
          [f.id],
        )
      ).rows;
      expect(rows.map((r) => [r.kind, r.amount, r.reserved_delta])).toEqual([
        ["reward_reservation", -23, 23],
        ["reward_expiration", 23, -23],
      ]);
      expect(rows[1].season_key).toBe(rows[0].season_key);
      expect(rows[1].original_entry_id).not.toBeNull();
      await permission(reviewer, scope, "admin.audit");
      const audit = await readAudit(runtime, reviewer.id, reviewer.hash, {
        allowSyntheticAudit: true,
        scope,
        action: "reward.expire",
      });
      if (audit.kind !== "ok") throw new Error(audit.kind);
      const event = auditResponseSchema
        .parse(audit.response)
        .items.find((e) => e.reward?.redemptionId === f.id);
      expect(event).toMatchObject({
        action: "reward.expire",
        reason: i.reason,
        reward: { price: 23, expiresAt: result.response.redemption.expiresAt },
      });
      expect(event?.values).toContainEqual({
        field: "availableDelta",
        value: 23,
      });
    });
    it("blocks approval after the deadline even after waiting for a quota lock", async () => {
      const f = await fixture(scope, 30, 3600000, 1),
        lock = await admin.connect();
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [f.quota],
        );
        const op = decideRedemption(runtime, input(f));
        await due(f);
        await lock.query("COMMIT");
        expect(await op).toEqual({ kind: "reservation_expired" });
        expect(await projection(f)).toMatchObject({
          status: "pending",
          available_points: "90",
          reserved_points: "30",
          reserved: 1,
          used: 0,
          entries: 1,
        });
        await expect(
          admin.query(
            "UPDATE impuls.redemptions SET status='approved',decision_actor_id=$2,decision_reason='bypass',decided_at=created_at,version=2 WHERE id=$1",
            [f.id, reviewer.id],
          ),
        ).rejects.toThrow("Reservation has expired");
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
    });
    it.each(["expire", "reject", "cancel", "approve"] as const)(
      "serializes expiry against %s without duplicate release",
      async (action) => {
        const f = await fixture(scope, 30, 3600000, 1);
        await due(f);
        const one = input(f, "expire");
        const results = await Promise.all([
          decideRedemption(runtime, one),
          action === "cancel"
            ? mutateRedemption(runtime, {
                ...common(f.owner),
                action: "cancel",
                redemptionId: f.id,
                expectedVersion: 1,
                reason: "cancel",
              })
            : decideRedemption(runtime, input(f, action, other)),
        ]);
        expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
        expect(
          results.every((r) =>
            ["ok", "conflict", "reservation_expired"].includes(r.kind),
          ),
        ).toBe(true);
        expect(await projection(f)).toMatchObject({
          lifetime_xp: "300",
          available_points: "120",
          reserved_points: "0",
          reserved: 0,
          used: 0,
          entries: 2,
          audit: 2,
          outbox: 2,
        });
      },
    );
    it("keeps approved requests terminal, enforces authority and blocks self-expiry", async () => {
      const f = await fixture(scope, 30, 3600000, 1);
      expect((await decideRedemption(runtime, input(f))).kind).toBe("ok");
      await due(f);
      expect(
        (
          await decideRedemption(runtime, {
            ...input(f, "expire"),
            expectedVersion: 2,
          })
        ).kind,
      ).toBe("conflict");
      const own = await fixture(scope, 30, 3600000, 1);
      await permission(own.owner);
      await due(own);
      expect(
        await decideRedemption(runtime, input(own, "expire", own.owner)),
      ).toEqual({ kind: "not_found" });
      expect(
        await decideRedemption(runtime, input(own, "expire", outsider)),
      ).toEqual({ kind: "not_found" });
      expect(
        await decideRedemption(runtime, {
          ...input(own, "expire"),
          allowSyntheticRewards: false,
        }),
      ).toEqual({ kind: "disabled" });
      const actor = await user("Expiry actor"),
        binding = await permission(actor),
        i = input(own, "expire", actor);
      expect((await decideRedemption(runtime, i)).kind).toBe("ok");
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE id=$1",
        [binding],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [actor.id],
      );
      expect(await decideRedemption(runtime, i)).toEqual({ kind: "not_found" });
    });
    it("rolls back the release, decision and journal when outbox insertion fails", async () => {
      const f = await fixture(scope, 30, 3600000, 1);
      await due(f);
      const constraint = `expiry_test_${f.id.replaceAll("-", "")}`;
      await admin.query(
        `ALTER TABLE impuls.notification_outbox ADD CONSTRAINT ${constraint} CHECK(kind<>'reward.expired' OR recipient_id<>'${f.owner.id}'::uuid)`,
      );
      try {
        await expect(
          decideRedemption(runtime, input(f, "expire")),
        ).rejects.toThrow();
        expect(await projection(f)).toMatchObject({
          status: "pending",
          available_points: "90",
          reserved_points: "30",
          reserved: 1,
          entries: 1,
          audit: 1,
          outbox: 1,
        });
      } finally {
        await admin.query(
          `ALTER TABLE impuls.notification_outbox DROP CONSTRAINT ${constraint}`,
        );
      }
    });
    it("approves exactly once without changing available points or XP; exposes owner evidence", async () => {
      const f = await fixture(),
        i = input(f),
        result = await decideRedemption(runtime, i);
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(
        redemptionDecisionResponseSchema.parse(result.response),
      ).toMatchObject({
        redemption: {
          status: "approved",
          version: 2,
          decision: { actorId: reviewer.id, reason: i.reason },
        },
      });
      expect(result.response).not.toHaveProperty("balance");
      expect(await projection(f)).toEqual({
        lifetime_xp: "300",
        available_points: "90",
        reserved_points: "0",
        reserved: 0,
        used: 1,
        status: "approved",
        version: 2,
        entries: 2,
        audit: 2,
        outbox: 2,
      });
      expect(await decideRedemption(runtime, i)).toEqual(result);
      expect(
        await decideRedemption(runtime, { ...i, decision: "reject" }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect((await decideRedemption(runtime, input(f, "reject"))).kind).toBe(
        "conflict",
      );
      expect(
        (
          await mutateRedemption(runtime, {
            ...common(f.owner),
            action: "cancel",
            redemptionId: f.id,
            expectedVersion: 2,
            reason: "cancel",
          })
        ).kind,
      ).toBe("conflict");
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
      const catalog = await readRewardCatalog(
        runtime,
        f.owner.id,
        f.owner.hash,
        { allowSyntheticRewards: true, scope },
      );
      if (catalog.kind !== "ok") throw new Error(catalog.kind);
      expect(
        catalog.response.items.find((i) => i.id === f.version)
          ?.hasPendingRequest,
      ).toBe(true);
      const mine = await readMyRedemptions(runtime, f.owner.id, f.owner.hash, {
        allowSyntheticRewards: true,
      });
      if (mine.kind !== "ok") throw new Error(mine.kind);
      expect(mine.response.items[0]?.decision?.displayName).toBe(
        "Тестовый уполномоченный",
      );
      const ledger = await readAccountLedger(runtime, f.owner.id, f.owner.hash);
      if (ledger.kind !== "ok") throw new Error(ledger.kind);
      expect(
        accountLedgerResponseSchema
          .parse(ledger.response)
          .entries.map((e) => [e.kind, e.amount, e.reservedDelta]),
      ).toEqual([
        ["reward_approval", 0, -30],
        ["reward_reservation", -30, 30],
      ]);
    });
    it("rejects and returns the original price and quota once", async () => {
      const f = await fixture(),
        i = input(f, "reject"),
        result = await decideRedemption(runtime, i);
      expect(result.kind).toBe("ok");
      expect(await decideRedemption(runtime, i)).toEqual(result);
      expect(await projection(f)).toMatchObject({
        available_points: "120",
        reserved_points: "0",
        reserved: 0,
        used: 0,
        status: "rejected",
        entries: 2,
        audit: 2,
        outbox: 2,
      });
      const ledger = await readAccountLedger(runtime, f.owner.id, f.owner.hash);
      if (ledger.kind !== "ok") throw new Error(ledger.kind);
      expect(
        accountLedgerResponseSchema.parse(ledger.response).entries[0],
      ).toMatchObject({
        kind: "reward_rejection",
        amount: 30,
        reservedDelta: -30,
        reason: i.reason,
      });
    });
    it("refuses self, neighbouring scope, task.review and disabled flag", async () => {
      const f = await fixture(),
        own = await fixture(foreign);
      await permission(f.owner);
      expect(
        await decideRedemption(runtime, input(f, "approve", f.owner)),
      ).toEqual({ kind: "not_found" });
      expect(
        await decideRedemption(runtime, input(f, "approve", outsider)),
      ).toEqual({ kind: "not_found" });
      expect(await decideRedemption(runtime, input(own))).toEqual({
        kind: "not_found",
      });
      expect(
        await decideRedemption(runtime, {
          ...input(f),
          allowSyntheticRewards: false,
        }),
      ).toEqual({ kind: "disabled" });
      expect(await projection(f)).toMatchObject({
        status: "pending",
        entries: 1,
      });
    });
    it("filters the queue, pages without duplicates and keeps balances private", async () => {
      await fixture();
      await fixture();
      const self = await fixture();
      await permission(self.owner);
      const mine = await readRedemptionReview(
        runtime,
        self.owner.id,
        self.owner.hash,
        { allowSyntheticRewards: true, scope },
      );
      if (mine.kind !== "ok") throw new Error(mine.kind);
      expect(
        mine.response.items.some((i) => i.recipient.id === self.owner.id),
      ).toBe(false);
      const q = await readRedemptionReview(
        runtime,
        reviewer.id,
        reviewer.hash,
        { allowSyntheticRewards: true, scope, limit: 1 },
      );
      if (q.kind !== "ok") throw new Error(q.kind);
      const parsed = redemptionReviewResponseSchema.parse(q.response);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]).not.toHaveProperty("balance");
      const next = await readRedemptionReview(
        runtime,
        reviewer.id,
        reviewer.hash,
        {
          allowSyntheticRewards: true,
          scope,
          limit: 1,
          cursor: redemptionCursorSchema.parse(parsed.nextCursor),
        },
      );
      if (next.kind !== "ok") throw new Error(next.kind);
      expect(next.response.items[0]?.redemption.id).not.toBe(
        parsed.items[0]!.redemption.id,
      );
      expect(
        await readRedemptionReview(runtime, reviewer.id, reviewer.hash, {
          allowSyntheticRewards: true,
          scope: foreign,
        }),
      ).toEqual({ kind: "not_found" });
    });
    it.each(["approve", "reject"] as const)(
      "one winner for simultaneous %s versus owner cancellation",
      async (decision) => {
        const f = await fixture(),
          results = await Promise.all([
            decideRedemption(runtime, input(f, decision)),
            mutateRedemption(runtime, {
              ...common(f.owner),
              action: "cancel",
              redemptionId: f.id,
              expectedVersion: 1,
              reason: "Передумал",
            }),
          ]);
        expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
        expect(await projection(f)).toMatchObject({
          reserved_points: "0",
          reserved: 0,
          entries: 2,
          audit: 2,
          outbox: 2,
        });
        const p = await projection(f);
        expect(p.used).toBe(p.status === "approved" ? 1 : 0);
        expect(p.available_points).toBe(p.status === "approved" ? "90" : "120");
      },
    );
    it("one decision for concurrent reviewers and identical replay", async () => {
      const f = await fixture(),
        results = await Promise.all([
          decideRedemption(runtime, input(f)),
          decideRedemption(runtime, input(f, "reject", other)),
        ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      expect(await projection(f)).toMatchObject({
        entries: 2,
        audit: 2,
        outbox: 2,
      });
      const f2 = await fixture(),
        i = input(f2);
      expect(
        await Promise.all([
          decideRedemption(runtime, i),
          decideRedemption(runtime, i),
        ]),
      ).toEqual([
        expect.objectContaining({ kind: "ok" }),
        expect.objectContaining({ kind: "ok" }),
      ]);
      expect(await projection(f2)).toMatchObject({ entries: 2 });
    });
    it("rechecks revoked authority before exposing an idempotent response", async () => {
      const f = await fixture(),
        actor = await user("Отозванный уполномоченный"),
        binding = await permission(actor),
        i = input(f, "approve", actor);
      expect((await decideRedemption(runtime, i)).kind).toBe("ok");
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE id=$1",
        [binding],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [actor.id],
      );
      expect(await decideRedemption(runtime, i)).toEqual({ kind: "not_found" });
    });
    it.each(["session", "permission"])(
      "rechecks %s expiry after waiting for quota lock",
      async (what) => {
        const f = await fixture(),
          actor = await user("Истекающий уполномоченный"),
          binding = await permission(actor),
          lock = await admin.connect();
        try {
          await lock.query("BEGIN");
          await lock.query(
            "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
            [f.quota],
          );
          if (what === "session")
            await admin.query(
              "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE user_id=$1",
              [actor.id],
            );
          else
            await admin.query(
              "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",
              [binding],
            );
          await admin.query(
            "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
            [actor.id],
          );
          const operation = decideRedemption(
            runtime,
            input(f, "approve", actor),
          );
          await new Promise((r) => setTimeout(r, 500));
          await lock.query("COMMIT");
          expect(await operation).toEqual({
            kind: what === "session" ? "unauthorized" : "not_found",
          });
          expect(await projection(f)).toMatchObject({
            status: "pending",
            reserved: 1,
            reserved_points: "30",
            entries: 1,
          });
        } finally {
          await lock.query("ROLLBACK");
          lock.release();
        }
      },
    );
    it("blocks inactive recipient approval but releases its reserve on rejection", async () => {
      const f = await fixture();
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        f.owner.id,
      ]);
      expect(await decideRedemption(runtime, input(f))).toEqual({
        kind: "recipient_inactive",
      });
      expect((await decideRedemption(runtime, input(f, "reject"))).kind).toBe(
        "ok",
      );
      expect(await projection(f)).toMatchObject({
        available_points: "120",
        reserved_points: "0",
      });
    });
    it("honours saved terms after disabled latest price, revoked membership and original quota expiry", async () => {
      const f = await fixture(scope, 23, 1200);
      await admin.query(
        "INSERT INTO impuls.reward_versions(reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from) VALUES($1,$2,2,'New','New',99,'cosmetic',false,clock_timestamp())",
        [f.reward, scope],
      );
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [f.owner.id],
      );
      await new Promise((r) => setTimeout(r, 1300));
      expect((await decideRedemption(runtime, input(f))).kind).toBe("ok");
      expect(await projection(f)).toMatchObject({
        available_points: "97",
        used: 1,
        reserved_points: "0",
      });
    });
    it("rolls back a failed outbox write with all financial and decision effects", async () => {
      const f = await fixture(),
        suffix = randomUUID().replaceAll("-", "");
      await admin.query(
        `CREATE FUNCTION impuls.fail_decision_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.recipient_id='${f.owner.id}'::uuid AND NEW.kind IN ('reward.approved','reward.rejected') THEN RAISE EXCEPTION 'Synthetic decision failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_decision_${suffix} BEFORE INSERT ON impuls.notification_outbox FOR EACH ROW EXECUTE FUNCTION impuls.fail_decision_${suffix}()`,
      );
      const i = input(f);
      try {
        await expect(decideRedemption(runtime, i)).rejects.toThrow(
          "Synthetic decision failure",
        );
        expect(await projection(f)).toMatchObject({
          available_points: "90",
          reserved_points: "30",
          reserved: 1,
          used: 0,
          status: "pending",
          version: 1,
          entries: 1,
          audit: 1,
          outbox: 1,
        });
      } finally {
        await admin.query(
          `DROP TRIGGER fail_decision_${suffix} ON impuls.notification_outbox; DROP FUNCTION impuls.fail_decision_${suffix}()`,
        );
      }
      expect((await decideRedemption(runtime, i)).kind).toBe("ok");
    });
    it("DB guards prevent self decision, altered snapshot and terminal rewrite", async () => {
      const f = await fixture();
      await expect(
        runtime.query(
          "UPDATE impuls.redemptions SET status='approved',decision_actor_id=user_id,decision_reason='self',decided_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [f.id],
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query("UPDATE impuls.redemptions SET price=1 WHERE id=$1", [
          f.id,
        ]),
      ).rejects.toThrow();
      expect((await decideRedemption(runtime, input(f))).kind).toBe("ok");
      await expect(
        runtime.query(
          "UPDATE impuls.redemptions SET decision_reason='rewrite',version=version+1 WHERE id=$1",
          [f.id],
        ),
      ).rejects.toThrow();
    });
    it.runIf(Boolean(origin))(
      "HTTP expiry errors, replay and real Chromium→API→DB release",
      async () => {
        const f = await fixture(scope, 30, 3600000, 3),
          endpoint = `${origin}/api/v1/redemptions/${f.id}/decide`;
        const headers = {
          cookie: `impuls_session=${reviewer.token}`,
          origin: origin!,
          "content-type": "application/json",
          "x-csrf-token": createCsrfToken(
            reviewer.token,
            process.env.CSRF_SECRET!,
          ),
          "idempotency-key": randomUUID(),
        };
        const body = {
          decision: "expire",
          expectedVersion: 1,
          reason: "Истечение тестового срока",
        };
        const post = (payload: unknown = body) =>
          fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });
        expect(
          (await post({ ...body, expiresAt: "2026-01-01T00:00:00Z" })).status,
        ).toBe(400);
        const early = await post();
        expect(early.status).toBe(409);
        expect((await early.json()).code).toBe("RESERVATION_NOT_DUE");
        await due(f);
        const late = await post({ ...body, decision: "approve" });
        expect(late.status).toBe(409);
        expect((await late.json()).code).toBe("RESERVATION_EXPIRED");
        const result = await post();
        expect(result.status).toBe(200);
        expect(result.headers.get("cache-control")).toContain("no-store");
        const saved = redemptionDecisionResponseSchema.parse(
          await result.json(),
        );
        expect(saved.redemption.status).toBe("expired");
        expect(await (await post()).json()).toEqual(saved);
        const f2 = await fixture(scope, 30, 3600000, 1);
        await due(f2);
        const browser = await chromium.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 320, height: 950 },
            reducedMotion: "reduce",
          });
          await context.addCookies([
            {
              name: "impuls_session",
              value: reviewer.token,
              url: origin!,
              httpOnly: true,
              sameSite: "Strict",
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
          await page
            .getByRole("button", { name: "Решения по заявкам", exact: true })
            .click();
          const row = page.locator(`[data-redemption-id="${f2.id}"]`);
          await row.getByRole("button", { name: "Рассмотреть заявку" }).click();
          await selectOption(page, "Решение", "expire");
          await page.getByLabel("Причина решения").fill(body.reason);
          await page.getByRole("checkbox").check();
          await page
            .getByRole("button", { name: "Завершить резерв", exact: true })
            .click();
          await page.getByText(/Срок заявки истёк\. Баллы вернулись/).waitFor();
          expect(await projection(f2)).toMatchObject({
            status: "expired",
            available_points: "120",
            reserved_points: "0",
            used: 0,
            reserved: 0,
            entries: 2,
            audit: 2,
            outbox: 2,
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
    it.runIf(Boolean(origin))(
      "HTTP boundaries and real Chromium→API→DB decision",
      async () => {
        const f = await fixture(),
          endpoint = `${origin}/api/v1/redemptions/${f.id}/decide`,
          headers = {
            cookie: `impuls_session=${reviewer.token}`,
            origin: origin!,
            "content-type": "application/json",
            "x-csrf-token": createCsrfToken(
              reviewer.token,
              process.env.CSRF_SECRET!,
            ),
            "idempotency-key": randomUUID(),
          },
          body = {
            decision: "approve",
            expectedVersion: 1,
            reason: "Проверено через браузер",
          };
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, origin: "https://wrong.example" },
              body: JSON.stringify(body),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, "x-csrf-token": "bad" },
              body: JSON.stringify(body),
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...body, price: 1 }),
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...body, reason: "x".repeat(9000) }),
            })
          ).status,
        ).toBe(400);
        const read = await fetch(
          `${origin}/api/v1/redemptions/review?scope=${scope}`,
          { headers },
        );
        expect(read.status).toBe(200);
        expect(read.headers.get("cache-control")).toContain("no-store");
        redemptionReviewResponseSchema.parse(await read.json());
        expect(
          (
            await fetch(
              `${origin}/api/v1/redemptions/review?userId=${f.owner.id}`,
              { headers },
            )
          ).status,
        ).toBe(400);
        const browser = await chromium.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 390, height: 950 },
            reducedMotion: "reduce",
          });
          await context.addCookies([
            {
              name: "impuls_session",
              value: reviewer.token,
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
          await page
            .getByRole("button", { name: "Решения по заявкам", exact: true })
            .click();
          const row = page.locator(".tasks-list li").filter({
            has: page.getByRole("heading", {
              name: `Тест решения ${f.reward}`,
              exact: true,
            }),
          });
          await row.getByRole("button", { name: "Рассмотреть заявку" }).click();
          await page.getByLabel("Причина решения").fill(body.reason);
          await page.getByRole("checkbox").check();
          await page
            .getByRole("button", { name: "Одобрить заявку", exact: true })
            .click();
          await page.getByText(/Заявка одобрена/).waitFor();
          expect(await projection(f)).toMatchObject({
            status: "approved",
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
      },
      20000,
    );
    afterAll(async () => {
      for (const [table, column] of [
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
