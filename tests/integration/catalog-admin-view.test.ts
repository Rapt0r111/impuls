import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRewardCatalog } from "../../packages/domain/src/rewards/read";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";

const url = process.env.TEST_DATABASE_URL;

(url ? describe : describe.skip)(
  "reward catalog for scope administrators",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
      application_name: "catalog-admin-view-tests",
      max: 4,
    });
    const [adminId, memberId] = [randomUUID(), randomUUID()];
    const scope = randomUUID();
    const tokens = [
      randomBytes(32).toString("base64url"),
      randomBytes(32).toString("base64url"),
    ];
    const [adminHash, memberHash] = tokens.map((t) =>
      createHash("sha256").update(t).digest(),
    );

    beforeAll(async () => {
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic admin view scope')",
        [scope],
      );
      for (const [i, u] of [adminId, memberId].entries()) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic catalog user',true)",
          [u, randomInt(4e12, 5e12)],
        );
        await admin.query(
          "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
          [u],
        );
      }
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,'admin.catalog',$1,'Synthetic fixture')",
        [adminId, scope],
      );
      await admin.query(
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
        [memberId, scope],
      );
      // Sessions last: a binding change revokes the holder's existing sessions.
      for (const [i, u] of [adminId, memberId].entries())
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [u, [adminHash, memberHash][i]],
        );
    });

    afterAll(async () => {
      await runtime.end();
      await admin.end();
    });

    async function reward() {
      const rewardId = randomUUID();
      const versionId = randomUUID();
      await admin.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds) VALUES($1,$2,$3,1,'Synthetic admin view reward','Synthetic conditions',30,'cosmetic',true,clock_timestamp()-interval '1 minute',3600)",
        [versionId, rewardId, scope],
      );
      const quotaId = randomUUID();
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',NULL)",
        [quotaId, rewardId, scope],
      );
      return { versionId, quotaId };
    }

    it("lets an administrator read the catalog without requesting from it", async () => {
      await reward();
      const result = await readRewardCatalog(runtime, adminId, adminHash, {
        allowSyntheticRewards: true,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.response.scope?.id).toBe(scope);
      expect(result.response.canRequest).toBe(false);
      expect(result.response.items.length).toBeGreaterThan(0);
    });

    it("refuses a request from a non-member administrator", async () => {
      const f = await reward();
      const result = await mutateRedemption(runtime, {
        actorId: adminId,
        sessionHash: adminHash,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        allowSyntheticRewards: true,
        action: "reserve",
        rewardVersionId: f.versionId,
        quotaPeriodId: f.quotaId,
        expectedVersion: 1,
      });
      expect(result.kind).toBe("not_found");
    });

    it("marks the catalog as requestable for a member", async () => {
      const result = await readRewardCatalog(runtime, memberId, memberHash, {
        allowSyntheticRewards: true,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.response.canRequest).toBe(true);
    });
  },
);
