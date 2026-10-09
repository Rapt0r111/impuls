import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  listActivePermissions,
  permissionActions,
} from "../../packages/domain/src/permissions/service";
import { bootstrapOwner } from "../../scripts/bootstrap-owner.mjs";

const url = process.env.TEST_DATABASE_URL;

(url ? describe : describe.skip)("P-01 initial owner grant", () => {
  const admin = new Pool({ connectionString: url });
  afterAll(() => admin.end());

  const run = async (
    options: Parameters<typeof bootstrapOwner>[1],
  ): Promise<Awaited<ReturnType<typeof bootstrapOwner>>> => {
    const client = await admin.connect();
    try {
      return await bootstrapOwner(client, options);
    } finally {
      client.release();
    }
  };
  const fresh = () => ({
    telegramId: randomInt(8e12, 9e12),
    displayName: "Synthetic owner",
    scopeName: `Synthetic owner scope ${randomUUID()}`,
    scopeKind: "project" as const,
  });
  const count = async (sql: string, params: unknown[]) =>
    Number((await admin.query(sql, params)).rows[0].n);

  it("creates user, scope and every right, self-granted and active", async () => {
    const input = fresh();
    const result = await run({ ...input, apply: true });
    expect(result.applied).toBe(true);
    expect(result.userCreated).toBe(true);
    expect(result.scopeCreated).toBe(true);
    expect(result.granted).toEqual([...permissionActions]);

    const held = await listActivePermissions(admin, result.userId);
    expect(held.map((p) => p.action).sort()).toEqual(
      [...permissionActions].sort(),
    );
    expect(new Set(held.map((p) => p.scope.id))).toEqual(
      new Set([result.scopeId]),
    );
    expect(
      await count(
        `SELECT count(*) n FROM impuls.role_bindings
          WHERE user_id=$1 AND granted_by=$1 AND valid_until IS NULL`,
        [result.userId],
      ),
    ).toBe(permissionActions.length);
  });

  it("is idempotent: a second apply grants nothing and creates nothing", async () => {
    const input = fresh();
    const first = await run({ ...input, apply: true });
    const second = await run({ ...input, apply: true });
    expect(second.userCreated).toBe(false);
    expect(second.scopeCreated).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(second.scopeId).toBe(first.scopeId);
    expect(second.granted).toEqual([]);
    expect(
      await count(
        "SELECT count(*) n FROM impuls.role_bindings WHERE user_id=$1",
        [first.userId],
      ),
    ).toBe(permissionActions.length);
  });

  it("dry run reports the plan and writes nothing", async () => {
    const input = fresh();
    const result = await run({ ...input, apply: false });
    expect(result.applied).toBe(false);
    expect(result.userCreated).toBe(true);
    expect(result.granted).toEqual([...permissionActions]);
    expect(
      await count("SELECT count(*) n FROM impuls.users WHERE telegram_id=$1", [
        input.telegramId,
      ]),
    ).toBe(0);
    expect(
      await count("SELECT count(*) n FROM impuls.access_scopes WHERE name=$1", [
        input.scopeName,
      ]),
    ).toBe(0);
  });

  it("keeps an existing user and replaces only revoked or expired rights", async () => {
    const input = fresh();
    const first = await run({ ...input, apply: true });
    await admin.query(
      `UPDATE impuls.role_bindings SET revoked_at=clock_timestamp()
        WHERE user_id=$1 AND action='task.review'`,
      [first.userId],
    );
    const again = await run({
      ...input,
      displayName: "A different name is ignored",
      apply: true,
    });
    expect(again.userCreated).toBe(false);
    expect(again.granted).toEqual(["task.review"]);
    expect(
      (
        await admin.query("SELECT display_name FROM impuls.users WHERE id=$1", [
          first.userId,
        ])
      ).rows[0].display_name,
    ).toBe("Synthetic owner");
  });

  it("reuses an existing scope by id and refuses an unknown one", async () => {
    const scopeId = randomUUID();
    await admin.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'group','Synthetic existing scope')",
      [scopeId],
    );
    const result = await run({
      telegramId: randomInt(8e12, 9e12),
      displayName: "Synthetic owner",
      scopeId,
      apply: true,
    });
    expect(result.scopeId).toBe(scopeId);
    expect(result.scopeCreated).toBe(false);
    await expect(
      run({
        telegramId: randomInt(8e12, 9e12),
        displayName: "Synthetic owner",
        scopeId: randomUUID(),
        apply: true,
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("refuses an inactive existing user", async () => {
    const input = fresh();
    await admin.query(
      "INSERT INTO impuls.users(telegram_id,display_name,active) VALUES($1,'Synthetic off',false)",
      [input.telegramId],
    );
    await expect(run({ ...input, apply: true })).rejects.toThrow(/inactive/i);
  });

  it("rejects malformed input before touching the database", async () => {
    const input = fresh();
    for (const bad of [
      { ...input, telegramId: 0 },
      { ...input, telegramId: 1.5 },
      { ...input, displayName: "  " },
      { ...input, displayName: "x".repeat(81) },
      { ...input, scopeName: undefined },
      { ...input, scopeId: "not-a-uuid" },
    ])
      await expect(run({ ...bad, apply: true })).rejects.toThrow();
  });
});
