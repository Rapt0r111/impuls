// «Главная» открывается первой и сама запрашивает профиль и задачи. Фикстуры
// остальных экранов не должны уходить на настоящий сервер: этот запасной ответ
// регистрируется первым, поэтому собственные маршруты теста его перекрывают.
const at = "2026-10-06T10:00:00.000Z";
export const homeFallbackProfile = {
  user: { id: "a1111111-1111-4111-8111-111111111111", displayName: "Участник" },
  balance: {
    lifetimeXp: 0,
    availablePoints: 0,
    reservedPoints: 0,
    version: 1,
    updatedAt: at,
  },
  progression: { state: "unconfigured", ruleVersion: null, level: null },
  firstResult: null,
  asOf: at,
};

export async function mockHomeFallback(page) {
  const json = (route, status, body) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route(
    (url) => url.pathname === "/api/v1/me/profile",
    (route) => json(route, 200, homeFallbackProfile),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks",
    (route) => json(route, 200, { items: [], nextCursor: null }),
  );
  // Колокольчик и карточка свободных задач читают журнал, заявки и свободные задачи.
  await page.route(
    (url) => url.pathname === "/api/v1/me/ledger",
    (route) =>
      json(route, 200, {
        balance: homeFallbackProfile.balance,
        entries: [],
        nextCursor: null,
        asOf: at,
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/redemptions",
    (route) =>
      json(route, 200, {
        items: [],
        nextCursor: null,
        updatedAt: at,
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks/open",
    (route) => json(route, 200, { items: [] }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/leaderboard",
    (route) =>
      json(route, 200, {
        timeZone: "Europe/Moscow",
        season: "2026-10",
        scopes: [],
        scope: null,
        self: null,
        items: [],
        nextCursor: null,
        revision: null,
        updatedAt: at,
      }),
  );
}

// Все открываются на «Главной» (у проверяющего там карточка очереди):
// переходим к списку задач только тогда, когда открыта «Главная».
export async function leaveHome(page) {
  await page.getByRole("button", { name: "Мои задачи", exact: true }).waitFor();
  if (
    await page
      .getByRole("heading", { name: "Главная", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
}

// Проверяющий тоже начинает с «Главной»: очередь открывается её карточкой.
export async function openReviewQueue(page) {
  const home = page.getByRole("heading", { name: "Главная", exact: true });
  if (!(await home.isVisible()))
    await page.getByRole("button", { name: "Главная", exact: true }).click();
  // Карточка очереди есть, только когда в ней что-то ждёт; иначе — через «Ещё».
  const card = page.getByRole("button", {
    name: "Открыть очередь",
    exact: true,
  });
  const shown = await card
    .waitFor({ timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (shown) return card.click();
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "Очередь проверки", exact: true })
    .click();
}
