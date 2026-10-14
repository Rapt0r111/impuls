import assert from "node:assert/strict";
import { chromium } from "playwright";

// «Главная» по макету «NR_Point Home»: уровень, плитки, свободные задачи, колокольчик,
// шторки «Уровень», «Баллы» и «Как это работает», экран нового уровня. Ответы синтетические.
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const uid = "a1111111-1111-4111-8111-111111111111";
const scope = {
  id: "b1111111-1111-4111-8111-111111111111",
  kind: "group",
  name: "Группа",
};
const now = Date.now();
const ago = (ms) => new Date(now - ms).toISOString();
const at = ago(0);
const level3 = {
  level: 3,
  minimumXp: 800,
  progressXp: 199,
  spanXp: 400,
  remainingXp: 201,
  nextLevelXp: 1200,
};
const balance = (xp, points = 899) => ({
  lifetimeXp: xp,
  availablePoints: points,
  reservedPoints: 0,
  version: 1,
  updatedAt: at,
});
const entry = (id, currency, amount) => ({
  id,
  currency,
  amount,
  kind: "task_acceptance",
  correction: null,
  reason: "Принято",
  task: {
    id: "c1111111-1111-4111-8111-111111111111",
    title: "Разработка API модуля",
  },
  reward: null,
  reservedDelta: 0,
  ruleVersion: 1,
  seasonKey: "2026-10",
  timeZone: "Europe/Moscow",
  mode: "synthetic",
  createdAt: ago(10 * 60e3),
});
const redemption = {
  id: "a9111111-1111-4111-8111-111111111111",
  rewardId: "a2222222-1111-4111-8111-111111111111",
  rewardVersionId: "a3333333-1111-4111-8111-111111111111",
  quotaPeriodId: "a4444444-1111-4111-8111-111111111111",
  scope,
  title: "Благодарность роты",
  conditions: "Условия",
  price: 120,
  rewardVersion: 1,
  periodStart: ago(9e9),
  periodEnd: ago(-9e9),
  expiresAt: null,
  status: "approved",
  cancellationReason: null,
  decision: {
    actorId: uid,
    displayName: "Командир",
    reason: "Согласовано",
    decidedAt: ago(26 * 3600e3),
  },
  fulfillment: null,
  version: 1,
  createdAt: ago(30 * 3600e3),
  updatedAt: ago(26 * 3600e3),
};
const reward = (id, title, price) => ({
  id,
  rewardId: id,
  version: 1,
  title,
  conditions: "Условия",
  price,
  reservationSeconds: null,
  quota: {
    id: "a5555555-1111-4111-8111-111111111111",
    startsAt: ago(9e9),
    endsAt: ago(-9e9),
    available: 5,
  },
  hasPendingRequest: false,
  owned: false,
});
const assigned = {
  id: "c2222222-1111-4111-8111-111111111111",
  title: "Отчёт по этапу 2",
  status: "assigned",
  priority: "normal",
  dueAt: ago(-3600e3),
  fundXp: 40,
  fundPoints: 20,
  ruleVersion: 1,
  version: 1,
  updatedAt: ago(3600e3),
};
const freeTask = (i) => ({
  id: `c${i}333333-1111-4111-8111-111111111111`,
  title: `Свободная ${i}`,
  criteria: "Критерии",
  priority: "normal",
  dueAt: ago(-3600e3),
  fundXp: 150,
  fundPoints: 50,
  version: 1,
  updatedAt: at,
  scope,
});

const browser = await chromium.launch();
let scenarios = 0;

async function open({
  width = 390,
  xp = 999,
  level = level3,
  free = 3,
  seen,
  notes = true,
  height = 844,
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (seen !== undefined)
    await page.addInitScript(
      ([key, value]) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      },
      [`impuls.home.level.seen.${uid}`, String(seen)],
    );
  const json = (r, body, status = 200) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/"),
    (r) => {
      const p = new URL(r.request().url()).pathname;
      if (p === "/api/v1/me")
        return json(r, {
          user: { id: uid, displayName: "Тестовый Участник" },
          csrfToken: "x",
        });
      if (p === "/api/v1/me/permissions") return json(r, { permissions: [] });
      if (p === "/api/v1/me/profile")
        return json(r, {
          mode: "synthetic",
          user: { id: uid, displayName: "Тестовый Участник" },
          balance: balance(xp),
          progression: level
            ? { state: "configured", ruleVersion: 1, level }
            : { state: "unconfigured", ruleVersion: null, level: null },
          firstResult: null,
          asOf: at,
        });
      if (p === "/api/v1/tasks")
        return json(r, {
          items: notes ? [assigned] : [],
          nextCursor: null,
        });
      if (p === "/api/v1/tasks/open")
        return json(r, {
          items: Array.from({ length: free }, (_, i) => freeTask(i)),
        });
      if (p === "/api/v1/me/ledger")
        return json(r, {
          balance: balance(xp),
          entries: notes
            ? [
                entry("e1111111-1111-4111-8111-111111111111", "xp", 150),
                entry("e2111111-1111-4111-8111-111111111111", "points", 50),
              ]
            : [],
          nextCursor: null,
          asOf: at,
        });
      if (p === "/api/v1/me/redemptions")
        return json(r, {
          mode: "synthetic",
          items: notes ? [redemption] : [],
          nextCursor: null,
          updatedAt: at,
        });
      if (p === "/api/v1/rewards")
        return json(r, {
          mode: "synthetic",
          scopes: [scope],
          scope,
          balance: balance(xp),
          items: [
            reward(
              "a6111111-1111-4111-8111-111111111111",
              "Увольнение (сутки)",
              300,
            ),
            reward(
              "a6222222-1111-4111-8111-111111111111",
              "Благодарность роты",
              120,
            ),
            reward(
              "a6333333-1111-4111-8111-111111111111",
              "Дорогое поощрение",
              5000,
            ),
          ],
          nextCursor: null,
          updatedAt: at,
        });
      if (p === "/api/v1/leaderboard")
        return json(r, {
          mode: "synthetic",
          timeZone: "Europe/Moscow",
          season: "2026-10",
          scopes: [],
          scope: null,
          self: { xp, rank: 1 },
          items: [],
          nextCursor: null,
          revision: null,
          updatedAt: at,
        });
      return json(r, { code: "TEST" }, 404);
    },
  );
  await page.goto(origin);
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  return { page, context, errors };
}

// Содержимое и отсутствие горизонтальной прокрутки на трёх ширинах.
for (const width of [320, 360, 390]) {
  const { page, context, errors } = await open({ width });
  await page.getByText("До уровня 4 — 201 XP", { exact: true }).waitFor();
  await page.getByText("800 XP", { exact: true }).waitFor();
  await page.getByText("1200 XP", { exact: true }).waitFor();
  await page.getByText("Не сгорают", { exact: true }).waitFor();
  await page.getByText("0 в резерве", { exact: true }).waitFor();
  await page
    .getByText("XP остаются навсегда, баллы тратятся на поощрения")
    .waitFor();
  await page.getByText("3 задачи · до +150 XP").waitFor();
  await page.getByText("XP за октябрь", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Взять задачу" }).count(),
    1,
  );
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= width,
    `горизонтальная прокрутка на ${width} px`,
  );
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  // Колокольчик: события, «Прочитано», «Прочитать все», запоминание на устройстве.
  const { page, context, errors } = await open();
  const bell = (n) =>
    page.getByRole("button", { name: `Уведомления, новых: ${n}`, exact: true });
  await bell(3).waitFor();
  await bell(3).click();
  const region = page.getByRole("region", { name: "Уведомления" });
  await region.getByText("Задача принята").waitFor();
  await region
    .getByText("Разработка API модуля: +150 XP и +50 баллов")
    .waitFor();
  await region.getByText("Новое назначение").waitFor();
  await region.getByText("Назначена задача «Отчёт по этапу 2»").waitFor();
  await region.getByText("Поощрение одобрено").waitFor();
  await region.getByText("Вчера", { exact: true }).waitFor();
  await region.getByText("3 новых").waitFor();
  await region.getByRole("button", { name: "Прочитано" }).first().click();
  await bell(2).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  await bell(2).waitFor();
  await bell(2).click();
  await page.getByRole("button", { name: "Прочитать все" }).click();
  await page
    .getByRole("button", { name: "Уведомления", exact: true })
    .waitFor();
  assert.equal(await page.getByText("Прочитать все").count(), 0);
  // Esc закрывает окно, фокус возвращается на колокольчик.
  await page.keyboard.press("Escape");
  await region.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "Уведомления",
  );
  // Строка ведёт в нужный раздел и закрывает окно.
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  await page.getByRole("button", { name: /Новое назначение/ }).click();
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor({
    state: "detached",
  });
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  // Без событий окно объясняет, что здесь появится, и не предлагает «Прочитать все».
  const { page, context } = await open({ notes: false });
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  await page.getByText("Пока ничего нового.", { exact: false }).waitFor();
  assert.equal(await page.getByText("Прочитать все").count(), 0);
  await context.close();
  scenarios++;
}

{
  // Шторка «Уровень»: цифры, подсказка про задачи, Esc и возврат фокуса.
  const { page, context, errors } = await open();
  const card = page.getByRole("button", { name: /^Уровень 3, до уровня 4/ });
  await card.click();
  const dialog = page.getByRole("dialog", { name: "Уровень 3" });
  await dialog.waitFor();
  await dialog.getByText("999 из 1200 XP до уровня 4").waitFor();
  await dialog.getByText("Осталось 201 XP").waitFor();
  await dialog.getByText("Это примерно 2 задачи по +150 XP.").waitFor();
  await dialog.getByText("Уровень не сгорает").waitFor();
  await dialog.getByText("Рейтинг считается за месяц").waitFor();
  assert.equal(await dialog.getByText("Ур. 3").count(), 1);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await card.evaluate((node) => node === document.activeElement),
    true,
  );
  // Из шторки можно взять задачу: она закрывается, открывается список задач.
  await page.getByRole("button", { name: /^XP за всё время: 999/ }).click();
  await dialog.getByRole("button", { name: "Взять задачу" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor({
    state: "detached",
  });
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  // Шторка «Баллы»: только доступные поощрения, «Хватает на N», переход в каталог.
  const { page, context, errors } = await open();
  await page.getByRole("button", { name: /^Баллы: 899/ }).click();
  const dialog = page.getByRole("dialog", { name: "Баллы" });
  await dialog.getByText("899 баллов").waitFor();
  await dialog.getByText("0 в резерве · доступно к трате").waitFor();
  await dialog.getByText("Увольнение (сутки)").waitFor();
  await dialog.getByText("300 б.").waitFor();
  await dialog.getByText("Хватает на 2").waitFor();
  await dialog.getByText("Благодарность роты").waitFor();
  await dialog.getByText("Хватает на 5").waitFor();
  assert.equal(await dialog.getByText("Дорогое поощрение").count(), 0);
  await dialog
    .getByRole("button", { name: "Открыть каталог поощрений" })
    .click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor({
    state: "detached",
  });
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  // Меню «Ещё»: «Помощь» открывает шторку, «Профиль» ведёт на экран профиля.
  const { page, context } = await open();
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Помощь" }).click();
  const help = page.getByRole("dialog", { name: "Как это работает" });
  await help.getByText("Отправьте отчёт", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await help.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Профиль" }).click();
  await page.getByRole("button", { name: "Назад на «Главную»" }).waitFor();
  await context.close();
  scenarios++;
}

{
  // Нет свободных задач: карточки нет, а шторка уровня зовёт в «Задачи».
  const { page, context } = await open({ free: 0 });
  await page.getByText("До уровня 4 — 201 XP", { exact: true }).waitFor();
  assert.equal(await page.getByText("Свободные задачи").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Взять задачу" }).count(),
    0,
  );
  await page.getByRole("button", { name: /^Уровень 3, до уровня 4/ }).click();
  await page
    .getByRole("dialog", { name: "Уровень 3" })
    .getByRole("button", { name: "Открыть задачи" })
    .waitFor();
  assert.equal(
    await page.getByText("Это примерно", { exact: false }).count(),
    0,
  );
  await context.close();
  scenarios++;
}

{
  // Высший уровень и уровень не настроен: честные подписи без шкалы.
  const top = await open({
    level: {
      level: 5,
      minimumXp: 2000,
      progressXp: 100,
      spanXp: null,
      remainingXp: 0,
      nextLevelXp: null,
    },
    xp: 2100,
  });
  await top.page.getByText("Высший уровень", { exact: true }).first().waitFor();
  assert.equal(await top.page.getByText("2000 XP").count(), 0);
  await top.context.close();
  const none = await open({ level: null, xp: 10 });
  await none.page.getByRole("button", { name: /^Баллы:/ }).waitFor();
  assert.equal(
    await none.page.getByRole("button", { name: /^Уровень \d/ }).count(),
    0,
  );
  assert.equal(
    await none.page.getByRole("button", { name: /^XP за всё время/ }).count(),
    0,
  );
  await none.context.close();
  scenarios++;
}

{
  // Экран нового уровня: один раз после повышения, не на первом запуске.
  const up = await open({
    xp: 1200,
    level: {
      level: 4,
      minimumXp: 1200,
      progressXp: 0,
      spanXp: 400,
      remainingXp: 400,
      nextLevelXp: 1600,
    },
    seen: 3,
  });
  const dialog = up.page.getByRole("dialog", { name: "Новый уровень: 4" });
  await dialog.waitFor();
  await dialog.getByText("До уровня 5").waitFor();
  await dialog.getByText("1600 XP").waitFor();
  await dialog.getByRole("button", { name: "Продолжить" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await up.page.evaluate(
      (key) => localStorage.getItem(key),
      `impuls.home.level.seen.${uid}`,
    ),
    "4",
  );
  await up.page.reload();
  await up.page
    .getByRole("heading", { name: "Главная", exact: true })
    .waitFor();
  await up.page.getByText("До уровня 5 — 400 XP", { exact: true }).waitFor();
  assert.equal(await up.page.getByRole("dialog").count(), 0);
  await up.context.close();
  const first = await open({
    xp: 1200,
    level: {
      level: 4,
      minimumXp: 1200,
      progressXp: 0,
      spanXp: 400,
      remainingXp: 400,
      nextLevelXp: 1600,
    },
  });
  await first.page.getByText("До уровня 5 — 400 XP", { exact: true }).waitFor();
  assert.equal(await first.page.getByRole("dialog").count(), 0);
  await first.context.close();
  scenarios++;
}

{
  // Низкий экран (iPhone SE): шторка прокручивается и не выходит за экран.
  const { page, context } = await open({ width: 320, height: 568 });
  await page.getByRole("button", { name: /^Уровень 3, до уровня 4/ }).click();
  const box = await page
    .getByRole("dialog", { name: "Уровень 3" })
    .boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= 568 + 1);
  await context.close();
  scenarios++;
}

await browser.close();
console.log(JSON.stringify({ scenarios, result: "passed" }));
