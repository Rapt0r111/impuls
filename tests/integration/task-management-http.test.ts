import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  taskManagementOptionsResponseSchema,
  taskManagementResponseSchema,
} from "../../packages/contracts/src/task-management";

const origin = process.env.TEST_APP_ORIGIN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const secret = process.env.CSRF_SECRET;
const integration = origin && databaseUrl && secret ? describe : describe.skip;
integration("F02/F03 task management real HTTP", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const manager = randomUUID(),
    participant = randomUUID(),
    outsider = randomUUID();
  const scope = randomUUID(),
    rules = randomUUID();
  const users = [manager, participant, outsider];
  const tokens = users.map(() => randomBytes(32).toString("base64url"));
  const tasks: string[] = [];
  const payload = {
    scopeId: scope,
    ruleSetId: rules,
    title: "Synthetic HTTP managed task",
    criteria: "Independent test criteria",
    categoryCode: "test",
    priority: "normal",
    dueAt: "2035-01-01T00:00:00.000Z",
    fundXp: 19,
    fundPoints: 7,
  };
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(origin!).hostname))
      throw new Error("Local test server required");
    for (const [i, user] of users.entries())
      await pool.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,$3,true)",
        [
          user,
          randomInt(7_000_000_000_000, 8_000_000_000_000),
          `Synthetic HTTP manager ${i}`,
        ],
      );
    await pool.query(
      "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic HTTP management')",
      [scope],
    );
    await pool.query(
      `INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{"mode":"synthetic"}',clock_timestamp()-interval '1 minute',$3)`,
      [rules, randomInt(1_000_000, 2_000_000_000), manager],
    );
    await pool.query(
      `INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason) VALUES ($1,'task.create',$2,$1,'Synthetic HTTP test'),($1,'task.assign',$2,$1,'Synthetic HTTP test')`,
      [manager, scope],
    );
    await pool.query(
      "INSERT INTO impuls.task_scope_members (scope_id,user_id) VALUES ($1,$2)",
      [scope, participant],
    );
    for (const [i, user] of users.entries())
      await pool.query(
        "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [user, createHash("sha256").update(tokens[i]!).digest()],
      );
  });
  afterAll(async () => {
    try {
      await pool.query(
        "DELETE FROM impuls.notification_outbox WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await pool.query(
        "DELETE FROM impuls.audit_events WHERE actor_id=ANY($1::uuid[])",
        [users],
      );
      await pool.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
        [users],
      );
      await pool.query(
        "DELETE FROM impuls.task_assignments WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await pool.query("DELETE FROM impuls.tasks WHERE created_by=$1", [
        manager,
      ]);
      await pool.query(
        "DELETE FROM impuls.task_scope_members WHERE scope_id=$1",
        [scope],
      );
      await pool.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await pool.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await pool.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rules]);
      await pool.query("DELETE FROM impuls.access_scopes WHERE id=$1", [scope]);
      await pool.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await pool.end();
    }
  });
  function headers(actor = 0, key = randomUUID()) {
    return {
      "Content-Type": "application/json",
      Origin: origin!,
      Cookie: `impuls_session=${tokens[actor]}`,
      "X-CSRF-Token": createHmac("sha256", secret!)
        .update(`csrf:${tokens[actor]}`)
        .digest("base64url"),
      "Idempotency-Key": key,
    };
  }
  async function post(path: string, body: unknown, h = headers()) {
    return fetch(`${origin}${path}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
  }
  it("rejects origin, CSRF, keys, extra fields and wrong scope without inserting a task", async () => {
    expect(
      (
        await post("/api/v1/tasks", payload, {
          ...headers(),
          Origin: "https://untrusted.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post("/api/v1/tasks", payload, {
          ...headers(),
          "X-CSRF-Token": "wrong",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post("/api/v1/tasks", payload, {
          ...headers(),
          "Idempotency-Key": "wrong",
        })
      ).status,
    ).toBe(400);
    expect(
      (await post("/api/v1/tasks", { ...payload, createdBy: outsider })).status,
    ).toBe(400);
    expect((await post("/api/v1/tasks", payload, headers(2))).status).toBe(404);
    expect(
      (
        await pool.query("SELECT id FROM impuls.tasks WHERE created_by=$1", [
          manager,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("creates and assigns once, preserves no-store and denies closed object information", async () => {
    const h = headers();
    const response = await post("/api/v1/tasks", payload, h);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const created = taskManagementResponseSchema.parse(await response.json());
    tasks.push(created.task.id);
    expect(
      taskManagementResponseSchema.parse(
        await (await post("/api/v1/tasks", payload, h)).json(),
      ),
    ).toEqual(created);
    expect(
      (await post("/api/v1/tasks", { ...payload, title: "Changed" }, h)).status,
    ).toBe(409);
    const assignBody = { assigneeId: participant, expectedVersion: 1 };
    const path = `/api/v1/tasks/${created.task.id}/assign`;
    const denied = await post(path, assignBody, headers(2));
    expect(denied.status).toBe(404);
    expect(await denied.json()).not.toHaveProperty("currentVersion");
    expect((await post(path, { ...assignBody, scopeId: scope })).status).toBe(
      400,
    );
    const ah = headers();
    const assigned = await post(path, assignBody, ah);
    expect(assigned.status).toBe(200);
    expect(
      taskManagementResponseSchema.parse(await assigned.json()).task,
    ).toMatchObject({
      id: created.task.id,
      status: "assigned",
      version: 2,
      assignee: { id: participant },
    });
    expect((await post(path, assignBody, ah)).status).toBe(200);
    const conflict = await post(path, assignBody);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "TASK_CONFLICT",
      currentVersion: 2,
    });
    const memberRead = await fetch(
      `${origin}/api/v1/tasks/${created.task.id}`,
      { headers: { Cookie: `impuls_session=${tokens[1]}` } },
    );
    expect(memberRead.status).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM impuls.ledger_entries WHERE task_id=$1",
          [created.task.id],
        )
      ).rows[0],
    ).toEqual({ n: 0 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM impuls.notification_outbox WHERE task_id=$1",
          [created.task.id],
        )
      ).rows[0],
    ).toEqual({ n: 1 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM impuls.audit_events WHERE task_id=$1",
          [created.task.id],
        )
      ).rows[0],
    ).toEqual({ n: 2 });
  });
  it("reads scoped server choices, validates queries and rejects assignment outside membership", async () => {
    const options = await fetch(`${origin}/api/v1/task-management/options`, {
      headers: { Cookie: `impuls_session=${tokens[0]}` },
    });
    expect(options.status).toBe(200);
    expect(
      taskManagementOptionsResponseSchema.parse(await options.json()).scopes,
    ).toEqual([
      expect.objectContaining({
        id: scope,
        canCreate: true,
        canAssign: true,
        assignees: [
          { id: participant, displayName: "Synthetic HTTP manager 1" },
        ],
      }),
    ]);
    for (const query of [
      "limit=51",
      "limit=20&limit=20",
      "userId=bad",
      "cursor=bad",
    ]) {
      expect(
        (
          await fetch(`${origin}/api/v1/task-management?${query}`, {
            headers: { Cookie: `impuls_session=${tokens[0]}` },
          })
        ).status,
      ).toBe(400);
    }
    expect((await fetch(`${origin}/api/v1/task-management`)).status).toBe(401);
    const response = await post("/api/v1/tasks", payload);
    const created = taskManagementResponseSchema.parse(await response.json());
    tasks.push(created.task.id);
    const rejected = await post(`/api/v1/tasks/${created.task.id}/assign`, {
      assigneeId: outsider,
      expectedVersion: 1,
    });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({
      code: "TASK_ASSIGNEE_INVALID",
    });
    expect(
      (
        await pool.query(
          "SELECT status,version FROM impuls.tasks WHERE id=$1",
          [created.task.id],
        )
      ).rows[0],
    ).toEqual({ status: "draft", version: 1 });
  });
});
