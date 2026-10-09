import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

// API/Telegram fixtures exercise layout only; no database or external writes.
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? "test-results",
  "workspace-reflow",
);
const reportOnly = process.env.TEST_REFLOW_REPORT_ONLY === "1";
const id = "a1111111-1111-4111-8111-111111111111";
const scopeId = "b1111111-1111-4111-8111-111111111111";
const versionId = "c1111111-1111-4111-8111-111111111111";
const at = "2026-10-06T10:00:00.000Z";
const longName = "Учебная_область_с_длинным_названием_для_проверки_переноса";
const scope = { id: scopeId, name: longName };
const balance = {
  lifetimeXp: 12345,
  availablePoints: 6789,
  reservedPoints: 1234,
  version: 1,
  updatedAt: at,
};
const task = {
  id,
  title: "Синтетическая_задача_с_длинным_неразрывным_названием",
  status: "in_progress",
  priority: "high",
  dueAt: "2040-01-01T00:00:00.000Z",
  fundXp: 12345,
  fundPoints: 6789,
  ruleVersion: 1,
  version: 2,
  updatedAt: at,
  criteria: "Описать синтетический результат и независимую проверку.",
  latestSubmission: null,
  scope: { ...scope, kind: "project" },
};
const terms = {
  id: versionId,
  version: 1,
  title: "Синтетический_косметический_знак_исследователя",
  conditions:
    "Учебные условия косметики. Не предоставляют служебных привилегий.",
  price: 30,
  enabled: true,
  effectiveFrom: at,
  reservationSeconds: 3600,
};
const scheduled = {
  ...terms,
  id,
  version: 2,
  effectiveFrom: "2040-01-01T00:00:00.000Z",
};
const quota = {
  id,
  startsAt: at,
  endsAt: "2040-01-01T00:00:00.000Z",
  capacity: 12345,
  reserved: 1234,
  used: 5678,
  available: 5433,
};
const views = [
  ["home", "Главная", ".home-level"],
  ["tasks", "Мои задачи", ".tasks-list > li"],
  ["ledger", "Баланс и журнал", ".ledger-balances"],
  ["rewards", "Поощрения", ".reward-row"],
  ["ranking", "Рейтинг", ".ranking-table tbody tr"],
  ["profile", "Мой профиль", ".profile-block"],
  ["reviews", "Проверка отчётов", ".tasks-list > li"],
  ["management", "Постановка задач", ".task-mgmt__item"],
  ["catalog", "Управление каталогом", ".admin-catalog-items > li"],
  ["audit", "Журнал действий", ".audit-section"],
  ["notifications", "Состояние уведомлений", ".notification-counts"],
];

async function fixture(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    reducedMotion: "reduce",
    timezoneId: "Europe/Moscow",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [],
    unexpected = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.__back=null;window.Telegram={WebApp:{version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},enableClosingConfirmation(){},disableClosingConfirmation(){},BackButton:{show(){},hide(){},onClick(cb){window.__back=cb},offClick(){window.__back=null}}}}",
    }),
  );
  const review = {
    submissionId: versionId,
    text: "Синтетический отчёт с независимой проверкой.",
    submittedAt: at,
    attemptNumber: 1,
    author: { id, displayName: "Синтетический_участник_с_длинным_псевдонимом" },
    task: { ...task, status: "in_review", version: 3 },
  };
  const responses = {
    "/api/v1/me": {
      user: { id, displayName: "Синтетический_участник_с_длинным_псевдонимом" },
      csrfToken: "synthetic",
    },
    "/api/v1/me/permissions": {
      permissions: [
        "task.review",
        "task.create",
        "task.assign",
        "task.view",
        "ledger.correct",
        "admin.catalog",
        "admin.audit",
        "admin.notifications",
      ].map((action) => ({
        action,
        scope: { ...scope, kind: "project" },
        validUntil: null,
      })),
    },
    "/api/v1/tasks": { items: [task], nextCursor: null },
    [`/api/v1/tasks/${id}`]: { task },
    "/api/v1/reviews": { items: [review], nextCursor: null },
    "/api/v1/me/ledger": {
      balance,
      entries: [
        {
          id,
          currency: "xp",
          amount: 12345,
          kind: "task_acceptance",
          reason: "Синтетический результат",
          task: { id, title: task.title },
          ruleVersion: 1,
          seasonKey: "2026-10",
          timeZone: "Europe/Moscow",
          mode: "synthetic",
          createdAt: at,
        },
      ],
      nextCursor: null,
      asOf: at,
    },
    "/api/v1/leaderboard": {
      mode: "synthetic",
      timeZone: "Europe/Moscow",
      season: "2026-10",
      scope,
      scopes: [scope],
      self: { xp: 12345, rank: 1 },
      items: [
        {
          id,
          displayName: "Синтетический_участник_с_длинным_псевдонимом",
          xp: 12345,
          rank: 1,
          isSelf: true,
        },
      ],
      nextCursor: null,
      revision: "a".repeat(64),
      updatedAt: at,
    },
    "/api/v1/me/profile": {
      mode: "synthetic",
      user: { id, displayName: "Синтетический участник" },
      balance,
      progression: {
        state: "configured",
        ruleVersion: 1,
        level: {
          level: 2,
          minimumXp: 100,
          nextLevelXp: 20000,
          remainingXp: 7655,
          progressXp: 12245,
          spanXp: 19900,
        },
      },
      firstResult: {
        code: "first_result",
        conditionVersion: 1,
        sourceEntryId: id,
        reviewId: id,
        task: { id, title: task.title },
        grantedAt: at,
        provenance: "acceptance",
        sourceCorrected: false,
      },
      asOf: at,
    },
    "/api/v1/task-management/options": {
      scopes: [
        {
          ...scope,
          kind: "project",
          canCreate: true,
          canAssign: true,
          assignees: [{ id, displayName: "Учебный исполнитель" }],
        },
      ],
      ruleSets: [{ id, version: 1 }],
    },
    "/api/v1/task-management": {
      items: [
        {
          ...task,
          status: "draft",
          categoryCode: "synthetic",
          ruleSetId: id,
          assignee: null,
        },
      ],
      nextCursor: null,
    },
    "/api/v1/admin/rewards": {
      mode: "synthetic",
      scope,
      scopes: [scope],
      canPublish: true,
      canSchedule: true,
      canCancelSchedule: true,
      canCreate: true,
      canPublishQuota: true,
      items: [{ rewardId: id, current: terms, scheduled, quota }],
      updatedAt: at,
      nextCursor: null,
    },
    "/api/v1/rewards": {
      mode: "synthetic",
      scope,
      scopes: [scope],
      balance,
      items: [
        {
          ...terms,
          rewardId: id,
          quota: { id, startsAt: at, endsAt: quota.endsAt, available: 5433 },
          hasPendingRequest: false,
        },
      ],
      nextCursor: null,
      updatedAt: at,
    },
    "/api/v1/me/redemptions": {
      mode: "synthetic",
      items: [],
      nextCursor: null,
      updatedAt: at,
    },
    "/api/v1/admin/audit": {
      mode: "synthetic",
      scope,
      scopes: [scope],
      items: [],
      nextCursor: null,
      updatedAt: at,
    },
    "/api/v1/admin/notifications": {
      mode: "simulation",
      scope,
      scopes: [scope],
      updatedAt: at,
      recentEvents: [
        {
          kind: "reward.approved",
          createdAt: at,
          status: "retry",
          errorCode: "timeout",
        },
      ],
      counts: {
        unclaimed: 3,
        ready: 1,
        processing: 2,
        retry: 4,
        simulated: 12345,
        failed: 6,
        suppressed: 2,
      },
      errors: {
        transport_unavailable: 3,
        timeout: 2,
        attempts_exhausted: 1,
        recipient_inactive: 1,
        unsupported_kind: 1,
      },
    },
  };
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/"),
    (r) => {
      const pathname = new URL(r.request().url()).pathname;
      if (r.request().method() !== "GET" || !(pathname in responses)) {
        unexpected.push(`${r.request().method()} ${pathname}`);
        return r.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"code":"UNEXPECTED_FIXTURE_REQUEST"}',
        });
      }
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(responses[pathname]),
      });
    },
  );
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-nav").waitFor();
  return { context, page, errors, unexpected };
}

async function resizeText(page, mode) {
  await page.evaluate((mode) => {
    // Freeze original sizes before applying overrides so nested text scales once.
    const elements = [
      ...document.querySelectorAll(".access-screen, .access-screen *"),
    ];
    const sizes = elements.map((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    elements.forEach((el, i) => {
      el.style.setProperty(
        "font-size",
        `${mode === "uniform24" ? 24 : sizes[i] * 2}px`,
        "important",
      );
      el.style.setProperty("line-height", "1.6", "important");
    });
  }, mode);
}

async function inspect(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const outside = [],
      clippedButtons = [],
      smallTargets = [];
    for (const el of document.querySelectorAll(".access-screen *")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const name = `${el.tagName.toLowerCase()}.${el.className}`;
      if (rect.left < -1 || rect.right > innerWidth + 1) outside.push(name);
      if (
        el.matches(
          "button, summary, select, textarea, input:not([type=checkbox]):not([type=radio])",
        ) &&
        (rect.height < 44 || rect.width < 44)
      )
        smallTargets.push(name);
      if (el.matches("button")) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const text of range.getClientRects()) {
            if (
              text.left < rect.left - 1 ||
              text.right > rect.right + 1 ||
              text.bottom > rect.bottom + 1
            )
              clippedButtons.push(`${name}: ${el.textContent}`);
          }
        }
      }
    }
    return {
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      outside: [...new Set(outside)],
      clippedButtons: [...new Set(clippedButtons)],
      smallTargets: [...new Set(smallTargets)],
    };
  });
}

await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [320, 360, 390, 1280]) {
    for (const mode of ["normal", "uniform24", "double"]) {
      for (const [name, label, ready] of views) {
        const f = await fixture(browser, width);
        try {
          await f.page
            .getByRole("button", { name: label, exact: true })
            .click();
          await f.page.locator(ready).first().waitFor();
          if (name === "audit") {
            await f.page
              .getByText("Записанных действий по выбранному фильтру нет.", {
                exact: true,
              })
              .waitFor();
          }
          if (mode !== "normal") await resizeText(f.page, mode);
          await f.page
            .getByRole("button", { name: label, exact: true })
            .focus();
          await f.page.keyboard.press("Enter");
          assert.equal(
            await f.page
              .getByRole("button", { name: label, exact: true })
              .getAttribute("aria-pressed"),
            "true",
          );
          const metrics = await inspect(f.page);
          results.push({
            name,
            width,
            mode,
            ...metrics,
            errors: f.errors,
            unexpected: f.unexpected,
          });
          if (
            (width === 320 &&
              mode !== "normal" &&
              ["catalog", "tasks", "ranking", "management"].includes(name)) ||
            (width === 1280 && mode === "normal" && name === "catalog")
          ) {
            await f.page.evaluate(() => scrollTo(0, 0));
            await f.page.screenshot({
              path: path.join(dir, `${name}-${mode}-${width}.png`),
              fullPage: true,
            });
            if (name === "tasks" && width === 320) {
              await f.page.locator(".workspace-nav").screenshot({
                path: path.join(dir, `navigation-${mode}-${width}.png`),
              });
            }
          }
        } finally {
          await f.context.close();
        }
      }
    }
  }
  // Exercise inset forms, where padding and side-by-side values reduce space.
  for (const width of [320, 360, 390]) {
    for (const mode of ["uniform24", "double"]) {
      for (const name of ["task-detail", "review-detail", "cancel-preview"]) {
        const f = await fixture(browser, width);
        try {
          const page = f.page;
          if (name === "task-detail") {
            await page
              .getByRole("button", { name: "Мои задачи", exact: true })
              .click();
            await page.locator(".tasks-row").first().click();
            await page.locator(".task-report textarea").waitFor();
            await page
              .locator(".task-report textarea")
              .fill("Синтетический несданный отчёт.");
          } else if (name === "review-detail") {
            await page
              .getByRole("button", { name: "Проверка отчётов", exact: true })
              .click();
            await page.locator(".tasks-row").first().click();
            await page
              .getByLabel("Причина возврата", { exact: true })
              .waitFor();
          } else {
            await page
              .getByRole("button", {
                name: "Управление каталогом",
                exact: true,
              })
              .click();
            await page
              .getByRole("button", {
                name: "Отменить будущие условия",
                exact: true,
              })
              .click();
            await page
              .getByLabel("Основание отмены", { exact: true })
              .fill("Синтетическое основание отмены.");
            await page
              .getByRole("button", { name: "Проверить отмену", exact: true })
              .click();
            await page
              .getByRole("button", { name: "Подтвердить отмену", exact: true })
              .waitFor();
          }
          // Lateral safe areas reduce available space further; this is a CSS
          // fixture, not proof of the Telegram device adapter or OS settings.
          await page.evaluate(() => {
            document.documentElement.style.setProperty(
              "--impuls-device-safe-left",
              "24px",
            );
            document.documentElement.style.setProperty(
              "--impuls-device-safe-right",
              "24px",
            );
          });
          await resizeText(page, mode);
          results.push({
            name,
            width,
            mode,
            ...(await inspect(page)),
            errors: f.errors,
            unexpected: f.unexpected,
          });
          if (width === 320) {
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({
              path: path.join(dir, `${name}-${mode}-${width}.png`),
              fullPage: true,
            });
          }
          if (name === "task-detail") {
            page.once("dialog", (dialog) => dialog.dismiss());
            await page
              .getByRole("button", { name: "Рейтинг", exact: true })
              .focus();
            await page.keyboard.press("Enter");
            assert.equal(
              await page.locator(".task-report textarea").inputValue(),
              "Синтетический несданный отчёт.",
            );
          }
        } finally {
          await f.context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(dir, "metrics.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
const failures = results.filter(
  (r) =>
    r.scrollWidth > r.viewport ||
    r.outside.length ||
    r.clippedButtons.length ||
    r.smallTargets.length ||
    r.errors.length ||
    r.unexpected.length,
);
console.log(
  JSON.stringify({
    scenarios: results.length,
    failures: failures.length,
    screenshots: dir,
  }),
);
if (reportOnly) console.log(JSON.stringify(failures));
else
  assert.deepEqual(
    failures,
    [],
    "Workspace reflow must preserve document width, controls and button labels",
  );
