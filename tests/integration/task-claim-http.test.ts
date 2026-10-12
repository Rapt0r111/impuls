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
  openTaskListResponseSchema,
  taskClaimResponseSchema,
} from "../../packages/contracts/src/tasks";
import { taskManagementResponseSchema } from "../../packages/contracts/src/task-management";

const origin = process.env.TEST_APP_ORIGIN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const secret = process.env.CSRF_SECRET;
const integration = origin && databaseUrl && secret ? describe : describe.skip;
integration("free tasks over real HTTP", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const manager = randomUUID(),
    member = randomUUID(),
    second = randomUUID(),
    outsider = randomUUID();
  const users = [manager, member, second, outsider];
  const scope = randomUUID(),
    rules = randomUUID();
  const tokens = users.map(() => randomBytes(32).toString("base64url"));
  const payload = {
    scopeId: scope,
    ruleSetId: rules,
    title: "Synthetic free HTTP task",
    criteria: "Independent test criteria",
    categoryCode: "test",
    priority: "normal",
    dueAt: "2035-01-01T00:00:00.000Z",
    fundXp: 21,
    fundPoints: 8,
    openForClaim: true,
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
          `Synthetic free task user ${i}`,
        ],
      );
    await pool.query(
      "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic free task scope')",
      [scope],
    );
    await pool.query(
      `INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{"mode":"synthetic"}',clock_timestamp()-interval '1 minute',$3)`,
      [rules, randomInt(1_000_000, 2_000_000_000), manager],
    );
    await pool.query(
      `INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason) VALUES ($1,'task.create',$2,$1,'Synthetic HTTP test')`,
      [manager, scope],
    );
    for (const user of [member, second])
      await pool.query(
        "INSERT INTO impuls.task_scope_members (scope_id,user_id) VALUES ($1,$2)",
        [scope, user],
      );
    for (const [i, user] of users.entries())
      await pool.query(
        "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [user, createHash("sha256").update(tokens[i]!).digest()],
      );
  });
  afterAll(async () => {
    try {
      const tasks = (
        await pool.query<{ id: string }>(
          "SELECT id FROM impuls.tasks WHERE created_by=$1",
          [manager],
        )
      ).rows.map((row) => row.id);
      for (const sql of [
        "DELETE FROM impuls.audit_events WHERE actor_id=ANY($1::uuid[])",
        "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
      ])
        await pool.query(sql, [users]);
      for (const sql of [
        "DELETE FROM impuls.notification_outbox WHERE task_id=ANY($1::uuid[])",
        "DELETE FROM impuls.task_events WHERE task_id=ANY($1::uuid[])",
        "DELETE FROM impuls.task_assignments WHERE task_id=ANY($1::uuid[])",
        "DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])",
      ])
        await pool.query(sql, [tasks]);
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
  function headers(actor: number, key = randomUUID()) {
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
  const post = (path: string, body: unknown, h: Record<string, string>) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
  const openList = async (actor: number) =>
    openTaskListResponseSchema.parse(
      await (
        await fetch(`${origin}/api/v1/tasks/open`, { headers: headers(actor) })
      ).json(),
    ).items;

  it("creates a free draft, shows it to scope members only and lets exactly one take it", async () => {
    const created = await post("/api/v1/tasks", payload, headers(0));
    expect(created.status).toBe(201);
    const task = taskManagementResponseSchema.parse(await created.json()).task;
    expect(task).toMatchObject({ status: "draft", openForClaim: true });

    expect((await openList(1)).map((item) => item.id)).toContain(task.id);
    expect((await openList(2)).map((item) => item.id)).toContain(task.id);
    expect((await openList(3)).map((item) => item.id)).not.toContain(task.id);
    const noSession = await fetch(`${origin}/api/v1/tasks/open`);
    expect(noSession.status).toBe(401);

    const path = `/api/v1/tasks/${task.id}/claim`;
    const body = { action: "claim", expectedVersion: task.version };
    expect(
      (
        await post(path, body, {
          ...headers(1),
          Origin: "https://untrusted.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(path, body, { ...headers(1), "X-CSRF-Token": "wrong" }))
        .status,
    ).toBe(403);
    expect((await post(path, body, headers(3))).status).toBe(404);
    expect(
      (await post(path, { ...body, assigneeId: second }, headers(1))).status,
    ).toBe(400);

    const key = randomUUID();
    const won = await post(path, body, headers(1, key));
    expect(won.status).toBe(200);
    expect(won.headers.get("cache-control")).toBe("private, no-store");
    expect(taskClaimResponseSchema.parse(await won.json()).task).toMatchObject({
      id: task.id,
      status: "assigned",
      version: 2,
    });
    // A repeat with the same key is an idempotent replay; another member gets a conflict.
    expect((await post(path, body, headers(1, key))).status).toBe(200);
    expect((await post(path, body, headers(2))).status).toBe(409);
    expect((await openList(2)).map((item) => item.id)).not.toContain(task.id);
    const mine = await fetch(`${origin}/api/v1/tasks/${task.id}`, {
      headers: headers(1),
    });
    expect(mine.status).toBe(200);
    const others = await fetch(`${origin}/api/v1/tasks/${task.id}`, {
      headers: headers(2),
    });
    expect(others.status).toBe(404);
  });
});
