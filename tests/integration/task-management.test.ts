import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAssignedTask,
  listAssignedTasks,
} from "../../packages/domain/src/tasks/read";
import { mutateAssignedTask } from "../../packages/domain/src/tasks/write";
import {
  assignTask,
  createTask,
  listManagedTasks,
  readTaskManagementOptions,
  type AssignTaskInput,
  type CreateTaskInput,
} from "../../packages/domain/src/tasks/manage";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("F02/F03 scoped synthetic task management", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({
    connectionString: databaseUrl,
    options: "-c role=impuls_app",
    max: 8,
  });
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [manager, participant, otherParticipant, stranger] = users as [
    string,
    string,
    string,
    string,
  ];
  const tokens = users.map(() => randomBytes(32).toString("base64url"));
  const hashes = tokens.map((token) =>
    createHash("sha256").update(token).digest(),
  );
  const scopes = [randomUUID(), randomUUID()];
  const [scope, neighbour] = scopes as [string, string];
  const rules = [randomUUID(), randomUUID(), randomUUID()];
  const [syntheticRules, nonSyntheticRules, futureRules] = rules as [
    string,
    string,
    string,
  ];
  const taskIds: string[] = [];
  let versionNumber = randomInt(1_000_000, 1_500_000_000);

  async function registerUser(name: string, active = true) {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    users.push(id);
    tokens.push(token);
    hashes.push(createHash("sha256").update(token).digest());
    await admin.query(
      "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,$3,$4)",
      [id, randomInt(8_000_000_000_000, 9_000_000_000_000), name, active],
    );
    await admin.query(
      "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
      [id, hashes.at(-1)],
    );
    return id;
  }

  async function waitForLock(queryFragment: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await admin.query(
        `SELECT 1 FROM pg_stat_activity
         WHERE wait_event_type='Lock' AND query ILIKE $1 AND pid <> pg_backend_pid()`,
        [`%${queryFragment}%`],
      );
      if (waiting.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for PostgreSQL lock: ${queryFragment}`);
  }

  beforeAll(async () => {
    for (const [index, user] of users.entries())
      await admin.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,$3,true)",
        [
          user,
          randomInt(8_000_000_000_000, 9_000_000_000_000),
          `Synthetic manager fixture ${index}`,
        ],
      );
    for (const id of scopes)
      await admin.query(
        "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'group',$2)",
        [id, id === scope ? "Management scope" : "Neighbour scope"],
      );
    await admin.query(
      `INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by)
       VALUES ($1,$4,'{"mode":"synthetic"}'::jsonb,clock_timestamp()-interval '1 minute',$5),
              ($2,$6,'{"mode":"production"}'::jsonb,clock_timestamp()-interval '1 minute',$5),
              ($3,$7,'{"mode":"synthetic"}'::jsonb,clock_timestamp()+interval '1 day',$5)`,
      [
        syntheticRules,
        nonSyntheticRules,
        futureRules,
        versionNumber++,
        manager,
        versionNumber++,
        versionNumber++,
      ],
    );
    await admin.query(
      `INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason)
       VALUES ($1,'task.create',$2,$1,'Synthetic management test'),
              ($1,'task.assign',$2,$1,'Synthetic management test'),
              ($3,'task.create',$4,$3,'Neighbour-only synthetic test')`,
      [manager, scope, stranger, neighbour],
    );
    await addMember(scope, participant);
    await addMember(scope, otherParticipant);
    await renewSessions(users);
  });

  async function addMember(
    scopeId: string,
    userId: string,
    validity: "active" | "expired" | "revoked" = "active",
  ) {
    await admin.query(
      `INSERT INTO impuls.task_scope_members (scope_id,user_id,valid_from,valid_until,revoked_at)
       VALUES ($1,$2,clock_timestamp()-interval '2 days',
         CASE WHEN $3='expired' THEN clock_timestamp()-interval '1 day' END,
         CASE WHEN $3='revoked' THEN clock_timestamp() END)`,
      [scopeId, userId, validity],
    );
  }

  async function renewSessions(ids: string[] = users) {
    await admin.query(
      "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
      [ids],
    );
    for (const id of ids)
      await admin.query(
        "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [id, hashes[users.indexOf(id)]],
      );
  }

  function createInput(
    data: Partial<CreateTaskInput["data"]> = {},
    overrides: Partial<CreateTaskInput> = {},
  ): CreateTaskInput {
    return {
      actorId: manager,
      sessionHash: hashes[0]!,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      enabled: true,
      data: {
        scopeId: scope,
        ruleSetId: syntheticRules,
        title: `Synthetic task ${randomUUID()}`,
        criteria: "Complete the independently checked criteria.",
        categoryCode: "synthetic-test",
        priority: "normal",
        dueAt: "2035-01-01T12:00:00.000Z",
        fundXp: 17,
        fundPoints: 9,
        ...data,
      },
      ...overrides,
    };
  }

  function assignInput(
    taskId: string,
    assigneeId = participant,
    overrides: Partial<AssignTaskInput> = {},
  ): AssignTaskInput {
    return {
      actorId: manager,
      sessionHash: hashes[0]!,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      enabled: true,
      taskId,
      data: { assigneeId, expectedVersion: 1 },
      ...overrides,
    };
  }

  async function create(overrides: Parameters<typeof createInput>[1] = {}) {
    const input = createInput({}, overrides);
    const result = await createTask(runtime, input);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Synthetic task creation failed");
    taskIds.push(result.response.task.id);
    return { input, result };
  }

  async function taskState(id: string) {
    return (
      await admin.query(
        `SELECT t.status,t.version,t.fund_xp,t.fund_points,
          (SELECT count(*)::int FROM impuls.task_assignments a WHERE a.task_id=t.id) assignments,
          (SELECT count(*)::int FROM impuls.ledger_entries e WHERE e.task_id=t.id) ledger_entries
         FROM impuls.tasks t WHERE t.id=$1`,
        [id],
      )
    ).rows[0];
  }

  afterAll(async () => {
    try {
      if (taskIds.length) {
        await admin.query(
          "DELETE FROM impuls.notification_outbox WHERE task_id=ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.audit_events WHERE task_id=ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.ledger_entries WHERE task_id=ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.task_assignments WHERE task_id=ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
          taskIds,
        ]);
      }
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.task_scope_members WHERE scope_id=ANY($1::uuid[])",
        [scopes],
      );
      await admin.query(
        "DELETE FROM impuls.audit_events WHERE actor_id=ANY($1::uuid[])",
        [users],
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
        "DELETE FROM impuls.rule_sets WHERE id=ANY($1::uuid[])",
        [rules],
      );
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [scopes],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await Promise.all([runtime.end(), admin.end()]);
    }
  });

  it("creates a draft, assigns a member, then exposes and starts it for the participant without credit", async () => {
    const created = await create();
    const draft =
      created.result.kind === "ok" ? created.result.response.task : null;
    expect(draft).toMatchObject({
      status: "draft",
      version: 1,
      assignee: null,
      fundXp: 17,
      fundPoints: 9,
    });
    const assigned = await assignTask(runtime, assignInput(draft!.id));
    expect(assigned.kind).toBe("ok");
    if (assigned.kind !== "ok") throw new Error("Assignment failed");
    expect(assigned.response.task).toMatchObject({
      status: "assigned",
      version: 2,
      assignee: { id: participant },
    });
    expect(
      (await listAssignedTasks(runtime, participant)).items.map(
        (item) => item.id,
      ),
    ).toContain(draft!.id);
    expect(
      await getAssignedTask(runtime, participant, draft!.id),
    ).toMatchObject({ status: "assigned", fundXp: 17, fundPoints: 9 });
    const started = await mutateAssignedTask(runtime, {
      action: "start",
      taskId: draft!.id,
      actorId: participant,
      sessionHash: hashes[1]!,
      expectedVersion: 2,
      idempotencyKey: randomUUID(),
    });
    expect(started.kind).toBe("ok");
    expect(await taskState(draft!.id)).toMatchObject({
      status: "in_progress",
      version: 3,
      fund_xp: 17,
      fund_points: 9,
      assignments: 1,
      ledger_entries: 0,
    });
    const audit = await admin.query<{ action: string }>(
      "SELECT action FROM impuls.audit_events WHERE task_id=$1 ORDER BY created_at",
      [draft!.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "task.create",
      "task.assign",
    ]);
    const outbox = await admin.query(
      "SELECT kind,recipient_id FROM impuls.notification_outbox WHERE task_id=$1",
      [draft!.id],
    );
    expect(outbox.rows).toEqual([
      { kind: "task.assigned", recipient_id: participant },
    ]);
  });

  it("replays identical create and assignment requests exactly once and rejects changed bodies", async () => {
    const input = createInput();
    const first = await createTask(runtime, input);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("Creation failed");
    const id = first.response.task.id;
    taskIds.push(id);
    expect(await createTask(runtime, input)).toEqual(first);
    expect(
      await createTask(runtime, {
        ...input,
        data: { ...input.data, title: "Changed body" },
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    const assign = assignInput(id);
    const assigned = await assignTask(runtime, assign);
    expect(assigned.kind).toBe("ok");
    expect(await assignTask(runtime, assign)).toEqual(assigned);
    expect(
      await assignTask(runtime, {
        ...assign,
        data: { ...assign.data, assigneeId: otherParticipant },
      }),
    ).toEqual({ kind: "idempotency_conflict" });
    expect(await taskState(id)).toMatchObject({
      status: "assigned",
      version: 2,
      assignments: 1,
      ledger_entries: 0,
    });
    const counts = await admin.query<{
      creates: number;
      assignments: number;
      outbox: number;
    }>(
      `SELECT (SELECT count(*)::int FROM impuls.audit_events WHERE task_id=$1 AND action='task.create') creates,
       (SELECT count(*)::int FROM impuls.audit_events WHERE task_id=$1 AND action='task.assign') assignments,
       (SELECT count(*)::int FROM impuls.notification_outbox WHERE task_id=$1 AND kind='task.assigned') outbox`,
      [id],
    );
    expect(counts.rows[0]).toEqual({ creates: 1, assignments: 1, outbox: 1 });
  });

  it("serializes concurrent create requests with one idempotency key", async () => {
    const input = createInput();
    const [first, second] = await Promise.all([
      createTask(runtime, input),
      createTask(runtime, input),
    ]);
    expect(first).toEqual(second);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("Concurrent creation failed");
    const id = first.response.task.id;
    taskIds.push(id);
    const counts = await admin.query<{ tasks: number; audits: number }>(
      `SELECT (SELECT count(*)::int FROM impuls.tasks WHERE id=$1) tasks,
       (SELECT count(*)::int FROM impuls.audit_events WHERE task_id=$1 AND action='task.create') audits`,
      [id],
    );
    expect(counts.rows[0]).toEqual({ tasks: 1, audits: 1 });
  });

  it("hides missing and neighbour-scope permissions and enforces the feature flag", async () => {
    const absent = await createTask(
      runtime,
      createInput({}, { actorId: stranger, sessionHash: hashes[3]! }),
    );
    expect(absent).toEqual({ kind: "not_found" });
    const neighbourOnly = await createTask(
      runtime,
      createInput(
        { scopeId: neighbour },
        { actorId: manager, sessionHash: hashes[0]! },
      ),
    );
    expect(neighbourOnly).toEqual({ kind: "not_found" });
    const disabled = await createTask(
      runtime,
      createInput({}, { enabled: false }),
    );
    expect(disabled).toEqual({ kind: "disabled" });
    expect(await listManagedTasks(runtime, stranger)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("keeps create and assign rights independent and does not leak a neighbour task version", async () => {
    const createOnly = await registerUser("Create only manager");
    const assignOnly = await registerUser("Assign only manager");
    await admin.query(
      `INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason)
       VALUES ($1,'task.create',$3,$4,'Independent create right'),
              ($2,'task.assign',$3,$4,'Independent assign right')`,
      [createOnly, assignOnly, scope, manager],
    );
    await renewSessions([createOnly, assignOnly]);
    const created = await createTask(
      runtime,
      createInput(
        {},
        {
          actorId: createOnly,
          sessionHash: hashes[users.indexOf(createOnly)]!,
        },
      ),
    );
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok")
      throw new Error("Create-only right was rejected");
    const id = created.response.task.id;
    taskIds.push(id);
    const createOnlyAssign = await assignTask(
      runtime,
      assignInput(id, participant, {
        actorId: createOnly,
        sessionHash: hashes[users.indexOf(createOnly)]!,
      }),
    );
    expect(createOnlyAssign).toEqual({ kind: "not_found" });
    const noCreate = await createTask(
      runtime,
      createInput(
        {},
        {
          actorId: assignOnly,
          sessionHash: hashes[users.indexOf(assignOnly)]!,
        },
      ),
    );
    expect(noCreate).toEqual({ kind: "not_found" });
    const assignOnlyNeighbour = await assignTask(
      runtime,
      assignInput(id, participant, {
        actorId: stranger,
        sessionHash: hashes[users.indexOf(stranger)]!,
      }),
    );
    expect(assignOnlyNeighbour).toEqual({ kind: "not_found" });
    expect(await taskState(id)).toMatchObject({
      status: "draft",
      version: 1,
      assignments: 0,
    });
  });

  it("rejects non-synthetic and not-yet-effective rules without saving task state", async () => {
    for (const ruleSetId of [nonSyntheticRules, futureRules]) {
      const input = createInput({ ruleSetId });
      expect(await createTask(runtime, input)).toEqual({
        kind: "rules_invalid",
      });
      const persisted = await admin.query(
        "SELECT id FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='task.create' AND key=$2",
        [manager, input.idempotencyKey],
      );
      expect(persisted.rowCount).toBe(0);
    }
    const task = await create();
    expect(task.result.kind).toBe("ok");
  });

  it("requires an active in-scope member and rejects inactive, expired, or revoked membership", async () => {
    const inactive = await registerUser("Inactive member", false);
    const expiredMember = await registerUser("Expired member");
    const revokedMember = await registerUser("Revoked member");
    await addMember(scope, expiredMember, "expired");
    await addMember(scope, revokedMember, "revoked");
    const task = await create();
    const id = task.result.kind === "ok" ? task.result.response.task.id : "";
    for (const member of [inactive, expiredMember, revokedMember, stranger])
      expect(await assignTask(runtime, assignInput(id, member))).toEqual({
        kind: "assignee_invalid",
      });
    expect(await taskState(id)).toMatchObject({
      status: "draft",
      version: 1,
      assignments: 0,
      ledger_entries: 0,
    });
  });

  it("rejects stale versions and serializes competing assignments to one winner", async () => {
    const staleTask = await create();
    const staleId =
      staleTask.result.kind === "ok" ? staleTask.result.response.task.id : "";
    expect(
      await assignTask(
        runtime,
        assignInput(staleId, participant, {
          data: { assigneeId: participant, expectedVersion: 2 },
        }),
      ),
    ).toEqual({ kind: "conflict", currentVersion: 1 });
    expect(await taskState(staleId)).toMatchObject({
      status: "draft",
      version: 1,
      assignments: 0,
    });

    const concurrentTask = await create();
    const concurrentId =
      concurrentTask.result.kind === "ok"
        ? concurrentTask.result.response.task.id
        : "";
    const [first, second] = await Promise.all([
      assignTask(runtime, assignInput(concurrentId, participant)),
      assignTask(runtime, assignInput(concurrentId, otherParticipant)),
    ]);
    expect(
      [first.kind, second.kind].filter((kind) => kind === "ok"),
    ).toHaveLength(1);
    expect(
      [first.kind, second.kind].filter((kind) => kind === "conflict"),
    ).toHaveLength(1);
    expect(await taskState(concurrentId)).toMatchObject({
      status: "assigned",
      version: 2,
      assignments: 1,
      ledger_entries: 0,
    });
    const rows = await admin.query<{ action: string }>(
      "SELECT action FROM impuls.audit_events WHERE task_id=$1 ORDER BY action",
      [concurrentId],
    );
    expect(rows.rows.map((row) => row.action)).toEqual([
      "task.assign",
      "task.create",
    ]);
  });

  it("rechecks membership and session validity after PostgreSQL lock waits", async () => {
    const memberWaitTask = await create();
    const memberTaskId =
      memberWaitTask.result.kind === "ok"
        ? memberWaitTask.result.response.task.id
        : "";
    const memberLock = await admin.connect();
    await memberLock.query("BEGIN");
    await memberLock.query(
      "SELECT id FROM impuls.task_scope_members WHERE scope_id=$1 AND user_id=$2 FOR UPDATE",
      [scope, participant],
    );
    const memberAssignment = assignTask(runtime, assignInput(memberTaskId));
    try {
      await waitForLock("FROM impuls.task_scope_members");
      await memberLock.query(
        "UPDATE impuls.task_scope_members SET valid_until=clock_timestamp()-interval '1 second',version=version+1 WHERE scope_id=$1 AND user_id=$2",
        [scope, participant],
      );
      await memberLock.query("COMMIT");
    } catch (error) {
      await memberLock.query("ROLLBACK");
      throw error;
    } finally {
      memberLock.release();
    }
    expect(await memberAssignment).toEqual({ kind: "assignee_invalid" });
    expect(await taskState(memberTaskId)).toMatchObject({
      status: "draft",
      version: 1,
      assignments: 0,
    });
    await admin.query(
      "UPDATE impuls.task_scope_members SET valid_until=NULL,version=version+1 WHERE scope_id=$1 AND user_id=$2",
      [scope, participant],
    );

    const sessionWaitTask = await create();
    const sessionTaskId =
      sessionWaitTask.result.kind === "ok"
        ? sessionWaitTask.result.response.task.id
        : "";
    const taskLock = await admin.connect();
    await taskLock.query("BEGIN");
    await taskLock.query("SELECT id FROM impuls.tasks WHERE id=$1 FOR UPDATE", [
      sessionTaskId,
    ]);
    const sessionAssignment = assignTask(runtime, assignInput(sessionTaskId));
    try {
      await waitForLock("SELECT t.scope_id");
      await admin.query(
        "UPDATE impuls.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
        [manager],
      );
      await taskLock.query("COMMIT");
    } catch (error) {
      await taskLock.query("ROLLBACK");
      throw error;
    } finally {
      taskLock.release();
    }
    expect(await sessionAssignment).toEqual({ kind: "unauthorized" });
    expect(await taskState(sessionTaskId)).toMatchObject({
      status: "draft",
      version: 1,
      assignments: 0,
    });
    await renewSessions([manager]);
  });

  it("rechecks exact assignment permission after waiting for the task row", async () => {
    const created = await create();
    const id =
      created.result.kind === "ok" ? created.result.response.task.id : "";
    const taskLock = await admin.connect();
    await taskLock.query("BEGIN");
    await taskLock.query("SELECT id FROM impuls.tasks WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    const assignment = assignTask(runtime, assignInput(id));
    try {
      await waitForLock("SELECT t.scope_id");
      await admin.query(
        "UPDATE impuls.role_bindings SET valid_from=clock_timestamp()+interval '1 hour',updated_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND scope_id=$2 AND action='task.assign'",
        [manager, scope],
      );
      await renewSessions([manager]);
      await taskLock.query("COMMIT");
    } catch (error) {
      await taskLock.query("ROLLBACK");
      throw error;
    } finally {
      taskLock.release();
    }
    expect(await assignment).toEqual({ kind: "not_found" });
    expect(await taskState(id)).toMatchObject({
      status: "draft",
      version: 1,
      assignments: 0,
    });
    await admin.query(
      "UPDATE impuls.role_bindings SET valid_from=clock_timestamp()-interval '1 minute',updated_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND scope_id=$2 AND action='task.assign'",
      [manager, scope],
    );
    await renewSessions([manager]);
  });

  it("rolls back a creation whose audit request id is invalid", async () => {
    const input = createInput({}, { requestId: "invalid-request-id" });
    await expect(createTask(runtime, input)).rejects.toThrow();
    expect(
      await admin.query(
        "SELECT id FROM impuls.tasks WHERE created_by=$1 AND title=$2",
        [manager, input.data.title],
      ),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await admin.query(
        "SELECT id FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='task.create' AND key=$2",
        [manager, input.idempotencyKey],
      ),
    ).toMatchObject({ rowCount: 0 });
  });

  it("rolls back assignment, audit, outbox, and idempotency when its audit insert fails", async () => {
    const created = await create();
    const id =
      created.result.kind === "ok" ? created.result.response.task.id : "";
    const input = assignInput(id, participant, {
      requestId: "invalid-request-id",
    });
    await expect(assignTask(runtime, input)).rejects.toMatchObject({
      code: "22P02",
    });
    expect(await taskState(id)).toMatchObject({
      status: "draft",
      version: 1,
      assignments: 0,
      ledger_entries: 0,
    });
    expect(
      (
        await admin.query(
          "SELECT id FROM impuls.audit_events WHERE task_id=$1 AND action='task.assign'",
          [id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await admin.query(
          "SELECT id FROM impuls.notification_outbox WHERE task_id=$1",
          [id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await admin.query(
          "SELECT id FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='task.assign' AND key=$2",
          [manager, input.idempotencyKey],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("checks current permission and session before replay, and keeps membership immutable to runtime", async () => {
    const input = createInput();
    const first = await createTask(runtime, input);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("Creation failed");
    taskIds.push(first.response.task.id);
    await admin.query(
      "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND scope_id=$2 AND action='task.create'",
      [manager, scope],
    );
    expect(await createTask(runtime, input)).toEqual({ kind: "not_found" });
    await admin.query(
      "UPDATE impuls.role_bindings SET revoked_at=NULL,updated_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND scope_id=$2 AND action='task.create'",
      [manager, scope],
    );
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
      [manager],
    );
    expect(await createTask(runtime, input)).toEqual({ kind: "unauthorized" });
    await expect(
      runtime.query(
        "UPDATE impuls.task_scope_members SET revoked_at=clock_timestamp() WHERE scope_id=$1 AND user_id=$2",
        [scope, participant],
      ),
    ).rejects.toThrow();
    await expect(
      runtime.query(
        "UPDATE impuls.task_assignments SET user_id=$2 WHERE task_id=$1",
        [first.response.task.id, otherParticipant],
      ),
    ).rejects.toThrow();
  });

  it("returns only exact-scope options and permitted synthetic rules", async () => {
    const options = await readTaskManagementOptions(runtime, manager, {
      enabled: true,
    });
    expect(options.scopes).toContainEqual(
      expect.objectContaining({
        id: scope,
        canCreate: true,
        canAssign: true,
        assignees: expect.arrayContaining([
          { id: participant, displayName: "Synthetic manager fixture 1" },
          { id: otherParticipant, displayName: "Synthetic manager fixture 2" },
        ]),
      }),
    );
    expect(options.scopes.map((item) => item.id)).not.toContain(neighbour);
    expect(options.ruleSets).toEqual(
      expect.arrayContaining([
        { id: syntheticRules, version: versionNumber - 3 },
      ]),
    );
    expect(options.ruleSets.map((item) => item.id)).not.toContain(
      nonSyntheticRules,
    );
    expect(options.ruleSets.map((item) => item.id)).not.toContain(futureRules);
    expect(
      await readTaskManagementOptions(runtime, manager, { enabled: false }),
    ).toMatchObject({
      scopes: [{ canCreate: false, canAssign: false, assignees: [] }],
      ruleSets: [],
    });
  });

  it("paginates the scoped task list without duplicates and hides it after actor revocation", async () => {
    const expected = (
      await admin.query<{ id: string }>(
        "SELECT id FROM impuls.tasks WHERE scope_id=$1 ORDER BY id",
        [scope],
      )
    ).rows.map((row) => row.id);
    expect(expected.length).toBeGreaterThan(2);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listManagedTasks(runtime, manager, {
        limit: 2,
        cursor,
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.items.every((item) => item.scope.id === scope)).toBe(true);
      if (page.nextCursor !== null) {
        expect(page.nextCursor).toBe(page.items.at(-1)?.id);
      }
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(expected);
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      manager,
    ]);
    try {
      expect(await listManagedTasks(runtime, manager)).toEqual({
        items: [],
        nextCursor: null,
      });
      expect(
        await readTaskManagementOptions(runtime, manager, { enabled: true }),
      ).toEqual({ scopes: [], ruleSets: [] });
    } finally {
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        manager,
      ]);
    }
  });
});
