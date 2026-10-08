import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../packages/contracts/src/index";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = process.env.TEST_APP_ORIGIN;
const secret = process.env.CSRF_SECRET;
const integration = databaseUrl && origin && secret ? describe : describe.skip;

integration("F03 mutation limit real HTTP", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const actor = randomUUID();
  const tokens = [
    randomBytes(32).toString("base64url"),
    randomBytes(32).toString("base64url"),
  ];
  const scope = randomUUID(),
    rules = randomUUID(),
    task = randomUUID();
  const key = randomUUID();
  const body = { action: "start", expectedVersion: 1 };

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(origin!).hostname))
      throw new Error("Local test server required");
    await admin.query(
      "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,'Synthetic HTTP rate limit',true)",
      [actor, randomInt(8_000_000_000_000, 9_000_000_000_000)],
    );
    await admin.query(
      "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic rate limit scope')",
      [scope],
    );
    await admin.query(
      "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{}',clock_timestamp(),$3)",
      [rules, randomInt(1_000_000, 2_000_000_000), actor],
    );
    await admin.query(
      "INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES ($1,$2,$3,$4,'Synthetic rate limit task','Independent criteria','test','normal','assigned',clock_timestamp(),19,7)",
      [task, scope, rules, actor],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
      [task, actor],
    );
    for (const token of tokens)
      await admin.query(
        "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [actor, createHash("sha256").update(token).digest()],
      );
  });
  beforeEach(async () => {
    await admin.query(
      "DELETE FROM impuls.task_mutation_limits WHERE actor_id=$1",
      [actor],
    );
  });
  afterAll(async () => {
    try {
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id=$1",
        [actor],
      );
      await admin.query(
        "DELETE FROM impuls.task_assignments WHERE task_id=$1",
        [task],
      );
      await admin.query("DELETE FROM impuls.tasks WHERE id=$1", [task]);
      await admin.query("DELETE FROM impuls.sessions WHERE user_id=$1", [
        actor,
      ]);
      await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rules]);
      await admin.query("DELETE FROM impuls.access_scopes WHERE id=$1", [
        scope,
      ]);
      await admin.query("DELETE FROM impuls.users WHERE id=$1", [actor]);
    } finally {
      await admin.end();
    }
  });
  function headers(session = 0) {
    return {
      "Content-Type": "application/json",
      Origin: origin!,
      Cookie: `impuls_session=${tokens[session]}`,
      "X-CSRF-Token": createHmac("sha256", secret!)
        .update(`csrf:${tokens[session]}`)
        .digest("base64url"),
      "Idempotency-Key": randomUUID(),
    };
  }
  function send(
    path = `/api/v1/tasks/${task}`,
    payload: unknown = body,
    h = headers(),
    method = "PATCH",
  ) {
    return fetch(`${origin}${path}`, {
      method,
      headers: h,
      body: JSON.stringify(payload),
    });
  }
  async function exhaust() {
    await admin.query(
      "INSERT INTO impuls.task_mutation_limits VALUES ($1,30,clock_timestamp()+interval '60 seconds')",
      [actor],
    );
  }
  async function rejected(response: Response) {
    expect(response.status).toBe(429);
    const error = apiErrorSchema.parse(await response.json());
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.requestId).toBe(response.headers.get("x-request-id"));
    expect(error.currentVersion).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(
      1,
    );
    expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(60);
  }
  async function counts() {
    return (
      await admin.query(
        `SELECT
      (SELECT status FROM impuls.tasks WHERE id=$1) AS status,
      (SELECT version FROM impuls.tasks WHERE id=$1) AS version,
      (SELECT count(*)::int FROM impuls.idempotency_records WHERE actor_id=$2) AS keys,
      (SELECT count(*)::int FROM impuls.submissions WHERE task_id=$1) AS reports,
      (SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=$1) AS reviews,
      (SELECT count(*)::int FROM impuls.ledger_entries WHERE task_id=$1) AS credits,
      (SELECT count(*)::int FROM impuls.account_balances WHERE user_id=$2) AS balances,
      (SELECT count(*)::int FROM impuls.audit_events WHERE actor_id=$2) AS audit,
      (SELECT count(*)::int FROM impuls.notification_outbox WHERE recipient_id=$2) AS outbox`,
        [task, actor],
      )
    ).rows[0];
  }

  it("shares exactly 30 attempts across sessions, malformed bodies and all task adapters", async () => {
    const paths = [
      { path: "/api/v1/tasks", method: "POST", payload: {} },
      { path: `/api/v1/tasks/${task}/assign`, method: "POST", payload: {} },
      { path: `/api/v1/tasks/${task}`, method: "PATCH", payload: {} },
      {
        path: `/api/v1/tasks/${task}/submissions`,
        method: "POST",
        payload: {},
      },
      {
        path: `/api/v1/submissions/${randomUUID()}/review`,
        method: "POST",
        payload: { action: "return" },
      },
      {
        path: `/api/v1/submissions/${randomUUID()}/review`,
        method: "POST",
        payload: { action: "accept" },
      },
    ];
    const before = await counts();
    for (let i = 0; i < 30; i++) {
      const route = paths[i % paths.length]!;
      const response = await send(
        route.path,
        route.payload,
        headers(i % 2),
        route.method,
      );
      expect(response.status).toBe(400);
    }
    for (const route of paths)
      await rejected(
        await send(route.path, route.payload, headers(1), route.method),
      );
    expect(await counts()).toEqual(before);
    expect(
      (
        await admin.query(
          "SELECT attempts FROM impuls.task_mutation_limits WHERE actor_id=$1",
          [actor],
        )
      ).rows[0],
    ).toEqual({ attempts: 31 });
  });

  it("rejects a valid write without business changes, then replays the same key after expiry", async () => {
    await exhaust();
    const h = { ...headers(), "Idempotency-Key": key };
    const before = await counts();
    await rejected(await send(undefined, body, h));
    expect(await counts()).toEqual(before);
    await admin.query(
      "UPDATE impuls.task_mutation_limits SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_id=$1",
      [actor],
    );
    const first = await send(undefined, body, h);
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(saved.task).toMatchObject({
      id: task,
      status: "in_progress",
      version: 2,
    });
    await admin.query(
      "UPDATE impuls.task_mutation_limits SET attempts=30 WHERE actor_id=$1",
      [actor],
    );
    await rejected(await send(undefined, body, h));
    await admin.query(
      "UPDATE impuls.task_mutation_limits SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_id=$1",
      [actor],
    );
    const replay = await send(undefined, body, h);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(saved);
    expect(await counts()).toEqual({
      ...before,
      status: "in_progress",
      version: 2,
      keys: 1,
    });
  });

  it("keeps Origin, auth, CSRF and revoked access ahead of a full bucket; reads and logout work", async () => {
    await exhaust();
    expect(
      (
        await send(undefined, body, {
          ...headers(),
          Origin: "https://untrusted.invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      (await send(undefined, body, { ...headers(), Cookie: "" })).status,
    ).toBe(401);
    expect(
      (await send(undefined, body, { ...headers(), "X-CSRF-Token": "invalid" }))
        .status,
    ).toBe(403);
    expect(
      (
        await admin.query(
          "SELECT attempts FROM impuls.task_mutation_limits WHERE actor_id=$1",
          [actor],
        )
      ).rows[0],
    ).toEqual({ attempts: 30 });
    expect(
      (await fetch(`${origin}/api/v1/tasks`, { headers: headers() })).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/api/v1/tasks/${task}`, { headers: headers() }))
        .status,
    ).toBe(200);
    expect(
      (await send("/api/v1/auth/logout", {}, headers(1), "POST")).status,
    ).toBe(204);
    const revoked = await send(undefined, body, headers(1));
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ code: "ACCESS_REVOKED" });
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      actor,
    ]);
    const disabled = await send();
    expect(disabled.status).toBe(403);
    expect(await disabled.json()).toMatchObject({ code: "ACCESS_REVOKED" });
    await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
      actor,
    ]);
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
  });

  it("returns 503 without a business mutation when the counter lock times out", async () => {
    await exhaust();
    const before = await counts();
    const lock = await admin.connect();
    try {
      await lock.query("BEGIN");
      await lock.query(
        "SELECT actor_id FROM impuls.task_mutation_limits WHERE actor_id=$1 FOR UPDATE",
        [actor],
      );
      const response = await send();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
      expect(response.headers.get("retry-after")).toBeNull();
      expect(await counts()).toEqual(before);
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
    expect(
      (
        await admin.query(
          "SELECT attempts FROM impuls.task_mutation_limits WHERE actor_id=$1",
          [actor],
        )
      ).rows[0],
    ).toEqual({ attempts: 30 });
  }, 10_000);
});
