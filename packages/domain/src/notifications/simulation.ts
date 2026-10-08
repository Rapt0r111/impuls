import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// Fixed text only. Never interpolate task/reward titles, reports, reasons, or names.
const messages: Record<string, string> = {
  "task.assigned": "В приложении назначена задача.",
  "task.returned": "В приложении результат возвращён на доработку.",
  "task.accepted": "В приложении принято решение по результату.",
  "ledger.corrected": "В приложении обновлён журнал начислений.",
  "reward.reserved": "В приложении сохранена заявка.",
  "reward.cancelled": "В приложении отменена заявка.",
  "reward.approved":
    "В приложении согласована заявка. Выдача ещё не подтверждена.",
  "reward.rejected": "В приложении принято решение по заявке.",
  "reward.fulfilled": "В приложении подтверждена выдача.",
  "reward.expired": "В приложении завершена заявка по истечении срока.",
};
export function neutralNotification(kind: string): string | null {
  return Object.hasOwn(messages, kind) ? messages[kind]! : null;
}

export type NotificationClaim = { outboxId: string; token: string };
export type SimulationTransport = (message: {
  eventId: string;
  recipientId: string;
  text: string;
  signal: AbortSignal;
}) => Promise<"simulated">;
export type SimulationResult =
  "simulated" | "retry" | "failed" | "suppressed" | "lost";

// One short transaction; independent workers skip each other's row locks.
// Disabled operation does not even open a connection.
export async function claimNotificationSimulation(
  pool: Pool,
  enabled: boolean,
): Promise<NotificationClaim | null> {
  if (!enabled) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO impuls.notification_simulations(outbox_id)
      SELECT o.id FROM impuls.notification_outbox o
      WHERE o.mode='synthetic' AND o.status='pending'
        AND NOT EXISTS(SELECT 1 FROM impuls.notification_simulations d WHERE d.outbox_id=o.id)
      ORDER BY o.created_at,o.id LIMIT 100 ON CONFLICT DO NOTHING`);
    await client.query(`UPDATE impuls.notification_simulations SET status='failed',
      error_code='attempts_exhausted',lease_token=NULL,lease_until=NULL,
      completed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE outbox_id IN (SELECT outbox_id FROM impuls.notification_simulations
        WHERE status='processing' AND lease_until<=clock_timestamp() AND attempts=5
        LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    const row = (
      await client.query<{ outbox_id: string; attempts: number }>(`
      SELECT outbox_id,attempts FROM impuls.notification_simulations
      WHERE attempts<5 AND ((status IN ('ready','retry') AND next_attempt_at<=clock_timestamp())
         OR (status='processing' AND lease_until<=clock_timestamp()))
      ORDER BY next_attempt_at,outbox_id LIMIT 1 FOR UPDATE SKIP LOCKED`)
    ).rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const token = randomUUID();
    await client.query(
      `UPDATE impuls.notification_simulations SET status='processing',
      attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds',
      updated_at=clock_timestamp() WHERE outbox_id=$1`,
      [row.outbox_id, token],
    );
    await client.query("COMMIT");
    return { outboxId: row.outbox_id, token };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processNotificationSimulation(
  pool: Pool,
  claim: NotificationClaim,
  transport: SimulationTransport,
  enabled: boolean,
): Promise<SimulationResult> {
  if (!enabled) return "lost";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    const row = (
      await client.query<{
        attempts: number;
        recipient_id: string;
        kind: string;
      }>(
        `SELECT d.attempts,o.recipient_id,o.kind
      FROM impuls.notification_simulations d JOIN impuls.notification_outbox o ON o.id=d.outbox_id
      WHERE d.outbox_id=$1 AND d.lease_token=$2 AND d.status='processing'
        AND d.lease_until>clock_timestamp() AND o.mode='synthetic' AND o.status='pending'
      FOR UPDATE OF d`,
        [claim.outboxId, claim.token],
      )
    ).rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return "lost";
    }
    const active = (
      await client.query<{ allowed: boolean }>(
        "SELECT impuls.lock_notification_recipient($1) allowed",
        [row.recipient_id],
      )
    ).rows[0]!.allowed;
    // Access checking may wait on a revocation transaction past the lease deadline.
    const valid = (
      await client.query<{ valid: boolean }>(
        "SELECT lease_until>clock_timestamp() valid FROM impuls.notification_simulations WHERE outbox_id=$1 AND lease_token=$2",
        [claim.outboxId, claim.token],
      )
    ).rows[0]?.valid;
    if (!valid) {
      await client.query("ROLLBACK");
      return "lost";
    }
    const text = neutralNotification(row.kind);
    let status: Exclude<SimulationResult, "lost">,
      code: string | null = null;
    if (!active || !text) {
      status = "suppressed";
      code = active ? "unsupported_kind" : "recipient_inactive";
    } else {
      // This boundary only accepts simulation receipts; it is not a Bot API adapter.
      const signal = AbortSignal.timeout(5000);
      let onAbort: (() => void) | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("simulation timeout"));
          signal.addEventListener("abort", onAbort, { once: true });
        });
        const receipt = await Promise.race([
          Promise.resolve().then(() =>
            transport({
              eventId: claim.outboxId,
              recipientId: row.recipient_id,
              text,
              signal,
            }),
          ),
          timeout,
        ]);
        if (receipt !== "simulated")
          throw new Error("Invalid simulation receipt");
        status = "simulated";
      } catch {
        status = row.attempts >= 5 ? "failed" : "retry";
        code = signal.aborted ? "timeout" : "transport_unavailable";
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    }
    const updated = await client.query(
      `UPDATE impuls.notification_simulations
      SET status=$3,error_code=$4,lease_token=NULL,lease_until=NULL,
        next_attempt_at=clock_timestamp()+($5::integer*interval '1 second'),
        completed_at=CASE WHEN $3 IN ('simulated','failed','suppressed') THEN clock_timestamp() ELSE NULL END,
        updated_at=clock_timestamp()
      WHERE outbox_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
      [claim.outboxId, claim.token, status, code, 30 * 2 ** (row.attempts - 1)],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return "lost";
    }
    await client.query("COMMIT");
    return status;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readNotificationSimulationCounts(pool: Pool) {
  const result = await pool.query<{ status: string; count: number }>(
    "SELECT status,count(*)::int count FROM impuls.notification_simulations GROUP BY status ORDER BY status",
  );
  return result.rows;
}
