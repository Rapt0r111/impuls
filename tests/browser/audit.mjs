import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
import { openSection } from "./nav.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? "test-results",
  "audit",
);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const actor = "a1111111-1111-4111-8111-111111111111",
  scope = "b1111111-1111-4111-8111-111111111111",
  other = "c1111111-1111-4111-8111-111111111111";
const uuid = (n) => `d1111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const actions = [
  "ledger.correct",
  "task.accept",
  "task.edit",
  "task.create",
  "task.assign",
  "task.cancel",
  "task.return",
];
const items = Array.from({ length: 24 }, (_, i) => ({
  id: uuid(i + 1),
  requestId: uuid(i + 100),
  action: actions[i % actions.length],
  actor: {
    id: actor,
    displayName:
      i === 0
        ? "Синтетический_автор_с_длинным_неразрывным_псевдонимом"
        : "Учебный проверяющий",
  },
  occurredAt: "2026-10-02T09:00:00.000Z",
  reason:
    i === 0
      ? "В тестовом решении обнаружен повторный учёт результата. Начисление возвращено отдельной записью."
      : `Учебное основание ${i + 1}`,
  task: {
    id: uuid(300),
    currentTitle: "Синтетическая проверка результатов исследования",
  },
  reward: null,
  reviewId: i % actions.length === 1 ? uuid(500 + i) : null,
  correctionId: i % actions.length === 0 ? uuid(500 + i) : null,
  values:
    i % actions.length === 0
      ? [
          { field: "xpDelta", value: -17 },
          { field: "pointsDelta", value: -9 },
          { field: "seasonKey", value: "2026-09" },
        ]
      : [
          { field: "status", value: "draft" },
          { field: "version", value: 2 },
        ],
}));
const rewardActions = [
  "reward.fulfill",
  "reward.approve",
  "reward.reject",
  "reward.cancel",
  "reward.reserve",
];
const rewardItems = rewardActions.map((action, i) => ({
  id: uuid(800 + i),
  requestId: uuid(850 + i),
  action,
  actor: {
    id: actor,
    displayName: "Синтетический_проверяющий_с_длинным_псевдонимом",
  },
  occurredAt: "2026-10-04T09:00:00.000Z",
  reason: "Учебное основание действия с косметикой без служебных привилегий.",
  task: null,
  reviewId: null,
  correctionId: null,
  reward: {
    redemptionId: uuid(900 + i),
    rewardId: uuid(910 + i),
    rewardVersionId: uuid(920 + i),
    quotaPeriodId: uuid(930 + i),
    title: "Сохранённый знак исследователя синтетической коллекции",
    conditions:
      "Исходные условия косметической позиции. Знак не предоставляет служебных привилегий. Длинное_неразрывное_название_для_проверки_мобильного_чтения.",
    price: 30,
    rewardVersion: 1,
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    recipient: {
      id: uuid(950),
      displayName: "Синтетический_получатель_с_длинным_неразрывным_псевдонимом",
    },
  },
  values:
    action === "reward.fulfill"
      ? [
          { field: "from", value: "approved" },
          { field: "to", value: "fulfilled" },
          { field: "version", value: 3 },
          { field: "entitlementId", value: uuid(960) },
        ]
      : action === "reward.reserve" || action === "reward.cancel"
        ? [
            {
              field: "status",
              value: action === "reward.reserve" ? "pending" : "cancelled",
            },
            {
              field: "availableDelta",
              value: action === "reward.reserve" ? -30 : 30,
            },
            {
              field: "reservedDelta",
              value: action === "reward.reserve" ? 30 : -30,
            },
          ]
        : [
            { field: "from", value: "pending" },
            {
              field: "to",
              value: action === "reward.approve" ? "approved" : "rejected",
            },
            { field: "version", value: 2 },
            {
              field: "availableDelta",
              value: action === "reward.approve" ? 0 : 30,
            },
            { field: "reservedDelta", value: -30 },
          ],
}));
const mixedItems = [...items.slice(0, 4), ...rewardItems, ...items.slice(9)];
const catalogItems = [
  {
    ...items[0],
    action: "catalog.publish",
    occurredAt: "2026-10-05T12:00:00.123456Z",
    reason:
      "Учебная публикация новых условий косметики без реальных поощрений.",
    task: null,
    reward: null,
    reviewId: null,
    correctionId: null,
    values: [],
    catalog: {
      rewardId: uuid(990),
      previousVersion: 1,
      published: {
        id: uuid(991),
        version: 2,
        title: "Синтетические опубликованные условия",
        conditions:
          "Сохранённые новые условия косметики без реальных поощрений.",
        price: 19,
        enabled: false,
        effectiveFrom: "2026-10-05T12:00:00.123456Z",
        reservationSeconds: null,
      },
    },
  },
];
const task = {
  id: uuid(999),
  title: "Синтетическая задача для сохранения черновика",
  status: "in_progress",
  priority: "normal",
  dueAt: "2026-10-10T12:00:00.000Z",
  fundXp: 17,
  fundPoints: 9,
  ruleVersion: 1,
  version: 3,
  updatedAt: "2026-10-02T09:00:00.000Z",
  criteria: "Проверяемый результат",
  latestSubmission: null,
  latestReview: null,
  scope: { id: scope, kind: "group", name: "Учебная область" },
};
let scenarios = 0;
async function fixture(mode = "populated", width = 390, open = true) {
  const context = await browser.newContext({
    viewport: { width, height: 850 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [],
    calls = [];
  let fail = 0,
    delay = mode === "loading",
    total =
      mode === "capture" || mode === "all-permissions"
        ? 3
        : mode === "reward-capture"
          ? 5
          : 24;
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (r, body, status = 200) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `window.__back=null;window.Telegram={WebApp:{version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},enableClosingConfirmation(){},disableClosingConfirmation(){},BackButton:{show(){},hide(){},onClick(cb){window.__back=cb},offClick(){window.__back=null}}}};`,
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (r) =>
      json(r, {
        user: { id: actor, displayName: "Синтетический участник" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (r) =>
      json(r, {
        permissions:
          mode === "no-permission"
            ? []
            : [
                {
                  action: "admin.audit",
                  scope: { id: scope, kind: "group", name: "Учебная область" },
                  validUntil: null,
                },
              ].concat(
                mode === "all-permissions"
                  ? ["task.review", "task.create"].map((action) => ({
                      action,
                      scope: {
                        id: scope,
                        kind: "group",
                        name: "Учебная область",
                      },
                      validUntil: null,
                    }))
                  : [],
              ),
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks",
    (r) => json(r, { items: [task], nextCursor: null }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/reviews",
    (r) => json(r, { items: [], nextCursor: null }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/tasks/${task.id}`,
    (r) => json(r, { task }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/admin/audit",
    async (r) => {
      const params = new URL(r.request().url()).searchParams;
      calls.push(Object.fromEntries(params));
      if (delay) await new Promise((resolve) => setTimeout(resolve, 600));
      const status =
        fail ||
        (mode === "disabled" || mode === "denied"
          ? 404
          : mode === "unavailable"
            ? 503
            : mode === "invalid-cursor" && params.has("cursor")
              ? 400
              : 0);
      if (status)
        return json(
          r,
          {
            code:
              mode === "disabled"
                ? "AUDIT_DISABLED"
                : status === 400
                  ? "INVALID_CURSOR"
                  : status === 403
                    ? "ACCESS_REVOKED"
                    : "UNAVAILABLE",
            message: "Synthetic",
            requestId: actor,
          },
          status,
        );
      const selectedScope = params.get("scope") ?? scope;
      const list =
        mode === "empty" || selectedScope === other
          ? []
          : (mode === "catalog-capture"
              ? catalogItems
              : mode === "reward-capture"
                ? rewardItems
                : mixedItems
            )
              .slice(0, total)
              .filter(
                (i) =>
                  !params.has("action") || i.action === params.get("action"),
              );
      const next = params.has("cursor"),
        selected = list.slice(next ? 20 : 0, next ? 50 : 20);
      return json(r, {
        mode: "synthetic",
        scopes: [
          { id: scope, name: "Учебная область" },
          { id: other, name: "Вторая учебная область" },
        ],
        scope: {
          id: selectedScope,
          name:
            selectedScope === scope
              ? "Учебная область"
              : "Вторая учебная область",
        },
        updatedAt:
          mode === "catalog-capture"
            ? "2026-10-05T12:10:00.000Z"
            : "2026-10-04T09:10:00.000Z",
        items: selected,
        nextCursor:
          !next && list.length > 20
            ? `${actor}|${selectedScope}|${params.get("action") ?? "all"}|${uuid(20)}`
            : null,
      });
    },
  );
  await page.goto(origin);
  await page.getByRole("heading", { name: "Доступ подтверждён" }).waitFor();
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  if (open && mode !== "no-permission")
    await (await openSection(page, "Журнал действий")).click();
  return {
    page,
    context,
    errors,
    calls,
    setFail: (status) => {
      fail = status;
    },
    setTotal: (n) => {
      total = n;
    },
    stopDelay: () => {
      delay = false;
    },
  };
}
async function close(f) {
  assert.deepEqual(f.errors, []);
  await f.context.close();
  scenarios++;
}
async function ready(f) {
  await f.page.locator(".audit-list > li").first().waitFor();
}
async function capture(f, name) {
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await f.page.evaluate(() => window.scrollTo(0, 0));
  await f.page.mouse.move(0, 0);
  await f.page.screenshot({
    path: path.join(dir, name),
    fullPage: true,
    animations: "disabled",
  });
}
try {
  {
    const f = await fixture("catalog-capture", 320);
    await ready(f);
    await f.page
      .getByText("Версия 1 → 2. Сохранённые условия на момент публикации.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole("heading", {
          name: "Синтетические опубликованные условия",
          exact: true,
        })
        .count(),
      1,
    );
    assert.match(await f.page.locator(".audit-list").innerText(), /19 баллов/);
    await capture(f, "catalog-publication-320.png");
    await close(f);
  }
  {
    const f = await fixture("all-permissions", 320);
    await ready(f);
    await f.page
      .locator(".workspace-nav-personal")
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    const operations = f.page.locator(".more-row");
    // Журнал начислений (Баланс) входит в раздел «Ещё» для всех.
    assert.equal(await operations.count(), 4);
    const dimensions = await operations.evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          height: rect.height,
          left: rect.left,
          right: rect.right,
        };
      }),
    );
    // Служебные разделы — строки списка «Ещё»: нажимаемы и не расширяют страницу.
    for (const d of dimensions) assert.ok(d.height >= 44);
    assert.ok(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await f.page.getByText("Полномочия", { exact: true }).press("Enter");
    await f.page
      .getByText("Просмотр журнала действий", { exact: true })
      .waitFor();
    await f.page.getByText("Полномочия", { exact: true }).press("Enter");
    assert.equal(
      await f.page.getByRole("button", { name: "Выйти", exact: true }).count(),
      0,
      "кнопки выхода в интерфейсе нет",
    );
    await capture(f, "audit-all-permissions-320.png");
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("capture", width);
    await ready(f);
    const navButtons = f.page.locator(".workspace-nav-personal .workspace-tab");
    const boxes = await navButtons.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          left: rect.left,
          right: rect.right,
        };
      }),
    );
    assert.equal(boxes.length, 5);
    for (const box of boxes) {
      // Content-dependent wrapping (workspace-reflow slice): size and bounds only.
      assert.ok(box.height >= 44 && box.left >= 0 && box.right <= width);
    }
    assert.equal(
      await f.page.locator('.workspace-nav [aria-pressed="true"]').count(),
      1,
    );
    assert.equal(
      await navButtons
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      "0s",
    );
    const summary = f.page.locator(".audit-evidence summary").first();
    await f.page.keyboard.press("Tab");
    await summary.focus();
    assert.equal(
      await summary.evaluate((el) => getComputedStyle(el).outlineStyle),
      "solid",
    );
    assert.ok((await summary.boundingBox()).height >= 44);
    await summary.press("Enter");
    await f.page.getByText("Изменение XP", { exact: true }).waitFor();
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .focus();
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .press("Enter");
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .waitFor();
    await capture(f, `audit-${width}.png`);
    await f.page
      .getByLabel("Действие", { exact: true })
      .selectOption("ledger.correct");
    await f.page.waitForFunction(
      () => document.querySelectorAll(".audit-list > li").length === 1,
    );
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page
      .getByText("Записанных действий по выбранному фильтру нет.")
      .waitFor();
    assert.equal(f.calls.at(-1).scope, other);
    assert.equal(f.calls.at(-1).action, "ledger.correct");
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("reward-capture", width);
    await ready(f);
    assert.equal(await f.page.locator(".audit-list > li").count(), 5);
    const first = f.page.locator(".audit-list > li").first(),
      summary = first.locator("summary");
    await summary.focus();
    await summary.press("Enter");
    await first.getByText("Версия заявки в событии", { exact: true }).waitFor();
    await first.getByText("Выдана", { exact: true }).waitFor();
    assert.equal(
      await first.getByText("ID владения", { exact: true }).count(),
      1,
    );
    assert.equal(
      await first
        .getByText("Изменение доступных баллов", { exact: true })
        .count(),
      0,
    );
    assert.equal(await first.getByText("Задача", { exact: true }).count(), 0);
    assert.ok((await summary.boundingBox()).height >= 44);
    await capture(f, `audit-rewards-${width}.png`);
    for (const action of rewardActions) {
      await f.page.getByLabel("Действие", { exact: true }).selectOption(action);
      await f.page.waitForFunction(
        () => document.querySelectorAll(".audit-list > li").length === 1,
      );
      await f.page
        .locator(".audit-list > li")
        .getByRole("heading", {
          name: {
            "reward.fulfill": "Выдача косметики",
            "reward.approve": "Одобрение заявки",
            "reward.reject": "Отказ по заявке",
            "reward.cancel": "Отмена заявки",
            "reward.reserve": "Резерв по заявке",
          }[action],
          exact: true,
        })
        .waitFor();
      assert.equal(f.calls.at(-1).action, action);
      assert.ok(!f.calls.at(-1).cursor);
      const row = f.page.locator(".audit-list > li");
      await row.locator("summary").press("Enter");
      if (action === "reward.reserve" || action === "reward.cancel") {
        await row
          .getByText("Изменение резерва баллов", { exact: true })
          .waitFor();
        assert.ok(
          (await row.innerText()).includes(
            action === "reward.reserve" ? "Ожидает решения" : "Отменена",
          ),
        );
      }
      if (action !== "reward.fulfill") {
        const movement = (name) =>
          row
            .locator(".audit-evidence dl > div")
            .filter({ has: f.page.getByText(name, { exact: true }) })
            .locator("dd");
        assert.equal(
          await movement("Изменение доступных баллов").innerText(),
          action === "reward.reserve"
            ? "-30"
            : action === "reward.approve"
              ? "0"
              : "30",
        );
        assert.equal(
          await movement("Изменение резерва баллов").innerText(),
          action === "reward.reserve" ? "30" : "-30",
        );
        if (width === 320)
          await capture(f, `audit-${action.split(".")[1]}-320.png`);
      }
    }
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page
      .getByText("Записанных действий по выбранному фильтру нет.")
      .waitFor();
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    assert.equal(await f.page.locator(".audit-list > li").count(), 20);
    assert.equal(
      await f.page.getByText("Позиция при подаче:", { exact: false }).count(),
      5,
    );
    await f.page.getByRole("button", { name: "Более ранние действия" }).click();
    await f.page.waitForFunction(
      () => document.querySelectorAll(".audit-list > li").length === 24,
    );
    const before = f.calls.length;
    await f.page.getByRole("button", { name: "Обновить журнал" }).click();
    await f.page.waitForFunction(
      () => document.querySelectorAll(".audit-list > li").length === 20,
    );
    assert.ok(f.calls.length > before);
    assert.ok(!f.calls.at(-1).cursor);
    await f.page.evaluate(() => window.__back());
    await f.page.getByRole("heading", { name: "Ещё" }).waitFor();
    await f.page.evaluate(() => window.__back());
    await f.page.getByRole("heading", { name: "Главная" }).waitFor();
    assert.equal(await f.page.locator(".audit-list").count(), 0);
    await close(f);
  }
  for (const mode of [
    "empty",
    "disabled",
    "denied",
    "unavailable",
    "loading",
  ]) {
    const f = await fixture(mode, 320);
    const text = {
      empty: "Записанных действий по выбранному фильтру нет.",
      disabled: "Синтетический журнал выключен.",
      denied: "Журнал в этой области недоступен.",
      unavailable: "Не удалось загрузить журнал.",
      loading: "Загружаем журнал…",
    }[mode];
    await f.page.getByText(text, { exact: false }).waitFor();
    if (["empty", "disabled"].includes(mode))
      await capture(f, `audit-${mode}-320.png`);
    if (mode === "loading") {
      f.stopDelay();
      await ready(f);
    }
    await close(f);
  }
  for (const status of [503, 403, 401, 404]) {
    const f = await fixture("capture", 320);
    await ready(f);
    f.setFail(status);
    await f.page.getByRole("button", { name: "Обновить журнал" }).click();
    if (status === 503) {
      await f.page
        .getByText("Показаны ранее подтверждённые записи.", { exact: false })
        .waitFor();
      assert.equal(await f.page.locator(".audit-list > li").count(), 3);
      await capture(f, "audit-stale-320.png");
      f.setFail(0);
      await f.page.getByRole("button", { name: "Повторить загрузку" }).click();
      await f.page
        .getByText("Показаны ранее подтверждённые записи.", { exact: false })
        .waitFor({ state: "hidden" });
    } else {
      await f.page.locator(".audit-list").waitFor({ state: "hidden" });
      if (status === 404)
        await f.page.getByText("Журнал в этой области недоступен.").waitFor();
      else
        await f.page
          .getByRole("heading", {
            name:
              status === 403
                ? "Доступ отозван"
                : "Не удалось подтвердить сессию",
          })
          .waitFor();
      assert.equal(await f.page.locator(".audit-list").count(), 0);
    }
    await close(f);
  }
  for (const status of [503, 403, 401, 404]) {
    const f = await fixture("reward-capture", 320);
    await ready(f);
    f.setFail(status);
    await f.page.getByRole("button", { name: "Обновить журнал" }).click();
    if (status === 503) {
      await f.page
        .getByText("Показаны ранее подтверждённые записи.", { exact: false })
        .waitFor();
      assert.equal(await f.page.locator(".audit-list > li").count(), 5);
      await capture(f, "audit-rewards-stale-320.png");
      f.setFail(0);
      await f.page.getByRole("button", { name: "Повторить загрузку" }).click();
      await f.page
        .getByText("Показаны ранее подтверждённые записи.", { exact: false })
        .waitFor({ state: "hidden" });
    } else {
      await f.page.locator(".audit-list").waitFor({ state: "hidden" });
      assert.equal(
        await f.page.getByText("Позиция при подаче:", { exact: false }).count(),
        0,
      );
    }
    await close(f);
  }
  {
    const f = await fixture("invalid-cursor", 320);
    await ready(f);
    await f.page.getByRole("button", { name: "Более ранние действия" }).click();
    await f.page
      .getByText("Страница недоступна. Обновите журнал с начала.")
      .waitFor();
    assert.equal(await f.page.locator(".audit-list > li").count(), 20);
    await f.page.getByRole("button", { name: "Повторить загрузку" }).click();
    await f.page
      .getByText("Страница недоступна. Обновите журнал с начала.")
      .waitFor({ state: "hidden" });
    await close(f);
  }
  {
    const f = await fixture("no-permission", 320);
    assert.equal(
      await (await openSection(f.page, "Журнал действий")).count(),
      0,
    );
    await close(f);
  }
  {
    const f = await fixture("capture", 320);
    await ready(f);
    await f.page.addStyleTag({
      content: ".audit-section{font-size:24px}.audit-section p{font-size:24px}",
    });
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await close(f);
  }
  {
    const f = await fixture("populated", 390, false);
    await f.page
      .getByRole("button", { name: task.title, exact: false })
      .click();
    const report = f.page.getByLabel("Отчёт о выполнении", { exact: true });
    await report.fill("Несданный текст для проверки перехода к аудиту.");
    f.page.once("dialog", (d) => d.dismiss());
    await f.page
      .locator(".workspace-nav-personal")
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    assert.equal(
      await report.inputValue(),
      "Несданный текст для проверки перехода к аудиту.",
    );
    assert.equal(await f.page.locator(".audit-list").count(), 0);
    f.page.once("dialog", (d) => d.accept());
    await (await openSection(f.page, "Журнал действий")).click();
    await ready(f);
    await close(f);
  }
  console.log(
    `F07 audit browser: ${scenarios} scenarios passed; captures in ${dir}`,
  );
} finally {
  await browser.close();
}
