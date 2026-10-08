import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readAdminCatalog } from "../../packages/domain/src/admin/catalog";
import { readAdminCatalogHistory } from "../../packages/domain/src/admin/catalog-history";
import { readAdminCatalogQuotas } from "../../packages/domain/src/admin/catalog-quotas";
import {
  adminCatalogCursorSchema,
  adminCatalogResponseSchema,
  adminCatalogHistoryCursorSchema,
  adminCatalogHistoryResponseSchema,
  adminCatalogQuotasCursorSchema,
  adminCatalogQuotasResponseSchema,
} from "../../packages/contracts/src/admin-catalog";
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)("F07 scoped catalog inspection", () => {
  const admin = new Pool({ connectionString: url }),
    runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
    });
  const users = [randomUUID(), randomUUID()],
    scopes = [randomUUID(), randomUUID(), randomUUID()];
  const actor = users[0]!,
    owner = users[1]!,
    scope = scopes[0]!,
    empty = scopes[1]!,
    neighbour = scopes[2]!;
  const tokens = users.map(() => randomBytes(32).toString("base64url")),
    hashes = tokens.map((t) => createHash("sha256").update(t).digest());
  const rewards = [randomUUID(), randomUUID(), randomUUID()].sort(),
    versions: string[] = [];
  const periods = [randomUUID(), randomUUID(), randomUUID()];
  const quotas = (
    extra: Partial<Parameters<typeof readAdminCatalogQuotas>[4]> = {},
    reward = rewards[0]!,
    i = 0,
  ) =>
    readAdminCatalogQuotas(runtime, users[i]!, hashes[i]!, reward, {
      enabled: true,
      scope,
      ...extra,
    });
  const read = (extra: Parameters<typeof readAdminCatalog>[3] = {}, i = 0) =>
    readAdminCatalog(runtime, users[i]!, hashes[i]!, {
      enabled: true,
      scope,
      ...extra,
    });
  const history = (
    extra: Partial<Parameters<typeof readAdminCatalogHistory>[4]> = {},
    reward = rewards[0]!,
    i = 0,
  ) =>
    readAdminCatalogHistory(runtime, users[i]!, hashes[i]!, reward, {
      enabled: true,
      scope,
      ...extra,
    });
  async function version(
    reward: string,
    v: number,
    effective: string,
    enabled = true,
    atScope = scope,
  ) {
    const id = randomUUID();
    versions.push(id);
    await admin.query(
      "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from,reservation_seconds) VALUES($1,$2,$3,$4,$5,'Explicit synthetic cosmetic conditions',7,'cosmetic','synthetic',$6,$7,3600)",
      [
        id,
        reward,
        atScope,
        v,
        `Synthetic cosmetic ${v}`,
        enabled,
        `${effective}T00:00:00Z`,
      ],
    );
    return id;
  }
  const snapshot = async () =>
    (
      await admin.query(
        "SELECT (SELECT jsonb_agg(r ORDER BY id) FROM impuls.reward_versions r WHERE scope_id=ANY($1::uuid[])) terms,(SELECT jsonb_agg(q ORDER BY id) FROM impuls.quota_periods q WHERE scope_id=ANY($1::uuid[])) quotas,(SELECT count(*) FROM impuls.audit_events WHERE actor_id=ANY($2::uuid[])) audit",
        [scopes, users],
      )
    ).rows;
  beforeAll(async () => {
    for (const u of users)
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic catalog reader',true)",
        [u, randomInt(6e12, 7e12)],
      );
    for (const s of scopes)
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project',$2)",
        [s, `Synthetic catalog ${s}`],
      );
    for (const s of [scope, empty])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,'admin.catalog',$1,'Synthetic fixture')",
        [actor, s],
      );
    await admin.query(
      "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,'reward.decide',$1,'Not catalog authority')",
      [owner, scope],
    );
    await version(rewards[0]!, 1, "2020-01-01");
    await version(rewards[0]!, 2, "2025-01-01", false);
    await version(rewards[0]!, 3, "2040-01-01");
    await version(rewards[0]!, 4, "2041-01-01");
    await version(rewards[1]!, 1, "2040-01-01");
    await version(rewards[2]!, 1, "2020-01-01");
    await version(randomUUID(), 1, "2020-01-01", true, neighbour);
    await admin.query(
      "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity,reserved,used) VALUES($1,$2,$3,'2020-01-01','2039-01-01',9,2,3),($4,$2,$3,'2019-01-01','2020-01-01',7,1,2),($5,$2,$3,'2039-01-01','2040-01-01',0,0,0)",
      [periods[0], rewards[0], scope, periods[1], periods[2]],
    );
    for (const [i, u] of users.entries())
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [u, hashes[i]],
      );
  });
  it("returns disabled effective terms, only nearest future version and reconciled current quota", async () => {
    const before = await snapshot(),
      result = await read();
    if (result.kind !== "ok") throw new Error(result.kind);
    const data = adminCatalogResponseSchema.parse(result.response);
    expect(data.items.map((i) => i.rewardId)).toEqual(rewards);
    expect(data.items[0]!.current).toMatchObject({
      version: 2,
      enabled: false,
      price: 7,
      reservationSeconds: 3600,
    });
    expect(data.items[0]!.scheduled).toMatchObject({
      version: 3,
      effectiveFrom: "2040-01-01T00:00:00.000Z",
    });
    expect(data.items[0]!.quota).toMatchObject({
      capacity: 9,
      reserved: 2,
      used: 3,
      available: 4,
    });
    expect(data.items[1]!.current).toBeNull();
    expect(data.items[1]!.scheduled?.version).toBe(1);
    expect(data.items[2]!.quota).toBeNull();
    expect(JSON.stringify(data)).not.toContain(neighbour);
    expect(await snapshot()).toEqual(before);
  });
  it("does not infer catalog authority from reward.decide or adjacent scopes", async () => {
    expect(await read({}, 1)).toEqual({ kind: "not_found" });
    expect(await read({ scope: neighbour })).toEqual({ kind: "not_found" });
    const result = await read({ scope: empty });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.response.items).toEqual([]);
  });
  it("reads live past/current/future quotas without modifying business records", async () => {
    const saved = () =>
      admin.query(
        "SELECT to_jsonb(q) value FROM impuls.quota_periods q WHERE scope_id=ANY($1::uuid[]) ORDER BY id",
        [scopes],
      );
    const before = await saved();
    const result = await quotas();
    if (result.kind !== "ok") throw new Error(result.kind);
    const data = adminCatalogQuotasResponseSchema.parse(result.response);
    expect(
      data.items.map((q) => [q.id, q.state, q.available, q.reserved]),
    ).toEqual([
      [periods[2], "scheduled", 0, 0],
      [periods[0], "current", 4, 2],
      [periods[1], "past", 4, 1],
    ]);
    expect(data.nextCursor).toBeNull();
    expect((await saved()).rows).toEqual(before.rows);
    const noQuota = await quotas({}, rewards[1]);
    if (noQuota.kind !== "ok") throw new Error(noQuota.kind);
    expect(noQuota.response.items).toEqual([]);
  });
  it("pages periods by database start time and binds every cursor component", async () => {
    const found: string[] = [];
    let cursor:
      ReturnType<typeof adminCatalogQuotasCursorSchema.parse> | undefined;
    do {
      const result = await quotas({ cursor, limit: 1 });
      if (result.kind !== "ok") throw new Error(result.kind);
      found.push(result.response.items[0]!.id);
      cursor = result.response.nextCursor
        ? adminCatalogQuotasCursorSchema.parse(result.response.nextCursor)
        : undefined;
    } while (cursor);
    expect(found).toEqual([periods[2], periods[0], periods[1]]);
    const first = await quotas({ limit: 1 });
    if (first.kind !== "ok") throw new Error(first.kind);
    const anchor = adminCatalogQuotasCursorSchema.parse(
      first.response.nextCursor,
    );
    for (const forged of [
      { ...anchor, actor: owner },
      { ...anchor, scope: empty },
      { ...anchor, rewardId: rewards[1]! },
      { ...anchor, periodId: randomUUID() },
      { ...anchor, purpose: "admin-catalog-history" as "admin-catalog-quotas" },
    ])
      expect(await quotas({ cursor: forged })).toEqual({
        kind: "invalid_cursor",
      });
    expect(await quotas({ scope: neighbour })).toEqual({ kind: "not_found" });
    expect(await quotas({}, randomUUID())).toEqual({ kind: "not_found" });
    expect(await quotas({}, rewards[0], 1)).toEqual({ kind: "not_found" });
    expect(await quotas({ enabled: false })).toEqual({ kind: "disabled" });
    await admin
      .query(
        "INSERT INTO impuls.quota_periods(reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,'2040-01-01','2041-01-01',1) RETURNING id",
        [rewards[1], scope],
      )
      .then(async (result) => {
        expect(
          await quotas({ cursor: { ...anchor, periodId: result.rows[0].id } }),
        ).toEqual({ kind: "invalid_cursor" });
      });
  });
  it("classifies adjacent periods with inclusive start and exclusive end", async () => {
    const reward = randomUUID();
    try {
      await version(reward, 1, "2020-01-01");
      await admin.query(
        `WITH boundary AS (SELECT date_trunc('milliseconds',clock_timestamp()) t)
         INSERT INTO impuls.quota_periods(reward_id,scope_id,starts_at,ends_at,capacity)
         SELECT $1::uuid,$2::uuid,t-interval '1 day',t,1 FROM boundary
         UNION ALL SELECT $1::uuid,$2::uuid,t,t+interval '1 day',1 FROM boundary`,
        [reward, scope],
      );
      const result = await quotas({}, reward);
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(result.response.items.map((q) => q.state)).toEqual([
        "current",
        "past",
      ]);
      expect(result.response.items[0]!.startsAt).toBe(
        result.response.items[1]!.endsAt,
      );
    } finally {
      await admin.query(
        "DELETE FROM impuls.quota_periods WHERE reward_id=$1 AND scope_id=$2",
        [reward, scope],
      );
      await admin.query(
        "DELETE FROM impuls.reward_versions WHERE reward_id=$1 AND scope_id=$2",
        [reward, scope],
      );
    }
  });
  it("keeps millisecond order independent of UUID and reflects changed past counters", async () => {
    const reward = randomUUID();
    const ids = [
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "00000000-0000-4000-8000-000000000001",
    ];
    try {
      await version(reward, 1, "2040-01-01");
      await admin.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$3,$4,'2045-01-01T00:00:00.001Z','2045-01-01T00:00:00.002Z',1),($2,$3,$4,'2045-01-01T00:00:00.002Z','2045-01-01T00:00:00.003Z',1)",
        [...ids, reward, scope],
      );
      const first = await quotas({ limit: 1 }, reward);
      if (first.kind !== "ok") throw new Error(first.kind);
      expect(first.response.items[0]!.id).toBe(ids[1]);
      const cursor = adminCatalogQuotasCursorSchema.parse(
        first.response.nextCursor,
      );
      const next = await quotas({ cursor, limit: 1 }, reward);
      if (next.kind !== "ok") throw new Error(next.kind);
      expect(next.response.items[0]!.id).toBe(ids[0]);
      expect(next.response.items[0]!.startsAt).toBe("2045-01-01T00:00:00.001Z");
      await admin.query(
        "DELETE FROM impuls.quota_periods WHERE id=$1 AND reward_id=$2 AND scope_id=$3",
        [ids[1], reward, scope],
      );
      expect(await quotas({ cursor }, reward)).toEqual({
        kind: "invalid_cursor",
      });
    } finally {
      await admin.query(
        "DELETE FROM impuls.quota_periods WHERE reward_id=$1 AND scope_id=$2",
        [reward, scope],
      );
      await admin.query(
        "DELETE FROM impuls.reward_versions WHERE reward_id=$1 AND scope_id=$2",
        [reward, scope],
      );
    }
    const before = await quotas();
    if (before.kind !== "ok") throw new Error(before.kind);
    await admin.query(
      "UPDATE impuls.quota_periods SET reserved=0,version=version+1,updated_at=now() WHERE id=$1",
      [periods[1]],
    );
    const changed = await quotas();
    if (changed.kind !== "ok") throw new Error(changed.kind);
    expect(changed.response.items[2]).toMatchObject({
      state: "past",
      reserved: 0,
      available: 5,
      version: 2,
    });
    await admin.query(
      "UPDATE impuls.quota_periods SET reserved=1,version=version+1,updated_at=now() WHERE id=$1",
      [periods[1]],
    );
  });
  it("reads every saved version including disabled current, old and distant future terms without mutation", async () => {
    const before = await snapshot();
    const result = await history();
    if (result.kind !== "ok") throw new Error(result.kind);
    const response = adminCatalogHistoryResponseSchema.parse(result.response);
    expect(response.items.map((v) => [v.version, v.state])).toEqual([
      [4, "scheduled"],
      [3, "scheduled"],
      [2, "current"],
      [1, "superseded"],
    ]);
    expect(response.items[2]).toMatchObject({
      enabled: false,
      price: 7,
      reservationSeconds: 3600,
    });
    expect(response.items[0]!.effectiveFrom).toBe(
      "2041-01-01T00:00:00.000000Z",
    );
    expect(response.nextCursor).toBeNull();
    const future = await history({}, rewards[1]);
    if (future.kind !== "ok") throw new Error(future.kind);
    expect(future.response.items.map((v) => v.state)).toEqual(["scheduled"]);
    expect(await snapshot()).toEqual(before);
  });
  it("pages by full database timestamp and version, including ties and out-of-order version numbers", async () => {
    const reward = randomUUID();
    try {
      for (const [v, time] of [
        [1, "2045-01-01T00:00:00.000001Z"],
        [2, "2045-01-01T00:00:00.000002Z"],
        [3, "2045-01-01T00:00:00.000002Z"],
        [4, "2020-01-01T00:00:00Z"],
        [5, "2020-01-01T00:00:00Z"],
      ] as const)
        await admin.query(
          "INSERT INTO impuls.reward_versions(reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,'Synthetic tied version','Explicit synthetic terms',11,'cosmetic','synthetic',true,$4)",
          [reward, scope, v, time],
        );
      const found: number[] = [],
        states: string[] = [];
      let cursor:
        ReturnType<typeof adminCatalogHistoryCursorSchema.parse> | undefined;
      do {
        const result = await history({ limit: 1, cursor }, reward);
        if (result.kind !== "ok") throw new Error(result.kind);
        found.push(result.response.items[0]!.version);
        states.push(result.response.items[0]!.state);
        cursor = result.response.nextCursor
          ? adminCatalogHistoryCursorSchema.parse(result.response.nextCursor)
          : undefined;
      } while (cursor);
      expect(found).toEqual([3, 2, 1, 5, 4]);
      expect(states).toEqual([
        "scheduled",
        "scheduled",
        "scheduled",
        "current",
        "superseded",
      ]);
    } finally {
      await admin.query(
        "DELETE FROM impuls.reward_versions WHERE reward_id=$1 AND scope_id=$2",
        [reward, scope],
      );
    }
  });
  it("rejects history cursors for another actor, scope, reward or inaccessible version", async () => {
    const first = await history({ limit: 1 });
    if (first.kind !== "ok") throw new Error(first.kind);
    const cursor = adminCatalogHistoryCursorSchema.parse(
      first.response.nextCursor,
    );
    const next = await history({ cursor, limit: 1 });
    if (next.kind !== "ok") throw new Error(next.kind);
    expect(next.response.items[0]!.version).toBe(3);
    for (const forged of [
      { ...cursor, actor: owner },
      { ...cursor, scope: empty },
      { ...cursor, rewardId: rewards[1]! },
      { ...cursor, versionId: randomUUID() },
    ])
      expect(await history({ cursor: forged })).toEqual({
        kind: "invalid_cursor",
      });
    const other = await history({}, rewards[1]);
    if (other.kind !== "ok") throw new Error(other.kind);
    expect(
      await history({
        cursor: { ...cursor, versionId: other.response.items[0]!.id },
      }),
    ).toEqual({ kind: "invalid_cursor" });
    expect(await history({ scope: neighbour })).toEqual({ kind: "not_found" });
    expect(await history({}, randomUUID())).toEqual({ kind: "not_found" });
    expect(await history({}, rewards[0], 1)).toEqual({ kind: "not_found" });
    expect(await history({ enabled: false })).toEqual({ kind: "disabled" });
  });
  it("pins cursor scope and actor, validates anchor and pages without duplicate identities", async () => {
    const first = await read({ limit: 1 });
    if (first.kind !== "ok") throw new Error(first.kind);
    expect(first.response.items[0]!.rewardId).toBe(rewards[0]);
    const cursor = adminCatalogCursorSchema.parse(first.response.nextCursor);
    const next = await read({ scope: undefined, cursor, limit: 1 });
    if (next.kind !== "ok") throw new Error(next.kind);
    expect(next.response.scope.id).toBe(scope);
    expect(next.response.items[0]!.rewardId).toBe(rewards[1]);
    for (const forged of [
      { ...cursor, actor: owner },
      { ...cursor, scope: empty },
      { ...cursor, rewardId: randomUUID() },
    ])
      expect(await read({ cursor: forged })).toEqual({
        kind: "invalid_cursor",
      });
  });
  it("checks flag and expired sessions before exposing configuration", async () => {
    expect(await read({ enabled: false })).toEqual({ kind: "disabled" });
    expect(
      await readAdminCatalog(runtime, actor, Buffer.alloc(32), {
        enabled: true,
        scope,
      }),
    ).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "unauthorized" });
    expect(await history()).toEqual({ kind: "unauthorized" });
    expect(await quotas()).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()+interval '1 hour' WHERE user_id=$1",
      [actor],
    );
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=now() WHERE user_id=$1",
      [actor],
    );
    expect(await history()).toEqual({ kind: "revoked" });
    expect(await quotas()).toEqual({ kind: "revoked" });
    if (origin) {
      expect(
        (
          await fetch(
            `${origin}/api/v1/admin/rewards/${rewards[0]}/versions?scope=${scope}`,
            { headers: { cookie: `impuls_session=${tokens[0]}` } },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(
            `${origin}/api/v1/admin/rewards/${rewards[0]}/quotas?scope=${scope}`,
            { headers: { cookie: `impuls_session=${tokens[0]}` } },
          )
        ).status,
      ).toBe(403);
    }
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
  });
  it("rejects expired/revoked bindings and inactive readers", async () => {
    await admin.query(
      "UPDATE impuls.role_bindings SET valid_until=now()-interval '1 second',valid_from=now()-interval '1 day' WHERE user_id=$1 AND scope_id=$2",
      [actor, scope],
    );
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "not_found" });
    expect(await history()).toEqual({ kind: "not_found" });
    expect(await quotas()).toEqual({ kind: "not_found" });
    await admin.query(
      "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1 AND scope_id=$2",
      [actor, scope],
    );
    await admin.query(
      "UPDATE impuls.role_bindings SET revoked_at=now() WHERE user_id=$1 AND scope_id=$2",
      [actor, scope],
    );
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "not_found" });
    expect(await history()).toEqual({ kind: "not_found" });
    expect(await quotas()).toEqual({ kind: "not_found" });
    await admin.query(
      "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND scope_id=$2",
      [actor, scope],
    );
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      actor,
    ]);
    expect(await read({ enabled: false })).toEqual({ kind: "revoked" });
    expect(await history()).toEqual({ kind: "revoked" });
    expect(await quotas()).toEqual({ kind: "revoked" });
    await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
      actor,
    ]);
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
  });
  it.skipIf(!origin)(
    "serves quota pages through private strict HTTP and rejects untrusted writes",
    async () => {
      const headers = { cookie: `impuls_session=${tokens[0]}` };
      const endpoint = `${origin}/api/v1/admin/rewards/${rewards[0]}/quotas?scope=${scope}&limit=1`;
      const response = await fetch(endpoint, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const data = adminCatalogQuotasResponseSchema.parse(
        await response.json(),
      );
      expect(data.items[0]).toMatchObject({
        id: periods[2],
        state: "scheduled",
        capacity: 0,
      });
      const next = await fetch(
        `${endpoint}&cursor=${encodeURIComponent(data.nextCursor!)}`,
        { headers },
      );
      expect(next.status).toBe(200);
      expect(
        adminCatalogQuotasResponseSchema.parse(await next.json()).items[0]!.id,
      ).toBe(periods[0]);
      for (const query of [
        "",
        `scope=${scope}&scope=${scope}`,
        `scope=${scope}&limit=51`,
        `scope=${scope}&cursor=bad`,
        `scope=${scope}&price=7`,
        `scope=${scope}&cursor=${encodeURIComponent(data.nextCursor!.replace("admin-catalog-quotas", "admin-catalog-history"))}`,
      ])
        expect(
          (
            await fetch(
              `${origin}/api/v1/admin/rewards/${rewards[0]}/quotas?${query}`,
              { headers },
            )
          ).status,
        ).toBe(400);
      expect((await fetch(endpoint)).status).toBe(401);
      expect((await fetch(endpoint, { headers, method: "POST" })).status).toBe(
        403,
      );
      expect(
        (
          await fetch(
            `${origin}/api/v1/admin/rewards/${randomUUID()}/quotas?scope=${scope}`,
            { headers },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await fetch(
            `${origin}/api/v1/admin/rewards/${rewards[0]}/quotas?scope=${neighbour}`,
            { headers },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await fetch(endpoint, {
            headers: { cookie: `impuls_session=${tokens[1]}` },
          })
        ).status,
      ).toBe(404);
    },
  );
  it.skipIf(!origin)(
    "serves private no-store HTTP, strict query and no mutating method",
    async () => {
      const headers = { cookie: `impuls_session=${tokens[0]}` },
        endpoint = `${origin}/api/v1/admin/rewards?scope=${scope}`;
      const response = await fetch(endpoint, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(
        adminCatalogResponseSchema.parse(await response.json()).items,
      ).toHaveLength(3);
      for (const query of [
        "limit=51",
        "price=7",
        `scope=${scope}&scope=${scope}`,
        "cursor=bad",
      ])
        expect(
          (await fetch(`${origin}/api/v1/admin/rewards?${query}`, { headers }))
            .status,
        ).toBe(400);
      expect((await fetch(endpoint)).status).toBe(401);
      expect((await fetch(endpoint, { headers, method: "POST" })).status).toBe(
        403,
      );
      expect(
        (
          await fetch(`${origin}/api/v1/admin/rewards?scope=${neighbour}`, {
            headers,
          })
        ).status,
      ).toBe(404);
      const historyEndpoint = `${origin}/api/v1/admin/rewards/${rewards[0]}/versions?scope=${scope}&limit=1`;
      const historyResponse = await fetch(historyEndpoint, { headers });
      expect(historyResponse.status).toBe(200);
      expect(historyResponse.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      const historyData = adminCatalogHistoryResponseSchema.parse(
        await historyResponse.json(),
      );
      expect(historyData.items[0]!.version).toBe(4);
      const second = await fetch(
        `${historyEndpoint}&cursor=${encodeURIComponent(historyData.nextCursor!)}`,
        { headers },
      );
      expect(second.status).toBe(200);
      expect(
        adminCatalogHistoryResponseSchema.parse(await second.json()).items[0]!
          .version,
      ).toBe(3);
      for (const query of [
        "",
        `scope=${scope}&scope=${scope}`,
        `scope=${scope}&limit=51`,
        `scope=${scope}&cursor=bad`,
        `scope=${scope}&price=7`,
      ])
        expect(
          (
            await fetch(
              `${origin}/api/v1/admin/rewards/${rewards[0]}/versions?${query}`,
              { headers },
            )
          ).status,
        ).toBe(400);
      expect((await fetch(historyEndpoint)).status).toBe(401);
      expect(
        (await fetch(historyEndpoint, { headers, method: "POST" })).status,
      ).toBe(403);
      expect(
        (
          await fetch(
            `${origin}/api/v1/admin/rewards/${randomUUID()}/versions?scope=${scope}`,
            { headers },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await fetch(
            `${origin}/api/v1/admin/rewards/${rewards[0]}/versions?scope=${neighbour}`,
            { headers },
          )
        ).status,
      ).toBe(404);
    },
  );
  it.skipIf(!origin)(
    "renders actual catalog API and database through the workspace",
    async () => {
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
        });
        await context.addCookies([
          {
            name: "impuls_session",
            value: tokens[0]!,
            url: origin!,
            httpOnly: true,
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
          .getByRole("button", { name: "Управление каталогом", exact: true })
          .click();
        await page.getByLabel("Область", { exact: true }).selectOption(scope);
        await page.locator(".admin-catalog-items li").first().waitFor();
        expect(await page.locator(".admin-catalog-items > li").count()).toBe(3);
        expect(
          await page.locator(".admin-catalog-items > li").first().innerText(),
        ).toContain("Выключена");
        await page.getByText("Будущая версия 3", { exact: true }).click();
        await page
          .getByRole("heading", { name: "Synthetic cosmetic 3" })
          .waitFor();
        await page.locator(".admin-catalog-history summary").first().click();
        await page.locator(".admin-catalog-versions > li").first().waitFor();
        expect(await page.locator(".admin-catalog-versions > li").count()).toBe(
          4,
        );
        expect(
          await page.locator(".admin-catalog-versions").innerText(),
        ).toContain("Заменённые условия");
        expect(
          await page.locator(".admin-catalog-versions").innerText(),
        ).toContain("версия 4");
        await page.locator(".admin-catalog-quotas summary").first().click();
        const quotaRows = page.locator(".admin-catalog-periods > li");
        await quotaRows.first().waitFor();
        expect(await quotaRows.count()).toBe(3);
        expect(await quotaRows.nth(2).innerText()).toContain(
          "Завершившийся период",
        );
        expect(await quotaRows.nth(2).innerText()).toContain("В резерве\n1");
      } finally {
        await browser.close();
      }
    },
  );
  afterAll(async () => {
    try {
      for (const table of ["quota_periods", "reward_versions"])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE scope_id=ANY($1::uuid[])`,
          [scopes],
        );
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [scopes],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await Promise.all([admin.end(), runtime.end()]);
    }
  });
});
