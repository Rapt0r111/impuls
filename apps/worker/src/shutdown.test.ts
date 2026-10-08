import { afterEach, describe, expect, it, vi } from "vitest";
import { installWorkerShutdown } from "./shutdown";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("shared worker stop deadline", () => {
  it("does not extend the 20s deadline on repeated signals", () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("test process exit");
    });
    const reportTimeout = vi.fn();
    const shutdown = installWorkerShutdown({
      mode: "reservation_expiry",
      reportTimeout,
    });
    try {
      shutdown.stop();
      expect(shutdown.signal.aborted).toBe(true);
      vi.advanceTimersByTime(19000);
      shutdown.stop();
      vi.advanceTimersByTime(999);
      expect(exit).not.toHaveBeenCalled();
      expect(() => vi.advanceTimersByTime(1)).toThrow("test process exit");
      expect(reportTimeout).toHaveBeenCalledExactlyOnceWith({
        mode: "reservation_expiry",
        error: "WORKER_STOP_TIMEOUT",
      });
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      shutdown.dispose();
    }
  });

  it("removes handlers and deadline after graceful pool cleanup", () => {
    vi.useFakeTimers();
    const before = [
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
    ];
    const reportTimeout = vi.fn();
    const shutdown = installWorkerShutdown({
      mode: "simulation",
      reportTimeout,
    });
    expect(process.listenerCount("SIGINT")).toBe(before[0]! + 1);
    expect(process.listenerCount("SIGTERM")).toBe(before[1]! + 1);
    shutdown.stop();
    shutdown.dispose();
    vi.advanceTimersByTime(25000);
    expect(reportTimeout).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGINT")).toBe(before[0]);
    expect(process.listenerCount("SIGTERM")).toBe(before[1]);
  });
});
