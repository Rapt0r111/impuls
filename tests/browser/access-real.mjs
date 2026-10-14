import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "access-real",
  );
if (!url) throw new Error("TEST_DATABASE_URL is required");
await mkdir(dir, { recursive: true });
const db = new pg.Pool({ connectionString: url }),
  [adminId, memberId, scope] = [randomUUID(), randomUUID(), randomUUID()],
  token = randomBytes(32).toString("base64url");
for (const [id, name] of [
  [adminId, "Реальный администратор"],
  [memberId, "Реальный участник"],
])
  await db.query(
    "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
    [id, randomInt(7e12, 8e12), name],
  );
await db.query(
  "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Реальная область')",
  [scope],
);
for (const action of [
  "admin.access",
  "admin.access.manage",
  "admin.members.manage",
  "admin.audit",
])
  await db.query(
    "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic fixture')",
    [adminId, scope, action],
  );
for (const id of [adminId, memberId])
  await db.query(
    "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
    [id, scope],
  );
await db.query(
  "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
  [adminId, createHash("sha256").update(token).digest()],
);
const count = async (sql) =>
  Number((await db.query(sql, [memberId, scope])).rows[0].n);
const live =
    "SELECT count(*) n FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2 AND action='task.assign' AND revoked_at IS NULL",
  changes =
    "SELECT count(*) n FROM impuls.access_changes WHERE subject_id=$1 AND scope_id=$2";

const browser = await chromium.launch();
let scenarios = 0;
for (const width of [320, 360, 390]) {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(10000);
  // Формы выдачи права и допуска свёрнуты; сценарию нужны их поля.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const d of document.querySelectorAll(
        "details.access-form:not([open])",
      ))
        d.open = true;
    }).observe(document, { childList: true, subtree: true });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([
    { name: "impuls_session", value: token, url: origin },
  ]);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}}",
    }),
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "Управление доступом", exact: true })
    .click();
  await page.getByText("Реальный участник").first().waitFor();
  if (width === 320) {
    await page.getByLabel("Участник", { exact: true }).selectOption(memberId);
    await page.getByLabel("Право", { exact: true }).selectOption("task.assign");
    await page.getByLabel("Основание выдачи").fill("Реальная выдача");
    await page.getByRole("button", { name: "Проверить выдачу" }).click();
    assert.equal(await count(live), 0, "preview writes nothing");
    await page.getByRole("button", { name: "Подтвердить изменение" }).click();
    await page.getByText("Право выдано.").waitFor();
    assert.equal(await count(live), 1);
    assert.equal(await count(changes), 1);
    await page
      .getByRole("button", { name: /Отозвать: .*Реальный участник/ })
      .click();
    await page.getByLabel("Основание отзыва").fill("Реальный отзыв");
    await page.getByRole("button", { name: "Проверить отзыв" }).click();
    await page.getByRole("button", { name: "Подтвердить изменение" }).click();
    await page.getByText("Право отозвано.").waitFor();
    assert.equal(await count(live), 0);
    assert.equal(await count(changes), 2);
    // «Командир» выдаёт весь набор прав одним подтверждением.
    const commander =
      "SELECT count(*) n FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2 AND revoked_at IS NULL AND action IN ('task.view','task.create','task.assign','task.edit','task.cancel','task.review','reward.decide','reward.fulfill')";
    await page.getByLabel("Участник", { exact: true }).selectOption(memberId);
    await page
      .getByLabel("Право", { exact: true })
      .selectOption("preset:commander");
    await page.getByLabel("Основание выдачи").fill("Командир пилота");
    await page.getByRole("button", { name: "Проверить выдачу" }).click();
    await page.getByText(/Сделать Реальный участник командиром/).waitFor();
    assert.equal(await count(commander), 0, "preview writes nothing");
    await page.getByRole("button", { name: "Подтвердить изменение" }).click();
    await page.getByText(/^Выдано прав: 8\./).waitFor();
    assert.equal(await count(commander), 8);
    assert.equal(await count(changes), 10);
    await page.getByLabel("Участник", { exact: true }).selectOption(memberId);
    await page
      .getByLabel("Право", { exact: true })
      .selectOption("preset:commander");
    await page.getByLabel("Основание выдачи").fill("Повтор");
    await page.getByRole("button", { name: "Проверить выдачу" }).click();
    await page.getByText("У участника уже есть все права командира.").waitFor();
    assert.equal(await count(changes), 10, "nothing granted twice");
    await page.getByLabel("Основание выдачи").fill("");
    // Admission and removal of a person through the real server and database.
    const telegramId = randomInt(7e12, 8e12);
    const person = async (sql) => (await db.query(sql, [telegramId])).rows[0];
    await page.getByLabel("Telegram ID").fill(String(telegramId));
    await page.getByLabel("Имя или псевдоним").fill("Допущенный участник");
    await page.getByLabel("Основание допуска").fill("Реальный допуск");
    await page.getByRole("button", { name: "Проверить допуск" }).click();
    assert.equal(
      (
        await person(
          "SELECT count(*)::int n FROM impuls.users WHERE telegram_id=$1",
        )
      ).n,
      0,
      "preview creates no account",
    );
    await page.getByRole("button", { name: "Подтвердить изменение" }).click();
    await page.getByText("Участник допущен.").waitFor();
    const admitted = await person(
      `SELECT u.id,u.active,u.display_name,
         (SELECT count(*)::int FROM impuls.task_scope_members m WHERE m.user_id=u.id AND m.revoked_at IS NULL) memberships,
         (SELECT count(*)::int FROM impuls.member_changes c WHERE c.subject_id=u.id AND c.kind='admit') changes
       FROM impuls.users u WHERE u.telegram_id=$1`,
    );
    assert.deepEqual(
      { ...admitted, id: undefined },
      {
        id: undefined,
        active: true,
        display_name: "Допущенный участник",
        memberships: 1,
        changes: 1,
      },
    );
    await page
      .getByRole("list", { name: "Участники" })
      .getByText("Допущенный участник")
      .waitFor();
    await page
      .getByRole("button", { name: "Отозвать допуск", exact: true })
      .click();
    await page
      .locator("select")
      .last()
      .selectOption({ label: "Допущенный участник" });
    await page
      .getByLabel("Основание отзыва")
      .last()
      .fill("Реальный отзыв допуска");
    await page.getByRole("button", { name: "Проверить отзыв" }).last().click();
    await page.getByRole("button", { name: "Подтвердить изменение" }).click();
    await page.getByText("Допуск отозван. Сессии участника закрыты.").waitFor();
    const removed = await person(
      `SELECT u.active,
         (SELECT count(*)::int FROM impuls.task_scope_members m WHERE m.user_id=u.id AND m.revoked_at IS NULL) memberships,
         (SELECT count(*)::int FROM impuls.member_changes c WHERE c.subject_id=u.id) changes
       FROM impuls.users u WHERE u.telegram_id=$1`,
    );
    assert.deepEqual(removed, { active: false, memberships: 0, changes: 2 });
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page
      .getByRole("button", { name: "Журнал действий", exact: true })
      .click();
    await page
      .getByText("Выдано право «Назначение задач» участнику Реальный участник.")
      .first()
      .waitFor();
    await page
      .getByText(
        "Отозвано право «Назначение задач» участнику Реальный участник.",
      )
      .waitFor();
    await page
      .getByText("Допущен новый участник Допущенный участник.")
      .waitFor();
    await page
      .getByText("Отозван допуск участника Допущенный участник.")
      .waitFor();
  }
  await page.screenshot({
    path: path.join(dir, `access-real-${width}.png`),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "no horizontal scroll",
  );
  await context.close();
  scenarios += 1;
}
await browser.close();
await db.end();
console.log(`Access real-DB browser: ${scenarios} scenarios passed`);
