import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";

const url = process.env.TEST_DATABASE_URL;

(url ? describe : describe.skip)("F07 unlimited quota periods", () => {
  const admin = new Pool({ connectionString: url });
  const runtime = new Pool({
    connectionString: url,
    options: "-c role=impuls_app",
    application_name: "unlimited-quota-tests",
    max: 4,
  });
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const scope = randomUUID();
  const tokens = users.map(() => randomBytes(32).toString("base64url"));
  const hashes = tokens.map((t) => createHash("sha256").update(t).digest());

  beforeAll(async () => {
    await admin.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic unlimited scope')",
      [scope],
    );
    for (const [i, u] of users.entries()) {
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic participant',true)",
        [u, randomInt(5e12, 6e12)],
      );
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [u, hashes[i]],
      );
      await admin.query(
        "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
        [u],
      );
      await admin.query(
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
        [u, scope],
      );
    }
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
  });

  async function reward(capacity: number | null) {
    const rewardId = randomUUID();
    const versionId = randomUUID();
    const quotaId = randomUUID();
    await admin.query(
      "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds) VALUES($1,$2,$3,1,'Synthetic unlimited reward','Synthetic conditions',30,'cosmetic',true,clock_timestamp()-interval '1 minute',3600)",
      [versionId, rewardId, scope],
    );
    await admin.query(
      "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$4)",
      [quotaId, rewardId, scope, capacity],
    );
    return { versionId, quotaId };
  }

  const reserve = (
    userIndex: number,
    f: Awaited<ReturnType<typeof reward>>,
  ) => ({
    actorId: users[userIndex]!,
    sessionHash: hashes[userIndex]!,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    allowSyntheticRewards: true,
    action: "reserve" as const,
    rewardVersionId: f.versionId,
    quotaPeriodId: f.quotaId,
    expectedVersion: 1,
  });

  it("reserves without a places check when capacity is unlimited", async () => {
    const f = await reward(null);
    for (const i of users.keys())
      expect((await mutateRedemption(runtime, reserve(i, f))).kind).toBe("ok");
    const quota = (
      await admin.query(
        "SELECT capacity,reserved,used FROM impuls.quota_periods WHERE id=$1",
        [f.quotaId],
      )
    ).rows[0];
    expect(quota).toEqual({ capacity: null, reserved: 3, used: 0 });
  });

  it("still refuses the next request once a counted capacity is full", async () => {
    const f = await reward(1);
    expect((await mutateRedemption(runtime, reserve(0, f))).kind).toBe("ok");
    expect((await mutateRedemption(runtime, reserve(1, f))).kind).toBe(
      "quota_full",
    );
  });

  it("rejects negative capacity and keeps NULL as the only unlimited marker", async () => {
    await expect(reward(-1)).rejects.toThrow();
    const f = await reward(null);
    const row = (
      await admin.query(
        "SELECT capacity FROM impuls.quota_periods WHERE id=$1",
        [f.quotaId],
      )
    ).rows[0];
    expect(row.capacity).toBeNull();
  });
});
