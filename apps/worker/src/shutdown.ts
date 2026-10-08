// Shared by both workers. The deadline includes in-flight work and pool.end().
export function installWorkerShutdown(options: {
  mode: "simulation" | "reservation_expiry";
  reportTimeout: (event: {
    mode: string;
    error: "WORKER_STOP_TIMEOUT";
  }) => void;
}) {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    deadline = setTimeout(() => {
      options.reportTimeout({
        mode: options.mode,
        error: "WORKER_STOP_TIMEOUT",
      });
      process.exit(1);
    }, 20000);
    deadline.unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return {
    signal: controller.signal,
    stop,
    dispose: () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (deadline) clearTimeout(deadline);
    },
  };
}
