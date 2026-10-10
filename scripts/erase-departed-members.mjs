import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";

// P-02: a member's Telegram ID and name are removed 90 days after they leave
// (migration 000041, ADR-0033). The rule and the work live in the database;
// this script only calls it under the migration (owner) role. The application
// role cannot run it.

/**
 * @param {import("pg").PoolClient | import("pg").Client} client
 * @param {{ apply: boolean, limit?: number }} options
 */
export async function eraseDepartedMembers(client, options) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("limit must be an integer between 1 and 1000");

  await client.query("BEGIN");
  try {
    const waiting = (
      await client.query(
        `SELECT count(*) FILTER (WHERE departed_at <= clock_timestamp() - interval '90 days')::int due,
                count(*) FILTER (WHERE departed_at > clock_timestamp() - interval '90 days')::int waiting,
                min(departed_at) FILTER (WHERE departed_at > clock_timestamp() - interval '90 days') next_departure
           FROM impuls.member_departures()`,
      )
    ).rows[0];
    const erased = (
      await client.query(
        "SELECT user_id, departed_at, erased_at FROM impuls.erase_departed_members($1)",
        [limit],
      )
    ).rows;
    await client.query(options.apply ? "COMMIT" : "ROLLBACK");
    return {
      applied: options.apply,
      due: waiting.due,
      erased: erased.map((row) => ({
        userId: row.user_id,
        departedAt: row.departed_at.toISOString(),
        erasedAt: row.erased_at.toISOString(),
      })),
      waiting: waiting.waiting,
      nextDueAt: waiting.next_departure
        ? new Date(
            waiting.next_departure.getTime() + 90 * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const localEnv = path.join(root, "apps", "app", ".env.local");
  if (existsSync(localEnv)) process.loadEnvFile(localEnv);
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  if (new URL(url).hostname.endsWith(".pooler.supabase.com"))
    throw new Error("Use a direct PostgreSQL connection");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await eraseDepartedMembers(client, {
      apply: values.apply,
      limit: values.limit === undefined ? undefined : Number(values.limit),
    });
    console.log(
      JSON.stringify(
        {
          mode: result.applied
            ? "applied"
            : "dry-run (nothing written; pass --apply)",
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
