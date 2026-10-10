import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readNotificationAttempts } from "../../packages/domain/src/notifications/attempts";
import {
  notificationAttemptsCursorSchema,
  notificationAttemptsResponseSchema,
} from "../../packages/contracts/src/notification-attempts";
import { openSection } from "../browser/nav.mjs";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)("F08 scoped immutable attempt reader", () => {
  const admin = new Pool({ connectionString: url }),
    app = new Pool({ connectionString: url, options: "-c role=impuls_app" });
  const users = [randomUUID(), randomUUID()],
    scopes = [randomUUID(), randomUUID(), randomUUID()];
  const actor = users[0]!,
    other = users[1]!,
    scope = scopes[0]!,
    hidden = scopes[1]!,
    empty = scopes[2]!;
  const token = randomBytes(32).toString("base64url"),
    hash = createHash("sha256").update(token).digest(),
    otherHash = createHash("sha256").update(randomBytes(32)).digest(),
    rule = randomUUID();
  const tasks: string[] = [],
    events: string[] = [],
    entries: { id: string; eventId: string; microsecond: number }[] = [];
  const read = (
    options: Partial<Parameters<typeof readNotificationAttempts>[3]> = {},
  ) =>
    readNotificationAttempts(app, actor, hash, {
      enabled: true,
      scope,
      ...options,
    });
  async function event(atScope = scope, microsecond = 0) {
    const task = randomUUID(),
      id = randomUUID();
    tasks.push(task);
    events.push(id);
    await admin.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,'PRIVATE TASK','PRIVATE CRITERIA','test','normal','draft','2035-01-01',7,3)",
      [task, atScope, rule, actor],
    );
    await admin.query(
      "INSERT INTO impuls.notification_outbox(id,recipient_id,task_id,kind,mode,created_at,updated_at) VALUES($1,$2,$3,'task.assigned','synthetic',clock_timestamp(),clock_timestamp())",
      [id, other, task],
    );
    await admin.query(
      "INSERT INTO impuls.notification_simulations(outbox_id,status) VALUES($1,'ready')",
      [id],
    );
    for (const [index, phase] of ["started", "retry"].entries()) {
      const journalId = randomUUID();
      // Synthetic SQL fixtures, deliberately tied/rounded times. Production rows come from the trigger.
      await admin.query(
        "INSERT INTO impuls.notification_simulation_events(id,outbox_id,attempt,phase,error_code,recorded_at) VALUES($1,$2,1,$3,$4,timestamptz '2040-01-01T00:00:00Z'+$5*interval '1 microsecond')",
        [
          journalId,
          id,
          phase,
          phase === "retry" ? "timeout" : null,
          microsecond + index,
        ],
      );
      if (atScope === scope)
        entries.push({
          id: journalId,
          eventId: id,
          microsecond: microsecond + index,
        });
    }
    return id;
  }
  beforeAll(async () => {
    for (const u of users)
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'PRIVATE NAME',true)",
        [u, randomInt(7e12, 8e12)],
      );
    for (const [i, s] of scopes.entries())
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project',$2)",
        [s, `Synthetic attempt area ${i}`],
      );
    for (const s of [scope, empty])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'admin.notifications',$2,$1,'Synthetic test')",
        [actor, s],
      );
    await admin.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'admin.audit',$2,$1,'Other permission')",
      [other, scope],
    );
    await admin.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,'{}',now(),$3)",
      [rule, randomInt(1e6, 2e9), actor],
    );
    for (let i = 0; i < 14; i++) await event(scope, i < 3 ? 0 : i * 2);
    await event(hidden, 100);
    await admin.query(
      "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [actor, hash],
    );
    await admin.query(
      "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [other, otherHash],
    );
  });
  it("paginates every immutable row using native microseconds and UUID ties, without sensitive fields", async () => {
    const expected = [...entries].sort(
      (a, b) => b.microsecond - a.microsecond || b.id.localeCompare(a.id),
    );
    const seen: string[] = [];
    let cursor:
      ReturnType<typeof notificationAttemptsCursorSchema.parse> | undefined;
    for (let i = 0; i < expected.length; i++) {
      const result = await read({ limit: 1, ...(cursor ? { cursor } : {}) });
      if (result.kind !== "ok") throw new Error(result.kind);
      const page = notificationAttemptsResponseSchema.parse(result.response);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.id).toBe(expected[i]!.id);
      expect(page.items[0]!.recordedAt).toBe("2040-01-01T00:00:00.000Z");
      expect(Object.keys(page.items[0]!).sort()).toEqual([
        "attempt",
        "errorCode",
        "eventId",
        "id",
        "kind",
        "phase",
        "recordedAt",
      ]);
      seen.push(page.items[0]!.id);
      if (page.nextCursor)
        cursor = notificationAttemptsCursorSchema.parse(page.nextCursor);
      else expect(i).toBe(expected.length - 1);
      const wire = JSON.stringify(page);
      for (const secret of [
        "PRIVATE",
        other,
        rule,
        "lease_token",
        "recipientId",
        "taskId",
        "text",
      ])
        expect(wire).not.toContain(secret);
    }
    expect(new Set(seen).size).toBe(28);
  });
  it("binds actor/scope/purpose/anchor and checks authority before hidden-anchor errors", async () => {
    const first = await read({ limit: 1 });
    if (first.kind !== "ok" || !first.response.nextCursor)
      throw new Error("no cursor");
    const cursor = notificationAttemptsCursorSchema.parse(
      first.response.nextCursor,
    );
    const foreign = (
      await admin.query(
        "SELECT id FROM impuls.notification_simulation_events WHERE outbox_id=$1 LIMIT 1",
        [events.at(-1)],
      )
    ).rows[0].id;
    for (const forged of [
      { ...cursor, actor: other },
      { ...cursor, scope: hidden },
      { ...cursor, journalId: foreign },
      { ...cursor, journalId: randomUUID() },
      { ...cursor, purpose: "notification-events" as "notification-attempts" },
    ])
      expect(await read({ cursor: forged })).toEqual({ kind: "invalid" });
    expect(await read({ scope: hidden, cursor })).toEqual({
      kind: "not_found",
    });
    expect(await read({ enabled: false, cursor })).toEqual({
      kind: "disabled",
    });
    expect(await readNotificationAttempts(app, actor, hash, { scope })).toEqual(
      { kind: "disabled" },
    );
    expect(
      await readNotificationAttempts(app, other, hash, {
        scope,
        enabled: true,
      }),
    ).toEqual({ kind: "unauthorized" });
    expect(
      await readNotificationAttempts(app, other, otherHash, {
        scope,
        enabled: true,
      }),
    ).toEqual({ kind: "not_found" });
    expect(await read({ limit: 0 })).toEqual({ kind: "invalid" });
    const result = await read({ scope: empty });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.response.items).toEqual([]);
  });
  it("retains historical synthetic rows after the outbox leaves pending and never mutates on read", async () => {
    await admin.query(
      "UPDATE impuls.notification_outbox SET status='sent' WHERE id=$1",
      [events[0]],
    );
    const snapshot = async () =>
      (
        await admin.query(
          `SELECT
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM impuls.notification_simulation_events e WHERE outbox_id=ANY($1::uuid[])) journal,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM impuls.notification_outbox o WHERE id=ANY($1::uuid[])) outbox,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY outbox_id) FROM impuls.notification_simulations d WHERE outbox_id=ANY($1::uuid[])) receipts`,
          [events],
        )
      ).rows[0];
    const before = await snapshot(),
      result = await read({ limit: 50 });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.response.items).toHaveLength(28);
    expect(
      result.response.items.filter((e) => e.eventId === events[0]),
    ).toHaveLength(2);
    expect(await snapshot()).toEqual(before);
  });
  it("keeps continuation stable when new transitions arrive and shows them after refresh", async () => {
    const result = await read({ limit: 1 });
    if (result.kind !== "ok" || !result.response.nextCursor)
      throw new Error("no cursor");
    const cursor = notificationAttemptsCursorSchema.parse(
        result.response.nextCursor,
      ),
      before = await read({ limit: 1, cursor }),
      id = randomUUID();
    await admin.query(
      "INSERT INTO impuls.notification_simulation_events(id,outbox_id,attempt,phase,recorded_at) VALUES($1,$2,1,'simulated',timestamptz '2050-01-01T00:00:00Z')",
      [id, events[0]],
    );
    const after = await read({ limit: 1, cursor });
    if (before.kind !== "ok" || after.kind !== "ok")
      throw new Error("continuation failure");
    expect(after.response.items).toEqual(before.response.items);
    const refreshed = await read({ limit: 1 });
    if (refreshed.kind !== "ok") throw new Error(refreshed.kind);
    expect(refreshed.response.items[0]!.id).toBe(id);
  });
  it("rechecks expired/revoked sessions, active subject and exact permission on every page", async () => {
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()+interval '1 hour',revoked_at=now() WHERE user_id=$1",
      [actor],
    );
    expect(await read({ enabled: false })).toEqual({ kind: "revoked" });
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      actor,
    ]);
    expect(await read({ enabled: false })).toEqual({ kind: "revoked" });
    await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
      actor,
    ]);
    await admin.query(
      "UPDATE impuls.role_bindings SET valid_from=now()-interval '1 minute',valid_until=now()-interval '1 second' WHERE user_id=$1 AND action='admin.notifications'",
      [actor],
    );
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "not_found" });
    await admin.query(
      "UPDATE impuls.role_bindings SET valid_until=NULL,revoked_at=now() WHERE user_id=$1 AND action='admin.notifications'",
      [actor],
    );
    expect(await read()).toEqual({ kind: "revoked" });
    await admin.query(
      "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND action='admin.notifications'",
      [actor],
    );
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    expect((await read()).kind).toBe("ok");
  });
  it.skipIf(!origin)(
    "HTTP enforces minimal projection, strict query, no-store and current access",
    async () => {
      const endpoint = `${origin}/api/v1/admin/notifications/attempts`,
        headers = { cookie: `impuls_session=${token}` };
      const valid = await fetch(`${endpoint}?scope=${scope}`, { headers });
      expect(valid.status).toBe(200);
      expect(valid.headers.get("cache-control")).toBe("private, no-store");
      expect(
        notificationAttemptsResponseSchema.parse(await valid.json()).items,
      ).toHaveLength(10);
      for (const params of [
        "",
        `scope=bad`,
        `scope=${scope}&scope=${scope}`,
        `scope=${scope}&unknown=1`,
        `scope=${scope}&limit=51`,
        `scope=${scope}&cursor=${actor}|${scope}|notification-events|${entries[0]!.id}`,
      ])
        expect((await fetch(`${endpoint}?${params}`, { headers })).status).toBe(
          400,
        );
      expect(
        (await fetch(`${endpoint}?scope=${hidden}`, { headers })).status,
      ).toBe(404);
      expect((await fetch(`${endpoint}?scope=${scope}`)).status).toBe(401);
      expect(
        (await fetch(`${endpoint}?scope=${scope}`, { headers, method: "POST" }))
          .status,
      ).toBe(405);
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        actor,
      ]);
      expect(
        (await fetch(`${endpoint}?scope=${scope}`, { headers })).status,
      ).toBe(403);
      await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
        actor,
      ]);
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [actor],
      );
    },
  );
  it.skipIf(!origin)(
    "browser reads the real scoped journal lazily, continues and closes on Back",
    async () => {
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
        });
        await context.addCookies([
          {
            name: "impuls_session",
            value: token,
            url: origin!,
            httpOnly: true,
          },
        ]);
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
          r.fulfill({
            contentType: "application/javascript",
            body: "window.__back=null;window.Telegram={WebApp:{version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(cb){window.__back=cb},offClick(){window.__back=null}}}}",
          }),
        );
        let calls = 0;
        page.on("request", (r) => {
          if (
            new URL(r.url()).pathname === "/api/v1/admin/notifications/attempts"
          )
            calls++;
        });
        await page.goto(origin!);
        await (await openSection(page, "Состояние уведомлений")).click();
        await page.getByLabel("Область", { exact: true }).selectOption(scope);
        const journal = page.locator(".notification-attempt-history");
        await journal.waitFor();
        expect(calls).toBe(0);
        await journal.locator("summary").first().click();
        await journal.locator("li").first().waitFor();
        expect(await journal.locator("li").count()).toBe(10);
        expect(calls).toBe(1);
        await page
          .getByRole("button", { name: "Следующие записи", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document
              .querySelector(".notification-attempt-history [aria-busy]")
              ?.getAttribute("aria-busy") === "false",
        );
        expect(calls).toBe(2);
        await page.evaluate(() =>
          (window as typeof window & { __back: () => void }).__back(),
        );
        expect(await journal.getAttribute("open")).toBeNull();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
        ).toBe(false);
      } finally {
        await browser.close();
      }
    },
    20000,
  );
  afterAll(async () => {
    // Privileged fixture cleanup only: random IDs belonging to this suite in the
    // explicitly configured isolated TEST_DATABASE_URL. Runtime cannot do this.
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role='replica'");
      await client.query(
        "DELETE FROM impuls.notification_simulation_events WHERE outbox_id=ANY($1::uuid[])",
        [events],
      );
      await client.query(
        "DELETE FROM impuls.notification_simulations WHERE outbox_id=ANY($1::uuid[])",
        [events],
      );
      await client.query(
        "DELETE FROM impuls.notification_outbox WHERE id=ANY($1::uuid[])",
        [events],
      );
      await client.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
        tasks,
      ]);
      await client.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await client.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await client.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rule]);
      await client.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [scopes],
      );
      await client.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await Promise.all([admin.end(), app.end()]);
    }
  });
});
