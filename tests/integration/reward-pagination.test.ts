import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  redemptionCursorSchema,
  redemptionListResponseSchema,
  redemptionReviewResponseSchema,
} from "../../packages/contracts/src/rewards";
import { readMyRedemptions } from "../../packages/domain/src/rewards/read";
import {
  readRedemptionReview,
  decideRedemption,
} from "../../packages/domain/src/rewards/decisions";
import { fulfillRedemption } from "../../packages/domain/src/rewards/fulfillment";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";

const url = process.env.TEST_DATABASE_URL;
const origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F06 reader-bound pagination under impuls_app",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
    });
    const scopes = [randomUUID(), randomUUID()];
    const users = Array.from({ length: 4 }, () => ({
      id: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      hash: Buffer.alloc(0),
    }));
    for (const u of users)
      u.hash = createHash("sha256").update(u.token).digest();
    const [owner, reviewer, issuer, outsider] = users as [
      (typeof users)[number],
      (typeof users)[number],
      (typeof users)[number],
      (typeof users)[number],
    ];
    const rewardIds: string[] = [];
    const ids: string[] = [];
    const common = (u = owner) => ({
      actorId: u.id,
      sessionHash: u.hash,
      allowSyntheticRewards: true,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    const mine = (cursor?: string, u = owner) =>
      readMyRedemptions(runtime, u.id, u.hash, {
        allowSyntheticRewards: true,
        limit: 1,
        ...(cursor ? { cursor: redemptionCursorSchema.parse(cursor) } : {}),
      });
    const queue = (
      cursor?: string,
      purpose: "decide" | "fulfill" = "decide",
      u = reviewer,
      scope?: string,
    ) =>
      readRedemptionReview(runtime, u.id, u.hash, {
        allowSyntheticRewards: true,
        limit: 1,
        purpose,
        ...(scope ? { scope } : {}),
        ...(cursor ? { cursor: redemptionCursorSchema.parse(cursor) } : {}),
      });
    async function reserve(scope = scopes[0]!, u = owner) {
      const reward = randomUUID(),
        version = randomUUID(),
        quota = randomUUID();
      rewardIds.push(reward);
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,1,'Pagination cosmetic','Synthetic pagination fixture',5,'cosmetic','synthetic',true,clock_timestamp()-interval '1 minute')",
        [version, reward, scope],
      );
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',10)",
        [quota, reward, scope],
      );
      const r = await mutateRedemption(runtime, {
        ...common(u),
        action: "reserve",
        rewardVersionId: version,
        quotaPeriodId: quota,
        expectedVersion: 1,
      });
      if (r.kind !== "ok") throw new Error(r.kind);
      if (u.id === owner.id) ids.push(r.response.redemption.id);
      return r.response.redemption.id;
    }
    beforeAll(async () => {
      for (const [i, s] of scopes.entries())
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project',$2)",
          [s, `Pagination scope ${i}`],
        );
      for (const u of users) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic pagination user',true)",
          [u.id, randomInt(8e12, 9e12)],
        );
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [u.id, u.hash],
        );
        await admin.query(
          "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
          [u.id],
        );
        for (const s of scopes)
          await admin.query(
            "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
            [u.id, s],
          );
      }
      for (const u of [reviewer, issuer])
        for (const s of scopes)
          for (const action of ["reward.decide", "reward.fulfill"])
            await admin.query(
              "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic pagination fixture')",
              [u.id, s, action],
            );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=ANY($1::uuid[])",
        [users.map((u) => u.id)],
      );
      // Same millisecond for all three records: UUID must break ties exactly once.
      // The fixture owner alone bypasses the immutable-update trigger; it is
      // re-enabled transactionally even if setup fails. Runtime never bypasses it.
      for (let i = 0; i < 3; i++) await reserve();
      const c = await admin.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "ALTER TABLE impuls.redemptions DISABLE TRIGGER redemption_valid",
        );
        await c.query(
          "UPDATE impuls.redemptions SET created_at='2026-10-03T10:00:00.123Z' WHERE id=ANY($1::uuid[])",
          [ids],
        );
        await c.query("SET CONSTRAINTS ALL IMMEDIATE");
        await c.query(
          "ALTER TABLE impuls.redemptions ENABLE TRIGGER redemption_valid",
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    });
    it("visits every tied timestamp once, using the saved anchor and immutable history", async () => {
      const snapshot = async () =>
        (
          await admin.query(
            `SELECT lifetime_xp,available_points,reserved_points,version,
        (SELECT count(*)::int FROM impuls.ledger_entries WHERE user_id=$1) AS ledger,
        (SELECT count(*)::int FROM impuls.audit_events WHERE redemption_id=ANY($2::uuid[])) AS audit,
        (SELECT count(*)::int FROM impuls.notification_outbox WHERE recipient_id=$1) AS outbox,
        (SELECT sum(reserved)::int FROM impuls.quota_periods WHERE reward_id=ANY($3::uuid[])) AS quota_reserved
        FROM impuls.account_balances WHERE user_id=$1`,
            [owner.id, ids, rewardIds],
          )
        ).rows[0];
      const before = await snapshot();
      expect(before).toEqual({
        lifetime_xp: "300",
        available_points: "105",
        reserved_points: "15",
        version: 4,
        ledger: 3,
        audit: 3,
        outbox: 3,
        quota_reserved: 3,
      });
      const expected = [...ids].sort().reverse();
      for (const reader of [
        mine,
        (cursor?: string) => queue(cursor, "decide", reviewer, scopes[0]),
      ]) {
        const found: string[] = [];
        let cursor: string | undefined;
        do {
          const r = await reader(cursor);
          if (r.kind !== "ok") throw new Error(r.kind);
          const page =
            "scopes" in r.response
              ? redemptionReviewResponseSchema.parse(r.response)
              : redemptionListResponseSchema.parse(r.response);
          found.push(
            ...page.items.map((i) =>
              "redemption" in i ? i.redemption.id : i.id,
            ),
          );
          cursor = page.nextCursor ?? undefined;
        } while (cursor && found.length <= 4);
        expect(found).toEqual(expected);
      }
      expect(await snapshot()).toEqual(before);
    });
    it("rejects another reader, list purpose, nonexistent or invisible anchor", async () => {
      const first = await mine();
      if (first.kind !== "ok") throw new Error(first.kind);
      const cursor = first.response.nextCursor!;
      expect(await mine(cursor, outsider)).toEqual({ kind: "invalid_cursor" });
      expect(await mine(`${owner.id}|all|mine|${randomUUID()}`)).toEqual({
        kind: "invalid_cursor",
      });
      expect(await mine(`${outsider.id}|all|mine|${ids[0]}`, outsider)).toEqual(
        { kind: "invalid_cursor" },
      );
      expect(await queue(cursor)).toEqual({ kind: "invalid_cursor" });
      const q = await queue();
      if (q.kind !== "ok") throw new Error(q.kind);
      expect(await queue(q.response.nextCursor!, "fulfill", reviewer)).toEqual({
        kind: "invalid_cursor",
      });
      expect(await queue(q.response.nextCursor!, "decide", issuer)).toEqual({
        kind: "invalid_cursor",
      });
      expect(
        await queue(q.response.nextCursor!, "decide", reviewer, scopes[1]),
      ).toEqual({ kind: "invalid_cursor" });
      expect(
        await queue(`${reviewer.id}|${scopes[0]}|decide|${randomUUID()}`),
      ).toEqual({ kind: "invalid_cursor" });
      expect(
        await queue(
          `${owner.id}|${scopes[0]}|decide|${ids[0]}`,
          "decide",
          owner,
        ),
      ).toEqual({ kind: "not_found" });
      const ownAnchor = await reserve(scopes[0], reviewer);
      expect(
        await queue(`${reviewer.id}|${scopes[0]}|decide|${ownAnchor}`),
      ).toEqual({ kind: "invalid_cursor" });
    });
    it("preserves cursor scope when the default scope order changes", async () => {
      const first = await queue();
      if (first.kind !== "ok") throw new Error(first.kind);
      await admin.query(
        "UPDATE impuls.access_scopes SET name='A pagination reordered scope' WHERE id=$1",
        [scopes[1]],
      );
      const next = await queue(first.response.nextCursor!);
      if (next.kind !== "ok") throw new Error(next.kind);
      expect(next.response.scope?.id).toBe(scopes[0]);
      expect(next.response.items[0]?.redemption.id).toBe(
        [...ids].sort().reverse()[1],
      );
    });
    it("reports an anchor leaving either queue while keeping personal history usable", async () => {
      const q = await queue(undefined, "decide", reviewer, scopes[0]);
      if (q.kind !== "ok") throw new Error(q.kind);
      const id = q.response.items[0]!.redemption.id;
      const result = await decideRedemption(runtime, {
        ...common(reviewer),
        redemptionId: id,
        expectedVersion: 1,
        decision: "approve",
        reason: "Pagination approval",
      });
      expect(result.kind).toBe("ok");
      expect(await queue(q.response.nextCursor!, "decide", reviewer)).toEqual({
        kind: "page_changed",
      });
      expect((await mine(`${owner.id}|all|mine|${id}`)).kind).toBe("ok");
      const second = ids.find((v) => v !== id)!;
      expect(
        (
          await decideRedemption(runtime, {
            ...common(reviewer),
            redemptionId: second,
            expectedVersion: 1,
            decision: "approve",
            reason: "Second pagination approval",
          })
        ).kind,
      ).toBe("ok");
      const approved = await queue(undefined, "fulfill", issuer, scopes[0]);
      if (approved.kind !== "ok") throw new Error(approved.kind);
      expect(approved.response.nextCursor).not.toBeNull();
      const approvedNext = await queue(
        approved.response.nextCursor!,
        "fulfill",
        issuer,
      );
      if (approvedNext.kind !== "ok") throw new Error(approvedNext.kind);
      expect([
        approved.response.items[0]!.redemption.id,
        approvedNext.response.items[0]!.redemption.id,
      ]).toEqual([id, second].sort().reverse());
      expect(
        (
          await fulfillRedemption(runtime, {
            ...common(issuer),
            redemptionId: approved.response.items[0]!.redemption.id,
            expectedVersion: 2,
            reason: "Pagination issuance",
          })
        ).kind,
      ).toBe("ok");
      expect(
        await queue(approved.response.nextCursor!, "fulfill", issuer),
      ).toEqual({ kind: "page_changed" });
    });
    it("checks current session and exact authority before exposing cursor results", async () => {
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE user_id=$1 AND scope_id=$2",
        [issuer.id, scopes[0]],
      );
      expect(
        await queue(
          `${issuer.id}|${scopes[0]}|fulfill|${ids[0]}`,
          "fulfill",
          issuer,
        ),
      ).toEqual({ kind: "unauthorized" });
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [issuer.id],
      );
      expect(
        await queue(
          `${issuer.id}|${scopes[0]}|fulfill|${ids[0]}`,
          "fulfill",
          issuer,
        ),
      ).toEqual({ kind: "not_found" });
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [outsider.id],
      );
      expect(
        await mine(`${outsider.id}|all|mine|${randomUUID()}`, outsider),
      ).toEqual({ kind: "unauthorized" });
    });
    it.skipIf(!origin)(
      "returns no-store HTTP errors and accepts the generated history cursor",
      async () => {
        const get = async (path: string, u = owner) =>
          fetch(`${origin}${path}`, {
            headers: { Cookie: `impuls_session=${u.token}` },
          });
        const first = await get("/api/v1/me/redemptions?limit=1");
        expect(first.status).toBe(200);
        const page = redemptionListResponseSchema.parse(await first.json());
        const cursor = encodeURIComponent(page.nextCursor!);
        const next = await get(
          `/api/v1/me/redemptions?limit=1&cursor=${cursor}`,
        );
        expect(next.status).toBe(200);
        expect(next.headers.get("cache-control")).toContain("no-store");
        for (const path of [
          `/api/v1/me/redemptions?cursor=${cursor}`,
          `/api/v1/me/redemptions?cursor=${encodeURIComponent(`${owner.id}|all|mine|${randomUUID()}`)}`,
        ]) {
          const r = await get(path, path.includes(cursor) ? reviewer : owner);
          expect(r.status).toBe(400);
          expect((await r.json()).code).toBe("INVALID_CURSOR");
          expect(r.headers.get("cache-control")).toContain("no-store");
        }
        const resolved = await admin.query<{ id: string }>(
          "SELECT id FROM impuls.redemptions WHERE id=ANY($1::uuid[]) AND status IN ('approved','fulfilled') LIMIT 1",
          [ids],
        );
        const changed = await get(
          `/api/v1/redemptions/review?cursor=${encodeURIComponent(`${reviewer.id}|${scopes[0]}|decide|${resolved.rows[0]!.id}`)}`,
          reviewer,
        );
        expect(changed.status).toBe(409);
        expect((await changed.json()).code).toBe("PAGE_CHANGED");
        for (const query of [
          "cursor=old",
          "cursor=old&cursor=other",
          "limit=51",
          "userId=anything",
        ])
          expect((await get(`/api/v1/me/redemptions?${query}`)).status).toBe(
            400,
          );
      },
    );
    afterAll(async () => {
      const userIds = users.map((u) => u.id);
      for (const [table, column] of [
        ["audit_events", "actor_id"],
        ["notification_outbox", "recipient_id"],
        ["entitlements", "user_id"],
        ["ledger_entries", "user_id"],
        ["redemptions", "user_id"],
        ["idempotency_records", "actor_id"],
        ["role_bindings", "user_id"],
        ["account_balances", "user_id"],
        ["sessions", "user_id"],
        ["task_scope_members", "user_id"],
      ])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE ${column}=ANY($1::uuid[])`,
          [userIds],
        );
      await admin.query(
        "DELETE FROM impuls.quota_periods WHERE reward_id=ANY($1::uuid[])",
        [rewardIds],
      );
      await admin.query(
        "DELETE FROM impuls.reward_versions WHERE reward_id=ANY($1::uuid[])",
        [rewardIds],
      );
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [scopes],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        userIds,
      ]);
      await runtime.end();
      await admin.end();
    });
  },
);
