import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readNotificationStatus } from "../../packages/domain/src/notifications/status";
import { readNotificationEvents } from "../../packages/domain/src/notifications/events";
import { createTask, assignTask } from "../../packages/domain/src/tasks/manage";
import { mutateAssignedTask } from "../../packages/domain/src/tasks/write";
import { reviewTaskSubmission } from "../../packages/domain/src/tasks/reviews";
import { reverseAcceptance } from "../../packages/domain/src/ledger/corrections";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import {
  notificationStatusResponseSchema,
  notificationEventsResponseSchema,
  notificationEventsCursorSchema,
} from "../../packages/contracts/src/notification-status";
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
(url ? describe : describe.skip)("F08 exact-scope simulation status", () => {
  const admin = new Pool({ connectionString: url }),
    runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
    });
  const users = Array.from({ length: 3 }, () => randomUUID()),
    scopes = Array.from({ length: 3 }, () => randomUUID());
  const actor = users[0]!,
    owner = users[1]!,
    unrelated = users[2]!;
  const scope = scopes[0]!,
    neighbour = scopes[1]!,
    emptyScope = scopes[2]!;
  const tokens = users.map(() => randomBytes(32).toString("base64url")),
    hashes = tokens.map((t) => createHash("sha256").update(t).digest());
  const rule = randomUUID(),
    tasks: string[] = [],
    events: string[] = [];
  const rewardId = randomUUID(),
    rewardVersion = randomUUID(),
    quota = randomUUID();
  const read = (
    extra: Parameters<typeof readNotificationStatus>[3] = {},
    i = 0,
  ) =>
    readNotificationStatus(runtime, users[i]!, hashes[i]!, {
      enabled: true,
      scope,
      ...extra,
    });
  const expected = {
    unclaimed: 1,
    ready: 1,
    processing: 1,
    retry: 2,
    simulated: 1,
    delivered: 0,
    failed: 2,
    suppressed: 2,
  };
  const readEvents = (
    extra: Partial<Parameters<typeof readNotificationEvents>[3]> = {},
    i = 0,
  ) =>
    readNotificationEvents(runtime, users[i]!, hashes[i]!, {
      enabled: true,
      scope,
      ...extra,
    });
  it("paginates more than 20 events with native microseconds and tied UUIDs, retains live status and rejects forged anchors", async () => {
    const start = events.length;
    try {
      for (let i = 0; i < 24; i++) await event(null);
      const added = events.slice(start);
      // First four share a timestamp; the rest differ by microseconds that round
      // to the same wire millisecond. UUIDs are intentionally nonmonotonic.
      for (const [i, id] of added.entries())
        await admin.query(
          "UPDATE impuls.notification_outbox SET created_at=timestamptz '2040-01-01T00:00:00Z' + $2 * interval '1 microsecond' WHERE id=$1",
          [id, Math.max(0, i - 3)],
        );
      const expectedOrder = [
        ...added.slice(4).reverse(),
        ...added.slice(0, 4).sort().reverse(),
        ...events.slice(0, 10).reverse(),
      ];
      const seen: string[] = [];
      let cursor:
        ReturnType<typeof notificationEventsCursorSchema.parse> | undefined;
      for (let i = 0; i < expectedOrder.length; i++) {
        const result = await readEvents({
          limit: 1,
          ...(cursor ? { cursor } : {}),
        });
        if (result.kind !== "ok") throw new Error(result.kind);
        const data = notificationEventsResponseSchema.parse(result.response);
        expect(data.items).toHaveLength(1);
        expect(Object.keys(data.items[0]!).sort()).toEqual([
          "createdAt",
          "errorCode",
          "kind",
          "status",
        ]);
        if (i < 24)
          expect(data.items[0]!.createdAt).toBe("2040-01-01T00:00:00.000Z");
        if (data.nextCursor) {
          cursor = notificationEventsCursorSchema.parse(data.nextCursor);
          seen.push(cursor.eventId);
          expect(cursor.eventId).toBe(expectedOrder[i]);
        } else expect(i).toBe(expectedOrder.length - 1);
      }
      expect(new Set(seen).size).toBe(33);
      const first = await readEvents({ limit: 1 });
      if (first.kind !== "ok" || !first.response.nextCursor)
        throw new Error("Missing cursor");
      const anchor = notificationEventsCursorSchema.parse(
        first.response.nextCursor,
      );
      for (const forged of [
        { ...anchor, actor: owner },
        { ...anchor, scope: neighbour },
        { ...anchor, eventId: events[10]! },
        { ...anchor, eventId: events[11]! },
        { ...anchor, eventId: randomUUID() },
      ])
        expect(await readEvents({ cursor: forged })).toEqual({
          kind: "invalid",
        });
      expect(await readEvents({ scope: neighbour, cursor: anchor })).toEqual({
        kind: "not_found",
      });
      expect(await readEvents({}, 2)).toEqual({ kind: "not_found" });
      expect(await readEvents({ enabled: false })).toEqual({
        kind: "disabled",
      });
      const defaultOff = await readNotificationEvents(
        runtime,
        actor,
        hashes[0]!,
        { scope },
      );
      expect(defaultOff).toEqual({ kind: "disabled" });
      await admin.query(
        "INSERT INTO impuls.notification_simulations(outbox_id,status) VALUES($1,'ready')",
        [expectedOrder[1]],
      );
      const live = await readEvents({ cursor: anchor, limit: 1 });
      if (live.kind !== "ok") throw new Error(live.kind);
      expect(live.response.items[0]!.status).toBe("ready");
      // Newer arrivals do not shift the continuation boundary.
      await event(null);
      await admin.query(
        "UPDATE impuls.notification_outbox SET created_at='2041-01-01T00:00:00Z' WHERE id=$1",
        [events.at(-1)],
      );
      const continuation = await readEvents({ cursor: anchor, limit: 1 });
      if (continuation.kind !== "ok") throw new Error(continuation.kind);
      expect(continuation.response.items[0]!.status).toBe("ready");
      const refreshed = await readEvents({ limit: 1 });
      if (refreshed.kind !== "ok") throw new Error(refreshed.kind);
      expect(refreshed.response.items[0]!.createdAt).toBe(
        "2041-01-01T00:00:00.000Z",
      );
      await admin.query("DELETE FROM impuls.notification_outbox WHERE id=$1", [
        anchor.eventId,
      ]);
      expect(await readEvents({ cursor: anchor })).toEqual({ kind: "invalid" });
    } finally {
      await admin.query(
        "DELETE FROM impuls.notification_simulations WHERE outbox_id=ANY($1::uuid[])",
        [events.slice(start)],
      );
      await admin.query(
        "DELETE FROM impuls.notification_outbox WHERE id=ANY($1::uuid[])",
        [events.slice(start)],
      );
      events.splice(start);
    }
  });
  const expectedErrors = {
    transport_unavailable: 1,
    timeout: 2,
    attempts_exhausted: 1,
    recipient_inactive: 1,
    unsupported_kind: 1,
    rate_limited: 0,
    recipient_unreachable: 0,
  };
  const base = () => ({
    actorId: actor,
    sessionHash: hashes[0]!,
    enabled: true,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
  });
  async function event(
    status: string | null,
    error: string | null = null,
    atScope = scope,
    sourceStatus = "pending",
  ) {
    const task = randomUUID(),
      id = randomUUID();
    tasks.push(task);
    events.push(id);
    await admin.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,'PRIVATE TASK','PRIVATE CRITERIA','test','normal','draft','2035-01-01',7,3)",
      [task, atScope, rule, actor],
    );
    await admin.query(
      "INSERT INTO impuls.notification_outbox(id,recipient_id,task_id,kind,mode,status,created_at,updated_at) VALUES($1,$2,$3,'task.assigned','synthetic',$4,clock_timestamp(),clock_timestamp())",
      [id, owner, task, sourceStatus],
    );
    if (status)
      await admin.query(
        `INSERT INTO impuls.notification_simulations(outbox_id,status,attempts,error_code,lease_token,lease_until,completed_at)
      VALUES($1,$2,CASE WHEN $2='ready' THEN 0 WHEN $2='failed' THEN 5 ELSE 1 END,$3,
        CASE WHEN $2='processing' THEN gen_random_uuid() END,CASE WHEN $2='processing' THEN clock_timestamp()+interval '30 seconds' END,
        CASE WHEN $2 IN ('simulated','failed','suppressed') THEN clock_timestamp() END)`,
        [id, status, error],
      );
  }
  beforeAll(async () => {
    for (const [i, u] of users.entries()) {
      await admin.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
        [u, randomInt(6e12, 7e12), `PRIVATE NAME ${i}`],
      );
    }
    for (const [i, s] of scopes.entries())
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'group',$2)",
        [s, `Synthetic notification area ${i}`],
      );
    for (const s of [scope, emptyScope])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'admin.notifications',$2,$1,'Synthetic fixture')",
        [actor, s],
      );
    for (const action of [
      "admin.audit",
      "admin.access",
      "admin.rules",
      "admin.catalog",
      "task.view",
      "task.review",
      "reward.decide",
      "reward.fulfill",
      "ledger.correct",
    ])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Does not grant status')",
        [unrelated, action, scope],
      );
    for (const action of [
      "task.create",
      "task.assign",
      "task.review",
      "ledger.correct",
    ])
      await admin.query(
        "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic source flow')",
        [actor, action, scope],
      );
    await admin.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,$2,$3::jsonb,now()-interval '1 minute',$4)",
      [
        rule,
        randomInt(1e6, 2e9),
        JSON.stringify({
          mode: "synthetic",
          timeZone: "Europe/Moscow",
          acceptance: { enabled: true },
        }),
        actor,
      ],
    );
    for (const [status, error] of [
      [null, null],
      ["ready", null],
      ["processing", null],
      ["retry", "transport_unavailable"],
      ["retry", "timeout"],
      ["simulated", null],
      ["failed", "timeout"],
      ["failed", "attempts_exhausted"],
      ["suppressed", "recipient_inactive"],
      ["suppressed", "unsupported_kind"],
    ])
      await event(status!, error);
    await event(null, null, neighbour);
    await event(null, null, scope, "sent");
    // Granting a binding revokes prior sessions; login follows fixture grants.
    for (const [i, u] of users.entries())
      await admin.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [u, hashes[i]],
      );
  });
  it("returns independent state/error counts, excludes neighbouring and nonpending source events", async () => {
    const result = await read();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(result.kind);
    const data = notificationStatusResponseSchema.parse(result.response);
    expect(data.counts).toEqual(expected);
    expect(data.errors).toEqual(expectedErrors);
    expect(data.recentEvents).toHaveLength(10);
    expect(data.recentEvents.map((e) => e.status)).toEqual([
      "suppressed",
      "suppressed",
      "failed",
      "failed",
      "simulated",
      "retry",
      "retry",
      "processing",
      "ready",
      "unclaimed",
    ]);
    expect(data.recentEvents.every((e) => e.kind === "task.assigned")).toBe(
      true,
    );
    expect(data.scopes.map((s) => s.id).sort()).toEqual(
      [scope, emptyScope].sort(),
    );
    const wire = JSON.stringify(data);
    for (const privateValue of [
      "PRIVATE",
      ...users,
      ...events,
      ...tokens,
      "lease",
      "recipient",
      "reason",
      "task_id",
      neighbour,
    ]) {
      // Fixed error-code vocabulary can contain 'recipient', but no recipient field/value.
      if (privateValue !== "recipient")
        expect(wire).not.toContain(privateValue);
    }
    expect(Object.keys(data).sort()).toEqual(
      [
        "mode",
        "scope",
        "scopes",
        "updatedAt",
        "counts",
        "errors",
        "recentEvents",
      ].sort(),
    );
  });
  it("bounds the list at 20 with a deterministic UUID tie-break", async () => {
    const firstEvent = events.length;
    try {
      for (let i = 0; i < 24; i++) await event(null);
      const added = events.slice(firstEvent);
      await admin.query(
        "UPDATE impuls.notification_outbox SET created_at='2040-01-01T00:00:00Z' WHERE id=ANY($1::uuid[])",
        [added],
      );
      const ordered = [...added].sort().reverse();
      // Different receipt states identify tied rows without exposing event IDs.
      await admin.query(
        "INSERT INTO impuls.notification_simulations(outbox_id,status) VALUES($1,'ready')",
        [ordered[0]],
      );
      await admin.query(
        "INSERT INTO impuls.notification_simulations(outbox_id,status,attempts,completed_at) VALUES($1,'simulated',1,clock_timestamp())",
        [ordered[1]],
      );
      const result = await read();
      if (result.kind !== "ok") throw new Error(result.kind);
      expect(result.response.recentEvents).toHaveLength(20);
      expect(
        result.response.recentEvents.slice(0, 2).map((e) => e.status),
      ).toEqual(["ready", "simulated"]);
      expect(
        result.response.recentEvents.every(
          (e) =>
            e.createdAt === "2040-01-01T00:00:00.000Z" && e.errorCode === null,
        ),
      ).toBe(true);
      expect(result.response.counts.unclaimed).toBe(23);
    } finally {
      await admin.query(
        "DELETE FROM impuls.notification_simulations WHERE outbox_id=ANY($1::uuid[])",
        [events.slice(firstEvent)],
      );
      await admin.query(
        "DELETE FROM impuls.notification_outbox WHERE id=ANY($1::uuid[])",
        [events.slice(firstEvent)],
      );
    }
  });
  it("does not infer authority from other permissions, membership or adjacent scopes", async () => {
    expect(await read({}, 1)).toEqual({ kind: "not_found" });
    expect(await read({}, 2)).toEqual({ kind: "not_found" });
    expect(await read({ scope: neighbour })).toEqual({ kind: "not_found" });
    expect(await readEvents({ scope: neighbour })).toEqual({
      kind: "not_found",
    });
    expect(await readEvents({}, 1)).toEqual({ kind: "not_found" });
    const empty = await read({ scope: emptyScope });
    expect(empty.kind).toBe("ok");
    if (empty.kind !== "ok") throw new Error(empty.kind);
    expect(Object.values(empty.response.counts)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
  it("is off by default and checks expired/wrong/revoked sessions and inactive users before the flag", async () => {
    expect(await read({ enabled: false })).toEqual({ kind: "disabled" });
    expect(await readNotificationStatus(runtime, actor, hashes[0]!)).toEqual({
      kind: "disabled",
    });
    expect(
      await readNotificationStatus(runtime, actor, hashes[1]!, {
        enabled: false,
      }),
    ).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [actor],
    );
    expect(await read()).toEqual({ kind: "unauthorized" });
    expect(await readEvents()).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.sessions SET expires_at=now()+interval '1 hour',revoked_at=now() WHERE user_id=$1",
      [actor],
    );
    expect(await read({ enabled: false })).toEqual({ kind: "revoked" });
    expect(await readEvents({ enabled: false })).toEqual({ kind: "revoked" });
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      actor,
    ]);
    expect(await read({ enabled: false })).toEqual({ kind: "revoked" });
    expect(await readEvents({ enabled: false })).toEqual({ kind: "revoked" });
    await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
      actor,
    ]);
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
  });
  it("rechecks permission start, expiration and revocation on every read", async () => {
    for (const update of [
      "valid_from=now()+interval '1 hour'",
      "valid_from=now()-interval '2 hours',valid_until=now()-interval '1 hour'",
      "valid_until=NULL,revoked_at=now()",
    ]) {
      await admin.query(
        `UPDATE impuls.role_bindings SET ${update} WHERE user_id=$1 AND action='admin.notifications' AND scope_id=$2`,
        [actor, scope],
      );
      // A fresh fixture login isolates permission validity from grant-change revocation.
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [actor],
      );
      expect(await read()).toEqual({ kind: "not_found" });
      expect(await readEvents()).toEqual({ kind: "not_found" });
    }
    await admin.query(
      "UPDATE impuls.role_bindings SET valid_from=now()-interval '1 minute',revoked_at=NULL WHERE user_id=$1 AND action='admin.notifications'",
      [actor],
    );
    await admin.query(
      "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
      [actor],
    );
    expect((await read()).kind).toBe("ok");
  });
  it("leaves source events, receipts, balances, audit and business records unchanged", async () => {
    const snapshot = async () =>
      (
        await admin.query(
          `SELECT
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM impuls.notification_outbox o WHERE recipient_id=ANY($1::uuid[])) outbox,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY outbox_id) FROM impuls.notification_simulations d WHERE outbox_id=ANY($2::uuid[])) receipts,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM impuls.tasks t WHERE id=ANY($3::uuid[])) tasks,
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY user_id) FROM impuls.account_balances b WHERE user_id=ANY($1::uuid[])) balances,
      (SELECT count(*)::int FROM impuls.audit_events WHERE actor_id=ANY($1::uuid[])) audit`,
          [users, events, tasks],
        )
      ).rows;
    const before = await snapshot();
    await read();
    await read({ scope: emptyScope });
    await read({ scope: neighbour });
    await readEvents();
    await readEvents({ scope: emptyScope });
    await readEvents({ scope: neighbour });
    expect(await snapshot()).toEqual(before);
  });
  it.skipIf(!origin)(
    "reads event HTTP with strict queries and minimal projection",
    async () => {
      const endpoint = `${origin}/api/v1/admin/notifications/events`;
      const headers = { cookie: `impuls_session=${tokens[0]}` };
      const response = await fetch(`${endpoint}?scope=${scope}&limit=3`, {
        headers,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const page = notificationEventsResponseSchema.parse(
        await response.json(),
      );
      expect(page.items.map((e) => e.status)).toEqual([
        "suppressed",
        "suppressed",
        "failed",
      ]);
      expect(page.nextCursor).toBeTruthy();
      for (const query of [
        "",
        "scope=bad",
        `scope=${scope}&limit=51`,
        `scope=${scope}&limit=1&limit=2`,
        `scope=${scope}&recipientId=${owner}`,
        `scope=${scope}&cursor=${actor}|${scope}|notification-events|${events[10]}`,
      ])
        expect((await fetch(`${endpoint}?${query}`, { headers })).status).toBe(
          400,
        );
      expect(
        (await fetch(`${endpoint}?scope=${neighbour}`, { headers })).status,
      ).toBe(404);
      expect((await fetch(`${endpoint}?scope=${scope}`)).status).toBe(401);
      expect((await fetch(endpoint, { headers, method: "POST" })).status).toBe(
        405,
      );
    },
  );
  it.skipIf(!origin)(
    "enforces real HTTP query, no-store, minimal response, current permission and nonmutating methods",
    async () => {
      const endpoint = `${origin}/api/v1/admin/notifications`,
        headers = { cookie: `impuls_session=${tokens[0]}` };
      const valid = await fetch(`${endpoint}?scope=${scope}`, { headers });
      expect((await fetch(endpoint, { headers })).status).toBe(200);
      expect(valid.status).toBe(200);
      expect(valid.headers.get("cache-control")).toBe("private, no-store");
      expect(
        notificationStatusResponseSchema.parse(await valid.json()).counts,
      ).toEqual(expected);
      for (const query of [
        `scope=bad`,
        `scope=${scope}&scope=${scope}`,
        `recipientId=${owner}`,
        `status=failed`,
      ])
        expect((await fetch(`${endpoint}?${query}`, { headers })).status).toBe(
          400,
        );
      expect(
        (await fetch(`${endpoint}?scope=${neighbour}`, { headers })).status,
      ).toBe(404);
      expect((await fetch(endpoint)).status).toBe(401);
      expect(
        (
          await fetch(endpoint, {
            headers: { cookie: `impuls_session=${tokens[2]}` },
          })
        ).status,
      ).toBe(404);
      expect((await fetch(endpoint, { headers, method: "POST" })).status).toBe(
        405,
      );
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=now() WHERE user_id=$1 AND action='admin.notifications' AND scope_id=$2",
        [actor, scope],
      );
      expect(
        (await fetch(`${endpoint}?scope=${scope}`, { headers })).status,
      ).toBe(403);
      await admin.query(
        "UPDATE impuls.role_bindings SET revoked_at=NULL WHERE user_id=$1 AND action='admin.notifications'",
        [actor],
      );
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        actor,
      ]);
      expect((await fetch(endpoint, { headers })).status).toBe(403);
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
    "renders real scoped API counts through the authorized workspace",
    async () => {
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
        });
        await context.addCookies([
          {
            name: "impuls_session",
            value: tokens[0]!,
            url: origin!,
            httpOnly: true,
          },
        ]);
        const page = await context.newPage();
        // Разбивка по статусам свёрнута; сценарий сверяет счётчики.
        await page.addInitScript(() => {
          new MutationObserver(() => {
            for (const d of document.querySelectorAll(
              "details.notification-breakdown:not([open])",
            ))
              d.open = true;
          }).observe(document, { childList: true, subtree: true });
        });
        page.setDefaultTimeout(5000);
        await page.route(
          "https://telegram.org/js/telegram-web-app.js",
          (route) =>
            route.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
            }),
        );
        await page.goto(origin!);
        await page.getByRole("button", { name: "Ещё", exact: true }).click();
        await page
          .getByRole("button", { name: "Состояние уведомлений", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Состояние уведомлений" })
          .waitFor();
        // Two permitted scopes are sorted; explicitly select the populated scope.
        const selector = page.getByLabel("Область", { exact: true });
        await selector.waitFor();
        await selector.selectOption(scope);
        await page
          .locator(".notification-counts dt")
          .filter({ hasText: "Ожидают повтора" })
          .waitFor();
        await page.getByText("Последние события (10)", { exact: true }).click();
        expect(await page.locator(".notification-events li").count()).toBe(10);
        await page.getByText("Все события", { exact: true }).click();
        await page
          .locator(".notification-history .notification-events li")
          .first()
          .waitFor();
        expect(
          await page
            .locator(".notification-history .notification-events li")
            .count(),
        ).toBe(10);
        expect(
          await page
            .locator(".notification-history .notification-events li")
            .first()
            .innerText(),
        ).toContain("Обработка запрещена");
        expect(
          await page
            .locator(".notification-counts div")
            .filter({ hasText: "Ожидают повтора" })
            .locator("dd")
            .textContent(),
        ).toBe("2");
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
  it("resolves assignment, review, correction and reward sources through their saved exact scopes", async () => {
    await admin.query(
      "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
      [owner, scope],
    );
    const created = await createTask(runtime, {
      ...base(),
      data: {
        scopeId: scope,
        ruleSetId: rule,
        title: "Synthetic provenance",
        criteria: "Synthetic criterion",
        categoryCode: "test",
        priority: "normal",
        dueAt: "2035-01-01T00:00:00.000Z",
        fundXp: 7,
        fundPoints: 3,
      },
    });
    if (created.kind !== "ok") throw new Error(created.kind);
    const taskId = created.response.task.id;
    tasks.push(taskId);
    const assigned = await assignTask(runtime, {
      ...base(),
      taskId,
      data: { assigneeId: owner, expectedVersion: 1 },
    });
    if (assigned.kind !== "ok") throw new Error(assigned.kind);
    const ownerInput = {
      actorId: owner,
      sessionHash: hashes[1]!,
      taskId,
      idempotencyKey: randomUUID(),
    };
    const started = await mutateAssignedTask(runtime, {
      ...ownerInput,
      action: "start",
      expectedVersion: assigned.response.task.version,
    });
    if (started.kind !== "ok") throw new Error(started.kind);
    const submitted = await mutateAssignedTask(runtime, {
      ...ownerInput,
      idempotencyKey: randomUUID(),
      action: "submit",
      expectedVersion: started.response.task.version,
      text: "PRIVATE REPORT",
    });
    if (submitted.kind !== "ok" || !submitted.response.submission)
      throw new Error(submitted.kind);
    const accepted = await reviewTaskSubmission(runtime, {
      ...base(),
      submissionId: submitted.response.submission.id,
      expectedVersion: submitted.response.task.version,
      action: "accept",
      reason: "PRIVATE REASON",
      allowSyntheticAccrual: true,
    });
    if (accepted.kind !== "ok") throw new Error(accepted.kind);
    const review = (
      await admin.query(
        "SELECT id FROM impuls.reviews WHERE submission_id=$1",
        [submitted.response.submission.id],
      )
    ).rows[0].id;
    const balance = (
      await admin.query(
        "SELECT version FROM impuls.account_balances WHERE user_id=$1",
        [owner],
      )
    ).rows[0].version;
    const corrected = await reverseAcceptance(runtime, {
      ...base(),
      reviewId: review,
      expectedVersion: balance,
      reason: "PRIVATE CORRECTION",
      allowSyntheticCorrections: true,
    });
    if (corrected.kind !== "ok") throw new Error(corrected.kind);
    await admin.query(
      "UPDATE impuls.account_balances SET available_points=20 WHERE user_id=$1",
      [owner],
    );
    await admin.query(
      "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,1,'PRIVATE COSMETIC','PRIVATE TERMS',3,'cosmetic','synthetic',true,now()-interval '1 minute')",
      [rewardVersion, rewardId, scope],
    );
    await admin.query(
      "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour',1)",
      [quota, rewardId, scope],
    );
    const rewardInput = {
      actorId: owner,
      sessionHash: hashes[1]!,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowSyntheticRewards: true,
    };
    const reserved = await mutateRedemption(runtime, {
      ...rewardInput,
      action: "reserve",
      rewardVersionId: rewardVersion,
      quotaPeriodId: quota,
      expectedVersion: 1,
    });
    if (reserved.kind !== "ok") throw new Error(reserved.kind);
    const cancelled = await mutateRedemption(runtime, {
      ...rewardInput,
      idempotencyKey: randomUUID(),
      action: "cancel",
      redemptionId: reserved.response.redemption.id,
      expectedVersion: 1,
      reason: "PRIVATE CANCEL",
    });
    if (cancelled.kind !== "ok") throw new Error(cancelled.kind);
    // Reader follows saved source scope after current recipient membership is revoked.
    await admin.query(
      "UPDATE impuls.task_scope_members SET revoked_at=now() WHERE user_id=$1",
      [owner],
    );
    const businessSnapshot = async () =>
      (
        await admin.query(
          `SELECT
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM impuls.ledger_entries l WHERE user_id=$1) ledger,
      (SELECT to_jsonb(b) FROM impuls.account_balances b WHERE user_id=$1) balance,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM impuls.redemptions d WHERE user_id=$1) redemptions,
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM impuls.audit_events a WHERE actor_id=ANY($2::uuid[])) audit,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM impuls.notification_outbox o WHERE recipient_id=$1) outbox`,
          [owner, users],
        )
      ).rows;
    const before = await businessSnapshot();
    const result = await read();
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.response.counts).toEqual({ ...expected, unclaimed: 6 }); // 1 fixture + assignment/accept/correction/reserve/cancel
    expect(result.response.errors).toEqual(expectedErrors);
    expect(JSON.stringify(result.response)).not.toContain("PRIVATE");
    const history = await readEvents({ limit: 50 });
    if (history.kind !== "ok") throw new Error(history.kind);
    const projection = notificationEventsResponseSchema.parse(history.response);
    expect(projection.items).toHaveLength(15);
    expect(
      projection.items.filter((e) => e.kind === "reward.reserved"),
    ).toHaveLength(1);
    expect(
      projection.items.filter((e) => e.kind === "reward.cancelled"),
    ).toHaveLength(1);
    expect(
      projection.items.filter((e) => e.kind === "ledger.corrected"),
    ).toHaveLength(1);
    expect(
      projection.items.filter((e) => e.kind === "task.accepted"),
    ).toHaveLength(1);
    expect(JSON.stringify(projection)).not.toContain("PRIVATE");
    expect(await businessSnapshot()).toEqual(before);
  });
  afterAll(async () => {
    try {
      await admin.query(
        "DELETE FROM impuls.notification_simulations WHERE outbox_id IN(SELECT id FROM impuls.notification_outbox WHERE recipient_id=ANY($1::uuid[]))",
        [users],
      );
      for (const [table, column] of [
        ["user_achievements", "user_id"],
        ["audit_events", "actor_id"],
        ["notification_outbox", "recipient_id"],
        ["ledger_entries", "user_id"],
        ["ledger_corrections", "user_id"],
        ["redemptions", "user_id"],
        ["idempotency_records", "actor_id"],
        ["role_bindings", "user_id"],
        ["account_balances", "user_id"],
        ["sessions", "user_id"],
        ["task_scope_members", "user_id"],
      ])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE ${column}=ANY($1::uuid[])`,
          [users],
        );
      await admin.query(
        "DELETE FROM impuls.task_events WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.reviews WHERE submission_id IN(SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[]))",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.submissions WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.task_assignments WHERE task_id=ANY($1::uuid[])",
        [tasks],
      );
      await admin.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
        tasks,
      ]);
      await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rule]);
      await admin.query("DELETE FROM impuls.quota_periods WHERE id=$1", [
        quota,
      ]);
      await admin.query("DELETE FROM impuls.reward_versions WHERE id=$1", [
        rewardVersion,
      ]);
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
        [scopes],
      );
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await Promise.all([runtime.end(), admin.end()]);
    }
  });
});
