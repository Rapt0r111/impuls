import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runExpiryLoop,
  runSimulationLoop,
  simulationPollInterval,
} from "./loop";

const claim = { outboxId: "synthetic-event", token: "synthetic-token" };
afterEach(() => vi.restoreAllMocks());

describe("F08 simulation process lifecycle", () => {
  it("emits a bounded heartbeat after successful steps under load, never after stop", async () => {
    const stop = new AbortController(),
      heartbeat = vi.fn();
    let time = 0,
      steps = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    await runExpiryLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 1000,
      heartbeat,
      expire: async () => {
        time = [0, 59999, 60000, 60001, 120000][steps++]!;
        if (steps === 5) stop.abort();
        return true;
      },
      report: () => {},
    });
    expect(steps).toBe(5);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });
  it("reports idle liveness without claiming a completion or emitting heartbeat in once mode", async () => {
    const stop = new AbortController(),
      heartbeat = vi.fn(),
      report = vi.fn();
    const running = runExpiryLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 60000,
      expire: async () => false,
      heartbeat,
      report,
    });
    await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledOnce());
    expect(report).not.toHaveBeenCalled();
    stop.abort();
    await running;
    heartbeat.mockClear();
    await runExpiryLoop({
      mode: "once",
      signal: new AbortController().signal,
      pollIntervalMs: 1000,
      expire: async () => false,
      heartbeat,
      report,
    });
    expect(heartbeat).not.toHaveBeenCalled();
  });
  it("does not emit liveness when a database step fails", async () => {
    const heartbeat = vi.fn();
    await expect(
      runExpiryLoop({
        mode: "watch",
        signal: new AbortController().signal,
        pollIntervalMs: 1000,
        expire: async () => {
          throw new Error("synthetic failure");
        },
        heartbeat,
        report: () => {},
      }),
    ).rejects.toThrow("synthetic failure");
    expect(heartbeat).not.toHaveBeenCalled();
  });
  it("bounds atomic expiry batches and drains an operation during shutdown", async () => {
    const expire = vi.fn(async () => true),
      report = vi.fn();
    await runExpiryLoop({
      mode: "once",
      signal: new AbortController().signal,
      pollIntervalMs: 5000,
      expire,
      report,
    });
    expect(expire).toHaveBeenCalledTimes(20);
    expect(report).toHaveBeenCalledExactlyOnceWith({ expired: 20 });
    const stop = new AbortController();
    const drained = vi.fn();
    await runExpiryLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 60000,
      expire: async () => {
        stop.abort();
        return true;
      },
      report: drained,
    });
    expect(drained).toHaveBeenCalledExactlyOnceWith({ expired: 1 });
  });
  it("accepts only bounded whole-millisecond poll intervals", () => {
    expect(simulationPollInterval(undefined)).toBe(5000);
    expect(simulationPollInterval("1000")).toBe(1000);
    expect(simulationPollInterval("60000")).toBe(60000);
    for (const value of [
      "",
      "0",
      "999",
      "60001",
      "1e3",
      "1000.5",
      " 1000",
      "NaN",
    ])
      expect(() => simulationPollInterval(value)).toThrow();
  });

  it("bounds once mode at 20 sequential attempts", async () => {
    const acquire = vi.fn(async () => claim);
    const processClaim = vi.fn(async () => "simulated" as const);
    const report = vi.fn();
    await runSimulationLoop({
      mode: "once",
      signal: new AbortController().signal,
      pollIntervalMs: 5000,
      claim: acquire,
      processClaim,
      report,
    });
    expect(acquire).toHaveBeenCalledTimes(20);
    expect(processClaim).toHaveBeenCalledTimes(20);
    expect(report).toHaveBeenCalledExactlyOnceWith({ simulated: 20 });
  });

  it("waits on an empty queue without idle log spam and wakes immediately on stop", async () => {
    const stop = new AbortController(),
      acquire = vi.fn(async () => null),
      report = vi.fn();
    const running = runSimulationLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 60000,
      claim: acquire,
      processClaim: async () => "simulated",
      report,
    });
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    stop.abort();
    await running;
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("pauses after a full batch, discovers later work, and stops before another claim", async () => {
    const stop = new AbortController(),
      acquire = vi.fn(async () => claim),
      report = vi.fn();
    const running = runSimulationLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 1000,
      claim: acquire,
      processClaim: async () => {
        if (acquire.mock.calls.length === 21) stop.abort();
        return "simulated";
      },
      report,
    });
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(acquire).toHaveBeenCalledTimes(20);
    await running;
    expect(acquire).toHaveBeenCalledTimes(21);
    expect(report.mock.calls).toEqual([
      [{ simulated: 20 }],
      [{ simulated: 1 }],
    ]);
  });

  it("drains a claim obtained during stop instead of leaving an unnecessary crash lease", async () => {
    const stop = new AbortController(),
      processClaim = vi.fn(async () => "simulated" as const);
    await runSimulationLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 5000,
      claim: async () => {
        stop.abort();
        return claim;
      },
      processClaim,
      report: () => {},
    });
    expect(processClaim).toHaveBeenCalledExactlyOnceWith(claim);
  });

  it("does not open the queue if stopped before the loop", async () => {
    const stop = new AbortController(),
      acquire = vi.fn(async () => claim);
    stop.abort();
    await runSimulationLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 5000,
      claim: acquire,
      processClaim: async () => "simulated",
      report: () => {},
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it("propagates database failures without starting an automatic reconnect loop", async () => {
    const acquire = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    await expect(
      runSimulationLoop({
        mode: "watch",
        signal: new AbortController().signal,
        pollIntervalMs: 5000,
        claim: acquire,
        processClaim: async () => "simulated",
        report: () => {},
      }),
    ).rejects.toThrow("database unavailable");
    expect(acquire).toHaveBeenCalledOnce();
  });
});
