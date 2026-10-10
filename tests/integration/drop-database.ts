import type { Pool } from "pg";

// pool.end() resolves before the server backends of the closed clients have exited. A
// DROP DATABASE ... WITH (FORCE) issued at that moment terminates backends that are
// already shutting down, and node-postgres reports their FATAL 57P01 as an uncaught
// error that fails the whole run. Wait until the sessions are gone, keep FORCE as the
// fallback for a session that really is stuck.
export async function dropDatabase(admin: Pool, name: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1",
      [name],
    );
    if (rows[0]!.n === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await admin.query(
    `DROP DATABASE "${name.replaceAll('"', '""')}" WITH (FORCE)`,
  );
}
