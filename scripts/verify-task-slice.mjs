import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "TEST_DATABASE_URL is required; use an isolated migrated test database",
  );
const root = path.resolve(import.meta.dirname, "..");
const origin = "http://localhost:3100";
const runtimeUrl = new URL(process.env.TEST_DATABASE_URL);
runtimeUrl.searchParams.set("options", "-c role=impuls_app");
const env = {
  ...process.env,
  DATABASE_URL: runtimeUrl.toString(),
  APP_ORIGIN: origin,
  TEST_APP_ORIGIN: origin,
  CSRF_SECRET: "synthetic-task-slice-csrf-test-only",
};
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "-H",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    cwd: path.join(root, "apps/app"),
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);
const done = once(server, "exit");

async function run(file, args = []) {
  const child = spawn(process.execPath, [path.join(root, file), ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${file} failed with exit ${code}`);
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Test server stopped before readiness");
    try {
      const response = await fetch(`${origin}/api/v1/me`, {
        signal: AbortSignal.timeout(1000),
      });
      ready = response.status === 401;
    } catch {
      /* The local server has not opened its socket yet. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Test server did not become ready");
  await run("node_modules/vitest/vitest.mjs", ["run", "tests/integration"]);
  await run("tests/browser/tasks-smoke.mjs");
  await run("tests/browser/task-submissions.mjs");
} finally {
  server.kill();
  await done;
}
