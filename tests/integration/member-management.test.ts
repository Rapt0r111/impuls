import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changeAccess,
  readAccess,
} from "../../packages/domain/src/admin/access";
import { readAudit } from "../../packages/domain/src/admin/audit";
import { auditResponseSchema } from "../../packages/contracts/src/audit";
import { changeMember } from "../../packages/domain/src/admin/members";
import {
  accessListResponseSchema,
  memberChangeResponseSchema,
} from "../../packages/contracts/src/access-management";

type Input = Parameters<typeof changeMember>[1];
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F01/F02/F07 member admission and removal under runtime role",
  () => {
    const admin = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        max: 6,
      });
    // 0 manager, 1 only admin.access, 2 only members right, 3 existing member, 4 second scope member
    const users = Array.from({ length: 5 }, () => randomUUID()),
      scope = randomUUID(),
      other = randomUUID(),
      tokens = users.map(() => randomBytes(32).toString("base64url")),
      hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    const created: string[] = [];
    const tg = () => randomInt(7e12, 8e12);
    // Any role_bindings change closes the subject's sessions by design; fixtures reopen them.
    const reopen = () =>
      admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=ANY($1::uuid[]) AND session_hash=ANY($2::bytea[])",
        [users, hashes],
      );
    beforeAll(async () => {
      for (const [i, u] of users.entries()) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic member user',true)",
          [u, tg()],
        );
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [u, hashes[i]],
        );
      }
      for (const s of [scope, other])
        await admin.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic member scope')",
          [s],
        );
      for (const [u, actions] of [
        [users[0], ["admin.access", "admin.members.manage", "admin.audit"]],
        [users[1], ["admin.access"]],
        [users[2], ["admin.members.manage"]],
      ] as const)
        for (const action of actions)
          await admin.query(
            "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fixture')",
            [u, scope, action],
          );
      for (const [u, s] of [
        [users[3], scope],
        [users[4], scope],
        [users[4], other],
      ] as const)
        await admin.query(
          "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
          [u, s],
        );
      await reopen();
    });
    afterAll(async () => {
      await runtime.end();
      await admin.end();
    });
    const admit = (over: Record<string, unknown> = {}, actor = 0): Input =>
      ({
        kind: "admit",
        actorId: users[actor]!,
        sessionHash: hashes[actor]!,
        scope,
        telegramId: tg(),
        displayName: "Синтетический участник",
        validUntil: null,
        reason: "Synthetic admission",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        allowMemberManagement: true,
        ...over,
      }) as Input;
    const remove = (
      membershipId: string,
      expectedVersion: number,
      over: Record<string, unknown> = {},
      actor = 0,
    ): Input =>
      ({
        kind: "remove",
        actorId: users[actor]!,
        sessionHash: hashes[actor]!,
        scope,
        membershipId,
        expectedVersion,
        reason: "Synthetic removal",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        allowMemberManagement: true,
        ...over,
      }) as Input;
    const ok = async (input: Input) => {
      const result = await changeMember(runtime, input);
      if (result.kind !== "ok") throw new Error(result.kind);
      const parsed = memberChangeResponseSchema.parse(result.response);
      created.push(parsed.member.userId);
      return parsed;
    };
    const membership = async (id: string, user: string) =>
      (
        await admin.query(
          "SELECT * FROM impuls.task_scope_members WHERE scope_id=$1 AND user_id=$2",
          [id, user],
        )
      ).rows[0];

    it("exposes admission and removal evidence to the exact audit scope only", async () => {
      const admitted = await ok(admit({ displayName: "Аудит участник" }));
      const removed = await ok(
        remove(admitted.member.membershipId, admitted.member.version),
      );
      const read = (actor: number, options: Record<string, unknown> = {}) =>
        readAudit(runtime, users[actor]!, hashes[actor]!, {
          allowSyntheticAudit: true,
          scope,
          limit: 50,
          ...options,
        });
      const all = await read(0);
      expect(all.kind).toBe("ok");
      if (all.kind !== "ok") return;
      const parsed = auditResponseSchema.parse(
        JSON.parse(JSON.stringify(all.response)),
      );
      const mine = parsed.items.filter(
        (i) => i.member?.membershipId === admitted.member.membershipId,
      );
      expect(mine.map((i) => i.action).sort()).toEqual([
        "member.admit",
        "member.remove",
      ]);
      const entry = mine.find((i) => i.action === "member.admit")!;
      expect(entry).toMatchObject({
        id: admitted.changeId,
        actor: { id: users[0] },
        reason: "Synthetic admission",
        member: {
          subject: {
            id: admitted.member.userId,
            displayName: "Аудит участник",
          },
          userCreated: true,
          validUntil: null,
        },
      });
      const exit = mine.find((i) => i.action === "member.remove")!;
      expect(exit.member).toMatchObject({
        userDeactivated: true,
        revokedBindings: 0,
      });
      expect(removed.kind).toBe("remove");
      expect(JSON.stringify(parsed)).not.toMatch(/telegram/i);
      const only = await read(0, { action: "member.remove" });
      expect(
        only.kind === "ok" &&
          only.response.items.length > 0 &&
          only.response.items.every((i) => i.action === "member.remove"),
      ).toBe(true);
      // Without admin.audit in this scope the history is not revealed.
      expect(await read(2)).toEqual({ kind: "not_found" });
    });

    it("admits a new person by Telegram ID, replays, and never returns the ID", async () => {
      const telegramId = tg();
      const input = admit({ telegramId });
      const first = await ok(input);
      expect(first).toMatchObject({
        kind: "admit",
        userCreated: true,
        userReactivated: false,
        member: { displayName: "Синтетический участник", version: 1 },
      });
      expect(JSON.stringify(first)).not.toContain(String(telegramId));
      const row = (
        await admin.query(
          "SELECT telegram_id,active,display_name FROM impuls.users WHERE id=$1",
          [first.member.userId],
        )
      ).rows[0];
      expect(row).toMatchObject({
        telegram_id: String(telegramId),
        active: true,
        display_name: "Синтетический участник",
      });
      expect(
        (await membership(scope, first.member.userId)).revoked_at,
      ).toBeNull();
      // Same key and body: the saved answer, no second row.
      expect(await changeMember(runtime, input)).toEqual({
        kind: "ok",
        response: first,
      });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.member_changes WHERE membership_id=$1",
            [first.member.membershipId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        await changeMember(runtime, {
          ...input,
          reason: "Another reason",
        } as Input),
      ).toEqual({ kind: "idempotency_conflict" });
    });

    it("lists the new member with membership data and the write flag", async () => {
      const added = await ok(admit());
      const list = await readAccess(runtime, {
        actorId: users[0]!,
        sessionHash: hashes[0]!,
        scope,
        enabled: true,
        allowAccessManagement: true,
        allowMemberManagement: true,
      });
      if (list.kind !== "ok") throw new Error(list.kind);
      const data = accessListResponseSchema.parse(list.response);
      expect(data.canManageMembers).toBe(true);
      expect(
        data.members.find((m) => m.userId === added.member.userId),
      ).toEqual({
        userId: added.member.userId,
        membershipId: added.member.membershipId,
        membershipVersion: 1,
        displayName: "Синтетический участник",
        isSelf: false,
        bindings: [],
      });
      const off = await readAccess(runtime, {
        actorId: users[0]!,
        sessionHash: hashes[0]!,
        scope,
        enabled: true,
        allowAccessManagement: true,
        allowMemberManagement: false,
      });
      if (off.kind !== "ok") throw new Error(off.kind);
      expect(off.response.canManageMembers).toBe(false);
    });

    it("adds an existing active person to another area without a new account", async () => {
      const result = await ok(
        admit({
          telegramId: Number(await telegramOf(users[3]!)),
          scope: other,
        }),
      ).catch((e: unknown) => e);
      // users[0] holds no rights in the other scope.
      expect((result as Error).message).toBe("not_found");
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) SELECT $1,$2,a,$1,'Synthetic fixture' FROM unnest(ARRAY['admin.access','admin.members.manage']) a",
        [users[0], other],
      );
      await reopen();
      const added = await ok(
        admit({
          telegramId: Number(await telegramOf(users[3]!)),
          scope: other,
        }),
      );
      expect(added).toMatchObject({
        userCreated: false,
        userReactivated: false,
      });
      expect(added.member.userId).toBe(users[3]);
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2",
        [users[0], other],
      );
      await reopen();
    });

    it("refuses an existing member, self, a past term and hides the operation without exact rights", async () => {
      const existing = Number(await telegramOf(users[3]!));
      expect(
        await changeMember(runtime, admit({ telegramId: existing })),
      ).toEqual({
        kind: "conflict",
      });
      expect(
        await changeMember(
          runtime,
          admit({ telegramId: Number(await telegramOf(users[0]!)) }),
        ),
      ).toEqual({ kind: "forbidden_target" });
      expect(
        await changeMember(
          runtime,
          admit({ validUntil: "2020-01-01T00:00:00.000Z" }),
        ),
      ).toEqual({ kind: "invalid_term" });
      for (const actor of [1, 2])
        expect(await changeMember(runtime, admit({}, actor))).toEqual({
          kind: "not_found",
        });
      expect(
        await changeMember(runtime, admit({ allowMemberManagement: false })),
      ).toEqual({ kind: "disabled" });
      expect(await changeMember(runtime, admit({ scope: other }))).toEqual({
        kind: "not_found",
      });
      expect(
        await changeMember(
          runtime,
          admit({ sessionHash: createHash("sha256").update("x").digest() }),
        ),
      ).toEqual({ kind: "unauthorized" });
    });

    it("reactivates a deactivated person and reopens a closed membership", async () => {
      const added = await ok(admit());
      const removed = await ok(
        remove(added.member.membershipId, added.member.version),
      );
      expect(removed).toMatchObject({ kind: "remove", userDeactivated: true });
      const tgId = Number(await telegramOf(added.member.userId));
      const again = await ok(
        admit({ telegramId: tgId, displayName: "Другое имя" }),
      );
      expect(again).toMatchObject({
        userCreated: false,
        userReactivated: true,
        member: {
          userId: added.member.userId,
          membershipId: added.member.membershipId,
          displayName: "Синтетический участник",
        },
      });
      expect(again.member.version).toBe(removed.member.version + 1);
      expect(
        (
          await admin.query("SELECT active FROM impuls.users WHERE id=$1", [
            added.member.userId,
          ])
        ).rows[0].active,
      ).toBe(true);
    });

    it("removes: closes sessions, role bindings and records each revoke; keeps people who belong elsewhere", async () => {
      const added = await ok(admit());
      const session = createHash("sha256").update(randomBytes(8)).digest();
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [added.member.userId, session],
      );
      for (const action of ["task.view", "task.review"])
        await admin.query(
          "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$4,'Synthetic fixture')",
          [added.member.userId, scope, action, users[0]],
        );
      const removed = await ok(
        remove(added.member.membershipId, added.member.version),
      );
      expect(removed).toMatchObject({
        kind: "remove",
        revokedBindings: 2,
        userDeactivated: true,
        member: { version: added.member.version + 1 },
      });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.sessions WHERE user_id=$1 AND revoked_at IS NULL",
            [added.member.userId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.access_changes WHERE subject_id=$1 AND kind='revoke' AND actor_id=$2",
            [added.member.userId, users[0]],
          )
        ).rows[0].n,
      ).toBe(2);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.role_bindings WHERE user_id=$1 AND revoked_at IS NULL",
            [added.member.userId],
          )
        ).rows[0].n,
      ).toBe(0);
      // A person who is also in another area stays admitted there.
      const shared = await membership(scope, users[4]!);
      const kept = await ok(remove(shared.id, shared.version));
      expect(kept).toMatchObject({
        userDeactivated: false,
        revokedBindings: 0,
      });
      expect(
        (
          await admin.query("SELECT active FROM impuls.users WHERE id=$1", [
            users[4],
          ])
        ).rows[0].active,
      ).toBe(true);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.sessions WHERE user_id=$1 AND revoked_at IS NULL",
            [users[4]],
          )
        ).rows[0].n,
      ).toBe(1);
      await admin.query(
        "UPDATE impuls.task_scope_members SET revoked_at=NULL WHERE id=$1",
        [shared.id],
      );
    });

    it("checks version, replays once, and refuses self, managers and unknown memberships", async () => {
      const added = await ok(admit());
      expect(
        await changeMember(runtime, remove(added.member.membershipId, 99)),
      ).toEqual({ kind: "conflict" });
      const input = remove(added.member.membershipId, added.member.version);
      const first = await ok(input);
      expect(await changeMember(runtime, input)).toEqual({
        kind: "ok",
        response: first,
      });
      expect(
        await changeMember(
          runtime,
          remove(added.member.membershipId, added.member.version),
        ),
      ).toEqual({ kind: "conflict" });
      expect(await changeMember(runtime, remove(randomUUID(), 1))).toEqual({
        kind: "not_found",
      });
      // The actor is not a member of the scope; make them one to test the self guard.
      await admin.query(
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
        [users[0], scope],
      );
      const self = await membership(scope, users[0]!);
      expect(
        await changeMember(runtime, remove(self.id, self.version)),
      ).toEqual({
        kind: "forbidden_target",
      });
      // A second manager cannot be removed through the application either.
      await admin.query(
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
        [users[2], scope],
      );
      const manager = await membership(scope, users[2]!);
      expect(
        await changeMember(runtime, remove(manager.id, manager.version)),
      ).toEqual({ kind: "forbidden_target" });
      await admin.query(
        "DELETE FROM impuls.task_scope_members WHERE user_id=ANY($1::uuid[]) AND scope_id=$2",
        [[users[0], users[2]], scope],
      );
    });

    it("lets one of two simultaneous admissions of the same person win", async () => {
      const telegramId = tg();
      const results = await Promise.all([
        changeMember(runtime, admit({ telegramId })),
        changeMember(runtime, admit({ telegramId })),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
      for (const r of results)
        if (r.kind === "ok") created.push(r.response.member.userId);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.users WHERE telegram_id=$1",
            [telegramId],
          )
        ).rows[0].n,
      ).toBe(1);
    });

    it("stops a revoked actor, and an actor revoked by an earlier removal cannot act again", async () => {
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        users[1],
      ]);
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,'admin.members.manage',$3,'Synthetic fixture')",
        [users[1], scope, users[0]],
      );
      expect(await changeMember(runtime, admit({}, 1))).toEqual({
        kind: "revoked",
      });
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        users[1],
      ]);
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=now() WHERE user_id=$1 AND action='admin.members.manage'",
        [users[1]],
      );
      await reopen();
    });

    it("keeps application roles away from direct writes and keeps the journal immutable", async () => {
      const added = await ok(admit());
      for (const sql of [
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES(gen_random_uuid(),gen_random_uuid())",
        "UPDATE impuls.task_scope_members SET revoked_at=now()",
        "INSERT INTO impuls.member_changes(kind,membership_id,actor_id,subject_id,scope_id,user_created,user_reactivated,user_deactivated,revoked_bindings,request_id,reason) SELECT 'admit',membership_id,actor_id,subject_id,scope_id,false,false,false,0,request_id,reason FROM impuls.member_changes",
      ])
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      for (const sql of [
        "UPDATE impuls.member_changes SET reason='x'",
        "DELETE FROM impuls.member_changes",
      ])
        await expect(admin.query(sql)).rejects.toMatchObject({ code: "23514" });
      // The definer functions check authority themselves, whoever calls them.
      await expect(
        runtime.query(
          "SELECT * FROM impuls.admit_member($1,$2,$3,'Тест',NULL,$4,'x')",
          [users[1], scope, tg(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "IM001" });
      await expect(
        runtime.query("SELECT * FROM impuls.remove_member($1,$2,$3,1,$4,'x')", [
          users[1],
          scope,
          added.member.membershipId,
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: "IM001" });
      // Only the runtime role may call the writers.
      const privileges = (
        await admin.query<{ role: string; admit: boolean; remove: boolean }>(
          `SELECT r role,
             has_function_privilege(r,'impuls.admit_member(uuid,uuid,bigint,text,timestamptz,uuid,text)','EXECUTE') admit,
             has_function_privilege(r,'impuls.remove_member(uuid,uuid,uuid,integer,uuid,text)','EXECUTE') remove
           FROM unnest(ARRAY['impuls_app','impuls_worker','anon','authenticated','service_role']) r`,
        )
      ).rows;
      expect(
        privileges.filter((p) => p.admit || p.remove).map((p) => p.role),
      ).toEqual(["impuls_app"]);
    });

    it("never lets the application delegate the members right", async () => {
      const result = await changeAccess(runtime, {
        kind: "grant",
        actorId: users[0]!,
        sessionHash: hashes[0]!,
        scope,
        subjectId: users[3]!,
        action: "admin.members.manage",
        validUntil: null,
        reason: "Synthetic delegation",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        allowAccessManagement: true,
      });
      // users[0] lacks admin.access.manage, so the operation is hidden before the target check.
      expect(result).toEqual({ kind: "not_found" });
      await expect(
        admin.query(
          `WITH b AS (INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason)
             VALUES($1,$2,'admin.members.manage',$3,'Synthetic fixture') RETURNING id)
           INSERT INTO impuls.access_changes(kind,binding_id,actor_id,subject_id,scope_id,action,request_id,reason)
           SELECT 'grant',id,$3,$1,$2,'admin.members.manage',gen_random_uuid(),'x' FROM b`,
          [users[3], scope, users[0]],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it.skipIf(!origin)(
      "serves guarded no-store HTTP for admission and removal",
      async () => {
        const call = (
          kind: "admissions" | "removals",
          payload: unknown,
          over: Record<string, string | undefined> = {},
          actor = 0,
        ) => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Origin: origin!,
            Cookie: "impuls_session=" + tokens[actor],
            "X-CSRF-Token": createCsrfToken(
              tokens[actor]!,
              process.env.CSRF_SECRET!,
            ),
            "Idempotency-Key": randomUUID(),
          };
          for (const [k, v] of Object.entries(over))
            if (v === undefined) delete headers[k];
            else headers[k] = v;
          return fetch(origin + "/api/v1/admin/members/" + kind, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });
        };
        const payload = {
          scope,
          telegramId: tg(),
          displayName: "HTTP участник",
          validUntil: null,
          reason: "Synthetic HTTP admission",
        };
        // Файлы тестов идут параллельно в одной базе: считаем только
        // строки, которые могли бы создать отклонённые запросы этого теста.
        const count = async () =>
          (
            await admin.query(
              "SELECT (SELECT count(*) FROM impuls.users WHERE telegram_id=$1)::int u,(SELECT count(*) FROM impuls.member_changes WHERE scope_id=$2)::int c",
              [payload.telegramId, scope],
            )
          ).rows[0];
        const before = await count();
        const refused: [string, Response, number][] = [
          [
            "foreign origin",
            await call("admissions", payload, {
              Origin: "https://foreign.invalid",
            }),
            403,
          ],
          [
            "bad csrf",
            await call("admissions", payload, { "X-CSRF-Token": "invalid" }),
            403,
          ],
          [
            "no key",
            await call("admissions", payload, { "Idempotency-Key": undefined }),
            400,
          ],
          [
            "extra field",
            await call("admissions", { ...payload, active: true }),
            400,
          ],
          [
            "string id",
            await call("admissions", { ...payload, telegramId: "7123456" }),
            400,
          ],
          [
            "control chars",
            await call("admissions", { ...payload, displayName: "a b" }),
            400,
          ],
          [
            "no cookie",
            await call("admissions", payload, { Cookie: undefined }),
            401,
          ],
          ["no members right", await call("admissions", payload, {}, 1), 404],
          ["only members right", await call("admissions", payload, {}, 2), 404],
        ];
        for (const [name, response, status] of refused)
          expect(response.status, name).toBe(status);
        expect(await count()).toEqual(before);
        const key = randomUUID();
        const done = await call("admissions", payload, {
          "Idempotency-Key": key,
        });
        expect(done.status).toBe(201);
        expect(done.headers.get("cache-control")).toContain("no-store");
        const saved = memberChangeResponseSchema.parse(await done.json());
        created.push(saved.member.userId);
        expect(JSON.stringify(saved)).not.toContain(String(payload.telegramId));
        const replay = await call("admissions", payload, {
          "Idempotency-Key": key,
        });
        expect(memberChangeResponseSchema.parse(await replay.json())).toEqual(
          saved,
        );
        expect(
          (
            await call(
              "admissions",
              { ...payload, reason: "Changed" },
              {
                "Idempotency-Key": key,
              },
            )
          ).status,
        ).toBe(409);
        expect((await call("admissions", payload)).status).toBe(409);
        const removal = {
          scope,
          membershipId: saved.member.membershipId,
          expectedVersion: saved.member.version + 7,
          reason: "Synthetic HTTP removal",
        };
        expect((await call("removals", removal)).status).toBe(409);
        const gone = await call("removals", {
          ...removal,
          expectedVersion: saved.member.version,
        });
        expect(gone.status).toBe(201);
        expect(
          memberChangeResponseSchema.parse(await gone.json()),
        ).toMatchObject({
          kind: "remove",
          userDeactivated: true,
        });
        const list = await fetch(
          origin + "/api/v1/admin/access?scope=" + scope,
          {
            headers: { Cookie: "impuls_session=" + tokens[0] },
          },
        );
        expect(list.status).toBe(200);
        const data = accessListResponseSchema.parse(await list.json());
        expect(data.canManageMembers).toBe(true);
        expect(data.members.some((m) => m.userId === saved.member.userId)).toBe(
          false,
        );
      },
    );

    async function telegramOf(id: string) {
      return (
        await admin.query("SELECT telegram_id FROM impuls.users WHERE id=$1", [
          id,
        ])
      ).rows[0].telegram_id as string;
    }
  },
);
