import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  homeFallbackProfile,
  mockHomeFallback,
  openReviewQueue,
} from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3101";
const id = "11111111-1111-4111-8111-111111111111";
const scopeId = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";
const reviewId = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-02T08:00:00.000Z";
const scope = { id: scopeId, kind: "project", name: "Учебная область" };
const task = {
  id: taskId,
  title: "Проверить синтетический результат",
  criteria: "Сверить два независимых учебных примера.",
  status: "in_progress",
  priority: "normal",
  dueAt: "2035-01-01T12:00:00.000Z",
  fundXp: 100,
  fundPoints: 30,
  ruleVersion: 1,
  version: 2,
  updatedAt: at,
  latestSubmission: null,
  scope,
};
const balance = {
  lifetimeXp: 100,
  availablePoints: 30,
  reservedPoints: 0,
  version: 1,
  updatedAt: at,
};

// This is an SDK simulation, not evidence about physical Telegram clients.
function installSdk(mode) {
  const events = new Map();
  const backHandlers = new Set();
  const staleBackHandlers = [];
  window.telegramTest = {
    colors: [],
    closing: false,
    ready: 0,
    expands: 0,
    emit(name, data) {
      for (const handler of events.get(name) ?? []) handler(data);
    },
    back() {
      for (const handler of backHandlers) handler();
    },
    staleBack() {
      for (const handler of staleBackHandlers) handler();
    },
    listeners() {
      return {
        back: backHandlers.size,
        events: Object.fromEntries(
          Array.from(events, ([name, handlers]) => [name, handlers.size]),
        ),
      };
    },
  };
  const native = (method, color) => {
    if (mode === "throwing") throw new Error("Unsupported native method");
    window.telegramTest.colors.push({ method, color });
  };
  const app = {
    initData: "",
    ready() {
      window.telegramTest.ready++;
    },
    expand() {
      window.telegramTest.expands++;
    },
    close() {},
    setHeaderColor(color) {
      native("header", color);
    },
    setBackgroundColor(color) {
      native("background", color);
    },
    enableClosingConfirmation() {
      window.telegramTest.closing = true;
    },
    disableClosingConfirmation() {
      window.telegramTest.closing = false;
    },
  };
  if (mode !== "legacy")
    Object.assign(app, {
      colorScheme: "dark",
      viewportHeight: 740,
      viewportStableHeight: 740,
      safeAreaInset: { top: 24, bottom: 34, left: 26, right: 18 },
      contentSafeAreaInset: { top: 48, bottom: 16, left: 4, right: 12 },
      setBottomBarColor(color) {
        native("bottom", color);
      },
      onEvent(name, handler) {
        if (mode === "throwing") throw new Error("Unsupported event");
        if (!events.has(name)) events.set(name, new Set());
        events.get(name).add(handler);
      },
      offEvent(name, handler) {
        events.get(name)?.delete(handler);
      },
      BackButton: {
        visible: false,
        show() {
          this.visible = true;
        },
        hide() {
          this.visible = false;
        },
        onClick(handler) {
          if (mode === "throwing") throw new Error("Unsupported back");
          backHandlers.add(handler);
          staleBackHandlers.push(handler);
        },
        offClick(handler) {
          backHandlers.delete(handler);
        },
      },
    });
  window.Telegram = { WebApp: app };
}

const browser = await chromium.launch({ headless: true });
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? "test-results/telegram-bridge",
);
await mkdir(dir, { recursive: true });
let scenarios = 0;

async function fixture(width = 390, mode = "modern", role = "participant") {
  const page = await browser.newPage({
    viewport: { width, height: 820 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body:
        mode === "late"
          ? `setTimeout(() => (${installSdk.toString()})("modern"), 12000);`
          : `(${installSdk.toString()})(${JSON.stringify(mode)});`,
    }),
  );
  const permissions = {
    participant: [],
    reviewer: ["task.review"],
    manager: ["task.edit"],
    corrector: ["ledger.correct"],
  }[role];
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/me")
      return json(route, {
        user: { id, displayName: "Синтетический участник" },
        csrfToken: "synthetic-csrf",
      });
    if (url.pathname === "/api/v1/me/permissions")
      return json(route, {
        permissions: permissions.map((action) => ({
          action,
          scope,
          validUntil: null,
        })),
      });
    if (url.pathname === "/api/v1/tasks")
      return json(route, { items: [task], nextCursor: null });
    if (url.pathname === `/api/v1/tasks/${taskId}`)
      return json(route, { task });
    if (url.pathname === "/api/v1/me/ledger")
      return json(route, {
        balance,
        items: [],
        nextCursor: null,
        asOf: at,
      });
    if (url.pathname === "/api/v1/reviews")
      return json(route, {
        items: [
          {
            submissionId: reviewId,
            text: "Учебный отчёт",
            submittedAt: at,
            attemptNumber: 1,
            author: { id, displayName: "Учебный исполнитель" },
            task: { ...task, status: "in_review" },
          },
        ],
        nextCursor: null,
        updatedAt: at,
      });
    if (url.pathname === "/api/v1/task-management/options")
      return json(route, {
        scopes: [
          {
            ...scope,
            canCreate: false,
            canAssign: false,
            canEdit: true,
            canCancel: false,
            assignees: [],
          },
        ],
        ruleSets: [],
      });
    if (url.pathname === "/api/v1/task-management")
      return json(route, {
        items: [
          {
            ...task,
            status: "draft",
            categoryCode: "synthetic-check",
            ruleSetId: reviewId,
            assignee: null,
          },
        ],
        nextCursor: null,
      });
    if (url.pathname === "/api/v1/admin/ledger-corrections")
      return json(route, {
        items: [
          {
            reviewId,
            task: { id: taskId, title: task.title },
            recipient: { id, displayName: "Учебный исполнитель" },
            scope: { id: scopeId, name: scope.name },
            xp: 100,
            points: 30,
            seasonKey: "2026-10",
            ruleVersion: 1,
            acceptedAt: at,
            balance,
            enabled: true,
            correction: null,
          },
        ],
        nextCursor: null,
        asOf: at,
      });
    if (url.pathname === "/api/v1/me/profile")
      return json(route, homeFallbackProfile);
    // «Главная» читает собственную строку рейтинга; ответ даёт mockHomeFallback.
    if (url.pathname === "/api/v1/leaderboard") return route.fallback();
    if (url.pathname === "/api/v1/auth/logout") return json(route, {});
    return json(
      route,
      { code: "ACCESS_REVOKED", message: "Учебный отказ", requestId: id },
      403,
    );
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Доступ подтверждён" }).waitFor();
  // Проверяющий открывается на очереди проверки, остальные — на «Главной».
  if (role !== "reviewer")
    await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  return { page, errors };
}

async function finish({ page, errors }) {
  assert.deepEqual(errors, []);
  await page.close({ runBeforeUnload: false });
  scenarios++;
}
const nativeBack = (page) => page.evaluate(() => window.telegramTest.back());
const backVisible = (page) =>
  page.evaluate(() => window.Telegram.WebApp.BackButton?.visible ?? false);
async function openTask(page) {
  await page.getByRole("button", { name: new RegExp(task.title) }).click();
  await page.getByLabel("Отчёт о выполнении", { exact: true }).waitFor();
}

try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture(width);
    await openTask(f.page);
    const layout = await f.page.evaluate(() => {
      const screen = getComputedStyle(document.querySelector(".access-screen"));
      return {
        padding: [
          screen.paddingTop,
          screen.paddingRight,
          screen.paddingBottom,
          screen.paddingLeft,
        ],
        minHeight: screen.minHeight,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    // Нижняя панель занимает 76 px сверх прежнего нижнего отступа 50 px.
    assert.deepEqual(layout, {
      padding: ["72px", "30px", "146px", "30px"],
      minHeight: "740px",
      colorScheme: "dark",
      overflow: false,
    });
    assert.equal(await backVisible(f.page), true);
    await f.page.screenshot({
      path: path.join(dir, `safe-${width}.png`),
      fullPage: true,
    });
    await nativeBack(f.page);
    await f.page
      .getByLabel("Отчёт о выполнении", { exact: true })
      .waitFor({ state: "detached" });
    // «Задачи» уже не корневой экран (корень — «Главная»): кнопка «Назад» остаётся.
    assert.equal(await backVisible(f.page), true);
    await finish(f);
  }
  {
    const f = await fixture();
    await openTask(f.page);
    const field = f.page.getByLabel("Отчёт о выполнении", { exact: true });
    await field.fill("Несохранённый учебный отчёт");
    f.page.once("dialog", (dialog) => dialog.dismiss());
    await nativeBack(f.page);
    assert.equal(await field.inputValue(), "Несохранённый учебный отчёт");
    assert.equal(await backVisible(f.page), true);
    assert.equal(
      await f.page.evaluate(() => window.telegramTest.closing),
      true,
    );
    f.page.once("dialog", (dialog) => dialog.accept());
    await nativeBack(f.page);
    await field.waitFor({ state: "detached" });
    assert.equal(
      await f.page.evaluate(() => window.telegramTest.closing),
      false,
    );
    await finish(f);
  }
  {
    const f = await fixture();
    await openTask(f.page);
    await f.page.evaluate(() => {
      const app = window.Telegram.WebApp;
      app.colorScheme = "light";
      window.telegramTest.colors = [];
      window.telegramTest.emit("themeChanged");
      app.viewportHeight = 420;
      app.viewportStableHeight = 470;
      window.telegramTest.emit("viewportChanged", { isStateStable: false });
    });
    assert.deepEqual(
      await f.page.evaluate(() => ({
        theme: document.documentElement.dataset.telegramTheme,
        colors: window.telegramTest.colors,
        stable: getComputedStyle(document.querySelector(".access-screen"))
          .minHeight,
      })),
      {
        theme: "light",
        colors: [
          { method: "header", color: "#08151c" },
          { method: "background", color: "#08151c" },
          { method: "bottom", color: "#08151c" },
        ],
        stable: "740px",
      },
    );
    await f.page.setViewportSize({ width: 390, height: 420 });
    await f.page.evaluate(() => {
      window.telegramTest.emit("viewportChanged", { isStateStable: true });
      window.Telegram.WebApp.safeAreaInset = {
        top: 0,
        bottom: 0,
        left: 44,
        right: 44,
      };
      window.Telegram.WebApp.contentSafeAreaInset = {
        top: 0,
        bottom: 0,
        left: 8,
        right: 8,
      };
      window.telegramTest.emit("safeAreaChanged");
      window.telegramTest.emit("contentSafeAreaChanged");
    });
    await f.page.getByLabel("Отчёт о выполнении", { exact: true }).focus();
    await f.page
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .scrollIntoViewIfNeeded();
    assert.equal(
      await f.page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".access-screen")).minHeight,
      ),
      "470px",
    );
    assert.equal(
      await f.page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".access-screen"))
            .paddingLeft,
      ),
      "52px",
    );
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await finish(f);
  }
  for (const mode of ["legacy", "throwing"]) {
    const f = await fixture(320, mode);
    await openTask(f.page);
    await f.page
      .getByRole("button", { name: "Задачи: вернуться к списку", exact: true })
      .click();
    await f.page
      .getByLabel("Отчёт о выполнении", { exact: true })
      .waitFor({ state: "detached" });
    assert.equal(await f.page.evaluate(() => window.telegramTest.ready), 1);
    await finish(f);
  }
  {
    const f = await fixture(390, "late");
    await openTask(f.page);
    await f.page.waitForFunction(() => window.telegramTest?.ready === 1);
    assert.equal(
      await f.page.getByLabel("Отчёт о выполнении", { exact: true }).count(),
      1,
    );
    assert.equal(await backVisible(f.page), true);
    assert.deepEqual(
      await f.page.evaluate(() => window.telegramTest.listeners()),
      {
        back: 1,
        events: {
          themeChanged: 1,
          viewportChanged: 1,
          safeAreaChanged: 1,
          contentSafeAreaChanged: 1,
        },
      },
    );
    await finish(f);
  }
  {
    const f = await fixture(390, "late");
    await openTask(f.page);
    const field = f.page.getByLabel("Отчёт о выполнении", { exact: true });
    await field.fill("Черновик до подключения SDK");
    await f.page.waitForFunction(() => window.telegramTest?.ready === 1);
    assert.equal(await field.inputValue(), "Черновик до подключения SDK");
    assert.equal(
      await f.page.evaluate(() => window.telegramTest.closing),
      true,
    );
    assert.equal(await backVisible(f.page), true);
    await finish(f);
  }
  for (const role of ["reviewer", "manager", "corrector"]) {
    const f = await fixture(390, "modern", role);
    if (role === "reviewer") {
      await openReviewQueue(f.page);
      await f.page
        .getByRole("button", { name: new RegExp(task.title) })
        .click();
      const reason = f.page.getByLabel("Причина возврата", { exact: true });
      await reason.fill("Учебное основание");
      f.page.once("dialog", (dialog) => dialog.dismiss());
      await nativeBack(f.page);
      assert.equal(await reason.inputValue(), "Учебное основание");
      f.page.once("dialog", (dialog) => dialog.accept());
      await nativeBack(f.page);
      await reason.waitFor({ state: "detached" });
      // Очередь открыта с «Главной», поэтому «Назад» ведёт на неё.
      assert.equal(await backVisible(f.page), true);
      f.page.once("dialog", (dialog) => dialog.accept());
      await nativeBack(f.page);
      await f.page
        .getByRole("heading", { name: "Главная", exact: true })
        .waitFor();
      assert.equal(await backVisible(f.page), false);
    } else if (role === "manager") {
      await f.page.getByRole("button", { name: "Ещё", exact: true }).click();
      await f.page
        .getByRole("button", { name: "Постановка задач", exact: true })
        .click();
      await f.page
        .getByRole("button", { name: "Редактировать черновик", exact: true })
        .click();
      const form = f.page.getByRole("form", {
        name: "Редактирование черновика",
        exact: true,
      });
      f.page.once("dialog", (dialog) => dialog.dismiss());
      await nativeBack(f.page);
      assert.equal(await form.count(), 1);
      f.page.once("dialog", (dialog) => dialog.accept());
      await nativeBack(f.page);
      await form.waitFor({ state: "detached" });
      assert.equal(
        await f.page
          .getByRole("heading", { name: "Управление задачами", exact: true })
          .count(),
        1,
      );
      await nativeBack(f.page);
      await f.page.getByRole("heading", { name: "Ещё", exact: true }).waitFor();
      await nativeBack(f.page);
      await f.page
        .getByRole("heading", { name: "Главная", exact: true })
        .waitFor();
      assert.equal(await backVisible(f.page), false);
    } else {
      await f.page.getByRole("button", { name: "Ещё", exact: true }).click();
      await f.page
        .getByRole("button", { name: "Баланс и журнал", exact: true })
        .click();
      await f.page
        .getByRole("button", { name: "Исправление начислений", exact: true })
        .click();
      await f.page
        .getByRole("button", { name: "Вернуть начисление", exact: true })
        .click();
      const reason = f.page.getByLabel("Основание возврата", { exact: true });
      await reason.fill("Учебное исправление");
      f.page.once("dialog", (dialog) => dialog.dismiss());
      await nativeBack(f.page);
      assert.equal(await reason.inputValue(), "Учебное исправление");
      f.page.once("dialog", (dialog) => dialog.accept());
      await nativeBack(f.page);
      await reason.waitFor({ state: "detached" });
      await f.page
        .getByRole("button", { name: "Вернуть начисление", exact: true })
        .waitFor();
      await nativeBack(f.page);
      assert.equal(
        await f.page
          .getByRole("button", { name: "Исправление начислений", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      );
      await nativeBack(f.page);
      await f.page.getByRole("heading", { name: "Ещё", exact: true }).waitFor();
      await nativeBack(f.page);
      await f.page
        .getByRole("heading", { name: "Главная", exact: true })
        .waitFor();
      assert.equal(await backVisible(f.page), false);
    }
    await finish(f);
  }
  {
    const f = await fixture();
    for (let cycle = 0; cycle < 3; cycle++) {
      await openTask(f.page);
      await nativeBack(f.page);
      await f.page
        .getByLabel("Отчёт о выполнении", { exact: true })
        .waitFor({ state: "detached" });
    }
    assert.equal(
      await f.page.evaluate(() => window.telegramTest.listeners().back),
      1,
    );
    await openTask(f.page);
    await f.page
      .getByLabel("Отчёт о выполнении", { exact: true })
      .fill("Учебный отчёт");
    await f.page
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    await f.page
      .getByRole("heading", { name: "Доступ отозван", exact: true })
      .waitFor();
    // Sessions close on any permission change: Telegram launch data allows a re-check.
    await f.page
      .getByRole("button", { name: "Проверить снова", exact: true })
      .waitFor();
    assert.equal(await backVisible(f.page), false);
    assert.equal(
      await f.page.evaluate(() => window.telegramTest.listeners().back),
      0,
    );
    await f.page.evaluate(() => window.telegramTest.staleBack());
    assert.equal(
      await f.page
        .getByRole("heading", { name: "Доступ отозван", exact: true })
        .count(),
      1,
    );
    await finish(f);
  }
  console.log(
    `Telegram bridge: ${scenarios} scenarios passed (SDK and HTTP simulated; physical devices unverified)`,
  );
} finally {
  await browser.close();
}
