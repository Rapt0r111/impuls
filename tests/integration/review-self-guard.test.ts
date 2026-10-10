import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "the database refuses a review of one's own work (000040)",
  () => {
    const admin = new Pool({ connectionString: url });
    const assignee = randomUUID();
    const reviewer = randomUUID();
    const scope = randomUUID();
    const rules = randomUUID();
    const task = randomUUID();
    let submission = "";
    const telegramId = () => randomInt(8_000_000_000_000, 9_000_000_000_000);
    beforeAll(async () => {
      await admin.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,'Synthetic guard assignee',true),($3,$4,'Synthetic guard reviewer',true)",
        [assignee, telegramId(), reviewer, telegramId()],
      );
      await admin.query(
        "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic guard scope')",
        [scope],
      );
      await admin.query(
        "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{}'::jsonb,now(),$3)",
        [rules, randomInt(1_000_000, 2_000_000_000), reviewer],
      );
      await admin.query(
        "INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES ($1,$2,$3,$4,'Synthetic guard task','Criteria','test','normal','in_review',now(),5,3)",
        [task, scope, rules, reviewer],
      );
      await admin.query(
        "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
        [task, assignee],
      );
      submission = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.submissions (task_id,author_id,attempt_number,text) VALUES ($1,$2,1,'Synthetic evidence') RETURNING id",
          [task, assignee],
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
          [assignee, reviewer],
        ]);
      } finally {
        await admin.end();
      }
    });
    const insertReturn = (reviewerId: string) =>
      admin.query(
        "INSERT INTO impuls.reviews (submission_id,reviewer_id,decision,reason) VALUES ($1,$2,'return','Synthetic guard check')",
        [submission, reviewerId],
      );

    it("rejects the author and assignee as reviewer", async () => {
      await expect(insertReturn(assignee)).rejects.toMatchObject({
        code: "23514",
      });
    });

    it("rejects an assignee who did not write the submission", async () => {
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE impuls.task_assignments SET user_id=$2 WHERE task_id=$1",
          [task, reviewer],
        );
        await expect(
          client.query(
            "INSERT INTO impuls.reviews (submission_id,reviewer_id,decision,reason) VALUES ($1,$2,'return','Synthetic guard check')",
            [submission, reviewer],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("accepts another member as reviewer", async () => {
      await expect(insertReturn(reviewer)).resolves.toMatchObject({
        rowCount: 1,
      });
    });
  },
);
