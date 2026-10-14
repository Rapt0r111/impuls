import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { readParticipantProfile } from "../../packages/domain/src/profile/read";
import { reviewTaskSubmission } from "../../packages/domain/src/tasks/reviews";
import { reverseAcceptance } from "../../packages/domain/src/ledger/corrections";
import { participantProfileResponseSchema } from "../../packages/contracts/src/profile";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)("F05 private synthetic profile", () => {
  const admin = new Pool({ connectionString: url }),
    runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
      max: 6,
    });
  const users = Array.from({ length: 5 }, () => randomUUID());
  const reviewer = users[0]!,
    owner = users[1]!,
    concurrent = users[2]!,
    zero = users[3]!,
    rollback = users[4]!;
  const tokens = users.map(() => randomBytes(32).toString("base64url")),
    hashes = tokens.map((t) => createHash("sha256").update(t).digest());
  const scope = randomUUID(),
    rule = randomUUID();
  const tasks: string[] = [];
  const read = (i = 1, allow = true) =>
    readParticipantProfile(runtime, users[i]!, hashes[i]!, {
      allowSyntheticProfile: allow,
    });
  const rules = (progression: unknown) =>
    admin.query(
      "UPDATE impuls.rule_sets SET definition=$2::jsonb WHERE id=$1",
      [
        rule,
        JSON.stringify({
          mode: "synthetic",
          timeZone: "Europe/Moscow",
          acceptance: { enabled: true },
          ...(progression === undefined ? {} : { progression }),
        }),
      ],
    );
  beforeAll(async () => {
    for (const [i, user] of users.entries())
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
        [user, randomInt(7e12, 8e12), `Synthetic profile ${i}`],
      );
    await admin.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic profile scope')",
      [scope],
    );
    for (const action of ["task.review", "ledger.correct"])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic profile verification')",
        [reviewer, action, scope],
      );
    await admin.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,'{}',now(),$3)",
      [rule, randomInt(1e6, 2e9), reviewer],
    );
    await rules({ levelThresholds: [0, 100, 250] });
    for (const [i, user] of users.entries())
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [user, hashes[i]],
      );
  });
  async function fixture(user = owner, xp = 125, points = 400) {
    const task = randomUUID();
    tasks.push(task);
    await admin.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,'Synthetic first result','Independent criteria','test','normal','in_review',now(),$5,$6)",
      [task, scope, rule, reviewer, xp, points],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments(task_id,user_id) VALUES($1,$2)",
      [task, user],
    );
    const sub = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.submissions(task_id,author_id,attempt_number,text) VALUES($1,$2,1,'Synthetic profile report') RETURNING id",
        [task, user],
      )
    ).rows[0]!.id;
    return {
      task,
      request: {
        actorId: reviewer,
        sessionHash: hashes[0]!,
        submissionId: sub,
        expectedVersion: 1,
        reason: "Synthetic profile evidence accepted",
        idempotencyKey: randomUUID(),
        action: "accept" as const,
        allowSyntheticAccrual: true,
      },
    };
  }
  let firstReview = "",
    firstSource = "";
  it("returns private zero balances with no invented achievement", async () => {
    const result = await read();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(
      participantProfileResponseSchema.parse(result.response),
    ).toMatchObject({
      user: { id: owner },
      balance: { lifetimeXp: 0, availablePoints: 0 },
      firstResult: null,
      progression: {
        state: "configured",
        level: { level: 1, remainingXp: 100 },
      },
    });
  });
  it("issues exactly one first-result with acceptance and replay, without extra currency", async () => {
    const f = await fixture(),
      r = await reviewTaskSubmission(runtime, f.request);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") throw new Error(r.kind);
    firstReview = r.response.review.id;
    expect(await reviewTaskSubmission(runtime, f.request)).toEqual(r);
    const p = await read();
    if (p.kind !== "ok") throw new Error(p.kind);
    expect(participantProfileResponseSchema.parse(p.response)).toMatchObject({
      balance: { lifetimeXp: 125, availablePoints: 400 },
      progression: {
        state: "configured",
        level: { level: 2, remainingXp: 125 },
      },
      firstResult: {
        reviewId: firstReview,
        sourceCorrected: false,
        provenance: "acceptance",
        task: { id: f.task },
      },
    });
    firstSource = p.response.firstResult!.sourceEntryId;
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.user_achievements WHERE user_id=$1",
          [owner],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.ledger_entries WHERE review_id=$1",
          [firstReview],
        )
      ).rowCount,
    ).toBe(2);
  });
  it("serializes different tasks for one recipient and keeps one source", async () => {
    const a = await fixture(concurrent, 100, 10),
      b = await fixture(concurrent, 150, 20);
    const results = await Promise.all([
      reviewTaskSubmission(runtime, a.request),
      reviewTaskSubmission(runtime, b.request),
    ]);
    expect(results.map((r) => r.kind)).toEqual(["ok", "ok"]);
    const p = await read(2);
    if (p.kind !== "ok") throw new Error(p.kind);
    expect(p.response.balance).toMatchObject({
      lifetimeXp: 250,
      availablePoints: 30,
      version: 2,
    });
    // Past the last configured threshold (250) the next level costs the last span (150).
    expect(p.response.progression.level).toMatchObject({
      level: 3,
      nextLevelXp: 400,
      remainingXp: 150,
    });
    expect([a.task, b.task]).toContain(p.response.firstResult!.task.id);
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.user_achievements WHERE user_id=$1",
          [concurrent],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("zero fund is still a confirmed result", async () => {
    const f = await fixture(zero, 0, 0);
    expect((await reviewTaskSubmission(runtime, f.request)).kind).toBe("ok");
    const p = await read(3);
    if (p.kind !== "ok") throw new Error(p.kind);
    expect(p.response.balance.lifetimeXp).toBe(0);
    expect(p.response.firstResult!.task.id).toBe(f.task);
  });
  it("rejects counterfeit source, migration issuance, mutation and deletion under runtime", async () => {
    const source = (
      await admin.query<{ id: string; created_at: Date }>(
        "SELECT id,created_at FROM impuls.ledger_entries WHERE review_id=$1 AND currency='points'",
        [firstReview],
      )
    ).rows[0]!;
    await expect(
      runtime.query(
        "INSERT INTO impuls.user_achievements(user_id,code,condition_version,source_entry_id,granted_at,provenance) VALUES($1,'first_result',1,$2,$3,'acceptance')",
        [rollback, source.id, source.created_at],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.query(
        "INSERT INTO impuls.user_achievements(user_id,code,condition_version,source_entry_id,granted_at,provenance) SELECT user_id,code,condition_version,source_entry_id,granted_at,'migration' FROM impuls.user_achievements WHERE user_id=$1",
        [owner],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query(
        "UPDATE impuls.user_achievements SET condition_version=1 WHERE user_id=$1",
        [owner],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("DELETE FROM impuls.user_achievements WHERE user_id=$1", [
        owner,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("rolls back issuance, review and currencies when the subsequent audit fails", async () => {
    const f = await fixture(rollback);
    const name = `profile_failure_${randomUUID().replaceAll("-", "")}`;
    await admin.query(
      `CREATE FUNCTION impuls.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='${reviewer}'::uuid THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON impuls.audit_events FOR EACH ROW EXECUTE FUNCTION impuls.${name}()`,
    );
    try {
      await expect(reviewTaskSubmission(runtime, f.request)).rejects.toThrow(
        "Synthetic audit failure",
      );
    } finally {
      await admin.query(
        `DROP TRIGGER ${name} ON impuls.audit_events; DROP FUNCTION impuls.${name}()`,
      );
    }
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.user_achievements WHERE user_id=$1",
          [rollback],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.ledger_entries WHERE task_id=$1",
          [f.task],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await admin.query(
          "SELECT 1 FROM impuls.reviews WHERE submission_id=$1",
          [f.request.submissionId],
        )
      ).rowCount,
    ).toBe(0);
    expect((await reviewTaskSubmission(runtime, f.request)).kind).toBe("ok");
  });
  it("recalculates level after a reversal while preserving historical issuance", async () => {
    const correction = await reverseAcceptance(runtime, {
      actorId: reviewer,
      sessionHash: hashes[0]!,
      reviewId: firstReview,
      expectedVersion: 1,
      reason: "Synthetic original award reversal",
      idempotencyKey: randomUUID(),
      allowSyntheticCorrections: true,
    });
    expect(correction.kind).toBe("ok");
    const p = await read();
    if (p.kind !== "ok") throw new Error(p.kind);
    expect(p.response).toMatchObject({
      balance: { lifetimeXp: 0, availablePoints: 0 },
      progression: { level: { level: 1, remainingXp: 100 } },
      firstResult: { sourceEntryId: firstSource, sourceCorrected: true },
    });
    const f = await fixture();
    expect((await reviewTaskSubmission(runtime, f.request)).kind).toBe("ok");
    const later = await read();
    if (later.kind !== "ok") throw new Error(later.kind);
    expect(later.response.firstResult!.sourceEntryId).toBe(firstSource);
  });
  it("does not guess or reuse older thresholds when config is missing or invalid", async () => {
    await rules(undefined);
    let r = await read();
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.response.progression).toEqual({
      state: "unconfigured",
      ruleVersion: null,
      level: null,
    });
    await rules({ levelThresholds: [0, 100, 100] });
    const older = randomUUID();
    await admin.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,$3::jsonb,now()-interval '1 day',$4)",
      [
        older,
        randomInt(1e6, 2e9),
        JSON.stringify({
          mode: "synthetic",
          progression: { levelThresholds: [0, 1] },
        }),
        reviewer,
      ],
    );
    try {
      r = await read();
      if (r.kind !== "ok") throw new Error(r.kind);
      expect(r.response.progression).toMatchObject({
        state: "invalid",
        level: null,
      });
    } finally {
      await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [older]);
    }
    await rules({ levelThresholds: [0, 100, 250] });
    const future = randomUUID();
    await admin.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,$3::jsonb,now()+interval '1 day',$4)",
      [
        future,
        randomInt(1e6, 2e9),
        JSON.stringify({
          mode: "synthetic",
          progression: { levelThresholds: [0, 1] },
        }),
        reviewer,
      ],
    );
    try {
      const p = await read();
      if (p.kind !== "ok") throw new Error(p.kind);
      expect(p.response.progression.level!.level).toBe(2);
    } finally {
      await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [future]);
    }
  });
  it("rechecks session and access before the disabled flag", async () => {
    expect((await read(1, false)).kind).toBe("disabled");
    expect(
      (
        await readParticipantProfile(runtime, owner, hashes[0]!, {
          allowSyntheticProfile: true,
        })
      ).kind,
    ).toBe("unauthorized");
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [owner],
    );
    expect((await read()).kind).toBe("unauthorized");
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()+interval '1 hour' WHERE user_id=$1",
      [owner],
    );
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      owner,
    ]);
    expect((await read(1, false)).kind).toBe("revoked");
    await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
      owner,
    ]);
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [owner],
    );
  });
  it.runIf(Boolean(origin))(
    "HTTP contract, parameter rejection and Chromium→API→PostgreSQL",
    async () => {
      const headers = { cookie: `impuls_session=${tokens[1]}` };
      expect((await fetch(`${origin}/api/v1/me/profile`)).status).toBe(401);
      for (const query of [
        `?userId=${concurrent}`,
        "?limit=1",
        "?scope=x&scope=x",
      ])
        expect(
          (await fetch(`${origin}/api/v1/me/profile${query}`, { headers }))
            .status,
        ).toBe(400);
      const response = await fetch(`${origin}/api/v1/me/profile`, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = participantProfileResponseSchema.parse(
        await response.json(),
      );
      expect(body.user.id).toBe(owner);
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 850 },
          reducedMotion: "reduce",
        });
        await context.addCookies([
          {
            name: "impuls_session",
            value: tokens[1]!,
            url: origin!,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
          r.fulfill({
            contentType: "application/javascript",
            body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
          }),
        );
        await page.goto(origin!);
        await page.getByRole("button", { name: "Ещё", exact: true }).click();
        await page
          .getByRole("button", { name: "Мой профиль", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Первый результат", exact: true })
          .waitFor();
        expect(
          await page.locator(".participant-profile").innerText(),
        ).toContain("Уровень 2");
        expect(
          await page.locator(".participant-profile").innerText(),
        ).toContain("Исходное начисление возвращено");
      } finally {
        await browser.close();
      }
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=now() WHERE user_id=$1",
        [owner],
      );
      expect(
        (await fetch(`${origin}/api/v1/me/profile`, { headers })).status,
      ).toBe(403);
    },
    20000,
  );
  afterAll(async () => {
    await admin.query("DELETE FROM impuls.audit_events WHERE actor_id=$1", [
      reviewer,
    ]);
    await admin.query(
      "DELETE FROM impuls.notification_outbox WHERE recipient_id=ANY($1::uuid[])",
      [users],
    );
    await admin.query(
      "DELETE FROM impuls.ledger_entries WHERE user_id=ANY($1::uuid[])",
      [users],
    );
    await admin.query(
      "DELETE FROM impuls.ledger_corrections WHERE user_id=ANY($1::uuid[])",
      [users],
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
      "DELETE FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[]))",
      [tasks],
    );
    await admin.query(
      "DELETE FROM impuls.submissions WHERE task_id=ANY($1::uuid[])",
      [tasks],
    );
    await admin.query(
      "DELETE FROM impuls.task_assignments WHERE task_id=ANY($1::uuid[])",
      [tasks],
    );
    await admin.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
      tasks,
    ]);
    await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rule]);
    await admin.query(
      "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
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
    await admin.query("DELETE FROM impuls.access_scopes WHERE id=$1", [scope]);
    await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
      users,
    ]);
    await runtime.end();
    await admin.end();
  });
});
