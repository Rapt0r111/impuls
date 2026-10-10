import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reverseAcceptance,
  listCorrectableAwards,
  type LedgerCorrectionInput,
} from "../../packages/domain/src/ledger/corrections";
import { reviewTaskSubmission } from "../../packages/domain/src/tasks/reviews";
import { readAccountLedger } from "../../packages/domain/src/ledger/read";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import {
  ledgerCorrectionResponseSchema,
  ledgerCorrectionsResponseSchema,
} from "../../packages/contracts/src/ledger-corrections";
import { accountLedgerResponseSchema } from "../../packages/contracts/src/ledger";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("F04 synthetic compensation", () => {
  const admin = new Pool({ connectionString: url }),
    runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
      max: 8,
    });
  const scope = randomUUID(),
    otherScope = randomUUID(),
    rule = randomUUID();
  const users: string[] = [],
    tasks: string[] = [];
  const actors: Array<{ id: string; token: string; hash: Buffer }> = [];
  async function user(name: string) {
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      hash = createHash("sha256").update(token).digest();
    users.push(id);
    await admin.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
      [id, randomInt(8e12, 9e12), name],
    );
    return { id, token, hash };
  }
  async function session(u: (typeof actors)[number]) {
    await admin.query("DELETE FROM impuls.sessions WHERE user_id=$1", [u.id]);
    await admin.query(
      "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [u.id, u.hash],
    );
  }
  beforeAll(async () => {
    for (const id of [scope, otherScope])
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic compensation scope')",
        [id],
      );
    for (let i = 0; i < 3; i++)
      actors.push(await user(`Synthetic correction actor ${i}`));
    for (const [i, a] of actors.entries()) {
      for (const action of i < 2
        ? ["task.review", "ledger.correct"]
        : ["task.review", "admin.access"])
        await admin.query(
          "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fixture')",
          [a.id, action, scope],
        );
      await session(a);
    }
    await admin.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,$3::jsonb,now(),$4)",
      [
        rule,
        randomInt(1e6, 2e9),
        JSON.stringify({
          mode: "synthetic",
          timeZone: "Europe/Moscow",
          acceptance: { enabled: true },
        }),
        actors[0]!.id,
      ],
    );
  });
  async function fixture(
    opts: {
      owner?: (typeof actors)[number];
      scope?: string;
      xp?: number;
      points?: number;
    } = {},
  ) {
    const owner = opts.owner ?? (await user("Synthetic correction recipient"));
    await session(owner);
    const taskId = randomUUID();
    tasks.push(taskId);
    await admin.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,$5,'Independent evidence','test','normal','in_review',now(),$6,$7)",
      [
        taskId,
        scope,
        rule,
        actors[0]!.id,
        `Synthetic compensated task ${taskId}`,
        opts.xp ?? 17,
        opts.points ?? 9,
      ],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments(task_id,user_id) VALUES($1,$2)",
      [taskId, owner.id],
    );
    const sub = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.submissions(task_id,author_id,attempt_number,text) VALUES($1,$2,1,'Synthetic evidence') RETURNING id",
        [taskId, owner.id],
      )
    ).rows[0]!.id;
    const accepted = await reviewTaskSubmission(runtime, {
      actorId: actors[0]!.id,
      sessionHash: actors[0]!.hash,
      submissionId: sub,
      expectedVersion: 1,
      reason: "Independent acceptance",
      idempotencyKey: randomUUID(),
      action: "accept",
      allowSyntheticAccrual: true,
    });
    if (accepted.kind !== "ok" || !accepted.response.award)
      throw new Error(`Acceptance ${accepted.kind}`);
    if (opts.scope)
      await admin.query("UPDATE impuls.tasks SET scope_id=$2 WHERE id=$1", [
        taskId,
        opts.scope,
      ]);
    const input: LedgerCorrectionInput = {
      actorId: actors[0]!.id,
      sessionHash: actors[0]!.hash,
      reviewId: accepted.response.review.id,
      expectedVersion: accepted.response.award.balance.version,
      reason: "Wrongly accepted synthetic evidence",
      idempotencyKey: randomUUID(),
      allowSyntheticCorrections: true,
    };
    return { owner, taskId, input };
  }
  async function counts(reviewId: string) {
    return (
      await admin.query(
        "SELECT (SELECT count(*)::int FROM impuls.ledger_corrections WHERE review_id=$1) corrections,(SELECT count(*)::int FROM impuls.ledger_entries WHERE review_id=$1) entries,(SELECT count(*)::int FROM impuls.audit_events WHERE correction_id IN(SELECT id FROM impuls.ledger_corrections WHERE review_id=$1)) audit,(SELECT count(*)::int FROM impuls.notification_outbox WHERE correction_id IN(SELECT id FROM impuls.ledger_corrections WHERE review_id=$1)) outbox",
        [reviewId],
      )
    ).rows[0];
  }
  async function reconcile(owner: string, xp: number, points: number) {
    const projection = (
      await admin.query(
        "SELECT lifetime_xp::int xp,available_points::int points,reserved_points::int reserved FROM impuls.account_balances WHERE user_id=$1",
        [owner],
      )
    ).rows[0];
    expect(projection).toEqual({ xp, points, reserved: 0 });
    const sum = (
      await admin.query(
        "SELECT sum(amount) FILTER(WHERE currency='xp')::int xp,sum(amount) FILTER(WHERE currency='points')::int points FROM impuls.ledger_entries WHERE user_id=$1",
        [owner],
      )
    ).rows[0];
    expect(sum).toEqual({ xp, points });
  }
  it("appends exact inverse entries, preserves original review/task and the original month, and replays once", async () => {
    const f = await fixture();
    // Source month is intentionally earlier than compensation: no new-month XP.
    await admin.query(
      "UPDATE impuls.ledger_entries SET season_key='2026-09' WHERE review_id=$1",
      [f.input.reviewId],
    );
    const first = await reverseAcceptance(runtime, f.input);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("Failed correction");
    const response = ledgerCorrectionResponseSchema.parse(first.response);
    expect(response.correction).toMatchObject({
      xpDelta: -17,
      pointsDelta: -9,
      reason: f.input.reason,
    });
    expect(response.balance).toMatchObject({
      lifetimeXp: 0,
      availablePoints: 0,
      reservedPoints: 0,
      version: 2,
    });
    expect(await reverseAcceptance(runtime, f.input)).toEqual(first);
    expect(await counts(f.input.reviewId)).toEqual({
      corrections: 1,
      entries: 4,
      audit: 1,
      outbox: 1,
    });
    expect(
      (
        await admin.query(
          "SELECT status,version FROM impuls.tasks WHERE id=$1",
          [f.taskId],
        )
      ).rows[0],
    ).toEqual({ status: "accepted", version: 2 });
    expect(
      (
        await admin.query(
          "SELECT decision,reason FROM impuls.reviews WHERE id=$1",
          [f.input.reviewId],
        )
      ).rows[0],
    ).toEqual({ decision: "accept", reason: "Independent acceptance" });
    expect(
      (
        await admin.query(
          "SELECT amount,season_key,original_entry_id IS NOT NULL AS linked FROM impuls.ledger_entries WHERE review_id=$1 ORDER BY amount",
          [f.input.reviewId],
        )
      ).rows,
    ).toEqual([
      { amount: -17, season_key: "2026-09", linked: true },
      { amount: -9, season_key: "2026-09", linked: true },
      { amount: 9, season_key: "2026-09", linked: false },
      { amount: 17, season_key: "2026-09", linked: false },
    ]);
    await reconcile(f.owner.id, 0, 0);
    const ledger = await readAccountLedger(runtime, f.owner.id, f.owner.hash);
    if (ledger.kind !== "ok") throw new Error("Ledger hidden");
    const data = accountLedgerResponseSchema.parse(ledger.response);
    expect(
      data.entries.filter((e) => e.kind === "acceptance_reversal"),
    ).toHaveLength(2);
    expect(
      data.entries.find((e) => e.kind === "acceptance_reversal")?.correction
        ?.actor.id,
    ).toBe(actors[0]!.id);
  });
  it("requires independent exact-scope permission and never discloses a neighbouring award", async () => {
    const f = await fixture();
    expect(
      (
        await reverseAcceptance(runtime, {
          ...f.input,
          actorId: actors[2]!.id,
          sessionHash: actors[2]!.hash,
        })
      ).kind,
    ).toBe("not_found");
    expect(
      (await listCorrectableAwards(runtime, actors[2]!.id, actors[2]!.hash))
        .kind,
    ).toBe("forbidden");
    const n = await fixture({ scope: otherScope });
    expect((await reverseAcceptance(runtime, n.input)).kind).toBe("not_found");
    const list = await listCorrectableAwards(
      runtime,
      actors[0]!.id,
      actors[0]!.hash,
      { reviewId: n.input.reviewId, allowSyntheticCorrections: true },
    );
    expect(list.kind).toBe("ok");
    if (list.kind === "ok") expect(list.response.items).toEqual([]);
  });
  it("denies self correction even with ledger.correct", async () => {
    const f = await fixture({ owner: actors[1]! });
    expect(
      (
        await reverseAcceptance(runtime, {
          ...f.input,
          actorId: actors[1]!.id,
          sessionHash: actors[1]!.hash,
        })
      ).kind,
    ).toBe("self_correction");
  });
  it("gates synthetic operation and replay; detects changed bodies and an already compensated source", async () => {
    const f = await fixture();
    expect(
      (
        await reverseAcceptance(runtime, {
          ...f.input,
          allowSyntheticCorrections: false,
        })
      ).kind,
    ).toBe("disabled");
    expect(await counts(f.input.reviewId)).toEqual({
      corrections: 0,
      entries: 2,
      audit: 0,
      outbox: 0,
    });
    expect((await reverseAcceptance(runtime, f.input)).kind).toBe("ok");
    expect(
      (
        await reverseAcceptance(runtime, {
          ...f.input,
          reason: "Changed reason",
        })
      ).kind,
    ).toBe("idempotency_conflict");
    expect(
      (
        await reverseAcceptance(runtime, {
          ...f.input,
          allowSyntheticCorrections: false,
        })
      ).kind,
    ).toBe("disabled");
    expect(
      (
        await reverseAcceptance(runtime, {
          ...f.input,
          idempotencyKey: randomUUID(),
          expectedVersion: 2,
        })
      ).kind,
    ).toBe("already_corrected");
  });
  it("rejects stale versions without leaving intents or partial corrections", async () => {
    const f = await fixture();
    expect(
      await reverseAcceptance(runtime, { ...f.input, expectedVersion: 99 }),
    ).toEqual({ kind: "conflict", currentVersion: 1 });
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM impuls.idempotency_records WHERE key=$1",
          [f.input.idempotencyKey],
        )
      ).rows[0],
    ).toEqual({ n: 0 });
    await reconcile(f.owner.id, 17, 9);
  });
  it("never creates a negative balance and never spends reserved points", async () => {
    const f = await fixture();
    await admin.query(
      "UPDATE impuls.account_balances SET available_points=2,reserved_points=7 WHERE user_id=$1",
      [f.owner.id],
    );
    expect((await reverseAcceptance(runtime, f.input)).kind).toBe(
      "insufficient_balance",
    );
    expect(await counts(f.input.reviewId)).toEqual({
      corrections: 0,
      entries: 2,
      audit: 0,
      outbox: 0,
    });
    expect(
      (
        await admin.query(
          "SELECT available_points::int available,reserved_points::int reserved,lifetime_xp::int xp FROM impuls.account_balances WHERE user_id=$1",
          [f.owner.id],
        )
      ).rows[0],
    ).toEqual({ available: 2, reserved: 7, xp: 17 });
  });
  it("serializes two correctors for one award", async () => {
    const f = await fixture();
    const results = await Promise.all([
      reverseAcceptance(runtime, f.input),
      reverseAcceptance(runtime, {
        ...f.input,
        actorId: actors[1]!.id,
        sessionHash: actors[1]!.hash,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual([
      "already_corrected",
      "ok",
    ]);
    await reconcile(f.owner.id, 0, 0);
  });
  it("serializes two different compensations to the same recipient using balance versions", async () => {
    const f = await fixture();
    const g = await fixture({ owner: f.owner, xp: 31, points: 12 });
    const results = await Promise.all([
      reverseAcceptance(runtime, { ...f.input, expectedVersion: 2 }),
      reverseAcceptance(runtime, g.input),
    ]);
    expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "conflict")).toHaveLength(1);
    const remaining = results[0]!.kind === "ok" ? g.input : f.input;
    expect(
      (
        await reverseAcceptance(runtime, {
          ...remaining,
          expectedVersion: 3,
          idempotencyKey: randomUUID(),
        })
      ).kind,
    ).toBe("ok");
    await reconcile(f.owner.id, 0, 0);
  });
  it("serializes a new acceptance with compensation for the same account", async () => {
    const f = await fixture();
    const blocker = await admin.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT 1 FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
      [f.owner.id],
    );
    try {
      const correction = reverseAcceptance(runtime, f.input);
      const acceptance = fixture({ owner: f.owner, xp: 31, points: 12 });
      await admin.query("SELECT pg_sleep(0.2)");
      await blocker.query("COMMIT");
      const [reversed] = await Promise.all([correction, acceptance]);
      if (reversed.kind === "conflict")
        expect(
          (
            await reverseAcceptance(runtime, {
              ...f.input,
              expectedVersion: 2,
              idempotencyKey: randomUUID(),
            })
          ).kind,
        ).toBe("ok");
      else expect(reversed.kind).toBe("ok");
      await reconcile(f.owner.id, 31, 12);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("handles zero awards without manufacturing XP or points", async () => {
    const f = await fixture({ xp: 0, points: 0 });
    expect((await reverseAcceptance(runtime, f.input)).kind).toBe("ok");
    await reconcile(f.owner.id, 0, 0);
  });
  it("rolls back correction, entries, balance, audit, outbox and intent on a late failure", async () => {
    const f = await fixture(),
      constraint = `f04_failure_${randomUUID().replaceAll("-", "")}`;
    await admin.query(
      `ALTER TABLE impuls.notification_outbox ADD CONSTRAINT ${constraint} CHECK(correction_id IS NULL OR recipient_id<>'${f.owner.id}'::uuid) NOT VALID`,
    );
    try {
      await expect(reverseAcceptance(runtime, f.input)).rejects.toMatchObject({
        code: "23514",
      });
    } finally {
      await admin.query(
        `ALTER TABLE impuls.notification_outbox DROP CONSTRAINT ${constraint}`,
      );
    }
    expect(await counts(f.input.reviewId)).toEqual({
      corrections: 0,
      entries: 2,
      audit: 0,
      outbox: 0,
    });
    await reconcile(f.owner.id, 17, 9);
    expect((await reverseAcceptance(runtime, f.input)).kind).toBe("ok");
  });
  it("protects all history from runtime updates/deletes and rejects fabricated inverse rows", async () => {
    const f = await fixture();
    const result = await reverseAcceptance(runtime, f.input);
    if (result.kind !== "ok") throw new Error("Failed correction");
    for (const table of [
      "ledger_corrections",
      "ledger_entries",
      "audit_events",
      "notification_outbox",
    ])
      for (const verb of ["UPDATE", "DELETE"]) {
        const sql =
          verb === "UPDATE"
            ? `UPDATE impuls.${table} SET version=version+1 WHERE false`
            : `DELETE FROM impuls.${table} WHERE false`;
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      }
    // Unique source linkage prevents a second inverse even under a new decision.
    const g = await fixture();
    const c = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.ledger_corrections(review_id,user_id,actor_id,reason,xp_delta,points_delta,mode,created_at,updated_at) VALUES($1,$2,$3,'Synthetic invalid row',-17,-9,'synthetic',now(),now()) RETURNING id",
        [g.input.reviewId, g.owner.id, actors[0]!.id],
      )
    ).rows[0]!.id;
    const sql =
      "INSERT INTO impuls.ledger_entries(user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,kind,amount,mode,season_key,time_zone,correction_id,original_entry_id,created_at,updated_at) SELECT user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,'acceptance_reversal',-16,mode,season_key,time_zone,$2,id,now(),now() FROM impuls.ledger_entries WHERE review_id=$1 AND currency='xp' AND kind='task_acceptance'";
    await expect(
      runtime.query(sql, [g.input.reviewId, c]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("checks permission expiry after waiting for the balance lock", async () => {
    const f = await fixture();
    const a = await user("Synthetic expiring corrector");
    await admin.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason,valid_until) VALUES($1,'ledger.correct',$2,$3,'Expires during wait',clock_timestamp()+interval '1 second')",
      [a.id, scope, actors[0]!.id],
    );
    await session(a);
    const blocker = await admin.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT 1 FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
      [f.owner.id],
    );
    try {
      const operation = reverseAcceptance(runtime, {
        ...f.input,
        actorId: a.id,
        sessionHash: a.hash,
      });
      await admin.query("SELECT pg_sleep(1.2)");
      await blocker.query("COMMIT");
      expect((await operation).kind).toBe("not_found");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await reconcile(f.owner.id, 17, 9);
  });
  it("checks session expiry after waiting for the balance lock", async () => {
    const f = await fixture();
    const a = await user("Synthetic expiring correction session");
    await admin.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'ledger.correct',$2,$3,'Synthetic temporary session')",
      [a.id, scope, actors[0]!.id],
    );
    await session(a);
    const blocker = await admin.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT 1 FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
      [f.owner.id],
    );
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
      [a.id],
    );
    try {
      const operation = reverseAcceptance(runtime, {
        ...f.input,
        actorId: a.id,
        sessionHash: a.hash,
      });
      await admin.query("SELECT pg_sleep(1.2)");
      await blocker.query("COMMIT");
      expect((await operation).kind).toBe("unauthorized");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await reconcile(f.owner.id, 17, 9);
  });
  it("checks revoked correction permission before replay even with a fresh valid session", async () => {
    const f = await fixture();
    const a = await user("Synthetic revoked corrector");
    await admin.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'ledger.correct',$2,$3,'Synthetic revoked permission')",
      [a.id, scope, actors[0]!.id],
    );
    await session(a);
    const input = { ...f.input, actorId: a.id, sessionHash: a.hash };
    expect((await reverseAcceptance(runtime, input)).kind).toBe("ok");
    await admin.query(
      "UPDATE impuls.role_bindings SET revoked_at=now() WHERE user_id=$1",
      [a.id],
    );
    await session(a);
    expect((await reverseAcceptance(runtime, input)).kind).toBe("not_found");
  });
  it("rejects source rules that are no longer explicitly synthetic", async () => {
    const f = await fixture();
    const old = (
      await admin.query<{ definition: unknown }>(
        "SELECT definition FROM impuls.rule_sets WHERE id=$1",
        [rule],
      )
    ).rows[0]!.definition;
    await admin.query(
      "UPDATE impuls.rule_sets SET definition='{}' WHERE id=$1",
      [rule],
    );
    try {
      expect((await reverseAcceptance(runtime, f.input)).kind).toBe(
        "rules_invalid",
      );
      expect(await counts(f.input.reviewId)).toEqual({
        corrections: 0,
        entries: 2,
        audit: 0,
        outbox: 0,
      });
    } finally {
      await admin.query(
        "UPDATE impuls.rule_sets SET definition=$2::jsonb WHERE id=$1",
        [rule, JSON.stringify(old)],
      );
    }
  });
  it("checks revocation before replay and rejects inactive recipients", async () => {
    const f = await fixture();
    expect((await reverseAcceptance(runtime, f.input)).kind).toBe("ok");
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=now() WHERE user_id=$1",
      [actors[0]!.id],
    );
    expect((await reverseAcceptance(runtime, f.input)).kind).toBe(
      "unauthorized",
    );
    await session(actors[0]!);
    const g = await fixture();
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      g.owner.id,
    ]);
    expect((await reverseAcceptance(runtime, g.input)).kind).toBe(
      "recipient_revoked",
    );
  });
  it("reads a scoped paginated snapshot and exposes a correction without granting report history", async () => {
    const f = await fixture();
    const list = await listCorrectableAwards(
      runtime,
      actors[0]!.id,
      actors[0]!.hash,
      { reviewId: f.input.reviewId, allowSyntheticCorrections: true },
    );
    if (list.kind !== "ok") throw new Error("List unavailable");
    const data = ledgerCorrectionsResponseSchema.parse(list.response);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      xp: 17,
      points: 9,
      enabled: true,
      correction: null,
    });
    const page = await listCorrectableAwards(
      runtime,
      actors[0]!.id,
      actors[0]!.hash,
      { limit: 1 },
    );
    if (page.kind !== "ok") throw new Error("List unavailable");
    expect(page.response.nextCursor).not.toBeNull();
    const [at, id] = page.response.nextCursor!.split("|");
    const next = await listCorrectableAwards(
      runtime,
      actors[0]!.id,
      actors[0]!.hash,
      { limit: 1, cursor: { at: at!, id: id! } },
    );
    if (next.kind !== "ok") throw new Error("List unavailable");
    expect(next.response.items[0]!.reviewId).not.toBe(
      page.response.items[0]!.reviewId,
    );
  });
  it("serves real HTTP guards/replay and browser → API → PostgreSQL correction", async () => {
    const origin = process.env.TEST_APP_ORIGIN;
    if (!origin) throw new Error("Run bun run test:task-slice");
    const f = await fixture();
    const a = actors[0]!;
    const csrf = createCsrfToken(a.token, process.env.CSRF_SECRET!);
    const headers = {
      Cookie: `impuls_session=${a.token}`,
      Origin: origin,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      "Idempotency-Key": f.input.idempotencyKey,
    };
    const body = {
      reviewId: f.input.reviewId,
      expectedVersion: 1,
      reason: f.input.reason,
    };
    const post = (h: Record<string, string>, b: unknown = body) =>
      fetch(`${origin}/api/v1/admin/ledger-corrections`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(b),
      });
    expect(
      (await post({ ...headers, Origin: "https://untrusted.invalid" })).status,
    ).toBe(403);
    expect((await post({ ...headers, "X-CSRF-Token": "invalid" })).status).toBe(
      403,
    );
    expect(
      (await post({ ...headers, "Idempotency-Key": "invalid" })).status,
    ).toBe(400);
    expect((await post(headers, { ...body, xp: 1 })).status).toBe(400);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page
        .context()
        .addCookies([{ name: "impuls_session", value: a.token, url: origin }]);
      await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){}}}",
        }),
      );
      await page.goto(origin);
      await page.getByRole("button", { name: "Ещё", exact: true }).click();
      await page
        .getByRole("button", { name: "Баланс и журнал", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Исправление начислений", exact: true })
        .click();
      const row = page.locator(".ledger-entry").filter({
        has: page.getByText(`Synthetic compensated task ${f.taskId}`, {
          exact: true,
        }),
      });
      await row
        .getByRole("button", { name: "Вернуть начисление", exact: true })
        .click();
      await page
        .getByLabel("Основание возврата", { exact: true })
        .fill("Synthetic browser correction");
      await page
        .getByLabel("Подтверждаю получателя, обе суммы и новый баланс")
        .check();
      await page
        .getByRole("button", {
          name: "Записать возврат начисления",
          exact: true,
        })
        .click();
      await page.getByText(/Возврат записан: -17 XP/).waitFor();
      await reconcile(f.owner.id, 0, 0);
      expect(await counts(f.input.reviewId)).toEqual({
        corrections: 1,
        entries: 4,
        audit: 1,
        outbox: 1,
      });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
    const g = await fixture();
    const h = { ...headers, "Idempotency-Key": g.input.idempotencyKey };
    const gb = {
      reviewId: g.input.reviewId,
      expectedVersion: 1,
      reason: g.input.reason,
    };
    const first = await post(h, gb);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("no-store");
    const result = await first.json();
    expect(await (await post(h, gb)).json()).toEqual(result);
    expect((await post(h, { ...gb, reason: "Different" })).status).toBe(409);
    await admin.query(
      "INSERT INTO impuls.task_mutation_limits(actor_id,expires_at,attempts) VALUES($1,clock_timestamp()+interval '60 seconds',30) ON CONFLICT(actor_id) DO UPDATE SET expires_at=clock_timestamp()+interval '60 seconds',attempts=30",
      [a.id],
    );
    const limited = await post(h, gb);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  }, 30000);
  afterAll(async () => {
    try {
      for (const table of ["notification_outbox", "audit_events"])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE correction_id IN(SELECT id FROM impuls.ledger_corrections WHERE user_id=ANY($1::uuid[])) OR review_id IN(SELECT id FROM impuls.reviews WHERE submission_id IN(SELECT id FROM impuls.submissions WHERE task_id=ANY($2::uuid[])))`,
          [users, tasks],
        );
      await admin.query(
        "DELETE FROM impuls.ledger_entries WHERE task_id=ANY($1::uuid[]) AND kind='acceptance_reversal'",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.ledger_corrections WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.ledger_entries WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.account_balances WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.task_events WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.reviews WHERE submission_id IN(SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[]))",
        [tasks],
      );
      for (const table of ["submissions", "task_assignments"])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE task_id=ANY($1::uuid[])`,
          [tasks],
        );
      await admin.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
        tasks,
      ]);
      for (const table of ["idempotency_records", "task_mutation_limits"])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE actor_id=ANY($1::uuid[])`,
          [users],
        );
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rule]);
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [[scope, otherScope]],
      );
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await runtime.end();
      await admin.end();
    }
  });
});
