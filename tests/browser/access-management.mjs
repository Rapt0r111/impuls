import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "access-management",
  );
await mkdir(dir, { recursive: true });
const browser = await chromium.launch(),
  actor = "a1111111-1111-4111-8111-111111111111",
  member = "b1111111-1111-4111-8111-111111111111",
  scope = "c1111111-1111-4111-8111-111111111111",
  binding = "d1111111-1111-4111-8111-111111111111";
let scenarios = 0;

async function fixture(width = 320, { canManage = true, post = [201] } = {}) {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    posts = [];
  let bindings = [
    {
      id: binding,
      action: "task.review",
      validUntil: null,
      version: 1,
    },
  ];
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (r, b, code = 200) =>
    r.fulfill({
      status: code,
      contentType: "application/json",
      body: JSON.stringify(b),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}}",
    }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me",
    (r) =>
      json(r, {
        user: { id: actor, displayName: "Учебный администратор" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me/permissions",
    (r) =>
      json(r, {
        permissions: [
          {
            action: "admin.access",
            scope: { id: scope, name: "Учебная область", kind: "project" },
            validUntil: null,
          },
        ],
      }),
  );
  for (const name of ["tasks", "reviews"])
    await page.route(
      (u) => u.pathname === `/api/v1/${name}`,
      (r) => json(r, { items: [], nextCursor: null }),
    );
  await page.route(
    (u) => u.pathname === "/api/v1/admin/access",
    (r) =>
      json(r, {
        mode: "synthetic",
        scope,
        canManage,
        members: [
          {
            userId: actor,
            displayName: "Учебный администратор",
            isSelf: true,
            bindings: [],
          },
          {
            userId: member,
            displayName: "Учебный участник",
            isSelf: false,
            bindings,
          },
        ],
      }),
  );
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/admin/access/"),
    async (r) => {
      const req = r.request();
      posts.push({
        path: new URL(req.url()).pathname,
        key: req.headers()["idempotency-key"],
        body: JSON.parse(req.postData() ?? "{}"),
      });
      const code = post.length > 1 ? post.shift() : post[0];
      if (code !== 201)
        return json(r, { code: "X", message: "x", requestId: "r" }, code);
      const body = JSON.parse(req.postData());
      if (posts.at(-1).path.endsWith("revocations")) bindings = [];
      else
        bindings = [
          ...bindings,
          {
            id: crypto.randomUUID(),
            action: body.action,
            validUntil: body.validUntil,
            version: 1,
          },
        ];
      return json(
        r,
        {
          mode: "synthetic",
          kind: posts.at(-1).path.endsWith("revocations") ? "revoke" : "grant",
          scope,
          changeId: crypto.randomUUID(),
          binding: {
            id: body.bindingId ?? crypto.randomUUID(),
            subjectId: member,
            action: body.action ?? "task.review",
            validUntil: body.validUntil ?? null,
            version: 2,
          },
          updatedAt: "2026-10-08T10:00:00.000Z",
        },
        201,
      );
    },
  );
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Управление доступом", exact: true })
    .click();
  await page.getByText("Учебный участник").first().waitFor();
  return { page, context, posts, errors };
}
async function close(f) {
  assert.deepEqual(f.errors, []);
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "no horizontal scroll",
  );
  await f.context.close();
  scenarios += 1;
}
const grant = async (f, reason = "Синтетическая выдача") => {
  await f.page.getByLabel("Участник", { exact: true }).selectOption(member);
  await f.page.getByLabel("Право", { exact: true }).selectOption("task.assign");
  await f.page.getByLabel("Основание выдачи").fill(reason);
  await f.page.getByRole("button", { name: "Проверить выдачу" }).click();
};

for (const width of [320, 360, 390]) {
  const f = await fixture(width);
  assert.equal(await f.page.getByLabel("Участник", { exact: true }).count(), 1);
  assert.equal(
    await f.page
      .getByLabel("Участник", { exact: true })
      .locator("option", { hasText: "Учебный администратор" })
      .count(),
    0,
    "self is not a recipient",
  );
  assert.equal(
    await f.page
      .getByRole("button", { name: /Отозвать: .*Учебный участник/ })
      .count(),
    1,
  );
  await f.page.screenshot({
    path: path.join(dir, `access-${width}.png`),
    fullPage: true,
  });
  await close(f);
}
{
  const f = await fixture(320, { canManage: false });
  assert.equal(
    await f.page.getByRole("button", { name: "Проверить выдачу" }).count(),
    0,
  );
  assert.equal(
    await f.page.getByRole("button", { name: /Отозвать/ }).count(),
    0,
  );
  await f.page.getByText("Изменение прав выключено").waitFor();
  await close(f);
}
{
  const f = await fixture(320);
  await grant(f);
  await f.page.getByText("Выдать «Назначение задач»").waitFor();
  assert.equal(f.posts.length, 0, "preview sends nothing");
  await f.page.getByRole("button", { name: "Подтвердить изменение" }).click();
  await f.page.getByText("Право выдано.").waitFor();
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].path, "/api/v1/admin/access/grants");
  assert.match(f.posts[0].key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...f.posts[0].body, validUntil: undefined },
    {
      scope,
      subjectId: member,
      action: "task.assign",
      reason: "Синтетическая выдача",
      validUntil: undefined,
    },
  );
  assert.equal(f.posts[0].body.validUntil, null);
  await f.page
    .getByText("Назначение задач", { exact: false })
    .first()
    .waitFor();
  await close(f);
}
{
  const f = await fixture(320, { post: [503, 201] });
  await grant(f);
  await f.page.getByRole("button", { name: "Подтвердить изменение" }).click();
  await f.page.getByText("Результат не подтверждён").waitFor();
  await f.page.getByRole("button", { name: "Повторить тот же запрос" }).click();
  await f.page.getByText("Право выдано.").waitFor();
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0].key, f.posts[1].key);
  assert.deepEqual(f.posts[0].body, f.posts[1].body);
  await close(f);
}
{
  const f = await fixture(320, { post: [409] });
  await grant(f);
  await f.page.getByRole("button", { name: "Подтвердить изменение" }).click();
  await f.page
    .getByRole("alert")
    .filter({ hasText: "Изменение отклонено" })
    .waitFor();
  assert.equal(
    await f.page
      .getByRole("button", { name: /Подтвердить|Повторить/ })
      .isDisabled(),
    true,
  );
  await close(f);
}
{
  const f = await fixture(320);
  await f.page
    .getByRole("button", { name: /Отозвать: .*Учебный участник/ })
    .click();
  await f.page.getByLabel("Основание отзыва").fill("Синтетический отзыв");
  await f.page.getByRole("button", { name: "Проверить отзыв" }).click();
  await f.page.getByText("Отозвать «Проверка отчётов»").waitFor();
  await f.page.getByRole("button", { name: "Подтвердить изменение" }).click();
  await f.page.getByText("Право отозвано.").waitFor();
  assert.equal(f.posts[0].path, "/api/v1/admin/access/revocations");
  assert.equal(f.posts[0].body.bindingId, binding);
  assert.equal(f.posts[0].body.expectedVersion, 1);
  await close(f);
}
await browser.close();
console.log(`Access management browser: ${scenarios} scenarios passed`);
