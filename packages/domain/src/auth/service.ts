import type { Pool } from "pg";
import { createSessionToken, hashSessionToken } from "./session";

export type AuthUser = { id: string; displayName: string };
export type LoginResult =
  | { kind: "authorized"; user: AuthUser; sessionToken: string }
  | { kind: "denied" };
export type SessionResult =
  | { kind: "authorized"; user: AuthUser }
  | { kind: "revoked" }
  | { kind: "missing" };

type UserRow = { id: string; display_name: string };
type SessionRow = {
  id: string;
  display_name: string;
  active: boolean;
  revoked: boolean;
  not_expired: boolean;
};

export async function createLoginSession(
  pool: Pool,
  telegramId: string,
): Promise<LoginResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query<UserRow>(
      "SELECT id, display_name FROM impuls.users WHERE telegram_id = $1 AND active = true FOR SHARE",
      [telegramId],
    );
    const row = user.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { kind: "denied" };
    }
    const sessionToken = createSessionToken();
    await client.query(
      "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '12 hours')",
      [row.id, hashSessionToken(sessionToken)],
    );
    await client.query("COMMIT");
    return {
      kind: "authorized",
      user: { id: row.id, displayName: row.display_name },
      sessionToken,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readSession(
  pool: Pool,
  sessionToken: string,
): Promise<SessionResult> {
  const result = await pool.query<SessionRow>(
    `SELECT users.id, users.display_name, users.active,
            sessions.revoked_at IS NOT NULL AS revoked,
            sessions.expires_at > now() AS not_expired
       FROM impuls.sessions AS sessions JOIN impuls.users AS users ON users.id = sessions.user_id
      WHERE sessions.session_hash = $1`,
    [hashSessionToken(sessionToken)],
  );
  const row = result.rows[0];
  if (!row) return { kind: "missing" };
  if (row.revoked || !row.active) return { kind: "revoked" };
  if (!row.not_expired) return { kind: "missing" };
  return {
    kind: "authorized",
    user: { id: row.id, displayName: row.display_name },
  };
}

export async function revokeSession(
  pool: Pool,
  sessionToken: string,
): Promise<void> {
  await pool.query(
    "UPDATE impuls.sessions SET revoked_at = now(), updated_at = now(), version = version + 1 WHERE session_hash = $1 AND revoked_at IS NULL",
    [hashSessionToken(sessionToken)],
  );
}
