import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { localRestoreConnection } from "./database-restore-safety.mjs";

// Creates/drops internally named disposable databases, never an external cluster.
localRestoreConnection(process.env.TEST_DATABASE_URL);
const root = path.resolve(import.meta.dirname, "..");
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "apps/worker/src/loop.test.ts",
    "apps/worker/src/shutdown.test.ts",
    "tests/integration/worker-observability.test.ts",
    ...process.argv.slice(2),
  ],
  { cwd: root, env: process.env, stdio: "inherit", windowsHide: true },
);
const [code] = await once(child, "exit");
process.exitCode = code ?? 1;
