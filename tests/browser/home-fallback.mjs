// «Главная» открывается первой и сама запрашивает профиль и задачи. Фикстуры
// остальных экранов не должны уходить на настоящий сервер: этот запасной ответ
// регистрируется первым, поэтому собственные маршруты теста его перекрывают.
const at = "2026-10-06T10:00:00.000Z";
export const homeFallbackProfile = {
  mode: "synthetic",
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
}

// Участник открывается на «Главной», проверяющий — на очереди проверки:
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
