import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decideSelfTask,
  listSelfTasks,
  proposeSelfTask,
  readSelfTaskOptions,
  verifySelfTask,
} from "../../packages/domain/src/tasks/self";
import { reviewTaskSubmission } from "../../packages/domain/src/tasks/reviews";
import type { SelfTaskResult } from "../../packages/domain/src/tasks/self";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration(
  "self-submitted tasks: propose, verify, forward in PostgreSQL",
  () => {
    const admin = new Pool({ connectionString: databaseUrl });
    // The runtime role, never a superuser path.
    const runtime = new Pool({
      connectionString: databaseUrl,
      options: "-c role=impuls_app",
      max: 8,
    });
    const keys = [
      "member",
      "verifier",
      "verifier2",
      "commander",
      "plain",
      "outsider",
      "inactive",
    ] as const;
    type Who = (typeof keys)[number];
    const users = {} as Record<Who, string>;
    const hashes = {} as Record<Who, Buffer>;
    let scopeId: string;
    let otherScopeId: string;
    let rulesId: string | null = null;
    let policyRule = "";
    const taskIds: string[] = [];

    beforeAll(async () => {
      for (const key of keys) {
        hashes[key] = randomBytes(32);
        users[key] = (
          await admin.query<{ id: string }>(
            "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, $3) RETURNING id",
            [
              randomInt(3_000_000_000_000, 4_000_000_000_000),
              `Synthetic self ${key}`,
              key !== "inactive",
            ],
          )
        ).rows[0]!.id;
      }
      scopeId = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', 'Synthetic self scope') RETURNING id",
        )
      ).rows[0]!.id;
      otherScopeId = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', 'Synthetic self other scope') RETURNING id",
        )
      ).rows[0]!.id;
      for (const key of [
        "member",
        "verifier",
        "verifier2",
        "commander",
        "plain",
        "inactive",
      ] as const)
        await admin.query(
          "INSERT INTO impuls.task_scope_members (scope_id, user_id, valid_from) VALUES ($1, $2, clock_timestamp() - interval '1 day')",
          [scopeId, users[key]],
        );
      await admin.query(
        "INSERT INTO impuls.task_scope_members (scope_id, user_id, valid_from) VALUES ($1, $2, clock_timestamp() - interval '1 day')",
        [otherScopeId, users.outsider],
      );
      const grant = (who: Who, action: string, scope: string) =>
        admin.query(
          "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fixture')",
          [users[who], scope, action],
        );
      await grant("verifier", "task.verify", scopeId);
      await grant("verifier2", "task.verify", scopeId);
      await grant("commander", "task.review", scopeId);
      await grant("outsider", "task.verify", otherScopeId);
      // The member is also a verifier for nothing; `plain` has no verify right at all.
      // Granting a binding revokes the user's sessions, so sessions are created last.
      for (const key of keys)
        await admin.query(
          "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
          [users[key], hashes[key]],
        );
      // Proposals take the latest effective synthetic rule, which parallel test files change, so
      // this file inserts one only when none is effective. The acceptance test pins its own rule.
      const effective = await admin.query(
        "SELECT 1 FROM impuls.rule_sets WHERE effective_from <= clock_timestamp()",
      );
      if (effective.rowCount === 0) {
        rulesId = randomUUID();
        await admin.query(
          "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,$3::jsonb,now(),$4)",
          [
            rulesId,
            randomInt(2_000_000_001, 2_100_000_000),
            JSON.stringify({
              mode: "synthetic",
              economy: { approved: true },
              timeZone: "Europe/Moscow",
              acceptance: { enabled: true },
            }),
            users.commander,
          ],
        );
      }
      // This file's own rule. Dated in the future, so proposals and claims elsewhere never pick it up,
      // and every task here is re-pointed at it, so other files' cleanup never meets these tasks.
      policyRule = randomUUID();
      await admin.query(
        "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,$3::jsonb,now() + interval '1 day',$4)",
        [
          policyRule,
          randomInt(1_000_000, 2_000_000_000),
          JSON.stringify({
            mode: "synthetic",
            economy: { approved: true },
            timeZone: "Europe/Moscow",
            acceptance: { enabled: true },
          }),
          users.commander,
        ],
      );
    });

    afterAll(async () => {
      try {
        const ids = Object.values(users);
        await admin.query(
          "DELETE FROM impuls.idempotency_records WHERE actor_id = ANY($1::uuid[])",
          [ids],
        );
        await admin.query(
          "DELETE FROM impuls.notification_outbox WHERE task_id = ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.ledger_entries WHERE task_id = ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.task_events WHERE task_id = ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.audit_events WHERE review_id IN (SELECT rev.id FROM impuls.reviews rev JOIN impuls.submissions sub ON sub.id = rev.submission_id WHERE sub.task_id = ANY($1::uuid[]))",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.notification_outbox WHERE review_id IN (SELECT rev.id FROM impuls.reviews rev JOIN impuls.submissions sub ON sub.id = rev.submission_id WHERE sub.task_id = ANY($1::uuid[]))",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id = ANY($1::uuid[]))",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.submissions WHERE task_id = ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.task_verifiers WHERE task_id = ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.task_assignments WHERE task_id = ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])",
          [taskIds],
        );
        await admin.query(
          "DELETE FROM impuls.role_bindings WHERE scope_id = ANY($1::uuid[])",
          [[scopeId, otherScopeId]],
        );
        await admin.query(
          "DELETE FROM impuls.task_scope_members WHERE scope_id = ANY($1::uuid[])",
          [[scopeId, otherScopeId]],
        );
        await admin.query(
          "DELETE FROM impuls.access_scopes WHERE id = ANY($1::uuid[])",
          [[scopeId, otherScopeId]],
        );
        await admin.query(
          "DELETE FROM impuls.rule_sets WHERE id = ANY($1::uuid[])",
          [[policyRule, ...(rulesId ? [rulesId] : [])]],
        );
        await admin.query(
          "DELETE FROM impuls.sessions WHERE user_id = ANY($1::uuid[])",
          [ids],
        );
        await admin.query(
          "DELETE FROM impuls.account_balances WHERE user_id = ANY($1::uuid[])",
          [ids],
        );
        await admin.query(
          "DELETE FROM impuls.users WHERE id = ANY($1::uuid[])",
          [ids],
        );
      } finally {
        await Promise.all([runtime.end(), admin.end()]);
      }
    });

    const pinRule = async (result: SelfTaskResult) => {
      // The proposal event copies the rule that was current at insert time; re-point it too,
      // or other files deleting that shared rule hit task_events_rule_set_id_fkey.
      if (result.kind === "ok") {
        await admin.query(
          "UPDATE impuls.tasks SET rule_set_id = $2 WHERE id = $1",
          [result.response.task.id, policyRule],
        );
        await admin.query(
          "UPDATE impuls.task_events SET rule_set_id = $2 WHERE task_id = $1",
          [result.response.task.id, policyRule],
        );
      }
      return result;
    };
    const base = (who: Who, over: { idempotencyKey?: string } = {}) => ({
      actorId: users[who],
      sessionHash: hashes[who],
      idempotencyKey: over.idempotencyKey ?? randomUUID(),
      enabled: true,
    });
    const propose = async (
      who: Who,
      over: Partial<{
        scopeId: string;
        requestedPoints: number;
        requestedXp: number | null;
        verifierIds: string[];
        idempotencyKey: string;
      }> = {},
    ) =>
      pinRule(
        await proposeSelfTask(runtime, {
          ...base(who, over),
          scopeId: over.scopeId ?? scopeId,
          title: "Synthetic report",
          text: "Synthetic result of the work",
          requestedPoints: over.requestedPoints ?? 30,
          requestedXp: over.requestedXp === undefined ? 10 : over.requestedXp,
          verifierIds: over.verifierIds ?? [users.verifier],
        }),
      );
    const verify = (
      who: Who,
      taskId: string,
      over: {
        expectedVersion?: number;
        decision?: "approve" | "decline";
        reason?: string;
        fundPoints?: number;
        fundXp?: number;
      } = {},
    ) =>
      verifySelfTask(runtime, {
        ...base(who),
        taskId,
        expectedVersion: over.expectedVersion ?? 1,
        ...(over.decision === "decline"
          ? {
              decision: "decline" as const,
              reason: over.reason ?? "Synthetic reason",
            }
          : {
              decision: "approve" as const,
              fundPoints: over.fundPoints ?? 25,
              fundXp: over.fundXp ?? 10,
            }),
      });
    const decide = (
      who: Who,
      taskId: string,
      over: {
        expectedVersion?: number;
        fundXp?: number;
        decision?: "forward" | "decline";
      } = {},
    ) =>
      decideSelfTask(runtime, {
        ...base(who),
        taskId,
        expectedVersion: over.expectedVersion ?? 2,
        ...(over.decision === "decline"
          ? { decision: "decline" as const, reason: "Synthetic decline" }
          : {
              decision: "forward" as const,
              fundXp: over.fundXp ?? 8,
            }),
      });
    const state = async (id: string) =>
      (
        await admin.query<{
          status: string;
          version: number;
          assignees: string[];
          fund_points: number;
          fund_xp: number;
          kinds: string[];
        }>(
          `SELECT t.status, t.version, t.fund_points, t.fund_xp,
           coalesce((SELECT array_agg(user_id::text) FROM impuls.task_assignments WHERE task_id = t.id), '{}') AS assignees,
           coalesce((SELECT array_agg(kind ORDER BY task_version) FROM impuls.task_events WHERE task_id = t.id), '{}') AS kinds
         FROM impuls.tasks t WHERE t.id = $1`,
          [id],
        )
      ).rows[0]!;
    const created = async (over = {}) => {
      const result = await propose("member", over);
      if (result.kind !== "ok")
        throw new Error(`propose failed: ${result.kind}`);
      taskIds.push(result.response.task.id);
      return result.response.task.id;
    };

    it("records a member's report as a task waiting for a verifier, with the report as its submission", async () => {
      const result = await propose("member");
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      taskIds.push(result.response.task.id);
      expect(result.status).toBe(201);
      expect(result.response.task).toMatchObject({
        status: "awaiting_verification",
        version: 1,
        requestedPoints: 30,
        requestedXp: 10,
        fundPoints: 0,
        fundXp: 0,
        author: { id: users.member },
        verifiers: [{ id: users.verifier }],
      });
      const id = result.response.task.id;
      expect(await state(id)).toMatchObject({
        status: "awaiting_verification",
        assignees: [],
        kinds: ["proposed"],
      });
      const submissions = await admin.query(
        "SELECT author_id, text FROM impuls.submissions WHERE task_id = $1",
        [id],
      );
      expect(submissions.rows).toEqual([
        { author_id: users.member, text: "Synthetic result of the work" },
      ]);
    });

    it("refuses verifiers who are the member, lack the right, or sit in another scope", async () => {
      expect(await propose("member", { verifierIds: [users.member] })).toEqual({
        kind: "verifiers_invalid",
      });
      expect(await propose("member", { verifierIds: [users.plain] })).toEqual({
        kind: "verifiers_invalid",
      });
      expect(
        await propose("member", { verifierIds: [users.outsider] }),
      ).toEqual({
        kind: "verifiers_invalid",
      });
      expect(await propose("member", { verifierIds: [] })).toEqual({
        kind: "verifiers_invalid",
      });
      expect(
        await propose("member", {
          verifierIds: [users.verifier, users.verifier2],
        }),
      ).toEqual({ kind: "verifiers_invalid" });
    });

    it("hides the scope from a non-member and refuses revoked accounts", async () => {
      expect(await propose("outsider")).toEqual({ kind: "not_found" });
      expect(await propose("inactive")).toEqual({ kind: "revoked" });
      expect(
        await proposeSelfTask(runtime, {
          ...base("member"),
          enabled: false,
          scopeId,
          title: "Off",
          text: "Off",
          requestedPoints: 1,
          requestedXp: null,
          verifierIds: [users.verifier],
        }),
      ).toEqual({ kind: "disabled" });
    });

    it("replays the same request and refuses a reused key for another request", async () => {
      const key = randomUUID();
      const first = await propose("member", { idempotencyKey: key });
      const replay = await propose("member", { idempotencyKey: key });
      expect(first.kind).toBe("ok");
      expect(replay).toEqual(first);
      if (first.kind === "ok") taskIds.push(first.response.task.id);
      expect(
        await propose("member", { idempotencyKey: key, requestedPoints: 31 }),
      ).toEqual({ kind: "idempotency_conflict" });
    });

    it("shows the member's scope and only verifiers who hold the right", async () => {
      expect(
        await readSelfTaskOptions(runtime, users.member, null, {
          enabled: true,
        }),
      ).toEqual({
        scopes: [{ id: scopeId, name: "Synthetic self scope" }],
        scopeId,
        verifiers: [
          { id: users.verifier, displayName: "Synthetic self verifier" },
          { id: users.verifier2, displayName: "Synthetic self verifier2" },
        ],
      });
      expect(
        await readSelfTaskOptions(runtime, users.outsider, null, {
          enabled: true,
        }),
      ).toMatchObject({
        scopeId: otherScopeId,
      });
    });

    it("lets only the chosen verifier approve, and approval forwards the task to the commander", async () => {
      const id = await created();
      expect(await verify("plain", id)).toEqual({ kind: "not_found" });
      expect(await verify("verifier2", id)).toEqual({ kind: "not_found" });
      expect(await verify("member", id)).toEqual({ kind: "not_found" });
      expect(await verify("verifier", id, { expectedVersion: 9 })).toEqual({
        kind: "conflict",
        currentVersion: 1,
      });
      const approved = await verify("verifier", id);
      expect(approved).toMatchObject({
        kind: "ok",
        response: { task: { status: "awaiting_commander", version: 2 } },
      });
      expect(await state(id)).toMatchObject({
        status: "awaiting_commander",
        version: 2,
        kinds: ["proposed", "verified"],
      });
    });

    it("stores the verifier's score beside the fund, which stays unchanged until forwarding", async () => {
      const id = await created();
      const scored = await verify("verifier", id, {
        fundPoints: 73,
        fundXp: 12,
      });
      expect(scored).toMatchObject({
        kind: "ok",
        response: {
          task: {
            status: "awaiting_commander",
            verifiedPoints: 73,
            verifiedXp: 12,
            fundPoints: 0,
          },
        },
      });
      expect(await state(id)).toMatchObject({
        status: "awaiting_commander",
        fund_points: 0,
      });
    });

    it("keeps points within 0-100 in the database as well", async () => {
      const id = await created();
      await verify("verifier", id, { fundPoints: 60 });
      await expect(
        admin.query(
          "UPDATE impuls.tasks SET verified_points = 101 WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow(/check/);
      await expect(
        admin.query(
          "UPDATE impuls.tasks SET requested_points = 101 WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow(/check/);
    });

    it("keeps XP within 0-100 in the database as well, the edges included", async () => {
      const id = await created();
      expect(
        await verify("verifier", id, { fundPoints: 60, fundXp: 100 }),
      ).toMatchObject({ kind: "ok" });
      for (const [column, value] of [
        ["verified_xp", 101],
        ["verified_xp", -1],
        ["requested_xp", 101],
      ] as const)
        await expect(
          admin.query(`UPDATE impuls.tasks SET ${column} = $2 WHERE id = $1`, [
            id,
            value,
          ]),
        ).rejects.toThrow(`violates check constraint "tasks_${column}_check"`);
    });

    it("refuses to forward a report that has no verifier score yet", async () => {
      const id = await created();
      await verify("verifier", id);
      await admin.query(
        "UPDATE impuls.tasks SET verified_points = NULL WHERE id = $1",
        [id],
      );
      expect(await decide("commander", id)).toEqual({ kind: "points_missing" });
    });

    it("closes a report the verifier declines, without an assignment", async () => {
      const id = await created();
      expect(
        await verify("verifier", id, {
          decision: "decline",
          reason: "Synthetic gap",
        }),
      ).toMatchObject({
        kind: "ok",
        response: { task: { status: "cancelled" } },
      });
      expect(await state(id)).toMatchObject({
        status: "cancelled",
        version: 2,
        assignees: [],
        kinds: ["proposed", "declined"],
      });
    });

    it("forwards only from awaiting_commander, to a commander who is not the member", async () => {
      const id = await created();
      expect(await decide("commander", id)).toEqual({
        kind: "conflict",
        currentVersion: 1,
      });
      await verify("verifier", id, { fundPoints: 25 });
      expect(await decide("verifier", id)).toEqual({ kind: "not_found" });
      expect(await decide("member", id)).toEqual({ kind: "not_found" });
      const forwarded = await decide("commander", id);
      expect(forwarded).toMatchObject({
        kind: "ok",
        response: {
          task: { status: "in_review", version: 3, fundPoints: 25, fundXp: 8 },
        },
      });
      expect(await state(id)).toMatchObject({
        status: "in_review",
        version: 3,
        fund_points: 25,
        fund_xp: 8,
        assignees: [users.member],
        kinds: ["proposed", "verified", "approved"],
      });
      expect(await decide("commander", id, { expectedVersion: 3 })).toEqual({
        kind: "conflict",
        currentVersion: 3,
      });
    });

    it("keeps the fund frozen until the commander forwards it", async () => {
      const id = await created();
      await expect(
        runtime.query(
          "UPDATE impuls.tasks SET fund_points = 999 WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow(/frozen/);
      await verify("verifier", id);
      await expect(
        runtime.query(
          "UPDATE impuls.tasks SET fund_points = 999 WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow(/frozen/);
    });

    it("lets the commander decline a task, which leaves no assignment", async () => {
      const id = await created();
      await verify("verifier", id);
      expect(
        await decide("commander", id, {
          decision: "decline",
          expectedVersion: 2,
        }),
      ).toMatchObject({
        kind: "ok",
        response: { task: { status: "cancelled", version: 3 } },
      });
      expect(await state(id)).toMatchObject({
        status: "cancelled",
        assignees: [],
        kinds: ["proposed", "verified", "declined"],
      });
    });

    it("does not let a commander forward a report they proposed themselves", async () => {
      // The commander proposes a report with the same verifier; they must not forward their own.
      const own = await pinRule(
        await proposeSelfTask(runtime, {
          ...base("commander"),
          scopeId,
          title: "Own",
          text: "Own result",
          requestedPoints: 5,
          requestedXp: null,
          verifierIds: [users.verifier],
        }),
      );
      expect(own.kind).toBe("ok");
      if (own.kind !== "ok") return;
      taskIds.push(own.response.task.id);
      const ownId = own.response.task.id;
      await verify("verifier", ownId);
      expect(await decide("commander", ownId, { expectedVersion: 2 })).toEqual({
        kind: "self_review",
      });
      expect(await state(ownId)).toMatchObject({
        status: "awaiting_commander",
        assignees: [],
      });
    });

    it("lists each view only to the people who act on it", async () => {
      const id = await created();
      const mine = await listSelfTasks(runtime, users.member, "mine", {
        enabled: true,
      });
      expect(mine.map((item) => item.id)).toContain(id);
      const waiting = await listSelfTasks(runtime, users.verifier, "verify", {
        enabled: true,
      });
      expect(waiting.map((item) => item.id)).toContain(id);
      expect(
        (
          await listSelfTasks(runtime, users.verifier2, "verify", {
            enabled: true,
          })
        ).map((item) => item.id),
      ).not.toContain(id);
      await verify("verifier", id);
      const decisions = await listSelfTasks(
        runtime,
        users.commander,
        "commander",
        { enabled: true },
      );
      expect(decisions.map((item) => item.id)).toContain(id);
      expect(
        (
          await listSelfTasks(runtime, users.plain, "commander", {
            enabled: true,
          })
        ).map((item) => item.id),
      ).not.toContain(id);
      expect(
        await listSelfTasks(runtime, users.member, "mine", { enabled: false }),
      ).toEqual([]);
    });

    it("hands a forwarded report into the existing acceptance with the commander's fund", async () => {
      const id = await created();
      await verify("verifier", id);
      const forwarded = await decide("commander", id, {
        expectedVersion: 2,
        fundXp: 12,
      });
      expect(forwarded.kind).toBe("ok");
      const submission = (
        await admin.query<{ id: string }>(
          "SELECT id FROM impuls.submissions WHERE task_id = $1",
          [id],
        )
      ).rows[0]!;
      const accepted = await reviewTaskSubmission(runtime, {
        actorId: users.commander,
        sessionHash: hashes.commander,
        submissionId: submission.id,
        expectedVersion: 3,
        reason: "Synthetic acceptance",
        idempotencyKey: randomUUID(),
        action: "accept",
        allowSyntheticAccrual: true,
      });
      expect(accepted).toMatchObject({
        kind: "ok",
        response: { task: { status: "accepted" } },
      });
      expect(await state(id)).toMatchObject({
        status: "accepted",
        fund_points: 25,
      });
    });
  },
);
