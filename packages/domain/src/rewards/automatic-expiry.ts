import type { Pool } from "pg";

// A single server-clock operation commits return + immutable evidence atomically.
// No session, actor, price, scope or client timestamp can be supplied by the worker.
export async function expireOneSyntheticReservation(
  pool: Pool,
  enabled: boolean,
): Promise<boolean> {
  if (!enabled) return false;
  const result = await pool.query<{ expired: boolean }>(
    "SELECT impuls.expire_one_synthetic_reservation() AS expired",
  );
  return result.rows[0]!.expired;
}

export type SyntheticExpiryStatus = {
  snapshotAt: string;
  counts: {
    due: number;
    scheduled: number;
    untimedPending: number;
    automaticExpired: number;
  };
  oldestDueAt: string | null;
  oldestDueAgeSeconds: number | null;
  lastAutomaticExpiryAt: string | null;
};

// No actor/object selection or direct table privileges. Reading cannot expire work.
export async function readSyntheticExpiryStatus(
  pool: Pool,
  enabled: boolean,
): Promise<SyntheticExpiryStatus | null> {
  if (!enabled) return null;
  const { rows } = await pool.query<{
    snapshot_at: Date;
    due: string;
    scheduled: string;
    untimed_pending: string;
    automatic_expired: string;
    oldest_due_at: Date | null;
    oldest_due_age_seconds: string | null;
    last_automatic_expiry_at: Date | null;
  }>("SELECT * FROM impuls.read_synthetic_expiry_status()");
  const row = rows[0]!;
  const count = (value: string) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0)
      throw new Error("Invalid expiry aggregate");
    return number;
  };
  return {
    snapshotAt: row.snapshot_at.toISOString(),
    counts: {
      due: count(row.due),
      scheduled: count(row.scheduled),
      untimedPending: count(row.untimed_pending),
      automaticExpired: count(row.automatic_expired),
    },
    oldestDueAt: row.oldest_due_at?.toISOString() ?? null,
    oldestDueAgeSeconds:
      row.oldest_due_age_seconds === null
        ? null
        : count(row.oldest_due_age_seconds),
    lastAutomaticExpiryAt: row.last_automatic_expiry_at?.toISOString() ?? null,
  };
}
