import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
import { optionTexts, selectOption, selectTrigger } from "./select-option.mjs";

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

async function fixture(
  width = 320,
  {
    canManage = true,
    canManageMembers = false,
    post = [201],
    memberPost = [201],
  } = {},
) {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    posts = [],
    memberPosts = [];
  // Формы выдачи права и допуска свёрнуты; сценарию нужны их поля.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const d of document.querySelectorAll(
        "details.access-form:not([open])",
      ))
        d.open = true;
    }).observe(document, { childList: true, subtree: true });
  });
  const membership = "e1111111-1111-4111-8111-111111111111";
  let people = [
    {
      userId: actor,
      membershipId: "e2222222-2222-4222-8222-222222222222",
      membershipVersion: 1,
      displayName: "Учебный администратор",
      isSelf: true,
    },
    {
      userId: member,
      membershipId: membership,
      membershipVersion: 3,
      displayName: "Учебный участник",
      isSelf: false,
    },
  ];
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
        canManageMembers,
        members: people.map((m) => ({
          ...m,
          bindings: m.userId === member ? bindings : [],
        })),
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
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/admin/members/"),
    async (r) => {
      const req = r.request();
      const body = JSON.parse(req.postData() ?? "{}");
      memberPosts.push({
        path: new URL(req.url()).pathname,
        key: req.headers()["idempotency-key"],
        body,
      });
      const code = memberPost.length > 1 ? memberPost.shift() : memberPost[0];
      if (code !== 201)
        return json(r, { code: "X", message: "x", requestId: "r" }, code);
      const removing = memberPosts.at(-1).path.endsWith("removals");
      const added = {
        userId: crypto.randomUUID(),
        membershipId: crypto.randomUUID(),
        membershipVersion: 1,
        displayName: body.displayName ?? "",
        isSelf: false,
      };
      const gone = people.find((m) => m.membershipId === body.membershipId);
      if (removing) people = people.filter((m) => m !== gone);
      else people = [...people, added];
      const base = {
        mode: "synthetic",
        scope,
        changeId: crypto.randomUUID(),
        updatedAt: "2026-10-09T10:00:00.000Z",
      };
      return json(
        r,
        removing
          ? {
              ...base,
              kind: "remove",
              member: {
                membershipId: body.membershipId,
                userId: gone?.userId ?? member,
                displayName: gone?.displayName ?? "Учебный участник",
                version: 4,
                validUntil: null,
              },
              revokedBindings: 1,
              userDeactivated: true,
            }
          : {
              ...base,
              kind: "admit",
              member: {
                membershipId: added.membershipId,
                userId: added.userId,
                displayName: added.displayName,
                version: 1,
                validUntil: body.validUntil,
              },
              userCreated: true,
              userReactivated: false,
            },
        201,
      );
    },
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "Управление доступом", exact: true })
    .click();
  await page.getByText("Учебный участник").first().waitFor();
  return { page, context, posts, memberPosts, errors };
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
  await selectOption(f.page, "Участник", member);
  await selectOption(f.page, "Право", "task.assign");
  await f.page.getByLabel("Основание выдачи").fill(reason);
  await f.page.getByRole("button", { name: "Проверить выдачу" }).click();
};

for (const width of [320, 360, 390]) {
  const f = await fixture(width);
  assert.equal(await selectTrigger(f.page, "Участник").count(), 1);
  assert.equal(
    (await optionTexts(f.page, "Участник")).includes("Учебный администратор"),
    false,
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
const admitForm = async (f, over = {}) => {
  const v = {
    id: "7123456789",
    name: "Новый участник",
    reason: "Синтетический допуск",
    ...over,
  };
  await f.page.getByLabel("Telegram ID").fill(v.id);
  await f.page.getByLabel("Имя или псевдоним").fill(v.name);
  await f.page.getByLabel("Основание допуска").fill(v.reason);
  await f.page.getByRole("button", { name: "Проверить допуск" }).click();
};
const confirm = (f) =>
  f.page.getByRole("button", { name: "Подтвердить изменение" }).click();
for (const width of [320, 360, 390]) {
  const f = await fixture(width, { canManageMembers: true });
  await f.page.getByRole("heading", { name: "Участники" }).waitFor();
  assert.equal(
    await f.page
      .getByRole("button", { name: "Допустить", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await f.page.screenshot({
    path: path.join(dir, `members-${width}.png`),
    fullPage: true,
  });
  await close(f);
}
{
  const f = await fixture(320);
  assert.equal(
    await f.page.getByRole("heading", { name: "Участники" }).count(),
    0,
    "no section without the members right",
  );
  await close(f);
}
{
  const f = await fixture(320, { canManage: false, canManageMembers: true });
  assert.equal(
    await f.page.getByRole("button", { name: "Проверить выдачу" }).count(),
    0,
  );
  await f.page.getByRole("button", { name: "Проверить допуск" }).waitFor();
  await close(f);
}
{
  const f = await fixture(320, { canManageMembers: true });
  await admitForm(f);
  await f.page
    .getByText("Допустить «Новый участник» (Telegram ID 7123456789) без срока.")
    .waitFor();
  assert.equal(f.memberPosts.length, 0, "preview sends nothing");
  await confirm(f);
  await f.page.getByText("Участник допущен.").waitFor();
  assert.equal(f.memberPosts.length, 1);
  assert.equal(f.memberPosts[0].path, "/api/v1/admin/members/admissions");
  assert.match(f.memberPosts[0].key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(f.memberPosts[0].body, {
    scope,
    telegramId: 7123456789,
    displayName: "Новый участник",
    validUntil: null,
    reason: "Синтетический допуск",
  });
  await f.page
    .getByRole("list", { name: "Участники" })
    .getByText("Новый участник")
    .waitFor();
  assert.equal(
    await f.page.getByLabel("Telegram ID").inputValue(),
    "",
    "the ID is not kept after saving",
  );
  await close(f);
}
{
  const f = await fixture(320, { canManageMembers: true });
  await f.page.getByLabel("Telegram ID").fill("12ab");
  await f.page.getByLabel("Имя или псевдоним").fill("Имя");
  await f.page.getByLabel("Основание допуска").fill("Основание");
  await f.page.getByRole("button", { name: "Проверить допуск" }).click();
  assert.equal(
    await f.page.getByRole("button", { name: "Подтвердить изменение" }).count(),
    0,
    "a non-numeric ID never reaches the preview",
  );
  await f.page.getByLabel("Telegram ID").fill("42");
  await f.page.getByLabel(/Допуск до/).fill("2020-01-01T10:00");
  await f.page.getByRole("button", { name: "Проверить допуск" }).click();
  await f.page.getByText("Срок допуска должен быть в будущем.").waitFor();
  assert.equal(f.memberPosts.length, 0);
  await close(f);
}
{
  const f = await fixture(320, {
    canManageMembers: true,
    memberPost: [503, 201],
  });
  await admitForm(f);
  await confirm(f);
  await f.page.getByText("Результат не подтверждён").waitFor();
  await f.page.getByRole("button", { name: "Повторить тот же запрос" }).click();
  await f.page.getByText("Участник допущен.").waitFor();
  assert.equal(f.memberPosts.length, 2);
  assert.equal(f.memberPosts[0].key, f.memberPosts[1].key);
  assert.deepEqual(f.memberPosts[0].body, f.memberPosts[1].body);
  await close(f);
}
{
  const f = await fixture(320, { canManageMembers: true, memberPost: [409] });
  await admitForm(f);
  await confirm(f);
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
  const f = await fixture(320, { canManageMembers: true, memberPost: [404] });
  await admitForm(f);
  await confirm(f);
  await f.page.getByText("Управление составом недоступно.").waitFor();
  assert.equal(
    await f.page.getByRole("list", { name: "Участники" }).count(),
    0,
    "the list is cleared on 404",
  );
  await close(f);
}
{
  const f = await fixture(320, { canManageMembers: true });
  await f.page
    .getByRole("button", { name: "Отозвать допуск", exact: true })
    .click();
  // Two member pickers exist (grant and removal); the removal form is the last one.
  const removal = selectTrigger(f.page, "Участник").last();
  assert.deepEqual(
    await optionTexts(f.page, removal),
    ["Выберите участника", "Учебный участник"],
    "the actor is not offered for removal",
  );
  await selectOption(f.page, removal, { label: "Учебный участник" });
  await f.page
    .getByLabel("Основание отзыва")
    .last()
    .fill("Синтетический отзыв допуска");
  await f.page.getByRole("button", { name: "Проверить отзыв" }).last().click();
  await f.page.getByText("Отозвать допуск у Учебный участник.").waitFor();
  await f.page.getByText("сессии закроются").waitFor();
  assert.equal(f.memberPosts.length, 0);
  await confirm(f);
  await f.page.getByText("Допуск отозван. Сессии участника закрыты.").waitFor();
  assert.equal(f.memberPosts[0].path, "/api/v1/admin/members/removals");
  assert.deepEqual(f.memberPosts[0].body, {
    scope,
    membershipId: "e1111111-1111-4111-8111-111111111111",
    expectedVersion: 3,
    reason: "Синтетический отзыв допуска",
  });
  assert.equal(
    await f.page
      .getByRole("list", { name: "Участники" })
      .getByText("Учебный участник")
      .count(),
    0,
  );
  await close(f);
}
await browser.close();
console.log(`Access management browser: ${scenarios} scenarios passed`);
