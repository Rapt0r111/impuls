import { spawnSync } from "node:child_process";

// Локальный прогон шагов из .github/workflows/check.yml, когда GitHub Actions недоступен.
// Перед каждым прогоном база пересоздаётся (scripts/reset-local-test-db.mjs), иначе тесты видят
// данные прошлого прогона. Шаг «Интеграция» есть только здесь: тесты, которым нужен запущенный
// сервер, в нём пропускаются и идут в шаге «Задачи (сценарий)». Для теста восстановления задайте
// PG_BIN с pg_dump 17. Шаги, которым нужны браузер или PostgreSQL 17, помечаются в итоге явно.
// Использование: bun run ci:local [--db-url=postgres://…] [--skip-browser]
const args = new Set(process.argv.slice(2));
const dbArg = process.argv.find((arg) => arg.startsWith("--db-url="));
const databaseUrl =
  dbArg?.slice("--db-url=".length) ?? process.env.TEST_DATABASE_URL ?? "";
const skipBrowser = args.has("--skip-browser");

const steps = [
  { name: "Проверка форматирования", cmd: ["bun", "run", "format:check"] },
  { name: "Секреты в файлах", cmd: ["node", "scripts/scan-secrets.mjs"] },
  {
    name: "Сброс тестовой базы",
    cmd: ["node", "scripts/reset-local-test-db.mjs"],
    needs: "db",
  },
  {
    name: "Миграции",
    cmd: ["bun", "run", "db:migrate"],
    needs: "db",
  },
  {
    name: "Общая проверка (lint, typecheck, unit, build)",
    cmd: ["bun", "run", "check"],
    env: { TEST_DATABASE_URL: "" },
  },
  {
    name: "Интеграция: правила, профиль, рейтинг",
    cmd: ["bunx", "vitest", "run", "tests/integration"],
    needs: "db",
  },
  {
    name: "Задачи (сценарий)",
    cmd: ["bun", "run", "test:task-slice"],
    needs: "db",
  },
  {
    name: "Телеграм-мост",
    cmd: ["bun", "run", "test:telegram"],
    needs: "browser",
  },
  {
    name: "Перенос текста (reflow)",
    cmd: ["node", "scripts/verify-workspace-reflow.mjs"],
    needs: "browser",
  },
];

const results = [];
for (const step of steps) {
  if (step.needs === "db" && !databaseUrl) {
    results.push({ name: step.name, status: "пропущен: нет --db-url" });
    continue;
  }
  if (step.needs === "browser" && skipBrowser) {
    results.push({ name: step.name, status: "пропущен: --skip-browser" });
    continue;
  }
  console.log(`\n== ${step.name}`);
  const run = spawnSync(step.cmd[0], step.cmd.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(step.needs === "db"
        ? {
            DATABASE_URL: databaseUrl,
            MIGRATION_DATABASE_URL: databaseUrl,
            TEST_DATABASE_URL: databaseUrl,
          }
        : {}),
      ...(step.env ?? {}),
    },
  });
  results.push({
    name: step.name,
    status:
      run.status === 0 ? "пройден" : `провален (код ${run.status ?? "?"})`,
  });
}

console.log("\n== Итог");
for (const result of results)
  console.log(`${result.status.padEnd(28)} ${result.name}`);
process.exit(results.some((r) => r.status.startsWith("провален")) ? 1 : 0);
