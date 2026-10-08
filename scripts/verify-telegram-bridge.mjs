import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const origin = "http://127.0.0.1:3101";
const env = { ...process.env, TEST_APP_ORIGIN: origin };
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "-H",
    "127.0.0.1",
    "--port",
    "3101",
  ],
  {
    cwd: path.join(root, "apps/app"),
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);
const done = once(server, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Test server stopped before readiness");
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      // The server has not opened its socket yet.
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Test server did not become ready");
  const child = spawn(
    process.execPath,
    [path.join(root, "tests/browser/telegram-bridge.mjs")],
    {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const [code] = await once(child, "exit");
  if (code !== 0)
    throw new Error(`Telegram bridge browser test failed with exit ${code}`);
} finally {
  server.kill();
  await done;
}
