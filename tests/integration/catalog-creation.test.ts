import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCatalogIdentity } from "../../packages/domain/src/admin/create-catalog";
import { publishCatalogTerms } from "../../packages/domain/src/admin/publish";
import { readAdminCatalog } from "../../packages/domain/src/admin/catalog";
import { readAudit } from "../../packages/domain/src/admin/audit";
import { readRewardCatalog } from "../../packages/domain/src/rewards/read";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import { catalogCreationResponseSchema } from "../../packages/contracts/src/catalog-creation";
import { auditResponseSchema } from "../../packages/contracts/src/audit";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)(
  "F07 new disabled identity under runtime role",
  () => {
    const owner = new Pool({ connectionString: url }),
      runtime = new Pool({
        connectionString: url,
        options: "-c role=impuls_app",
        application_name: "catalog-creation-tests",
        max: 8,
      });
    const users = [randomUUID(), randomUUID(), randomUUID()],
      scope = randomUUID(),
      foreign = randomUUID();
    const tokens = users.map(() => randomBytes(32).toString("base64url")),
      hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    const input = () => ({
      actorId: users[0]!,
      sessionHash: hashes[0]!,
      scope,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      title: "Synthetic creation",
      conditions: "Synthetic conditions\nnot a service reward",
      price: 19,
      reservationSeconds: null,
      reason: "Synthetic creation evidence",
      allowCreation: true,
    });
    beforeAll(async () => {
      for (const s of [scope, foreign])
        await owner.query(
          "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic creation scope')",
          [s],
        );
      for (const [i, user] of users.entries()) {
        await owner.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic creator',true)",
          [user, randomInt(7e12, 8e12)],
        );
        await owner.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [user, hashes[i]],
        );
        await owner.query(
          "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
          [user],
        );
        await owner.query(
          "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
          [user, scope],
        );
      }
      for (const [i, actions] of [
        [
          0,
          [
            "admin.catalog",
            "admin.catalog.create",
            "admin.catalog.publish",
            "admin.catalog.quota.publish",
            "admin.audit",
          ],
        ],
        [
          1,
          [
            "admin.catalog",
            "admin.catalog.publish",
            "admin.catalog.quota.publish",
          ],
        ],
        [2, ["admin.catalog.create"]],
      ] as const)
        for (const action of actions)
          await owner.query(
            "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fixture')",
            [users[i], scope, action],
          );
      await owner.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=ANY($1::uuid[])",
        [users],
      );
    });
    async function counts() {
      return (
        await owner.query(
          `SELECT (SELECT count(*)::int FROM impuls.reward_versions WHERE scope_id=$1) versions,(SELECT count(*)::int FROM impuls.catalog_creations c JOIN impuls.reward_versions r ON r.id=c.initial_version_id WHERE r.scope_id=$1) creations,(SELECT count(*)::int FROM impuls.idempotency_records WHERE actor_id=ANY($2::uuid[]) AND operation='catalog.create') intents,(SELECT count(*)::int FROM impuls.quota_periods WHERE scope_id=$1) quotas`,
          [scope, users],
        )
      ).rows[0];
    }
    async function create() {
      const body = input(),
        r = await createCatalogIdentity(runtime, body);
      if (r.kind !== "ok") throw Error(r.kind);
      return { body, r };
    }
    it("creates disabled version 1 and immutable evidence atomically without quota or financial changes", async () => {
      const before = await counts(),
        { body, r } = await create();
      expect(catalogCreationResponseSchema.parse(r.response)).toMatchObject({
        scope,
        creation: {
          initial: {
            version: 1,
            enabled: false,
            title: body.title,
            conditions: body.conditions,
            price: 19,
            reservationSeconds: null,
          },
        },
      });
      expect(await counts()).toEqual({
        ...before,
        versions: before.versions + 1,
        creations: before.creations + 1,
        intents: before.intents + 1,
      });
      expect(
        (
          await owner.query(
            "SELECT lifetime_xp::int,available_points::int,reserved_points::int,version FROM impuls.account_balances WHERE user_id=ANY($1::uuid[])",
            [users],
          )
        ).rows,
      ).toEqual(
        users.map(() => ({
          lifetime_xp: 300,
          available_points: 120,
          reserved_points: 0,
          version: 1,
        })),
      );
      expect(
        (
          await owner.query(
            "SELECT count(*)::int n FROM impuls.ledger_entries WHERE user_id=ANY($1::uuid[])",
            [users],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "SELECT count(*)::int n FROM impuls.notification_outbox WHERE recipient_id=ANY($1::uuid[])",
            [users],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("concurrent identical intents produce one UUID; changed body conflicts; distinct intents may share a title", async () => {
      const before = await counts(),
        body = input();
      const [a, b] = await Promise.all([
        createCatalogIdentity(runtime, body),
        createCatalogIdentity(runtime, { ...body, requestId: randomUUID() }),
      ]);
      expect(a.kind).toBe("ok");
      expect(b).toEqual(a);
      expect(await counts()).toEqual({
        ...before,
        versions: before.versions + 1,
        creations: before.creations + 1,
        intents: before.intents + 1,
      });
      expect(
        await createCatalogIdentity(runtime, { ...body, price: 20 }),
      ).toEqual({ kind: "idempotency_conflict" });
      const c = await createCatalogIdentity(runtime, {
        ...body,
        idempotencyKey: randomUUID(),
      });
      expect(c.kind).toBe("ok");
      if (a.kind === "ok" && c.kind === "ok")
        expect(c.response.creation.rewardId).not.toBe(
          a.response.creation.rewardId,
        );
    });
    it("rejects reader/publishers, creator without reader, foreign scope, disabled flag and invalid session without writes", async () => {
      const before = await counts();
      for (const patch of [
        { actorId: users[1]!, sessionHash: hashes[1]! },
        { actorId: users[2]!, sessionHash: hashes[2]! },
        { scope: foreign },
      ])
        expect(
          await createCatalogIdentity(runtime, { ...input(), ...patch }),
        ).toEqual({ kind: "not_found" });
      expect(
        await createCatalogIdentity(runtime, {
          ...input(),
          allowCreation: false,
        }),
      ).toEqual({ kind: "disabled" });
      expect(
        await createCatalogIdentity(runtime, {
          ...input(),
          sessionHash: randomBytes(32),
        }),
      ).toEqual({ kind: "unauthorized" });
      expect(await counts()).toEqual(before);
    });
    it("denies replay after exact permission, session or active revocation", async () => {
      const { body } = await create(),
        before = await counts();
      await owner.query(
        "UPDATE impuls.role_bindings SET revoked_at=clock_timestamp() WHERE user_id=$1 AND action='admin.catalog.create'",
        [users[0]],
      );
      try {
        expect(await createCatalogIdentity(runtime, body)).toEqual({
          kind: "not_found",
        });
      } finally {
        await owner.query(
          "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND action='admin.catalog.create'",
          [users[0]],
        );
        await owner.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
      }
      await owner.query(
        "UPDATE impuls.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [users[0]],
      );
      try {
        expect(await createCatalogIdentity(runtime, body)).toEqual({
          kind: "unauthorized",
        });
      } finally {
        await owner.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
      }
      await owner.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        users[0],
      ]);
      try {
        expect(await createCatalogIdentity(runtime, body)).toEqual({
          kind: "revoked",
        });
      } finally {
        await owner.query("UPDATE impuls.users SET active=true WHERE id=$1", [
          users[0],
        ]);
        await owner.query(
          "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
          [users[0]],
        );
      }
      expect(await counts()).toEqual(before);
    });
    for (const subject of ["permission", "session"] as const)
      it(`rechecks ${subject} expiry after a demonstrated idempotency lock wait`, async () => {
        const { body } = await create(),
          before = await counts(),
          blocker = await owner.connect();
        let pending: ReturnType<typeof createCatalogIdentity> | undefined;
        try {
          await blocker.query("BEGIN");
          await blocker.query(
            "SELECT 1 FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='catalog.create' AND key=$2 FOR UPDATE",
            [body.actorId, body.idempotencyKey],
          );
          if (subject === "permission")
            await owner.query(
              "UPDATE impuls.role_bindings SET valid_until=clock_timestamp()+interval '600 milliseconds' WHERE user_id=$1 AND action='admin.catalog.create'",
              [users[0]],
            );
          else
            await owner.query(
              "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '600 milliseconds' WHERE user_id=$1",
              [users[0]],
            );
          const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
            .rows[0].pid;
          await owner.query(
            "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
            [users[0]],
          );
          pending = createCatalogIdentity(runtime, body);
          let observed = false;
          for (let n = 0; n < 100; n++) {
            if (
              (
                await owner.query(
                  "SELECT 1 FROM pg_stat_activity WHERE application_name='catalog-creation-tests' AND $1=ANY(pg_blocking_pids(pid))",
                  [pid],
                )
              ).rowCount
            ) {
              observed = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 10));
          }
          expect(observed).toBe(true);
          const sql =
            subject === "permission"
              ? "SELECT clock_timestamp()>valid_until expired FROM impuls.role_bindings WHERE user_id=$1 AND action='admin.catalog.create'"
              : "SELECT clock_timestamp()>expires_at expired FROM impuls.sessions WHERE user_id=$1";
          for (let n = 0; n < 100; n++) {
            if ((await owner.query(sql, [users[0]])).rows[0].expired) break;
            await new Promise((r) => setTimeout(r, 20));
          }
          expect((await owner.query(sql, [users[0]])).rows[0].expired).toBe(
            true,
          );
          await blocker.query("ROLLBACK");
          expect(await pending).toEqual({
            kind: subject === "permission" ? "not_found" : "unauthorized",
          });
          expect(await counts()).toEqual(before);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          if (pending) await pending;
          await owner.query(
            "UPDATE impuls.role_bindings SET valid_until=NULL WHERE user_id=$1 AND action='admin.catalog.create'",
            [users[0]],
          );
          await owner.query(
            "UPDATE impuls.sessions SET revoked_at=NULL,expires_at=clock_timestamp()+interval '1 hour' WHERE user_id=$1",
            [users[0]],
          );
        }
      });
    it("rolls back initial version and intent when evidence fails", async () => {
      const before = await counts();
      await expect(
        createCatalogIdentity(runtime, { ...input(), reason: "" }),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await counts()).toEqual(before);
    });
    it("limits grants and rejects rewriting, deleting and invalid initial snapshots even by owner", async () => {
      const { r } = await create();
      for (const sql of [
        "UPDATE impuls.catalog_creations SET reason='rewrite' WHERE id=$1",
        "DELETE FROM impuls.catalog_creations WHERE id=$1",
      ]) {
        await expect(
          runtime.query(sql, [r.response.creationId]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          owner.query(sql, [r.response.creationId]),
        ).rejects.toMatchObject({ code: "23514" });
      }
      expect(
        (
          await owner.query(
            "SELECT has_table_privilege('impuls_worker','impuls.catalog_creations','SELECT') worker,has_table_privilege('anon','impuls.catalog_creations','SELECT') anon,has_table_privilege('authenticated','impuls.catalog_creations','SELECT') authenticated",
          )
        ).rows[0],
      ).toEqual({ worker: false, anon: false, authenticated: false });
      expect(
        (
          await owner.query(
            "SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid='impuls.guard_catalog_creation()'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') public_execute",
          )
        ).rows[0].public_execute,
      ).toBe(false);
      const id = randomUUID();
      await owner.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,1,'Invalid enabled identity','Synthetic',19,'cosmetic','synthetic',true,clock_timestamp())",
        [id, randomUUID(), scope],
      );
      await expect(
        runtime.query(
          "INSERT INTO impuls.catalog_creations(initial_version_id,actor_id,request_id,reason) VALUES($1,$2,$3,'Invalid snapshot')",
          [id, users[0], randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("keeps creation audit independent, scoped, paginated and immutable after later publication", async () => {
      const { body, r } = await create();
      const page = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "catalog.create",
        limit: 1,
      });
      if (page.kind !== "ok") throw Error(page.kind);
      expect(auditResponseSchema.parse(page.response).items[0]).toMatchObject({
        id: r.response.creationId,
        reason: body.reason,
        creation: r.response.creation,
        catalog: null,
        quota: null,
      });
      expect(page.response.nextCursor).not.toBeNull();
      const cursor = {
        actor: users[0]!,
        scope,
        action: "catalog.create" as const,
        id: page.response.items[0]!.id,
      };
      const next = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "catalog.create",
        limit: 1,
        cursor,
      });
      expect(next.kind).toBe("ok");
      if (next.kind === "ok")
        expect(next.response.items[0]!.id).not.toBe(cursor.id);
      expect(
        await readAudit(runtime, users[0]!, hashes[0]!, {
          allowSyntheticAudit: true,
          scope: foreign,
          action: "catalog.create",
        }),
      ).toEqual({ kind: "not_found" });
      expect(
        await readAudit(runtime, users[1]!, hashes[1]!, {
          allowSyntheticAudit: true,
          scope,
          action: "catalog.create",
        }),
      ).toEqual({ kind: "not_found" });
      expect(
        (
          await publishCatalogTerms(runtime, {
            ...body,
            rewardId: r.response.creation.rewardId,
            expectedVersion: 1,
            enabled: true,
            title: "Later enabled terms",
            allowPublication: true,
          })
        ).kind,
      ).toBe("ok");
      const after = await readAudit(runtime, users[0]!, hashes[0]!, {
        allowSyntheticAudit: true,
        scope,
        action: "catalog.create",
        limit: 50,
      });
      if (after.kind !== "ok") throw Error(after.kind);
      expect(
        after.response.items.find((x) => x.id === r.response.creationId)
          ?.creation,
      ).toEqual(r.response.creation);
      const list = await readAdminCatalog(runtime, users[0]!, hashes[0]!, {
        enabled: true,
        scope,
        allowCreation: true,
      });
      expect(list.kind).toBe("ok");
      if (list.kind === "ok") expect(list.response.canCreate).toBe(true);
      const other = await readAdminCatalog(runtime, users[1]!, hashes[1]!, {
        enabled: true,
        scope,
        allowCreation: true,
      });
      if (other.kind !== "ok") throw Error(other.kind);
      expect(other.response.canCreate).toBe(false);
      const participant = await readRewardCatalog(
        runtime,
        users[0]!,
        hashes[0]!,
        { allowSyntheticRewards: true, scope },
      );
      expect(participant.kind).toBe("ok");
      if (participant.kind === "ok")
        expect(participant.response.items).toEqual([]);
    });
    (origin ? it : it.skip)(
      "HTTP validates Origin/CSRF/strict input/no-store/replay and actual browser writes disabled identity",
      async () => {
        const body = input(),
          endpoint = `${origin}/api/v1/admin/rewards`,
          data = {
            scope,
            title: body.title,
            conditions: body.conditions,
            price: 19,
            reservationSeconds: null,
            reason: body.reason,
          };
        const headers = {
          Origin: origin!,
          Cookie: `impuls_session=${tokens[0]}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": createCsrfToken(tokens[0]!, process.env.CSRF_SECRET!),
          "Idempotency-Key": body.idempotencyKey,
        };
        for (const [suffix, patch, raw, status] of [
          ["", { Origin: "https://invalid.example" }, data, 403],
          ["", { "X-CSRF-Token": "bad" }, data, 403],
          ["", { "Idempotency-Key": "bad" }, data, 400],
          ["", { "Content-Type": "text/plain" }, data, 400],
          ["?scope=" + scope, {}, data, 400],
          ["", {}, { ...data, enabled: true }, 400],
          ["", {}, { ...data, reason: "x".repeat(20000) }, 413],
        ] as const) {
          const response = await fetch(endpoint + suffix, {
            method: "POST",
            headers: { ...headers, ...patch },
            body: JSON.stringify(raw),
          });
          expect(response.status).toBe(status);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
        }
        expect((await fetch(endpoint, { method: "PUT", headers })).status).toBe(
          405,
        );
        const first = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        });
        expect(first.status).toBe(201);
        expect(first.headers.get("cache-control")).toBe("private, no-store");
        const saved = catalogCreationResponseSchema.parse(await first.json());
        expect(
          await (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify(data),
            })
          ).json(),
        ).toEqual(saved);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...data, price: 20 }),
            })
          ).status,
        ).toBe(409);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: {
                ...headers,
                Cookie: `impuls_session=${tokens[1]}`,
                "X-CSRF-Token": createCsrfToken(
                  tokens[1]!,
                  process.env.CSRF_SECRET!,
                ),
              },
              body: JSON.stringify(data),
            })
          ).status,
        ).toBe(404);
        const browser = await chromium.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 360, height: 844 },
          });
          await context.addCookies([
            { name: "impuls_session", value: tokens[0]!, url: origin! },
          ]);
          const page = await context.newPage();
          await page.goto(origin!);
          await page.getByRole("button", { name: "Ещё", exact: true }).click();
          await page
            .getByRole("button", { name: "Управление каталогом", exact: true })
            .click();
          await page.getByLabel("Область", { exact: true }).selectOption(scope);
          await page
            .getByRole("button", {
              name: "Создать позицию косметики",
              exact: true,
            })
            .click();
          await page
            .getByLabel("Название", { exact: true })
            .fill("Actual synthetic browser creation");
          await page
            .getByLabel("Условия", { exact: true })
            .fill("Actual synthetic conditions");
          await page.getByLabel("Цена в баллах", { exact: true }).fill("23");
          await page
            .getByLabel("Основание создания", { exact: true })
            .fill("Actual browser evidence");
          await page
            .getByRole("button", { name: "Проверить позицию", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Подтвердить создание", exact: true })
            .click();
          await page
            .getByText(
              "Позиция создана и выключена. Квота не задана. Перечитываем каталог.",
            )
            .waitFor();
          expect(
            (
              await owner.query(
                "SELECT version,enabled,price,reservation_seconds FROM impuls.reward_versions WHERE scope_id=$1 AND title='Actual synthetic browser creation'",
                [scope],
              )
            ).rows,
          ).toEqual([
            {
              version: 1,
              enabled: false,
              price: 23,
              reservation_seconds: null,
            },
          ]);
        } finally {
          await browser.close();
        }
      },
      30000,
    );
    afterAll(async () => {
      const client = await owner.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role=replica");
        for (const table of [
          "catalog_creations",
          "catalog_publications",
          "idempotency_records",
        ])
          await client.query(
            `DELETE FROM impuls.${table} WHERE actor_id=ANY($1::uuid[])`,
            [users],
          );
        await client.query(
          "DELETE FROM impuls.reward_versions WHERE scope_id=$1",
          [scope],
        );
        for (const table of [
          "task_mutation_limits",
          "role_bindings",
          "sessions",
          "task_scope_members",
          "account_balances",
        ])
          await client.query(
            `DELETE FROM impuls.${table} WHERE ${table === "task_mutation_limits" ? "actor_id" : "user_id"}=ANY($1::uuid[])`,
            [users],
          );
        await client.query(
          "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
          [[scope, foreign]],
        );
        await client.query(
          "DELETE FROM impuls.users WHERE id=ANY($1::uuid[])",
          [users],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
        await runtime.end();
        await owner.end();
      }
    });
  },
);
