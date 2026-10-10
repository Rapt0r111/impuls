import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "acceptance breakdown stays compatible with the previous application version",
  () => {
    const admin = new Pool({ connectionString: url });
    const user = randomUUID();
    const reviewer = randomUUID();
    const scope = randomUUID();
    const rules = randomUUID();
    const task = randomUUID();
    let submission = "";
    beforeAll(async () => {
      await admin.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,'Synthetic compat user',true),($3,$4,'Synthetic compat reviewer',true)",
        [
          user,
          randomInt(8_000_000_000_000, 9_000_000_000_000),
          reviewer,
          randomInt(8_000_000_000_000, 9_000_000_000_000),
        ],
      );
      await admin.query(
        "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic compat scope')",
        [scope],
      );
      await admin.query(
        "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{}'::jsonb,now(),$3)",
        [rules, randomInt(1_000_000, 2_000_000_000), user],
      );
      await admin.query(
        "INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES ($1,$2,$3,$4,'Synthetic compat task','Criteria','test','normal','in_review',now(),31,13)",
        [task, scope, rules, user],
      );
      await admin.query(
        "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
        [task, user],
      );
      submission = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.submissions (task_id,author_id,attempt_number,text) VALUES ($1,$2,1,'Synthetic evidence') RETURNING id",
          [task, user],
        )
      ).rows[0]!.id;
    });
    afterAll(async () => {
      try {
        await admin.query("DELETE FROM impuls.reviews WHERE submission_id=$1", [
          submission,
        ]);
        await admin.query("DELETE FROM impuls.submissions WHERE id=$1", [
          submission,
        ]);
        await admin.query(
          "DELETE FROM impuls.task_assignments WHERE task_id=$1",
          [task],
        );
        await admin.query("DELETE FROM impuls.tasks WHERE id=$1", [task]);
        await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rules]);
        await admin.query("DELETE FROM impuls.access_scopes WHERE id=$1", [
          scope,
        ]);
        await admin.query("DELETE FROM impuls.users WHERE id=ANY($1)", [
          [user, reviewer],
        ]);
      } finally {
        await admin.end();
      }
    });
    it("fills an accepted review written without the breakdown with the unchanged fund", async () => {
      const review = (
        await admin.query(
          "INSERT INTO impuls.reviews (submission_id,reviewer_id,decision,reason,fund_xp,fund_points) VALUES ($1,$2,'accept','Previous app version',31,13) RETURNING base_xp,base_points,bonus_code,bonus_xp,bonus_points",
          [submission, reviewer],
        )
      ).rows[0];
      expect(review).toEqual({
        base_xp: 31,
        base_points: 13,
        bonus_code: null,
        bonus_xp: 0,
        bonus_points: 0,
      });
    });
  },
);
