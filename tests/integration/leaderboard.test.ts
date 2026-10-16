import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLeaderboard } from "../../packages/domain/src/ranking/read";
import { reviewTaskSubmission } from "../../packages/domain/src/tasks/reviews";
import { reverseAcceptance } from "../../packages/domain/src/ledger/corrections";
import {
  leaderboardQuerySchema,
  leaderboardResponseSchema,
} from "../../packages/contracts/src/leaderboard";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)("F05 synthetic monthly ranking", () => {
  const admin = new Pool({ connectionString: url });
  const runtime = new Pool({
    connectionString: url,
    options: "-c role=impuls_app",
  });
  const scope = randomUUID(),
    otherScope = randomUUID(),
    rule = randomUUID();
  const users = Array.from({ length: 7 }, () => randomUUID()).sort();
  const tokens = users.map(() => randomBytes(32).toString("base64url"));
  const hashes = tokens.map((t) => createHash("sha256").update(t).digest());
  const reviewer = users[6]!;
  const tasks: string[] = [];
  const awards: Array<{ reviewId: string; owner: string }> = [];
  const read = (extra = {}, actor = 0) =>
    readLeaderboard(runtime, users[actor]!, hashes[actor]!, {
      allowSyntheticRanking: true,
      scope,
      season: "2026-09",
      ...extra,
    });
  async function award(
    owner: string,
    xp: number,
    awardScope = scope,
    season = "2026-09",
    zone = "Europe/Moscow",
  ) {
    const task = randomUUID();
    tasks.push(task);
    await admin.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,'Synthetic ranking evidence','Independent evidence','test','normal','in_review',now(),$5,500)",
      [task, awardScope, rule, reviewer, xp],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments(task_id,user_id) VALUES($1,$2)",
      [task, owner],
    );
    const submission = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.submissions(task_id,author_id,attempt_number,text) VALUES($1,$2,1,'Synthetic ranking report') RETURNING id",
        [task, owner],
      )
    ).rows[0]!.id;
    const result = await reviewTaskSubmission(runtime, {
      actorId: reviewer,
      sessionHash: hashes[6]!,
      submissionId: submission,
      expectedVersion: 1,
      reason: "Independent evidence accepted",
      idempotencyKey: randomUUID(),
      action: "accept",
      allowSyntheticAccrual: true,
    });
    if (result.kind !== "ok" || !result.response.award)
      throw new Error(`Acceptance ${result.kind}`);
    const reviewId = result.response.review.id;
    awards.push({ reviewId, owner });
    // Isolated fixture owner controls source months; runtime cannot update ledger.
    await admin.query(
      "UPDATE impuls.ledger_entries SET season_key=$2,time_zone=$3 WHERE review_id=$1",
      [reviewId, season, zone],
    );
    return reviewId;
  }
  beforeAll(async () => {
    for (const s of [scope, otherScope])
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic ranking scope')",
        [s],
      );
    for (const [i, user] of users.entries()) {
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
        [user, randomInt(6e12, 7e12), `Synthetic ranked alias ${i}`],
      );
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [user, hashes[i]],
      );
      if (i < 6)
        await admin.query(
          "INSERT INTO impuls.task_scope_members(scope_id,user_id) VALUES($1,$2)",
          [scope, user],
        );
    }
    for (const s of [scope, otherScope])
      for (const action of [
        "task.review",
        "ledger.correct",
        "task.view",
        "admin.access",
      ])
        await admin.query(
          "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic ranking fixture')",
          [reviewer, action, s],
        );
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
        reviewer,
      ],
    );
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [reviewer],
    );
    for (const [i, xp] of [100, 60, 60, 20, 0, 1000].entries())
      await award(users[i]!, xp);
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      users[5],
    ]);
    await award(users[0]!, 700, otherScope);
    await award(users[0]!, 900, scope, "2026-10");
    await award(users[0]!, 800, scope, "2026-09", "UTC");
  });
  it("calculates 1,2,2,4 and UUID order while excluding points/other scope/month/zone/inactive users", async () => {
    const r = await read();
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") throw new Error(r.kind);
    const data = leaderboardResponseSchema.parse(r.response);
    expect(data.items.map((v) => [v.id, v.xp, v.rank])).toEqual([
      [users[0], 100, 1],
      [users[1], 60, 2],
      [users[2], 60, 2],
      [users[3], 20, 4],
    ]);
    expect(data.self).toEqual({ xp: 100, rank: 1 });
    const oct = await read({ season: "2026-10" });
    expect(oct.kind === "ok" && oct.response.items.map((v) => v.xp)).toEqual([
      900,
    ]);
  });
  it("keeps zero XP private and empty months explicit", async () => {
    const r = await read({}, 4);
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.response.self).toEqual({ xp: 0, rank: null });
    expect(r.response.items.some((v) => v.id === users[4])).toBe(false);
    const empty = await read({ season: "2025-01" });
    if (empty.kind !== "ok") throw new Error(empty.kind);
    expect(empty.response.items).toEqual([]);
    expect(empty.response.nextCursor).toBeNull();
  });
  it("rechecks exact synthetic membership; administrative/task permissions do not substitute", async () => {
    expect((await read({ scope: otherScope })).kind).toBe("not_found");
    const adminView = await read({ scope: undefined }, 6);
    if (adminView.kind !== "ok") throw new Error(adminView.kind);
    expect(adminView.response).toMatchObject({
      scopes: [],
      scope: null,
      self: null,
      items: [],
    });
    for (const change of [
      "revoked_at=now()",
      "valid_until=now()-interval '1 minute'",
      "valid_from=now()+interval '1 day'",
    ]) {
      await admin.query(
        `UPDATE impuls.task_scope_members SET ${change} WHERE scope_id=$1 AND user_id=$2`,
        [scope, users[3]],
      );
      try {
        expect((await read({}, 3)).kind).toBe("not_found");
        const r = await read();
        if (r.kind !== "ok") throw new Error(r.kind);
        expect(r.response.items).toHaveLength(3);
      } finally {
        await admin.query(
          "UPDATE impuls.task_scope_members SET revoked_at=NULL,valid_until=NULL,valid_from=now()-interval '1 day' WHERE scope_id=$1 AND user_id=$2",
          [scope, users[3]],
        );
      }
    }
  });
  it("checks disabled mode, inactive user and revoked/expired/wrong session", async () => {
    expect((await read({ allowSyntheticRanking: false })).kind).toBe(
      "disabled",
    );
    expect((await read({}, 5)).kind).toBe("revoked");
    expect(
      (
        await readLeaderboard(runtime, users[0]!, hashes[1]!, {
          allowSyntheticRanking: true,
        })
      ).kind,
    ).toBe("unauthorized");
    for (const set of [
      "revoked_at=now()",
      "expires_at=now()-interval '1 second'",
    ]) {
      await admin.query(`UPDATE impuls.sessions SET ${set} WHERE user_id=$1`, [
        users[0],
      ]);
      try {
        expect((await read()).kind).toBe("unauthorized");
      } finally {
        await admin.query(
          "UPDATE impuls.sessions SET revoked_at=NULL,expires_at=now()+interval '1 hour' WHERE user_id=$1",
          [users[0]],
        );
      }
    }
  });
  it("pages ties once and binds cursor to revision/scope/month", async () => {
    const first = await read({ limit: 2 });
    if (first.kind !== "ok") throw new Error(first.kind);
    const cursor = leaderboardQuerySchema.parse({
      cursor: first.response.nextCursor,
    }).cursor!;
    const second = await read({ limit: 2, cursor });
    if (second.kind !== "ok") throw new Error(second.kind);
    expect(second.response.items.map((v) => [v.xp, v.rank])).toEqual([
      [60, 2],
      [20, 4],
    ]);
    expect(second.response.nextCursor).toBeNull();
    expect(
      (await read({ cursor: { ...cursor, season: "2026-10" } })).kind,
    ).toBe("not_found");
    expect(
      (await read({ cursor: { ...cursor, scope: otherScope } })).kind,
    ).toBe("not_found");
    await admin.query(
      "UPDATE impuls.users SET display_name='Synthetic changed alias' WHERE id=$1",
      [users[2]],
    );
    try {
      expect((await read({ cursor })).kind).toBe("changed");
    } finally {
      await admin.query(
        "UPDATE impuls.users SET display_name='Synthetic ranked alias 2' WHERE id=$1",
        [users[2]],
      );
    }
    expect((await read({ cursor: { ...cursor, id: randomUUID() } })).kind).toBe(
      "changed",
    );
  });
  it("uses current Moscow month from database time", async () => {
    const expected = (
      await admin.query<{ month: string }>(
        "SELECT to_char(now() AT TIME ZONE 'Europe/Moscow','YYYY-MM') AS \"month\"",
      )
    ).rows[0]!.month;
    const r = await read({ season: undefined });
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.response.season).toBe(expected);
  });
  (origin ? it : it.skip)(
    "validates real HTTP contract/auth/no-store and Chromium reads PostgreSQL data",
    async () => {
      const request = (suffix = "", token = tokens[0]) =>
        fetch(
          `${origin}/api/v1/leaderboard?scope=${scope}&season=2026-09${suffix}`,
          { headers: { Cookie: `impuls_session=${token}` } },
        );
      const valid = await request();
      expect(valid.status).toBe(200);
      expect(valid.headers.get("cache-control")).toContain("no-store");
      expect(leaderboardResponseSchema.parse(await valid.json()).self).toEqual({
        xp: 100,
        rank: 1,
      });
      for (const suffix of [
        "&limit=51",
        "&scope=x",
        "&extra=x",
        "&season=2026-13",
        "&cursor=x",
      ])
        expect((await request(suffix)).status).toBe(400);
      expect((await request("", "bad")).status).toBe(401);
      const hidden = await fetch(
        `${origin}/api/v1/leaderboard?scope=${otherScope}`,
        { headers: { Cookie: `impuls_session=${tokens[0]}` } },
      );
      expect(hidden.status).toBe(404);
      const browser = await chromium.launch();
      const context = await browser.newContext();
      try {
        await context.addCookies([
          {
            name: "impuls_session",
            value: tokens[0]!,
            url: origin!,
          },
        ]);
        const page = await context.newPage();
        await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
          r.fulfill({
            contentType: "application/javascript",
            body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}",
          }),
        );
        await page.goto(origin!);
        await page
          .getByRole("button", { name: "Рейтинг", exact: true })
          .click();
        await page.getByLabel("Месяц").fill("2026-09");
        await page
          .getByRole("rowheader", { name: "Synthetic ranked alias 0" })
          .waitFor();
        const xp = await page.locator(".ranking-self strong").textContent();
        expect(xp).toBe("100 XP");
      } finally {
        await context.close();
        await browser.close();
      }
    },
    30000,
  );
  it("reflects real compensation in the original month and rejects a stale page without changing October XP", async () => {
    const first = await read({ limit: 2 });
    if (first.kind !== "ok") throw new Error(first.kind);
    const cursor = leaderboardQuerySchema.parse({
      cursor: first.response.nextCursor,
    }).cursor!;
    const version = (
      await admin.query<{ version: number }>(
        "SELECT version FROM impuls.account_balances WHERE user_id=$1",
        [users[0]],
      )
    ).rows[0]!.version;
    const correction = await reverseAcceptance(runtime, {
      actorId: reviewer,
      sessionHash: hashes[6]!,
      reviewId: awards[0]!.reviewId,
      expectedVersion: version,
      reason: "Synthetic source-month correction",
      idempotencyKey: randomUUID(),
      allowSyntheticCorrections: true,
    });
    expect(correction.kind).toBe("ok");
    expect((await read({ cursor })).kind).toBe("changed");
    const sept = await read();
    if (sept.kind !== "ok") throw new Error(sept.kind);
    expect(sept.response.items.map((v) => [v.xp, v.rank])).toEqual([
      [60, 1],
      [60, 1],
      [20, 3],
    ]);
    expect(sept.response.self).toEqual({ xp: 0, rank: null });
    const oct = await read({ season: "2026-10" });
    if (oct.kind !== "ok") throw new Error(oct.kind);
    expect(oct.response.self).toEqual({ xp: 900, rank: 1 });
  });
  afterAll(async () => {
    try {
      await admin.query(
        "DELETE FROM impuls.notification_outbox WHERE recipient_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.audit_events WHERE actor_id=ANY($1::uuid[])",
        [users],
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
      for (const t of ["submissions", "task_assignments"])
        await admin.query(
          `DELETE FROM impuls.${t} WHERE task_id=ANY($1::uuid[])`,
          [tasks],
        );
      await admin.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
        tasks,
      ]);
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.task_scope_members WHERE scope_id=ANY($1::uuid[])",
        [[scope, otherScope]],
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
