import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "TEST_DATABASE_URL is required; use an isolated migrated test database",
  );
const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 &&
    ![
      "--timeline-only",
      "--corrections-only",
      "--ranking-only",
      "--profile-only",
      "--audit-only",
      "--rewards-only",
      "--reward-decisions-only",
      "--reward-fulfillment-only",
      "--reward-pagination-only",
      "--reward-expiry-only",
      "--notification-status-only",
      "--admin-catalog-only",
      "--catalog-scheduling-only",
      "--catalog-cancellation-only",
      "--access-management-only",
    ].includes(args[0]))
)
  throw new Error(
    "Supported options: --timeline-only, --corrections-only, --ranking-only, --profile-only, --audit-only, --rewards-only, --reward-decisions-only, --reward-fulfillment-only, --reward-pagination-only, --reward-expiry-only, --notification-status-only, --admin-catalog-only, --catalog-scheduling-only, --catalog-cancellation-only or --access-management-only",
  );
const timelineOnly = args[0] === "--timeline-only";
const correctionsOnly = args[0] === "--corrections-only";
const rankingOnly = args[0] === "--ranking-only";
const profileOnly = args[0] === "--profile-only";
const auditOnly = args[0] === "--audit-only";
const rewardsOnly = args[0] === "--rewards-only";
const decisionsOnly = args[0] === "--reward-decisions-only";
const fulfillmentOnly = args[0] === "--reward-fulfillment-only";
const paginationOnly = args[0] === "--reward-pagination-only";
const expiryOnly = args[0] === "--reward-expiry-only";
const adminCatalogOnly = args[0] === "--admin-catalog-only";
const cancellationOnly = args[0] === "--catalog-cancellation-only";
const accessOnly = args[0] === "--access-management-only";
const schedulingOnly = args[0] === "--catalog-scheduling-only";
const notificationStatusOnly = args[0] === "--notification-status-only";
const origin = "http://localhost:3100";
const runtimeUrl = new URL(process.env.TEST_DATABASE_URL);
runtimeUrl.searchParams.set("options", "-c role=impuls_app");
const env = {
  ...process.env,
  DATABASE_URL: runtimeUrl.toString(),
  APP_ORIGIN: origin,
  TEST_APP_ORIGIN: origin,
  CSRF_SECRET: "synthetic-task-slice-csrf-test-only",
  TELEGRAM_BOT_TOKEN: "synthetic-task-slice-bot-test-only",
  SYNTHETIC_ECONOMY_ENABLED: "true",
  SYNTHETIC_LEDGER_CORRECTIONS_ENABLED: "true",
  SYNTHETIC_RANKING_ENABLED: "true",
  SYNTHETIC_PROFILE_ENABLED: "true",
  SYNTHETIC_AUDIT_ENABLED: "true",
  SYNTHETIC_ADMIN_CATALOG_ENABLED: "true",
  SYNTHETIC_CATALOG_PUBLICATION_ENABLED: "true",
  SYNTHETIC_CATALOG_SCHEDULING_ENABLED: "true",
  SYNTHETIC_CATALOG_CANCELLATION_ENABLED: "true",
  SYNTHETIC_ACCESS_MANAGEMENT_ENABLED: "true",
  SYNTHETIC_CATALOG_CREATION_ENABLED: "true",
  SYNTHETIC_QUOTA_PUBLICATION_ENABLED: "true",
  SYNTHETIC_NOTIFICATION_STATUS_ENABLED: "true",
  SYNTHETIC_REWARDS_ENABLED: "true",
  SYNTHETIC_TASK_MANAGEMENT_ENABLED: "true",
  TEST_SCREENSHOT_DIR:
    process.env.TEST_SCREENSHOT_DIR ??
    path.join(root, "test-results", "task-slice", String(process.pid)),
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
  if (accessOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/access-management.test.ts",
      "packages/contracts/src/access-management.test.ts",
    ]);
    await run("tests/browser/access-management.mjs");
    await run("tests/browser/access-real.mjs");
    await run("tests/browser/task-flow-real.mjs");
    await run("tests/browser/task-negative-real.mjs");
  } else if (cancellationOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/catalog-cancellation.test.ts",
      "packages/contracts/src/catalog-cancellation.test.ts",
    ]);
    await run("tests/browser/catalog-cancellation.mjs");
  } else if (schedulingOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/catalog-publication.test.ts",
      "packages/contracts/src/catalog-publication.test.ts",
    ]);
    await run("tests/browser/catalog-scheduling.mjs");
  } else if (adminCatalogOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/admin-catalog.test.ts",
      "tests/integration/catalog-publication.test.ts",
      "tests/integration/catalog-creation.test.ts",
      "tests/integration/catalog-cancellation.test.ts",
      "tests/integration/quota-publication.test.ts",
    ]);
    await run("tests/browser/admin-catalog.mjs");
    await run("tests/browser/catalog-publication.mjs");
    await run("tests/browser/catalog-scheduling.mjs");
    await run("tests/browser/catalog-cancellation.mjs");
    await run("tests/browser/catalog-creation.mjs");
    await run("tests/browser/quota-publication.mjs");
  } else if (notificationStatusOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/notification-status.test.ts",
      "tests/integration/notification-status-migration.test.ts",
      "tests/integration/notification-attempts.test.ts",
    ]);
    await run("tests/browser/notification-status.mjs");
  } else if (paginationOnly || expiryOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/reward-pagination.test.ts",
      "tests/integration/reward-catalog-pagination.test.ts",
      "tests/integration/rewards.test.ts",
      "tests/integration/reward-decisions.test.ts",
      "tests/integration/reward-fulfillment.test.ts",
      ...(expiryOnly
        ? [
            "tests/integration/reward-expiry-migration.test.ts",
            "tests/integration/reward-audit.test.ts",
            "tests/integration/automatic-expiry.test.ts",
          ]
        : []),
    ]);
    await run("tests/browser/rewards.mjs");
    await run("tests/browser/reward-decisions.mjs");
    await run("tests/browser/reward-fulfillment.mjs");
  } else if (fulfillmentOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/reward-fulfillment.test.ts",
      "tests/integration/reward-fulfillment-migration.test.ts",
    ]);
    await run("tests/browser/reward-fulfillment.mjs");
    await run("tests/browser/rewards.mjs");
    await run("tests/browser/reward-decisions.mjs");
  } else if (decisionsOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/reward-decisions.test.ts",
      "tests/integration/reward-decisions-migration.test.ts",
    ]);
    await run("tests/browser/reward-decisions.mjs");
  } else if (rewardsOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/rewards.test.ts",
      "tests/integration/reward-catalog-pagination.test.ts",
      "tests/integration/rewards-migration.test.ts",
    ]);
    await run("tests/browser/rewards.mjs");
  } else if (auditOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/audit.test.ts",
      "tests/integration/reward-audit.test.ts",
      "tests/integration/audit-migration.test.ts",
    ]);
    await run("tests/browser/audit.mjs");
  } else if (profileOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/profile.test.ts",
      "tests/integration/profile-migration.test.ts",
    ]);
    await run("tests/browser/profile.mjs");
  } else if (rankingOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/leaderboard.test.ts",
    ]);
    await run("tests/browser/leaderboard.mjs");
  } else if (correctionsOnly) {
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "tests/integration/ledger-corrections.test.ts",
      "tests/integration/ledger-corrections-migration.test.ts",
    ]);
    await run("tests/browser/ledger-corrections.mjs");
  } else if (!timelineOnly) {
    await run("node_modules/vitest/vitest.mjs", ["run", "tests/integration"]);
    await run("tests/browser/embedded-access.mjs");
    await run("tests/browser/tasks-smoke.mjs");
    await run("tests/browser/task-submissions.mjs");
    await run("tests/browser/task-reviews.mjs");
    await run("tests/browser/task-acceptance.mjs");
    await run("tests/browser/task-management.mjs");
    await run("tests/browser/task-history.mjs");
    await run("tests/browser/task-edit-cancel.mjs");
    await run("tests/browser/ledger-corrections.mjs");
    await run("tests/browser/leaderboard.mjs");
  }
  if (
    !adminCatalogOnly &&
    !cancellationOnly &&
    !accessOnly &&
    !schedulingOnly &&
    !notificationStatusOnly &&
    !timelineOnly &&
    !correctionsOnly &&
    !rankingOnly &&
    !profileOnly &&
    !auditOnly &&
    !rewardsOnly &&
    !decisionsOnly &&
    !paginationOnly &&
    !expiryOnly &&
    !fulfillmentOnly
  ) {
    await run("tests/browser/profile.mjs");
    await run("tests/browser/audit.mjs");
    await run("tests/browser/rewards.mjs");
    await run("tests/browser/reward-decisions.mjs");
    await run("tests/browser/reward-fulfillment.mjs");
    await run("tests/browser/notification-status.mjs");
    await run("tests/browser/admin-catalog.mjs");
    await run("tests/browser/catalog-publication.mjs");
    await run("tests/browser/catalog-scheduling.mjs");
    await run("tests/browser/catalog-cancellation.mjs");
    await run("tests/browser/catalog-creation.mjs");
    await run("tests/browser/quota-publication.mjs");
  }
  if (
    !adminCatalogOnly &&
    !schedulingOnly &&
    !notificationStatusOnly &&
    !correctionsOnly &&
    !cancellationOnly &&
    !accessOnly &&
    !rankingOnly &&
    !profileOnly &&
    !auditOnly &&
    !rewardsOnly &&
    !decisionsOnly &&
    !paginationOnly &&
    !expiryOnly &&
    !fulfillmentOnly
  )
    await run("tests/browser/task-timeline.mjs");
} finally {
  server.kill();
  await done;
}
