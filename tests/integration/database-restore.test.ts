import { dropDatabase } from "./drop-database";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runner } from "node-pg-migrate";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  localRestoreConnection,
  restoreDatabaseName,
  restoreToolEnvironment,
} from "../../scripts/database-restore-safety.mjs";
import {
  reviewTaskSubmission,
  type TaskReviewInput,
} from "../../packages/domain/src/tasks/reviews";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import { cancelScheduledCatalogTerms } from "../../packages/domain/src/admin/cancel-schedule";
import { readAdminCatalog } from "../../packages/domain/src/admin/catalog";
import { publishCatalogTerms } from "../../packages/domain/src/admin/publish";
import { createCatalogIdentity } from "../../packages/domain/src/admin/create-catalog";
import { publishQuotaPeriod } from "../../packages/domain/src/admin/publish-quota";
import {
  expireOneSyntheticReservation,
  readSyntheticExpiryStatus,
} from "../../packages/domain/src/rewards/automatic-expiry";
import {
  claimNotificationSimulation as claim,
  processNotificationSimulation as processClaim,
  type NotificationClaim,
} from "../../packages/domain/src/notifications/simulation";

const url = process.env.TEST_DATABASE_URL;
const run = promisify(execFile);
const schemas = "('impuls','impuls_meta')";
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// Metadata is compared without database-specific OIDs. Row hashes preserve native
// timestamp precision and bytea; independent totals below check business invariants.
async function snapshot(pool: Pool | PoolClient) {
  const tables = (
    await pool.query<{ schema: string; name: string }>(`
    SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ${schemas} AND c.relkind='r' ORDER BY 1,2`)
  ).rows;
  const data = [];
  for (const table of tables) {
    const rows = (
      await pool.query(`SELECT count(*)::int count,
      md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest
      FROM ${quote(table.schema)}.${quote(table.name)} t`)
    ).rows[0];
    data.push({ ...table, ...rows });
  }
  const definitions = {
    schemas: `SELECT nspname,pg_get_userbyid(nspowner) owner,coalesce(nspacl,acldefault('n',nspowner))::text acl FROM pg_namespace WHERE nspname IN ${schemas} ORDER BY 1`,
    tables: `SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity,
      coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))::text acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${schemas} ORDER BY 1,2`,
    columns: `SELECT n.nspname,c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) type,
      a.attnotnull,a.attidentity,a.attgenerated,coalesce(a.attacl,'{}'::aclitem[])::text acl,pg_get_expr(d.adbin,d.adrelid) default_value
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname IN ${schemas} AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,4`,
    constraints: `SELECT n.nspname,c.conname,c.conrelid::regclass::text relation,c.convalidated,
      pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname IN ${schemas} ORDER BY 1,2,3`,
    indexes: `SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ${schemas} ORDER BY 1,2,3`,
    policies: `SELECT * FROM pg_policies WHERE schemaname IN ${schemas} ORDER BY schemaname,tablename,policyname`,
    functions: `SELECT n.nspname,p.proname,pg_get_userbyid(p.proowner) owner,pg_get_function_identity_arguments(p.oid) args,
      pg_get_functiondef(p.oid) definition,coalesce(p.proacl,acldefault('f',p.proowner))::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ${schemas} ORDER BY 1,2,3`,
    triggers: `SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ${schemas} AND NOT t.tgisinternal ORDER BY 1,2,3`,
    defaultAcl: `SELECT n.nspname,a.defaclobjtype,a.defaclacl::text FROM pg_default_acl a
      JOIN pg_namespace n ON n.oid=a.defaclnamespace WHERE n.nspname IN ${schemas} ORDER BY 1,2`,
    sequences: `SELECT schemaname,sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value
      FROM pg_sequences WHERE schemaname IN ${schemas} ORDER BY 1,2`,
  };
  const metadata: Record<string, unknown> = {};
  for (const [key, sql] of Object.entries(definitions))
    metadata[key] = (await pool.query(sql)).rows;
  const sequences = (
    await pool.query<{ schemaname: string; sequencename: string }>(
      `SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ${schemas} ORDER BY 1,2`,
    )
  ).rows;
  const sequenceState = [];
  for (const seq of sequences)
    sequenceState.push({
      ...seq,
      ...(
        await pool.query(
          `SELECT last_value,is_called FROM ${quote(seq.schemaname)}.${quote(seq.sequencename)}`,
        )
      ).rows[0],
    });
  return { data, metadata, sequenceState };
}

(url ? describe : describe.skip)(
  "R1 isolated PostgreSQL backup/restore rehearsal",
  () => {
    const runId = randomUUID().replaceAll("-", "");
    const sourceName = restoreDatabaseName(runId, "source");
    const targetName = restoreDatabaseName(runId, "target");
    const created = new Set<string>();
    const pools: Pool[] = [];
    let admin: Pool,
      source: Pool,
      target: Pool,
      sourceApp: Pool,
      targetApp: Pool,
      sourceWorker: Pool,
      targetWorker: Pool,
      targetExpiry: Pool,
      directory: string,
      migrationDirectory: string;
    let baseline: Awaited<ReturnType<typeof snapshot>>;
    let migrationCount: number;
    let accepted: Awaited<ReturnType<typeof reviewTaskSubmission>>;
    let reserved: Awaited<ReturnType<typeof mutateRedemption>>;
    let published: Awaited<ReturnType<typeof publishCatalogTerms>>;
    let scheduled: Awaited<ReturnType<typeof publishCatalogTerms>>;
    let cancellation: Awaited<ReturnType<typeof cancelScheduledCatalogTerms>>;
    let cancellationInput: Parameters<typeof cancelScheduledCatalogTerms>[1];
    let identityCreated: Awaited<ReturnType<typeof createCatalogIdentity>>;
    let quotaPublished: Awaited<ReturnType<typeof publishQuotaPeriod>>;
    let held: NotificationClaim, completed: string;
    const [reviewer, participant, other] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ] as [string, string, string];
    const hashes = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const scope = randomUUID(),
      rules = randomUUID(),
      task = randomUUID(),
      submission = randomUUID();
    const reward = randomUUID(),
      version = randomUUID(),
      quota = randomUUID();
    const publicationInput = {
      actorId: reviewer,
      sessionHash: hashes[0]!,
      scope,
      rewardId: randomUUID(),
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowPublication: true,
      expectedVersion: 1,
      title: "Synthetic restored published title",
      conditions: "Synthetic restored new terms",
      price: 19,
      enabled: false,
      reservationSeconds: null,
      reason: "Synthetic restored publication evidence",
    };
    const creationInput = {
      actorId: reviewer,
      sessionHash: hashes[0]!,
      scope,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowCreation: true,
      title: "Synthetic restored creation",
      conditions: "Synthetic initial terms",
      price: 23,
      reservationSeconds: null,
      reason: "Synthetic restored creation evidence",
    };
    const schedulingInput = {
      ...publicationInput,
      expectedVersion: 2,
      effectiveFrom: "2040-01-01T12:00:00.000Z",
      idempotencyKey: randomUUID(),
      reason: "Synthetic restored future conditions",
    };
    const quotaPublicationInput = {
      actorId: reviewer,
      sessionHash: hashes[0]!,
      scope,
      rewardId: publicationInput.rewardId,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowPublication: true,
      startsAt: "2040-01-01T00:00:00.000Z",
      endsAt: "2040-02-01T00:00:00.000Z",
      capacity: 3,
      reason: "Synthetic restored quota publication",
    };
    const reviewInput: TaskReviewInput = {
      actorId: reviewer,
      sessionHash: hashes[0]!,
      submissionId: submission,
      expectedVersion: 1,
      reason: "Synthetic restore acceptance",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      action: "accept",
      allowSyntheticAccrual: true,
    };
    const reserveInput = {
      actorId: participant,
      sessionHash: hashes[1]!,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowSyntheticRewards: true,
      action: "reserve" as const,
      rewardVersionId: version,
      quotaPeriodId: quota,
      expectedVersion: 1,
    };

    beforeAll(async () => {
      const connection = localRestoreConnection(url);
      const connect = (database: string, role?: string) => {
        const pool = new Pool({
          ...connection,
          database,
          ...(role ? { options: `-c role=${role}` } : {}),
          connectionTimeoutMillis: 5000,
          statement_timeout: 15000,
        });
        pools.push(pool);
        return pool;
      };
      admin = connect(connection.database);
      const roles = (
        await admin.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls
      FROM pg_roles WHERE rolname IN ('impuls_app','impuls_worker') ORDER BY rolname`)
      ).rows;
      expect(roles).toEqual([
        {
          rolname: "impuls_app",
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
        },
        {
          rolname: "impuls_worker",
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
        },
      ]);
      const tool = (name: string) =>
        process.env.PG_BIN
          ? path.join(
              process.env.PG_BIN,
              `${name}${process.platform === "win32" ? ".exe" : ""}`,
            )
          : name;
      const executeTool = async (
        name: string,
        args: string[],
        database: string,
      ) => {
        try {
          const result = await run(tool(name), args, {
            env: restoreToolEnvironment(connection, database),
            windowsHide: true,
            timeout: 45000,
          });
          if (result.stderr.trim())
            throw new Error("Unexpected tool diagnostic");
          return result.stdout;
        } catch {
          // execFile errors include command arguments/stderr. Keep diagnostics neutral.
          throw new Error(
            `${name} failed; check PG_BIN/client compatibility and local test permissions`,
          );
        }
      };
      const dumpVersion = await executeTool(
        "pg_dump",
        ["--version"],
        sourceName,
      );
      const restoreVersion = await executeTool(
        "pg_restore",
        ["--version"],
        targetName,
      );
      expect(dumpVersion).toMatch(/PostgreSQL/);
      expect(restoreVersion).toMatch(/PostgreSQL/);
      directory = await mkdtemp(path.join(tmpdir(), "impuls-restore-"));
      migrationDirectory = path.join(directory, "migrations");
      await mkdir(migrationDirectory);
      const migrationFiles = (await readdir("db/migrations"))
        .filter((f) => /^\d+.*\.js$/.test(f))
        .sort();
      migrationCount = migrationFiles.length;
      for (const file of migrationFiles) {
        let text = await readFile(path.resolve("db/migrations", file), "utf8");
        if (file.startsWith("000003")) {
          const creation =
            /CREATE ROLE impuls_app\s+WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;/;
          expect(text).toMatch(creation);
          text = text.replace(
            creation,
            "-- Cluster role is already provisioned; preserve every schema/ACL statement.",
          );
        }
        await writeFile(path.join(migrationDirectory, file), text);
      }
      for (const name of [sourceName, targetName]) {
        expect(name).toMatch(
          new RegExp(`^impuls_restore_${runId}_(source|target)$`),
        );
        await admin.query(`CREATE DATABASE ${quote(name)} TEMPLATE template0`);
        created.add(name);
      }
      source = connect(sourceName);
      target = connect(targetName);
      sourceApp = connect(sourceName, "impuls_app");
      targetApp = connect(targetName, "impuls_app");
      sourceWorker = connect(sourceName, "impuls_worker");
      targetWorker = connect(targetName, "impuls_worker");
      targetExpiry = connect(targetName, "impuls_expiry_worker");
      const applied = await runner({
        databaseUrl: { ...connection, database: sourceName },
        direction: "up",
        dir: migrationDirectory,
        migrationsTable: "pgmigrations",
        migrationsSchema: "impuls_meta",
        createMigrationsSchema: true,
        logger: silentLogger,
      });
      expect(applied).toHaveLength(migrationFiles.length);
      for (const [i, id] of [reviewer, participant, other].entries()) {
        await source.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
          [id, 98765432001 + i, `Synthetic restore ${i}`],
        );
      }
      await source.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic restore scope')",
        [scope],
      );
      await source.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'task.review',$2,$1,'Synthetic restore authority')",
        [reviewer, scope],
      );
      for (const action of [
        "admin.catalog",
        "admin.catalog.create",
        "admin.catalog.publish",
        "admin.catalog.schedule",
        "admin.catalog.schedule.cancel",
        "admin.catalog.quota.publish",
      ])
        await source.query(
          "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic restore publication authority')",
          [reviewer, action, scope],
        );
      await source.query(
        "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,1,$2,now(),$3)",
        [
          rules,
          {
            mode: "synthetic",
            economy: { approved: true },
            timeZone: "Europe/Moscow",
            acceptance: { enabled: true },
          },
          reviewer,
        ],
      );
      await source.query(
        `INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points)
      VALUES($1,$2,$3,$4,'Synthetic restored task','Independent criteria','test','normal','in_review',now(),17,90)`,
        [task, scope, rules, reviewer],
      );
      await source.query(
        "INSERT INTO impuls.task_assignments(task_id,user_id) VALUES($1,$2)",
        [task, participant],
      );
      await source.query(
        "INSERT INTO impuls.submissions(id,task_id,author_id,attempt_number,text) VALUES($1,$2,$3,1,'Synthetic restore evidence')",
        [submission, task, participant],
      );
      for (const id of [participant, other])
        await source.query(
          "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
          [id, scope],
        );
      // Permission changes invalidate existing sessions. Sign in only after
      // the fixture's bindings/memberships are in place, as the application does.
      for (const [i, id] of [reviewer, participant, other].entries())
        await source.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
          [id, hashes[i]],
        );
      accepted = await reviewTaskSubmission(sourceApp, reviewInput);
      expect(accepted.kind).toBe("ok");
      await source.query(
        `INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from)
      VALUES($1,$2,$3,1,'Synthetic restore cosmetic','Synthetic terms',30,'cosmetic',true,now()-interval '1 second')`,
        [version, reward, scope],
      );
      await source.query(
        `INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity)
      VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour',1)`,
        [quota, reward, scope],
      );
      reserved = await mutateRedemption(sourceApp, reserveInput);
      expect(reserved.kind).toBe("ok");
      await source.query(
        "INSERT INTO impuls.reward_versions(reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from) VALUES($1,$2,1,'Synthetic original title','Synthetic original terms',30,'cosmetic',true,clock_timestamp()-interval '1 second')",
        [publicationInput.rewardId, scope],
      );
      identityCreated = await createCatalogIdentity(sourceApp, creationInput);
      expect(identityCreated.kind).toBe("ok");
      published = await publishCatalogTerms(sourceApp, publicationInput);
      expect(published.kind).toBe("ok");
      scheduled = await publishCatalogTerms(sourceApp, schedulingInput);
      expect(scheduled.kind).toBe("ok");
      if (scheduled.kind !== "ok") throw Error(scheduled.kind);
      cancellationInput = {
        actorId: reviewer,
        sessionHash: hashes[0]!,
        scope,
        rewardId: publicationInput.rewardId,
        versionId: scheduled.response.catalog.published.id,
        expectedVersion: 3,
        reason: "Synthetic restored cancellation evidence",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        allowCancellation: true,
      };
      cancellation = await cancelScheduledCatalogTerms(
        sourceApp,
        cancellationInput,
      );
      expect(cancellation.kind).toBe("ok");
      quotaPublished = await publishQuotaPeriod(
        sourceApp,
        quotaPublicationInput,
      );
      expect(quotaPublished.kind).toBe("ok");
      const first = await claim(sourceWorker, true);
      expect(first).not.toBeNull();
      completed = first!.outboxId;
      expect(
        await processClaim(sourceWorker, first!, async () => "simulated", true),
      ).toBe("simulated");
      held = (await claim(sourceWorker, true))!;
      expect(held).not.toBeNull();
      // A long live lease avoids dependence on pg_dump/runtime speed. Recovery tests
      // advance only this disposable row later; no production clock assumptions.
      await source.query(
        "UPDATE impuls.notification_simulations SET lease_until=clock_timestamp()+interval '1 hour' WHERE outbox_id=$1",
        [held.outboxId],
      );
      baseline = await snapshot(source);
      const archive = path.join(directory, "synthetic.dump");
      await executeTool(
        "pg_dump",
        ["--format=custom", "--no-password", "--file", archive],
        sourceName,
      );
      await executeTool(
        "pg_restore",
        [
          "--single-transaction",
          "--exit-on-error",
          "--no-password",
          "--dbname",
          targetName,
          archive,
        ],
        targetName,
      );
      console.log(
        JSON.stringify({
          mode: "synthetic-restore",
          server: (await target.query("SHOW server_version")).rows[0]
            .server_version,
          pgDump: dumpVersion.trim(),
          pgRestore: restoreVersion.trim(),
          migrations: applied.length,
          tables: baseline.data.length,
        }),
      );
    }, 90000);

    afterAll(async () => {
      const failures: unknown[] = [];
      for (const pool of pools.filter((pool) => pool !== admin)) {
        try {
          await pool.end();
        } catch (error) {
          failures.push(error);
        }
      }
      if (admin) {
        for (const name of created) {
          if (
            ![sourceName, targetName].includes(name) ||
            !new RegExp(`^impuls_restore_${runId}_(source|target)$`).test(name)
          )
            throw new Error("Refusing unexpected database cleanup target");
          try {
            await dropDatabase(admin, name);
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await admin.end();
        } catch (error) {
          failures.push(error);
        }
      }
      if (directory) {
        const resolved = path.resolve(directory);
        if (
          path.dirname(resolved) !== path.resolve(tmpdir()) ||
          !path.basename(resolved).startsWith("impuls-restore-")
        )
          throw new Error("Refusing unexpected archive cleanup target");
        try {
          await rm(resolved, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new Error(
          `Restore rehearsal cleanup failed (${failures.length} operations)`,
        );
    }, 30000);

    it("restores every table, sequence, ACL and protective schema object", async () => {
      expect(await snapshot(target)).toEqual(baseline);
      expect(
        baseline.data.find((t) => t.name === "catalog_publications")?.count,
      ).toBe(2);
      expect(
        baseline.data.find(
          (t) => t.schema === "impuls_meta" && t.name === "pgmigrations",
        )?.count,
      ).toBe(migrationCount);
      expect(
        baseline.data.find((t) => t.name === "notification_simulation_events")
          ?.count,
      ).toBe(3);
      expect(
        (
          await target.query(
            "SELECT lifetime_xp::int xp,available_points::int available,reserved_points::int reserved FROM impuls.account_balances WHERE user_id=$1",
            [participant],
          )
        ).rows,
      ).toEqual([{ xp: 17, available: 60, reserved: 30 }]);
      expect(
        (
          await target.query(
            "SELECT capacity,reserved,used FROM impuls.quota_periods WHERE id=$1",
            [quota],
          )
        ).rows,
      ).toEqual([{ capacity: 1, reserved: 1, used: 0 }]);
      const applied = await runner({
        databaseUrl: { ...localRestoreConnection(url), database: targetName },
        direction: "up",
        dir: migrationDirectory,
        migrationsTable: "pgmigrations",
        migrationsSchema: "impuls_meta",
        createMigrationsSchema: true,
        logger: silentLogger,
      });
      expect(applied).toEqual([]);
      expect(await snapshot(target)).toEqual(baseline);
    });

    it("replays restored operations without duplicate financial, audit or outbox writes", async () => {
      expect(await reviewTaskSubmission(targetApp, reviewInput)).toEqual(
        accepted,
      );
      const replay = await mutateRedemption(targetApp, reserveInput);
      expect(replay.kind).toBe("ok");
      if (replay.kind === "ok" && reserved.kind === "ok") {
        expect(replay.status).toBe(reserved.status);
        expect(replay.response).toEqual(reserved.response);
      }
      expect(
        await reviewTaskSubmission(targetApp, {
          ...reviewInput,
          reason: "Changed body after restore",
        }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect(
        await mutateRedemption(targetApp, {
          ...reserveInput,
          expectedVersion: 2,
        }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect(await snapshot(target)).toEqual(baseline);
    });

    it("detects financial, privilege and trigger drift instead of accepting a partial restore", async () => {
      const client = await target.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE impuls.account_balances SET available_points=available_points+1 WHERE user_id=$1",
          [participant],
        );
        await client.query("GRANT SELECT ON impuls.users TO impuls_worker");
        await client.query(
          "ALTER TABLE impuls.ledger_entries DISABLE TRIGGER USER",
        );
        const restoreOwner = (
          await client.query<{ name: string }>("SELECT session_user name")
        ).rows[0]!.name;
        await client.query(
          `ALTER FUNCTION impuls.expire_one_synthetic_reservation() OWNER TO ${quote(restoreOwner)}`,
        );
        const damaged = await snapshot(client);
        expect(damaged.data).not.toEqual(baseline.data);
        expect(damaged.metadata.tables).not.toEqual(baseline.metadata.tables);
        expect(damaged.metadata.triggers).not.toEqual(
          baseline.metadata.triggers,
        );
        expect(damaged.metadata.functions).not.toEqual(
          baseline.metadata.functions,
        );
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect(await snapshot(target)).toEqual(baseline);
    });
    it("restores immutable publication and cancellation evidence and idempotent replay", async () => {
      expect(
        await cancelScheduledCatalogTerms(targetApp, cancellationInput),
      ).toEqual(cancellation);
      if (cancellation.kind === "ok")
        await expect(
          target.query("DELETE FROM impuls.catalog_cancellations WHERE id=$1", [
            cancellation.response.cancellationId,
          ]),
        ).rejects.toMatchObject({ code: "23514" });
      const catalog = await readAdminCatalog(targetApp, reviewer, hashes[0]!, {
        enabled: true,
        scope,
        limit: 50,
      });
      if (catalog.kind !== "ok") throw Error(catalog.kind);
      expect(
        catalog.response.items.find(
          (i) => i.rewardId === publicationInput.rewardId,
        ),
      ).toMatchObject({ current: { version: 2, price: 19 }, scheduled: null });
      expect(await publishCatalogTerms(targetApp, schedulingInput)).toEqual(
        scheduled,
      );
      expect(await createCatalogIdentity(targetApp, creationInput)).toEqual(
        identityCreated,
      );
      if (identityCreated.kind === "ok")
        await expect(
          target.query("DELETE FROM impuls.catalog_creations WHERE id=$1", [
            identityCreated.response.creationId,
          ]),
        ).rejects.toMatchObject({ code: "23514" });
      expect(
        await publishQuotaPeriod(targetApp, quotaPublicationInput),
      ).toEqual(quotaPublished);
      if (quotaPublished.kind === "ok")
        await expect(
          target.query("DELETE FROM impuls.quota_publications WHERE id=$1", [
            quotaPublished.response.publicationId,
          ]),
        ).rejects.toMatchObject({ code: "23514" });
      expect(await publishCatalogTerms(targetApp, publicationInput)).toEqual(
        published,
      );
      if (published.kind === "ok")
        await expect(
          target.query("DELETE FROM impuls.catalog_publications WHERE id=$1", [
            published.response.publicationId,
          ]),
        ).rejects.toMatchObject({ code: "23514" });
      expect(await snapshot(target)).toEqual(baseline);
    });

    it("keeps the last quota place reserved after restoration", async () => {
      expect(
        await mutateRedemption(targetApp, {
          ...reserveInput,
          actorId: other,
          sessionHash: hashes[2]!,
          idempotencyKey: randomUUID(),
        }),
      ).toEqual({ kind: "quota_full" });
      expect(await snapshot(target)).toEqual(baseline);
    });

    it("preserves immutable history and narrow runtime privileges", async () => {
      for (const sql of [
        "UPDATE impuls.ledger_entries SET amount=999",
        "DELETE FROM impuls.ledger_entries",
        "UPDATE impuls.notification_simulation_events SET phase='failed'",
        "DELETE FROM impuls.notification_simulation_events",
      ])
        await expect(targetApp.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      await expect(
        targetWorker.query("SELECT display_name FROM impuls.users"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        targetWorker.query("DELETE FROM impuls.notification_simulations"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        target.query(
          "UPDATE impuls.notification_simulation_events SET phase='failed'",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        target.query("UPDATE impuls.ledger_entries SET amount=999"),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await snapshot(target)).toEqual(baseline);
    });

    it("recovers an expired restored lease with a fresh token and continues journaling", async () => {
      expect(await claim(targetWorker, true)).toBeNull();
      expect(await snapshot(target)).toEqual(baseline);
      await target.query(
        "UPDATE impuls.notification_simulations SET lease_until=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",
        [held.outboxId],
      );
      const recovered = (await claim(targetWorker, true))!;
      expect(recovered.outboxId).toBe(held.outboxId);
      expect(recovered.token).not.toBe(held.token);
      expect(
        await processClaim(targetWorker, held, async () => "simulated", true),
      ).toBe("lost");
      expect(
        await processClaim(
          targetWorker,
          recovered,
          async () => "simulated",
          true,
        ),
      ).toBe("simulated");
      expect(await claim(targetWorker, true)).toBeNull();
      expect(
        (
          await target.query(
            "SELECT status,attempts FROM impuls.notification_simulations WHERE outbox_id=$1",
            [completed],
          )
        ).rows,
      ).toEqual([{ status: "simulated", attempts: 1 }]);
      expect(
        (
          await target.query(
            "SELECT attempt,phase FROM impuls.notification_simulation_events WHERE outbox_id=$1 ORDER BY recorded_at,id",
            [held.outboxId],
          )
        ).rows,
      ).toEqual([
        { attempt: 1, phase: "started" },
        { attempt: 1, phase: "lease_expired" },
        { attempt: 2, phase: "started" },
        { attempt: 2, phase: "simulated" },
      ]);
      expect(
        (await target.query("SELECT status FROM impuls.notification_outbox"))
          .rows,
      ).toEqual([{ status: "pending" }, { status: "pending" }]);
    });

    it("continues to revoke restored sessions and reject saved operations after access loss", async () => {
      await target.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        participant,
      ]);
      expect(
        (
          await target.query(
            "SELECT revoked_at IS NOT NULL revoked FROM impuls.sessions WHERE user_id=$1",
            [participant],
          )
        ).rows,
      ).toEqual([{ revoked: true }]);
      expect(await mutateRedemption(targetApp, reserveInput)).toEqual({
        kind: "revoked",
      });
      expect(await reviewTaskSubmission(targetApp, reviewInput)).toEqual({
        kind: "recipient_revoked",
      });
      expect(
        (
          await target.query(
            "SELECT lifetime_xp::int xp,available_points::int available,reserved_points::int reserved FROM impuls.account_balances WHERE user_id=$1",
            [participant],
          )
        ).rows,
      ).toEqual([{ xp: 17, available: 60, reserved: 30 }]);
      expect(await snapshot(source)).toEqual(baseline);
    });
    it("continues automatic expiry through restored definer/ACL without duplicate returns", async () => {
      const newReward = randomUUID(),
        newVersion = randomUUID(),
        newQuota = randomUUID();
      await target.query(
        "INSERT INTO impuls.account_balances(user_id,available_points) VALUES($1,120) ON CONFLICT(user_id) DO UPDATE SET available_points=120",
        [other],
      );
      await target.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds) VALUES($1,$2,$3,1,'Restored expiry cosmetic','Synthetic saved deadline',23,'cosmetic',true,clock_timestamp()-interval '1 minute',1)",
        [newVersion, newReward, scope],
      );
      await target.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',1)",
        [newQuota, newReward, scope],
      );
      const request = await mutateRedemption(targetApp, {
        ...reserveInput,
        actorId: other,
        sessionHash: hashes[2]!,
        rewardVersionId: newVersion,
        quotaPeriodId: newQuota,
        idempotencyKey: randomUUID(),
      });
      expect(request.kind).toBe("ok");
      if (request.kind !== "ok") throw new Error(request.kind);
      await target.query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.02) FROM impuls.redemptions WHERE id=$1",
        [request.response.redemption.id],
      );
      expect(await expireOneSyntheticReservation(targetExpiry, true)).toBe(
        true,
      );
      expect(await expireOneSyntheticReservation(targetExpiry, true)).toBe(
        false,
      );
      expect(await readSyntheticExpiryStatus(targetExpiry, true)).toMatchObject(
        {
          counts: { due: 0, automaticExpired: 1 },
          oldestDueAt: null,
          oldestDueAgeSeconds: null,
          lastAutomaticExpiryAt: expect.any(String),
        },
      );
      await expect(
        targetApp.query("SELECT * FROM impuls.read_synthetic_expiry_status()"),
      ).rejects.toMatchObject({ code: "42501" });
      expect(
        (
          await target.query(
            "SELECT available_points::int available,reserved_points::int reserved FROM impuls.account_balances WHERE user_id=$1",
            [other],
          )
        ).rows,
      ).toEqual([{ available: 120, reserved: 0 }]);
      expect(
        (
          await target.query(
            "SELECT status,automatic_expiry,decision_actor_id FROM impuls.redemptions WHERE id=$1",
            [request.response.redemption.id],
          )
        ).rows,
      ).toEqual([
        { status: "expired", automatic_expiry: true, decision_actor_id: null },
      ]);
      expect(
        (
          await target.query(
            "SELECT reserved,used FROM impuls.quota_periods WHERE id=$1",
            [newQuota],
          )
        ).rows,
      ).toEqual([{ reserved: 0, used: 0 }]);
      await expect(
        targetApp.query("SELECT impuls.expire_one_synthetic_reservation()"),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await snapshot(source)).toEqual(baseline);
    });
  },
);
