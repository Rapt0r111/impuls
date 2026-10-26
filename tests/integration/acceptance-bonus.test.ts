import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reverseAcceptance } from "../../packages/domain/src/ledger/corrections";
import {
  listReviewQueue,
  reviewTaskSubmission,
  type TaskReviewInput,
} from "../../packages/domain/src/tasks/reviews";
import { taskAcceptanceResponseSchema } from "../../packages/contracts/src/reviews";

const url = process.env.TEST_DATABASE_URL;
const options = {
  adjustment: { maxXp: 200, maxPoints: 80 },
  bonuses: [
    { code: "quality", title: "Качество", xp: 20, points: 10 },
    { code: "innovation", title: "Инновация", xp: 40, points: 20 },
  ],
};
(url ? describe : describe.skip)(
  "F03/F04 acceptance adjustment and bonus (PostgreSQL)",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
      max: 4,
    });
    const reviewer = randomUUID();
    const participant = randomUUID();
    const hash = createHash("sha256")
      .update(randomBytes(32).toString("base64url"))
      .digest();
    const scope = randomUUID();
    const withOptions = randomUUID();
    const withoutOptions = randomUUID();
    const pilotShares = randomUUID();
    const tasks: string[] = [];
    let expectedXp = 0;
    let expectedPoints = 0;
    beforeAll(async () => {
      for (const [id, name] of [
        [reviewer, "Synthetic bonus reviewer"],
        [participant, "Synthetic bonus participant"],
      ] as const)
        await admin.query(
          "INSERT INTO impuls.users (id, telegram_id, display_name, active) VALUES ($1,$2,$3,true)",
          [id, randomInt(8_000_000_000_000, 9_000_000_000_000), name],
        );
      await admin.query(
        "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic bonus scope')",
        [scope],
      );
      for (const [id, definition] of [
        [
          withOptions,
          {
            mode: "synthetic",
            economy: { approved: true },
            timeZone: "Europe/Moscow",
            acceptance: { enabled: true, ...options },
          },
        ],
        [
          withoutOptions,
          {
            mode: "synthetic",
            economy: { approved: true },
            timeZone: "Europe/Moscow",
            acceptance: { enabled: true },
          },
        ],
        [
          pilotShares,
          {
            mode: "synthetic",
            economy: { approved: true },
            timeZone: "Europe/Moscow",
            acceptance: {
              enabled: true,
              adjustment: { minPercent: 50 },
              bonuses: [
                { code: "plus_10", title: "Бонус +10 %", percent: 10 },
                { code: "plus_25", title: "Бонус +25 %", percent: 25 },
              ],
            },
          },
        ],
      ] as const)
        await admin.query(
          "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,$3::jsonb,now(),$4)",
          [
            id,
            randomInt(1_000_000, 2_000_000_000),
            JSON.stringify(definition),
            reviewer,
          ],
        );
      for (const action of ["task.review", "ledger.correct"])
        await admin.query(
          "INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason) VALUES ($1,$2,$3,$1,'Synthetic test')",
          [reviewer, action, scope],
        );
      await admin.query(
        "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
        [reviewer, hash],
      );
    });
    async function fixture(rules: string, xp = 100, points = 30) {
      const id = randomUUID();
      tasks.push(id);
      await admin.query(
        "INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES ($1,$2,$3,$4,$5,'Independent criteria','test','normal','in_review',now(),$6,$7)",
        [id, scope, rules, reviewer, `Synthetic bonus task ${id}`, xp, points],
      );
      await admin.query(
        "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
        [id, participant],
      );
      const sub = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.submissions (task_id,author_id,attempt_number,text) VALUES ($1,$2,1,'Synthetic evidence') RETURNING id",
          [id, participant],
        )
      ).rows[0]!.id;
      const input: TaskReviewInput = {
        actorId: reviewer,
        sessionHash: hash,
        submissionId: sub,
        expectedVersion: 1,
        reason: "Independently verified both criteria",
        idempotencyKey: randomUUID(),
        action: "accept",
        allowSyntheticAccrual: true,
      };
      return { id, sub, input };
    }
    async function untouched(id: string) {
      return (
        await admin.query(
          "SELECT status, (SELECT count(*)::int FROM impuls.ledger_entries WHERE task_id=t.id) entries, (SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=t.id) reviews FROM impuls.tasks t WHERE id=$1",
          [id],
        )
      ).rows[0];
    }
    async function balance() {
      return (
        await admin.query(
          "SELECT lifetime_xp::int xp, available_points::int points FROM impuls.account_balances WHERE user_id=$1",
          [participant],
        )
      ).rows[0];
    }
    afterAll(async () => {
      try {
        const reviews =
          "SELECT r.id FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=ANY($1::uuid[])";
        await admin.query(
          `DELETE FROM impuls.notification_outbox WHERE review_id IN (${reviews}) OR correction_id IN (SELECT id FROM impuls.ledger_corrections WHERE review_id IN (${reviews}))`,
          [tasks],
        );
        await admin.query(
          `DELETE FROM impuls.audit_events WHERE review_id IN (${reviews}) OR correction_id IN (SELECT id FROM impuls.ledger_corrections WHERE review_id IN (${reviews}))`,
          [tasks],
        );
        await admin.query(
          "DELETE FROM impuls.ledger_entries WHERE task_id=ANY($1::uuid[])",
          [tasks],
        );
        await admin.query(
          `DELETE FROM impuls.ledger_corrections WHERE review_id IN (${reviews})`,
          [tasks],
        );
        await admin.query(
          "DELETE FROM impuls.account_balances WHERE user_id=$1",
          [participant],
        );
        await admin.query(
          "DELETE FROM impuls.idempotency_records WHERE actor_id=$1",
          [reviewer],
        );
        await admin.query(
          `DELETE FROM impuls.task_events WHERE task_id=ANY($1::uuid[])`,
          [tasks],
        );
        await admin.query(
          `DELETE FROM impuls.reviews WHERE id IN (${reviews})`,
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
        await admin.query(
          "DELETE FROM impuls.rule_sets WHERE id=ANY($1::uuid[])",
          [[withOptions, withoutOptions, pilotShares]],
        );
        await admin.query("DELETE FROM impuls.sessions WHERE user_id=$1", [
          reviewer,
        ]);
        await admin.query("DELETE FROM impuls.role_bindings WHERE user_id=$1", [
          reviewer,
        ]);
        await admin.query("DELETE FROM impuls.access_scopes WHERE id=$1", [
          scope,
        ]);
        await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
          [reviewer, participant],
        ]);
      } finally {
        await runtime.end();
        await admin.end();
      }
    });

    it("shows the reviewer only the options the saved rule version defines", async () => {
      const a = await fixture(withOptions);
      const b = await fixture(withoutOptions);
      const queue = await listReviewQueue(runtime, reviewer, {
        allowSyntheticAccrual: true,
        limit: 50,
      });
      const find = (taskId: string) =>
        queue.items.find((i) => i.task.id === taskId)!.acceptance;
      expect(find(a.id)).toMatchObject({ enabled: true, options });
      expect(find(b.id)).toMatchObject({
        enabled: true,
        options: { adjustment: null, bonuses: [] },
      });
      const disabled = await listReviewQueue(runtime, reviewer, {
        allowSyntheticAccrual: false,
        limit: 50,
      });
      expect(
        disabled.items.find((i) => i.task.id === a.id)!.acceptance,
      ).toMatchObject({
        enabled: false,
        options: { adjustment: null, bonuses: [] },
      });
    });

    it("pays the task fund unchanged when nothing is chosen", async () => {
      const f = await fixture(withOptions, 50, 12);
      const result = await reviewTaskSubmission(runtime, f.input);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expectedXp += 50;
      expectedPoints += 12;
      const award = taskAcceptanceResponseSchema.parse(result.response).award;
      expect(award).toMatchObject({
        xp: 50,
        points: 12,
        breakdown: { baseXp: 50, basePoints: 12, bonus: null },
      });
      expect(
        (
          await admin.query(
            "SELECT fund_xp,fund_points,base_xp,base_points,bonus_code,bonus_xp,bonus_points FROM impuls.reviews WHERE id=$1",
            [result.response.review.id],
          )
        ).rows[0],
      ).toEqual({
        fund_xp: 50,
        fund_points: 12,
        base_xp: 50,
        base_points: 12,
        bonus_code: null,
        bonus_xp: 0,
        bonus_points: 0,
      });
      expect(await balance()).toEqual({
        xp: expectedXp,
        points: expectedPoints,
      });
    });

    it("credits corrected base plus one bonus, keeps the breakdown and replays once", async () => {
      const f = await fixture(withOptions, 100, 30);
      const input = {
        ...f.input,
        baseXp: 80,
        basePoints: 25,
        bonusCode: "quality",
      };
      const result = await reviewTaskSubmission(runtime, input);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expectedXp += 100;
      expectedPoints += 35;
      expect(result.response.award).toMatchObject({
        xp: 100,
        points: 35,
        breakdown: {
          baseXp: 80,
          basePoints: 25,
          bonus: { code: "quality", title: "Качество", xp: 20, points: 10 },
        },
      });
      const entries = (
        await admin.query(
          "SELECT currency, amount, kind FROM impuls.ledger_entries WHERE task_id=$1 ORDER BY currency",
          [f.id],
        )
      ).rows;
      expect(entries).toEqual([
        { currency: "points", amount: 35, kind: "task_acceptance" },
        { currency: "xp", amount: 100, kind: "task_acceptance" },
      ]);
      const review = (
        await admin.query(
          "SELECT fund_xp,fund_points,base_xp,base_points,bonus_code,bonus_title,bonus_xp,bonus_points FROM impuls.reviews WHERE id=$1",
          [result.response.review.id],
        )
      ).rows[0];
      expect(review).toEqual({
        fund_xp: 100,
        fund_points: 30,
        base_xp: 80,
        base_points: 25,
        bonus_code: "quality",
        bonus_title: "Качество",
        bonus_xp: 20,
        bonus_points: 10,
      });
      const audit = (
        await admin.query(
          "SELECT diff FROM impuls.audit_events WHERE review_id=$1",
          [result.response.review.id],
        )
      ).rows[0].diff;
      expect(audit).toMatchObject({
        xp: 100,
        points: 35,
        baseXp: 80,
        basePoints: 25,
        bonusCode: "quality",
        bonusXp: 20,
        bonusPoints: 10,
      });
      expect(await reviewTaskSubmission(runtime, input)).toEqual(result);
      expect(
        await reviewTaskSubmission(runtime, {
          ...input,
          // 60 + 40 stays within 100 XP, so the reply is the conflict, not the cap.
          baseXp: 60,
          bonusCode: "innovation",
        }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect(await balance()).toEqual({
        xp: expectedXp,
        points: expectedPoints,
      });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM impuls.ledger_entries WHERE task_id=$1",
            [f.id],
          )
        ).rows[0].n,
      ).toBe(2);
    });

    it("rejects choices the saved rule version does not allow without saving anything", async () => {
      const f = await fixture(withOptions, 100, 30);
      const g = await fixture(withoutOptions, 100, 30);
      const cases: [Awaited<ReturnType<typeof fixture>>, object, string][] = [
        [f, { bonusCode: "missing" }, "bonus_unknown"],
        [f, { baseXp: 201 }, "adjustment_exceeds_limit"],
        [f, { basePoints: 81 }, "adjustment_exceeds_limit"],
        [g, { baseXp: 90 }, "adjustment_not_allowed"],
        [g, { bonusCode: "quality" }, "bonus_unknown"],
      ];
      for (const [fix, extra, reason] of cases) {
        expect(
          await reviewTaskSubmission(runtime, {
            ...fix.input,
            idempotencyKey: randomUUID(),
            ...extra,
          }),
        ).toEqual({ kind: "award_invalid", reason });
        expect(await untouched(fix.id)).toEqual({
          status: "in_review",
          entries: 0,
          reviews: 0,
        });
      }
      expect(await balance()).toEqual({
        xp: expectedXp,
        points: expectedPoints,
      });
    });

    it("resolves the pilot shares of the fund for the queue, the decision and the ledger", async () => {
      // Owner decision P-04 (10.10.2026, ADR-0031). Fund 100/30: minimum base 50/15,
      // +25 % = 25/7 (7.5 points rounded down). Expected values computed by hand.
      const f = await fixture(pilotShares, 100, 30);
      const queue = await listReviewQueue(runtime, reviewer, {
        allowSyntheticAccrual: true,
        limit: 50,
      });
      expect(
        queue.items.find((i) => i.task.id === f.id)!.acceptance.options,
      ).toEqual({
        adjustment: { minXp: 50, minPoints: 15, maxXp: 100, maxPoints: 30 },
        bonuses: [
          { code: "plus_10", title: "Бонус +10 %", xp: 10, points: 3 },
          { code: "plus_25", title: "Бонус +25 %", xp: 25, points: 7 },
        ],
      });
      for (const [extra, reason] of [
        [{ baseXp: 49 }, "adjustment_below_limit"],
        [{ basePoints: 14 }, "adjustment_below_limit"],
        [{ baseXp: 101 }, "adjustment_exceeds_limit"],
        [{ bonusCode: "quality" }, "bonus_unknown"],
      ] as const) {
        expect(
          await reviewTaskSubmission(runtime, {
            ...f.input,
            idempotencyKey: randomUUID(),
            ...extra,
          }),
        ).toEqual({ kind: "award_invalid", reason });
        expect(await untouched(f.id)).toEqual({
          status: "in_review",
          entries: 0,
          reviews: 0,
        });
      }
      const result = await reviewTaskSubmission(runtime, {
        ...f.input,
        baseXp: 50,
        basePoints: 15,
        bonusCode: "plus_25",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expectedXp += 75;
      expectedPoints += 22;
      expect(result.response.award).toMatchObject({
        xp: 75,
        points: 22,
        breakdown: {
          baseXp: 50,
          basePoints: 15,
          bonus: { code: "plus_25", title: "Бонус +25 %", xp: 25, points: 7 },
        },
      });
      expect(
        (
          await admin.query(
            "SELECT currency, amount FROM impuls.ledger_entries WHERE task_id=$1 ORDER BY currency",
            [f.id],
          )
        ).rows,
      ).toEqual([
        { currency: "points", amount: 22 },
        { currency: "xp", amount: 75 },
      ]);
      expect(await balance()).toEqual({
        xp: expectedXp,
        points: expectedPoints,
      });
    });

    it("refuses a credit that differs from the saved decision at the database", async () => {
      const f = await fixture(withOptions, 10, 5);
      const result = await reviewTaskSubmission(runtime, {
        ...f.input,
        bonusCode: "innovation",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expectedXp += 50;
      expectedPoints += 25;
      const insert = (amount: number) =>
        admin.query(
          "INSERT INTO impuls.ledger_entries (user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,kind,amount,mode,season_key,time_zone,created_at,updated_at) SELECT user_id,review_id,task_id,task_title,rule_set_id,rule_version,'xp','task_acceptance',$2,mode,season_key,time_zone,created_at,updated_at FROM impuls.ledger_entries WHERE task_id=$1 AND currency='xp'",
          [f.id, amount],
        );
      await expect(insert(51)).rejects.toMatchObject({ code: "23514" });
    });

    it("keeps a task fund within 0-100 XP in the database as well", async () => {
      await expect(
        admin.query(
          "INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES ($1,$2,$3,$4,'Synthetic oversized fund','Independent criteria','test','normal','in_review',now(),101,30)",
          [randomUUID(), scope, withOptions, reviewer],
        ),
      ).rejects.toThrow(
        'violates check constraint "tasks_fund_xp_limit_check"',
      );
    });

    it("reverses the whole credited total, bonus included, through the existing correction", async () => {
      const f = await fixture(withOptions, 100, 30);
      const accepted = await reviewTaskSubmission(runtime, {
        ...f.input,
        baseXp: 80,
        bonusCode: "quality",
      });
      expect(accepted.kind).toBe("ok");
      if (accepted.kind !== "ok" || !accepted.response.award) return;
      expect(accepted.response.award).toMatchObject({ xp: 100, points: 40 });
      const before = await balance();
      const corrected = await reverseAcceptance(runtime, {
        actorId: reviewer,
        sessionHash: hash,
        reviewId: accepted.response.review.id,
        expectedVersion: accepted.response.award.balance.version,
        reason: "Wrongly accepted synthetic evidence",
        idempotencyKey: randomUUID(),
        allowSyntheticCorrections: true,
      });
      expect(corrected.kind).toBe("ok");
      expect(await balance()).toEqual({
        xp: before.xp - 100,
        points: before.points - 40,
      });
      expect(
        (
          await admin.query(
            "SELECT currency, sum(amount)::int total FROM impuls.ledger_entries WHERE task_id=$1 GROUP BY currency ORDER BY currency",
            [f.id],
          )
        ).rows,
      ).toEqual([
        { currency: "points", total: 0 },
        { currency: "xp", total: 0 },
      ]);
    });

    it("accepts a base of 100 XP with a bonus on top, since only the base is capped", async () => {
      const f = await fixture(withOptions, 100, 30);
      const before = await balance();
      const accepted = await reviewTaskSubmission(runtime, {
        ...f.input,
        baseXp: 100,
        bonusCode: "quality",
      });
      expect(accepted.kind).toBe("ok");
      if (accepted.kind !== "ok" || !accepted.response.award) return;
      expect(accepted.response.award).toMatchObject({ xp: 120, points: 40 });
      expect(await balance()).toEqual({
        xp: before.xp + 120,
        points: before.points + 40,
      });
    });
  },
);
