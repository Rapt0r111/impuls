import { createRequire } from "node:module";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptanceOptions } from "../../packages/domain/src/ledger/economy";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
const migrationSql = () => {
  const migration = require(
    path.resolve("db/migrations/000039_rules_v2_pilot_bonus.js"),
  ) as { up(builder: { sql(value: string): void }): void };
  const sql: string[] = [];
  migration.up({ sql: (value) => void sql.push(value) });
  return sql;
};

// The migration already ran on the test database (no source version there). Each case
// replays its SQL inside a transaction that is rolled back, so nothing stays behind.
(url ? describe : describe.skip)(
  "rules version 2 for the pilot (000039)",
  () => {
    const admin = new Pool({ connectionString: url });
    const author = randomUUID();
    // Above every version number other test files insert (at most 2 000 000 000).
    const source = 2_100_000_000 + randomInt(0, 1_000_000);
    const v1 = {
      mode: "synthetic",
      timeZone: "Europe/Moscow",
      acceptance: {
        enabled: true,
        adjustment: { maxXp: 1, maxPoints: 1 },
        bonuses: [{ code: "old", title: "Old", xp: 1, points: 1 }],
      },
      progression: { levels: [0, 100] },
    };
    async function replay(seed: (client: PoolClient) => Promise<void>) {
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await seed(client);
        for (const statement of migrationSql()) await client.query(statement);
        return (
          await client.query<{
            version_number: number;
            definition: Record<string, unknown>;
            created_by: string;
          }>(
            "SELECT version_number, definition, created_by FROM impuls.rule_sets WHERE version_number > $1 AND created_by = $2 ORDER BY version_number",
            [source, author],
          )
        ).rows;
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }
    beforeAll(async () => {
      await admin.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,'Synthetic rules author',true)",
        [author, randomInt(8_000_000_000_000, 9_000_000_000_000)],
      );
    });
    afterAll(async () => {
      try {
        await admin.query("DELETE FROM impuls.users WHERE id=$1", [author]);
      } finally {
        await admin.end();
      }
    });

    it("publishes the next version with the owner's shares and keeps the rest", async () => {
      const rows = await replay(async (client) => {
        await client.query(
          "INSERT INTO impuls.rule_sets (version_number,definition,effective_from,created_by) VALUES ($1,$2,now(),$3)",
          [source, v1, author],
        );
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.version_number).toBe(source + 1);
      expect(rows[0]!.created_by).toBe(author);
      expect(rows[0]!.definition).toEqual({
        ...v1,
        acceptance: {
          enabled: true,
          adjustment: { minPercent: 50 },
          bonuses: [
            { code: "plus_10", title: "Бонус +10 %", percent: 10 },
            { code: "plus_25", title: "Бонус +25 %", percent: 25 },
          ],
        },
      });
      // What the reviewer would see for a 100 XP / 30 points task under that version.
      expect(
        acceptanceOptions(rows[0]!.definition, { xp: 100, points: 30 }),
      ).toEqual({
        adjustment: { minXp: 50, minPoints: 15, maxXp: 100, maxPoints: 30 },
        bonuses: [
          { code: "plus_10", title: "Бонус +10 %", xp: 10, points: 3 },
          { code: "plus_25", title: "Бонус +25 %", xp: 25, points: 7 },
        ],
      });
    });

    it("publishes nothing without a synthetic version that enables acceptance", async () => {
      const rows = await replay(async (client) => {
        await client.query(
          "INSERT INTO impuls.rule_sets (version_number,definition,effective_from,created_by) VALUES ($1,$2,now(),$3)",
          [source, { ...v1, acceptance: { enabled: false } }, author],
        );
      });
      expect(rows).toEqual([]);
    });
  },
);
