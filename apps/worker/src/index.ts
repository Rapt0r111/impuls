import { Pool } from "pg";
import { assertWorkerTlsUrl } from "./database-tls";
import {
  claimNotificationSimulation,
  processNotificationSimulation,
  readNotificationSimulationCounts,
} from "@impuls/domain/notification-simulation";
import {
  expireOneSyntheticReservation,
  readSyntheticExpiryStatus,
} from "@impuls/domain/reservation-expiry";
import { installWorkerShutdown } from "./shutdown";
import {
  runExpiryLoop,
  runSimulationLoop,
  simulationPollInterval,
} from "./loop";

// Never loads app .env or a bot token. Hosting/restart policy belongs to an external supervisor.
async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 1 ||
    ![
      "--once",
      "--status",
      "--watch",
      "--expire-once",
      "--expire-watch",
      "--expire-status",
    ].includes(args[0]!)
  )
    throw new Error(
      "Use --once, --status, --watch, --expire-once, --expire-watch or --expire-status",
    );
  const expiry = args[0]!.startsWith("--expire-");
  const mode = expiry ? "reservation_expiry" : "simulation";
  const enabled = expiry
    ? process.env.SYNTHETIC_RESERVATION_EXPIRY_ENABLED === "true"
    : process.env.SYNTHETIC_NOTIFICATIONS_ENABLED === "true";
  if (!enabled) {
    console.log(JSON.stringify({ mode, status: "disabled" }));
    return;
  }
  const pollIntervalMs =
    args[0] === "--watch" || args[0] === "--expire-watch"
      ? simulationPollInterval(process.env.WORKER_POLL_INTERVAL_MS)
      : 5000;
  const connectionString = process.env.WORKER_DATABASE_URL;
  if (!connectionString) throw new Error("WORKER_DATABASE_URL required");
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const cert = process.env.SUPABASE_CA_CERT_B64;
  if (!local && !cert) throw new Error("Verified database TLS required");
  // pg URL ssl parameters override the explicit certificate options; reject that ambiguity.
  assertWorkerTlsUrl(url);
  const pool = new Pool({
    connectionString,
    max: 2,
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
  const stop = installWorkerShutdown({
    mode,
    reportTimeout: (event) => console.error(JSON.stringify(event)),
  });
  const heartbeat = () =>
    console.log(
      JSON.stringify({
        mode,
        status: "alive",
        observedAt: new Date().toISOString(),
      }),
    );
  const unavailable = () => {
    console.error(JSON.stringify({ mode, error: "WORKER_UNAVAILABLE" }));
    process.exitCode = 1;
    stop.stop();
  };
  pool.on("error", unavailable);
  // pg-pool removes its idle listener while a transaction checks out a client.
  // Socket errors can still be emitted outside the rejected query promise.
  pool.on("connect", (client) => client.on("error", unavailable));
  try {
    const role = (
      await pool.query<{ current_user: string }>("SELECT current_user")
    ).rows[0]!.current_user;
    if (role !== (expiry ? "impuls_expiry_worker" : "impuls_worker"))
      throw new Error("Dedicated worker role required");
    if (args[0] === "--expire-status") {
      console.log(
        JSON.stringify({
          mode,
          status: "observed",
          ...(await readSyntheticExpiryStatus(pool, true)),
        }),
      );
    } else if (expiry) {
      const watch = args[0] === "--expire-watch";
      if (watch) console.log(JSON.stringify({ mode, status: "watching" }));
      await runExpiryLoop({
        mode: watch ? "watch" : "once",
        signal: stop.signal,
        pollIntervalMs,
        expire: () => expireOneSyntheticReservation(pool, true),
        report: (results) => console.log(JSON.stringify({ mode, results })),
        heartbeat,
      });
      if (watch) console.log(JSON.stringify({ mode, status: "stopped" }));
    } else if (args[0] === "--status") {
      console.log(
        JSON.stringify({
          mode: "simulation",
          counts: await readNotificationSimulationCounts(pool),
        }),
      );
    } else {
      const watch = args[0] === "--watch";
      if (watch)
        console.log(JSON.stringify({ mode: "simulation", status: "watching" }));
      await runSimulationLoop({
        mode: watch ? "watch" : "once",
        signal: stop.signal,
        pollIntervalMs,
        claim: () => claimNotificationSimulation(pool, true),
        processClaim: (claim) =>
          processNotificationSimulation(
            pool,
            claim,
            async () => "simulated",
            true,
          ),
        report: (results) =>
          console.log(JSON.stringify({ mode: "simulation", results })),
        heartbeat,
      });
      if (watch)
        console.log(JSON.stringify({ mode: "simulation", status: "stopped" }));
    }
  } catch (error) {
    stop.stop();
    throw error;
  } finally {
    try {
      await pool.end();
    } finally {
      stop.dispose();
    }
  }
}
main().catch(() => {
  // Database/transport exceptions can contain credentials or recipient data.
  console.error(
    JSON.stringify({
      mode: process.argv[2]?.startsWith("--expire-")
        ? "reservation_expiry"
        : "simulation",
      error: "WORKER_UNAVAILABLE",
    }),
  );
  process.exitCode = 1;
});
