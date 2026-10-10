import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import {
  claimNotificationSimulation,
  enqueueTaskDueReminders,
  processNotificationSimulation,
} from "@impuls/domain/notification-simulation";
import { expireOneSyntheticReservation } from "@impuls/domain/reservation-expiry";
import { assertWorkerTlsUrl } from "./database-tls";
import { runExpiryLoop, runSimulationLoop } from "./loop";
import { assertBotToken, createTelegramTransport } from "./telegram";

export type EdgeMode = "simulation" | "reservation_expiry";
type Env = (name: string) => string | undefined;

// One bounded `--once` pass per scheduled HTTP call (ADR-0032). The process has no
// watch loop or signals: pg_cron is the scheduler, each call opens and closes its pool.
export function createTickHandler(
  mode: EdgeMode,
  env: Env,
  log: (line: string) => void = console.log,
): (request: Request) => Promise<Response> {
  const json = (status: number, body: object) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  return async (request) => {
    if (request.method !== "POST") return json(405, { error: "METHOD" });
    if (!authorized(request, env("WORKER_TRIGGER_SECRET")))
      return json(401, { error: "UNAUTHORIZED" });
    const expiry = mode === "reservation_expiry";
    const enabled = expiry
      ? env("RESERVATION_EXPIRY_ENABLED") === "true"
      : env("SYNTHETIC_NOTIFICATIONS_ENABLED") === "true";
    if (!enabled) {
      log(JSON.stringify({ mode, status: "disabled" }));
      return json(200, { mode, status: "disabled" });
    }
    const telegram = !expiry && env("TELEGRAM_DELIVERY_ENABLED") === "true";
    const label = telegram ? "telegram" : mode;
    let pool: Pool | undefined;
    try {
      const transport = telegram
        ? createTelegramTransport({
            token: assertBotToken(env("TELEGRAM_BOT_TOKEN")),
          })
        : async () => "simulated" as const;
      const reminders = !expiry && env("TASK_REMINDERS_ENABLED") === "true";
      pool = createPool(
        env(
          expiry
            ? "EXPIRY_WORKER_DATABASE_URL"
            : "NOTIFICATION_WORKER_DATABASE_URL",
        ),
        env("WORKER_CA_CERT_B64"),
      );
      const role = (
        await pool.query<{ current_user: string }>("SELECT current_user")
      ).rows[0]!.current_user;
      if (role !== (expiry ? "impuls_expiry_worker" : "impuls_worker"))
        throw new Error("Dedicated worker role required");
      const signal = new AbortController().signal;
      let results: object = {};
      const report = (batch: object) => {
        results = batch;
      };
      const active = pool;
      if (expiry)
        await runExpiryLoop({
          mode: "once",
          signal,
          pollIntervalMs: 0,
          expire: () => expireOneSyntheticReservation(active, true),
          report,
        });
      else
        await runSimulationLoop({
          mode: "once",
          signal,
          pollIntervalMs: 0,
          claim: async () => {
            await enqueueTaskDueReminders(active, reminders);
            return claimNotificationSimulation(active, true);
          },
          processClaim: (claim) =>
            processNotificationSimulation(
              active,
              claim,
              transport,
              true,
              telegram ? "telegram" : "simulation",
            ),
          report,
        });
      log(JSON.stringify({ mode: label, results }));
      return json(200, { mode: label, results });
    } catch {
      // Database/transport exceptions can contain credentials or recipient data.
      log(JSON.stringify({ mode: label, error: "WORKER_UNAVAILABLE" }));
      return json(503, { mode: label, error: "WORKER_UNAVAILABLE" });
    } finally {
      await pool?.end().catch(() => undefined);
    }
  };
}

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function createPool(
  connectionString: string | undefined,
  cert: string | undefined,
): Pool {
  if (!connectionString) throw new Error("Worker database URL required");
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && !cert) throw new Error("Verified database TLS required");
  assertWorkerTlsUrl(url);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    ...(local
      ? {}
      : {
          ssl: {
            rejectUnauthorized: true,
            ca: Buffer.from(cert!, "base64").toString("utf8"),
          },
        }),
  });
  // A socket error outside a query must not crash the isolate with a raw stack.
  pool.on("error", () => undefined);
  pool.on("connect", (client) => client.on("error", () => undefined));
  return pool;
}
