import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeAccess } from "../../packages/domain/src/admin/access";
import {
  accessChangeResponseSchema,
  accessListResponseSchema,
} from "../../packages/contracts/src/access-management";

type Input = Parameters<typeof changeAccess>[1];
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F02/F07 access management under runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        max: 6,
      });
    // 0 manager, 1 only admin.access, 2 member, 3 non-member, 4 second manager
    const users = Array.from({ length: 5 }, () => randomUUID()),
      scope = randomUUID(),
      foreign = randomUUID(),
      tokens = users.map(() => randomBytes(32).toString("base64url")),
      hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    beforeAll(async () => {
      for (const [i, u] of users.entries()) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic access user',true)",
          [u, randomInt(7e12, 8e12)],
        );
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [u, hashes[i]],
        );
      }
      for (const s of [scope, foreign])
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic access scope')",
          [s],
        );
      for (const [u, actions] of [
        [users[0], ["admin.access", "admin.access.manage"]],
        [users[1], ["admin.access"]],
        [users[4], ["admin.access", "admin.access.manage"]],
      ] as const)
        for (const action of actions)
          await admin.query(
            "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fixture')",
            [u, scope, action],
          );
      for (const u of [users[2], users[4]])
        await admin.query(
          "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
          [u, scope],
        );
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=ANY($1::uuid[])",
        [users],
      );
    });
    afterAll(async () => {
      await runtime.end();
      await admin.end();
    });
    const grant = (over: Record<string, unknown> = {}, actor = 0) =>
      ({
        kind: "grant",
        actorId: users[actor]!,
        sessionHash: hashes[actor]!,
        scope,
        subjectId: users[2]!,
        action: "task.review",
        validUntil: null,
        reason: "Synthetic delegation",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        allowAccessManagement: true,
        ...over,
      }) as Input;
    const bindings = async (user: string, action: string) =>
      (
        await admin.query(
          "SELECT id,version,revoked_at FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2 AND action=$3 ORDER BY created_at",
          [user, scope, action],
        )
      ).rows;
    const evidence = async () =>
      (
        await admin.query(
          "SELECT count(*)::int n FROM impuls.access_changes WHERE scope_id=$1",
          [scope],
        )
      ).rows[0].n as number;

    it("grants, replays, rejects a changed body and revokes the subject sessions", async () => {
      const g = grant({ action: "task.view" });
      const r = await changeAccess(runtime, g);
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      accessChangeResponseSchema.parse(r.response);
      expect(r.response.binding).toMatchObject({
        subjectId: users[2],
        action: "task.view",
      });
      expect(await bindings(users[2]!, "task.view")).toHaveLength(1);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.sessions WHERE user_id=$1 AND revoked_at IS NULL",
            [users[2]],
          )
        ).rows[0].n,
      ).toBe(0);
      const before = await evidence();
      expect(await changeAccess(runtime, g)).toEqual(r);
      expect(await evidence()).toBe(before);
      expect(
        await changeAccess(runtime, {
          ...g,
          reason: "Different body",
        } as Input),
      ).toEqual({ kind: "idempotency_conflict" });
    });

    it("hides the operation without both exact rights, flag, scope or live session", async () => {
      const before = await evidence();
      expect(
        await changeAccess(runtime, grant({ action: "task.edit" }, 1)),
      ).toEqual({ kind: "not_found" });
      expect(await changeAccess(runtime, grant({ scope: foreign }))).toEqual({
        kind: "not_found",
      });
      expect(
        await changeAccess(runtime, grant({ allowAccessManagement: false })),
      ).toEqual({ kind: "disabled" });
      expect(
        await changeAccess(runtime, grant({ sessionHash: hashes[3]! })),
      ).toEqual({ kind: "unauthorized" });
      expect(await evidence()).toBe(before);
    });

    it("refuses self-service, delegating the access rights, non-members and past terms", async () => {
      const before = await evidence();
      for (const over of [
        { subjectId: users[0] },
        { action: "admin.access" },
        { action: "admin.access.manage" },
      ])
        expect(await changeAccess(runtime, grant(over))).toEqual({
          kind: "forbidden_target",
        });
      expect(
        await changeAccess(runtime, grant({ subjectId: users[3] })),
      ).toEqual({ kind: "not_found" });
      expect(
        await changeAccess(
          runtime,
          grant({
            action: "task.cancel",
            validUntil: "2020-01-01T00:00:00.000Z",
          }),
        ),
      ).toEqual({ kind: "invalid_term" });
      expect(await evidence()).toBe(before);
    });

    it("lets only one of two concurrent equal grants win", async () => {
      const results = await Promise.all([
        changeAccess(runtime, grant({ action: "task.assign" })),
        changeAccess(runtime, grant({ action: "task.assign" }, 4)),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      expect(await bindings(users[2]!, "task.assign")).toHaveLength(1);
    });

    it("revokes once with a version check and refuses own and protected bindings", async () => {
      const [{ id, version }] = await bindings(users[2]!, "task.assign");
      const revoke = (over: Record<string, unknown> = {}) =>
        ({
          kind: "revoke",
          actorId: users[0]!,
          sessionHash: hashes[0]!,
          scope,
          bindingId: id,
          expectedVersion: version,
          reason: "Synthetic revocation",
          idempotencyKey: randomUUID(),
          requestId: randomUUID(),
          allowAccessManagement: true,
          ...over,
        }) as Input;
      expect(
        await changeAccess(runtime, revoke({ expectedVersion: version + 5 })),
      ).toEqual({ kind: "conflict" });
      const own = (await bindings(users[0]!, "admin.access"))[0];
      expect(
        await changeAccess(
          runtime,
          revoke({ bindingId: own.id, expectedVersion: own.version }),
        ),
      ).toEqual({ kind: "forbidden_target" });
      const other = (await bindings(users[4]!, "admin.access.manage"))[0];
      expect(
        await changeAccess(
          runtime,
          revoke({ bindingId: other.id, expectedVersion: other.version }),
        ),
      ).toEqual({ kind: "forbidden_target" });
      const ok = await changeAccess(runtime, revoke());
      expect(ok.kind).toBe("ok");
      expect(
        (await bindings(users[2]!, "task.assign"))[0].revoked_at,
      ).not.toBeNull();
      expect(await changeAccess(runtime, revoke())).toEqual({
        kind: "conflict",
      });
    });

    it("keeps change evidence immutable and rejects forged evidence at the database", async () => {
      const row = (
        await admin.query(
          "SELECT id FROM impuls.access_changes WHERE scope_id=$1 LIMIT 1",
          [scope],
        )
      ).rows[0];
      await expect(
        runtime.query(
          "UPDATE impuls.access_changes SET reason='x' WHERE id=$1",
          [row.id],
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query("DELETE FROM impuls.access_changes WHERE id=$1", [
          row.id,
        ]),
      ).rejects.toThrow();
      const b = (await bindings(users[2]!, "task.view"))[0];
      await expect(
        runtime.query(
          "INSERT INTO impuls.access_changes(kind,binding_id,actor_id,subject_id,scope_id,action,request_id,reason) VALUES('revoke',$1,$2,$3,$4,'task.view',$5,'forged')",
          [b.id, users[0], users[2], scope, randomUUID()],
        ),
      ).rejects.toThrow(/Invalid access change/);
    });

    it.skipIf(!origin)(
      "serves guarded no-store HTTP for grant and revocation",
      async () => {
        const csrf = (i: number) =>
          createCsrfToken(tokens[i]!, process.env.CSRF_SECRET!);
        const call = (
          kind: "grants" | "revocations",
          payload: unknown,
          over: Record<string, string | undefined> = {},
          actor = 0,
        ) => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Origin: origin!,
            Cookie: "impuls_session=" + tokens[actor],
            "X-CSRF-Token": csrf(actor),
            "Idempotency-Key": randomUUID(),
          };
          for (const [k, v] of Object.entries(over))
            if (v === undefined) delete headers[k];
            else headers[k] = v;
          return fetch(origin + "/api/v1/admin/access/" + kind, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });
        };
        const payload = {
          scope,
          subjectId: users[2],
          action: "task.cancel",
          validUntil: null,
          reason: "Synthetic HTTP delegation",
        };
        const before = await evidence();
        expect(
          (await call("grants", payload, { Origin: "https://foreign.invalid" }))
            .status,
        ).toBe(403);
        expect(
          (await call("grants", payload, { "X-CSRF-Token": "invalid" })).status,
        ).toBe(403);
        expect(
          (await call("grants", payload, { "Idempotency-Key": undefined }))
            .status,
        ).toBe(400);
        expect(
          (await call("grants", { ...payload, action: "admin.access" })).status,
        ).toBe(400);
        expect((await call("grants", { ...payload, extra: 1 })).status).toBe(
          400,
        );
        expect(
          (await call("grants", payload, { Cookie: undefined })).status,
        ).toBe(401);
        expect((await call("grants", payload, {}, 1)).status).toBe(404);
        expect(
          (await call("grants", { ...payload, subjectId: users[0] })).status,
        ).toBe(422);
        expect(await evidence()).toBe(before);
        const key = randomUUID();
        const ok = await call("grants", payload, { "Idempotency-Key": key });
        expect(ok.status).toBe(201);
        expect(ok.headers.get("cache-control")).toContain("no-store");
        const saved = accessChangeResponseSchema.parse(await ok.json());
        const replay = await call("grants", payload, {
          "Idempotency-Key": key,
        });
        expect(accessChangeResponseSchema.parse(await replay.json())).toEqual(
          saved,
        );
        expect((await call("grants", payload)).status).toBe(409);
        const revoked = await call("revocations", {
          scope,
          bindingId: saved.binding.id,
          expectedVersion: saved.binding.version,
          reason: "Synthetic HTTP revocation",
        });
        expect(revoked.status).toBe(201);
        expect(
          accessChangeResponseSchema.parse(await revoked.json()).kind,
        ).toBe("revoke");
      },
    );

    it.skipIf(!origin)("serves the guarded no-store member list", async () => {
      const get = (query: string, actor: number | null = 0) =>
        fetch(origin + "/api/v1/admin/access" + query, {
          headers:
            actor === null ? {} : { Cookie: "impuls_session=" + tokens[actor] },
        });
      const ok = await get("?scope=" + scope);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toContain("no-store");
      const list = accessListResponseSchema.parse(await ok.json());
      expect(list.canManage).toBe(true);
      expect(list.members.some((m) => m.userId === users[2])).toBe(true);
      expect(list.members.find((m) => m.userId === users[0])).toBeUndefined();
      const reader = accessListResponseSchema.parse(
        await (await get("?scope=" + scope, 1)).json(),
      );
      expect(reader.canManage).toBe(false);
      expect((await get("?scope=" + scope, null)).status).toBe(401);
      expect((await get("?scope=" + foreign)).status).toBe(404);
      expect((await get("?scope=" + scope, 3)).status).toBe(404);
      expect((await get("?scope=" + scope + "&x=1")).status).toBe(400);
      expect((await get("")).status).toBe(400);
    });
  },
);
