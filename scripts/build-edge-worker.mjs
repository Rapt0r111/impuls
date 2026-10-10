import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Bundles apps/worker/src/edge.ts for Supabase Edge Functions (ADR-0032).
// pg stays external and is pinned to the lockfile version through an npm: specifier.
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(
  root,
  "supabase/functions/impuls-notifications/worker-edge.mjs",
);
const copies = ["supabase/functions/impuls-expiry/worker-edge.mjs"];
const pkg = JSON.parse(
  await readFile(path.join(root, "packages/domain/package.json"), "utf8"),
);
const build = spawnSync(
  "bun",
  [
    "build",
    "apps/worker/src/edge.ts",
    "--target",
    "node",
    "--format",
    "esm",
    "--external",
    "pg",
    "--outfile",
    out,
  ],
  { cwd: root, stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const source = await readFile(out, "utf8");
const pinned = source.replaceAll(
  /from\s*["']pg["']/g,
  `from "npm:pg@${pkg.dependencies.pg}"`,
);
if (pinned === source || /from\s*["']pg["']/.test(pinned))
  throw new Error("Expected exactly the external pg import to be pinned");
await writeFile(out, pinned);
// Each function uploads its own copy so the entry needs no path outside its folder.
for (const copy of copies) await writeFile(path.join(root, copy), pinned);
