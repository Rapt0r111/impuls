import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  rewardCursorSchema,
  rewardCatalogResponseSchema,
} from "../../packages/contracts/src/rewards";
import { readRewardCatalog } from "../../packages/domain/src/rewards/read";

const url = process.env.TEST_DATABASE_URL;
const origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F06 catalog pagination under impuls_app",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
    });
    const scopes = [randomUUID(), randomUUID()];
    const users = Array.from({ length: 2 }, () => {
      const token = randomBytes(32).toString("base64url");
      return {
        id: randomUUID(),
        token,
        hash: createHash("sha256").update(token).digest(),
      };
    });
    const owner = users[0]!;
    const rewards = Array.from({ length: 3 }, () => ({
      reward: randomUUID(),
      version: randomUUID(),
      quota: randomUUID(),
    })).sort((a, b) => a.reward.localeCompare(b.reward));
    const extraRewards: string[] = [];
    const encode = (r = rewards[0]!, scope = scopes[0]!, actor = owner.id) =>
      `${actor}|${scope}|catalog|${r.reward}|${r.version}|${r.quota}`;
    const read = (
      cursor?: string,
      scope?: string,
      user = owner,
      enabled = true,
    ) =>
      readRewardCatalog(runtime, user.id, user.hash, {
        allowSyntheticRewards: enabled,
        limit: 1,
        ...(cursor ? { cursor: rewardCursorSchema.parse(cursor) } : {}),
        ...(scope ? { scope } : {}),
      });
    const version = (
      r: (typeof rewards)[number],
      scope: string,
      n = 1,
      enabled = true,
      effective = "-1 minute",
    ) =>
      admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from) VALUES($1,$2,$3,$4,'Synthetic catalog position','Synthetic cursor fixture',5,'cosmetic',$5,clock_timestamp()+$6::interval)",
        [r.version, r.reward, scope, n, enabled, effective],
      );
    beforeAll(async () => {
      for (const [i, s] of scopes.entries())
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project',$2)",
          [s, `Catalog pagination ${i}`],
        );
      for (const u of users) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic catalog reader',true)",
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
      for (const r of rewards) {
        await version(r, scopes[0]!);
        await admin.query(
          "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',10)",
          [r.quota, r.reward, scopes[0]],
        );
      }
    });
    it("visits the independently ordered UUID list exactly once without writing financial state", async () => {
      const snapshot = async () =>
        (
          await admin.query(
            `SELECT lifetime_xp,available_points,reserved_points,version,
      (SELECT count(*)::int FROM impuls.ledger_entries WHERE user_id=$1) AS ledger,
      (SELECT count(*)::int FROM impuls.audit_events WHERE actor_id=$1) AS audit,
      (SELECT count(*)::int FROM impuls.notification_outbox WHERE recipient_id=$1) AS outbox,
      (SELECT sum(reserved+used)::int FROM impuls.quota_periods WHERE scope_id=$2) AS quota_consumed
      FROM impuls.account_balances WHERE user_id=$1`,
            [owner.id, scopes[0]],
          )
        ).rows[0];
      const expected = rewards.map((r) => r.reward);
      const before = await snapshot();
      expect(before).toEqual({
        lifetime_xp: "300",
        available_points: "120",
        reserved_points: "0",
        version: 1,
        ledger: 0,
        audit: 0,
        outbox: 0,
        quota_consumed: 0,
      });
      const found: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await read(cursor);
        if (result.kind !== "ok") throw new Error(result.kind);
        const page = rewardCatalogResponseSchema.parse(result.response);
        expect(page.scope?.id).toBe(scopes[0]);
        found.push(...page.items.map((i) => i.rewardId));
        cursor = page.nextCursor ?? undefined;
        expect(found.length).toBeLessThanOrEqual(3);
      } while (cursor);
      expect(found).toEqual(expected);
      expect(await snapshot()).toEqual(before);
    });
    it("rejects a different reader, explicit scope and missing scoped anchor", async () => {
      expect((await read(encode(), undefined, users[1]!)).kind).toBe(
        "invalid_cursor",
      );
      expect((await read(encode(), scopes[1])).kind).toBe("invalid_cursor");
      expect(
        (await read(encode({ ...rewards[0]!, reward: randomUUID() }))).kind,
      ).toBe("invalid_cursor");
      expect((await read(encode(rewards[0], scopes[1]!))).kind).toBe(
        "invalid_cursor",
      );
    });
    it("retains cursor scope when membership scope ordering changes", async () => {
      await admin.query(
        "UPDATE impuls.access_scopes SET name='AAA Catalog pagination' WHERE id=$1",
        [scopes[1]],
      );
      const result = await read(encode());
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(result.response.scope?.id).toBe(scopes[0]);
      expect(result.response.items[0]?.rewardId).toBe(rewards[1]!.reward);
      await admin.query(
        "UPDATE impuls.access_scopes SET name='Catalog pagination 1' WHERE id=$1",
        [scopes[1]],
      );
    });
    it("ignores a future version and reports a changed effective version or disabled position", async () => {
      const r = rewards[0]!;
      await version(
        { ...r, version: randomUUID() },
        scopes[0]!,
        2,
        true,
        "+1 day",
      );
      expect((await read(encode())).kind).toBe("ok");
      const current = { ...r, version: randomUUID() };
      await version(current, scopes[0]!, 3, true, "-10 seconds");
      expect((await read(encode())).kind).toBe("page_changed");
      expect((await read(encode(current))).kind).toBe("ok");
      await version(
        { ...r, version: randomUUID() },
        scopes[0]!,
        4,
        false,
        "-5 seconds",
      );
      expect((await read(encode(current))).kind).toBe("page_changed");
    });
    it("reports ended or replaced quota periods without rewriting the immutable terms", async () => {
      for (const replaced of [false, true]) {
        const r = {
          reward: randomUUID(),
          version: randomUUID(),
          quota: randomUUID(),
        };
        extraRewards.push(r.reward);
        await version(r, scopes[1]!);
        await admin.query(
          "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',10)",
          [r.quota, r.reward, scopes[1]],
        );
        if (replaced)
          await admin.query(
            "INSERT INTO impuls.quota_periods(reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',10)",
            [r.reward, scopes[1]],
          );
        expect((await read(encode(r, scopes[1]!))).kind).toBe("page_changed");
      }
    });
    it("checks membership, active user, session and disabled mode before returning catalog data", async () => {
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=clock_timestamp() WHERE user_id=$1 AND scope_id=$2",
        [owner.id, scopes[0]],
      );
      expect((await read(encode())).kind).toBe("not_found");
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=NULL WHERE user_id=$1 AND scope_id=$2",
        [owner.id, scopes[0]],
      );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [owner.id],
      );
      expect((await read(encode())).kind).toBe("unauthorized");
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [owner.id],
      );
      expect((await read(encode(), undefined, owner, false)).kind).toBe(
        "disabled",
      );
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        owner.id,
      ]);
      expect((await read(encode())).kind).toBe("revoked");
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        owner.id,
      ]);
      // Reactivating the fixture user does not resurrect its revoked session.
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [owner.id],
      );
    });
    (origin ? it : it.skip)(
      "serves strict HTTP errors and no-store responses with current scope access",
      async () => {
        const get = (query: string, user = owner) =>
          fetch(`${origin}/api/v1/rewards?${query}`, {
            headers: { cookie: `impuls_session=${user.token}` },
          });
        const valid = `${owner.id}|${scopes[0]}|catalog|${rewards[1]!.reward}|${rewards[1]!.version}|${rewards[1]!.quota}`;
        const response = await get(`scope=${scopes[0]}&limit=1`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        const page = rewardCatalogResponseSchema.parse(await response.json());
        expect(page.items[0]?.rewardId).toBe(rewards[1]!.reward);
        expect(
          (await get(`cursor=${encodeURIComponent(valid)}&limit=1`)).status,
        ).toBe(200);
        for (const [cursor, status, code] of [
          [valid, 400, "INVALID_CURSOR"],
          [encode(), 409, "PAGE_CHANGED"],
          [
            encode({ ...rewards[0]!, reward: randomUUID() }),
            400,
            "INVALID_CURSOR",
          ],
        ] as const) {
          const r = await get(
            `cursor=${encodeURIComponent(cursor)}`,
            cursor === valid ? users[1]! : owner,
          );
          expect(r.status).toBe(status);
          expect(r.headers.get("cache-control")).toContain("no-store");
          expect(await r.json()).toMatchObject({ code });
        }
        for (const query of [
          `cursor=${rewards[0]!.reward}`,
          "cursor=bad",
          "cursor=bad&cursor=other",
          "limit=0",
          "limit=51",
          "userId=anything",
          `cursor=${encodeURIComponent(valid + "|extra")}`,
        ])
          expect((await get(query)).status).toBe(400);
        await admin.query(
          "UPDATE impuls.task_scope_members SET revoked_at=clock_timestamp() WHERE user_id=$1 AND scope_id=$2",
          [owner.id, scopes[0]],
        );
        expect((await get(`cursor=${encodeURIComponent(valid)}`)).status).toBe(
          404,
        );
        await admin.query(
          "UPDATE impuls.task_scope_members SET revoked_at=NULL WHERE user_id=$1 AND scope_id=$2",
          [owner.id, scopes[0]],
        );
      },
    );
    afterAll(async () => {
      const userIds = users.map((u) => u.id);
      for (const table of [
        "sessions",
        "account_balances",
        "task_scope_members",
      ])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE user_id=ANY($1::uuid[])`,
          [userIds],
        );
      await admin.query(
        "DELETE FROM impuls.quota_periods WHERE reward_id=ANY($1::uuid[])",
        [rewards.map((r) => r.reward).concat(extraRewards)],
      );
      await admin.query(
        "DELETE FROM impuls.reward_versions WHERE reward_id=ANY($1::uuid[])",
        [rewards.map((r) => r.reward).concat(extraRewards)],
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
