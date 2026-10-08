import { setTimeout as delay } from "node:timers/promises";
import type {
  NotificationClaim,
  SimulationResult,
} from "@impuls/domain/notification-simulation";

export function simulationPollInterval(value: string | undefined): number {
  if (value === undefined) return 5000;
  if (!/^\d+$/.test(value)) throw new Error("Invalid worker poll interval");
  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 60000)
    throw new Error("Invalid worker poll interval");
  return interval;
}

type Batch = Partial<Record<SimulationResult, number>>;
type SimulationLoop = {
  mode: "once" | "watch";
  signal: AbortSignal;
  pollIntervalMs: number;
  claim: () => Promise<NotificationClaim | null>;
  processClaim: (claim: NotificationClaim) => Promise<SimulationResult>;
  report: (results: Batch) => void;
  heartbeat?: () => void;
};

// Serial processing, bounded batches and an interruptible pause, including under load.
// A claim already in flight is drained on stop; its transaction is never cancelled.
export async function runSimulationLoop(
  options: SimulationLoop,
): Promise<void> {
  await runBatchLoop({
    ...options,
    step: async () => {
      const claim = await options.claim();
      return claim ? options.processClaim(claim) : null;
    },
  });
}

export async function runExpiryLoop(options: {
  mode: "once" | "watch";
  signal: AbortSignal;
  pollIntervalMs: number;
  expire: () => Promise<boolean>;
  report: (results: Partial<Record<"expired", number>>) => void;
  heartbeat?: () => void;
}): Promise<void> {
  await runBatchLoop({
    ...options,
    step: async () => ((await options.expire()) ? "expired" : null),
  });
}

async function runBatchLoop<Result extends string>(options: {
  mode: "once" | "watch";
  signal: AbortSignal;
  pollIntervalMs: number;
  step: () => Promise<Result | null>;
  report: (results: Partial<Record<Result, number>>) => void;
  heartbeat?: () => void;
}): Promise<void> {
  let lastHeartbeat = -Infinity;
  do {
    const results: Partial<Record<Result, number>> = {};
    for (let i = 0; i < 20 && !options.signal.aborted; i++) {
      const result = await options.step();
      const now = performance.now();
      if (
        options.mode === "watch" &&
        !options.signal.aborted &&
        now - lastHeartbeat >= 60000
      ) {
        options.heartbeat?.();
        lastHeartbeat = now;
      }
      if (result === null) break;
      results[result] = (results[result] ?? 0) + 1;
    }
    if (options.mode === "once" || Object.keys(results).length > 0)
      options.report(results);
    if (options.mode === "once" || options.signal.aborted) return;
    try {
      await delay(options.pollIntervalMs, undefined, {
        signal: options.signal,
      });
    } catch (error) {
      if (!options.signal.aborted) throw error;
      return;
    }
  } while (!options.signal.aborted);
}
