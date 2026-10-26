import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

// ADR-0029, этап 2: после миграции 000051 схема не требует метки mode = 'synthetic'.
// Старые строки сохраняют значение, новые пишутся без него (mode NULL).
(url ? describe : describe.skip)(
  "synthetic mode label is gone from the schema",
  () => {
    const pool = new Pool({ connectionString: url });
    const tables = [
      "ledger_entries",
      "notification_outbox",
      "ledger_corrections",
      "reward_versions",
      "redemptions",
      "entitlements",
    ];
    it("drops every CHECK that pins the label", async () => {
      const rows = (
        await pool.query<{ conrelid: string; conname: string }>(
          `SELECT conrelid::regclass::text AS conrelid, conname FROM pg_constraint
         WHERE contype='c' AND pg_get_constraintdef(oid) ILIKE '%synthetic%'`,
        )
      ).rows;
      expect(rows).toEqual([]);
    });
    it("lets new rows leave mode empty", async () => {
      const rows = (
        await pool.query<{ table_name: string; is_nullable: string }>(
          `SELECT table_name, is_nullable FROM information_schema.columns
         WHERE table_schema='impuls' AND column_name='mode' AND table_name = ANY($1)`,
          [tables],
        )
      ).rows;
      expect(rows).toHaveLength(tables.length);
      expect(rows.every((row) => row.is_nullable === "YES")).toBe(true);
    });
    it("keeps the expiry and worker policies and the due index free of the label", async () => {
      const policies = (
        await pool.query<{
          policyname: string;
          qual: string | null;
          with_check: string | null;
        }>(
          `SELECT policyname, qual, with_check FROM pg_policies
         WHERE schemaname='impuls' AND policyname = ANY($1)`,
          [
            [
              "notification_outbox_worker_read",
              "redemptions_expiry_service",
              "ledger_expiry_service_read",
            ],
          ],
        )
      ).rows;
      expect(policies).toHaveLength(3);
      for (const policy of policies)
        expect(`${policy.qual ?? ""} ${policy.with_check ?? ""}`).not.toMatch(
          /mode/,
        );
      const index = (
        await pool.query<{ indexdef: string }>(
          "SELECT indexdef FROM pg_indexes WHERE schemaname='impuls' AND indexname='redemptions_due_idx'",
        )
      ).rows[0];
      expect(index?.indexdef).not.toMatch(/mode/);
    });
    it("keeps the expiry functions callable without the label", async () => {
      const status = (
        await pool.query(
          "SELECT count(*)::int AS n FROM impuls.read_synthetic_expiry_status()",
        )
      ).rows[0];
      expect(status.n).toBe(1);
    });
  },
);
