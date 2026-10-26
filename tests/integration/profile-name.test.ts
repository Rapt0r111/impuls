import { dropDatabase } from "./drop-database";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCsrfToken } from "../../packages/domain/src/auth/session";
import { renameSelf } from "../../packages/domain/src/profile/name";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN;
const require = createRequire(import.meta.url);

(url ? describe : describe.skip)(
  "participant self-service display name",
  () => {
    const name = `impuls_profile_name_${randomUUID().replaceAll("-", "")}`;
    const parsed = new URL(url || "postgres://localhost/test");
    parsed.pathname = `/${name}`;
    const admin = new Pool({ connectionString: url }),
      db = new Pool({ connectionString: parsed.toString() });
    const app = new Pool({
      connectionString: parsed.toString(),
      options: "-c role=impuls_app",
      max: 6,
    });
    let created = false,
      chat = 66666660000;

    async function migrate(file: string) {
      const statements: string[] = [];
      require(path.resolve("db/migrations", file)).up({
        sql: (s: string) => statements.push(s),
      });
      for (const s of statements)
        await db.query(
          file.startsWith("000003")
            ? s.replace(/CREATE ROLE impuls_app[\s\S]*?;/, "")
            : s,
        );
    }
    async function member(display: string, active = true) {
      const id = randomUUID(),
        token = createHash("sha256").update(id).digest();
      await db.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,$4)",
        [id, String(++chat), display, active],
      );
      await db.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [id, token],
      );
      return { id, token };
    }
    const rename = (
      who: { id: string; token: Buffer },
      displayName: string,
      allowSyntheticProfile = true,
    ) =>
      renameSelf(app, {
        actorId: who.id,
        sessionHash: who.token,
        displayName,
        requestId: randomUUID(),
        allowSyntheticProfile,
      });
    const current = async (id: string) =>
      (
        await db.query(
          "SELECT display_name,version FROM impuls.users WHERE id=$1",
          [id],
        )
      ).rows[0];
    const history = async (id: string) =>
      (
        await db.query(
          "SELECT previous_name,new_name FROM impuls.profile_name_changes WHERE user_id=$1 ORDER BY created_at,id",
          [id],
        )
      ).rows;

    beforeAll(async () => {
      if (!/^impuls_profile_name_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid disposable DB name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await db.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
      );
      for (const f of (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".js"))
        .sort())
        await migrate(f);
    }, 30000);
    afterAll(async () => {
      await Promise.all([app.end(), db.end()]);
      try {
        if (created) await dropDatabase(admin, name);
      } finally {
        await admin.end();
      }
    });

    it("changes the caller's own name, bumps the version and keeps the old name in history", async () => {
      const me = await member("Первоначальное имя");
      const other = await member("Другой участник");
      expect(await rename(me, "Анна Петрова")).toEqual({
        kind: "ok",
        changed: true,
        displayName: "Анна Петрова",
      });
      expect(await current(me.id)).toEqual({
        display_name: "Анна Петрова",
        version: 2,
      });
      expect(await history(me.id)).toEqual([
        { previous_name: "Первоначальное имя", new_name: "Анна Петрова" },
      ]);
      expect((await current(other.id)).display_name).toBe("Другой участник");
    });

    it("treats a repeat of the same name as no change without a history row", async () => {
      const me = await member("Повтор");
      await rename(me, "Новое имя");
      expect(await rename(me, "Новое имя")).toMatchObject({
        kind: "ok",
        changed: false,
      });
      expect(await history(me.id)).toHaveLength(1);
      expect((await current(me.id)).version).toBe(2);
    });

    it("rejects a name used by another active user, ignoring case, but allows an inactive user's", async () => {
      const holder = await member("Занятое Имя");
      await member("Бывший участник", false);
      const me = await member("Свободный");
      expect(await rename(me, "занятое имя")).toEqual({ kind: "taken" });
      expect((await current(me.id)).display_name).toBe("Свободный");
      expect(await history(me.id)).toEqual([]);
      expect(await rename(me, "Бывший участник")).toMatchObject({ kind: "ok" });
      // A case-only change of one's own name is allowed.
      expect(await rename(holder, "ЗАНЯТОЕ ИМЯ")).toMatchObject({
        kind: "ok",
        changed: true,
      });
    });

    it("lets exactly one of two concurrent renames to the same name win", async () => {
      const a = await member("Гонка один"),
        b = await member("Гонка два");
      const results = await Promise.all([
        rename(a, "Общее имя"),
        rename(b, "общее ИМЯ"),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["ok", "taken"]);
      const holders = (
        await db.query(
          "SELECT count(*)::int n FROM impuls.users WHERE active AND lower(display_name COLLATE pg_c_utf8)='общее имя'",
        )
      ).rows[0].n;
      expect(holders).toBe(1);
    });

    it("refuses revoked users, dead sessions and a disabled profile without writing", async () => {
      const gone = await member("Отозван");
      await db.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        gone.id,
      ]);
      expect(await rename(gone, "Попытка")).toEqual({ kind: "revoked" });

      const me = await member("Сессия");
      const foreign = createHash("sha256").update("x").digest();
      expect(await rename({ id: me.id, token: foreign }, "Чужая")).toEqual({
        kind: "unauthorized",
      });
      await db.query(
        "UPDATE impuls.sessions SET revoked_at=now() WHERE user_id=$1",
        [me.id],
      );
      expect(await rename(me, "Отозванная сессия")).toEqual({
        kind: "unauthorized",
      });

      const off = await member("Выключено");
      expect(await rename(off, "Новое", false)).toEqual({ kind: "disabled" });
      for (const id of [gone.id, me.id, off.id])
        expect(await history(id)).toEqual([]);
      expect((await current(off.id)).display_name).toBe("Выключено");
    });

    it("keeps the history immutable and unreadable by the application role", async () => {
      const me = await member("История");
      await rename(me, "История два");
      await expect(
        db.query("UPDATE impuls.profile_name_changes SET new_name='Подмена'"),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.query("DELETE FROM impuls.profile_name_changes"),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        app.query("SELECT * FROM impuls.profile_name_changes"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("bounds the stored name at the database", async () => {
      const me = await member("Граница");
      for (const bad of ["x", "x".repeat(41)])
        await expect(
          app.query("SELECT impuls.rename_self($1,$2,$3)", [
            me.id,
            bad,
            randomUUID(),
          ]),
        ).rejects.toMatchObject({ code: "23514" });
    });
  },
);

// Against the running application (task-slice runner): guards, validation and the real route.
(url && origin ? describe : describe.skip)("PATCH /api/v1/me/profile", () => {
  const main = new Pool({ connectionString: url });
  const suffix = randomBytes(4).toString("hex");
  const token = randomBytes(32).toString("base64url");
  const other = randomBytes(32).toString("base64url");
  const ids = [randomUUID(), randomUUID()];
  const call = (
    payload: unknown,
    over: Record<string, string | undefined> = {},
    who = token,
  ) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Origin: origin!,
      Cookie: "impuls_session=" + who,
      "X-CSRF-Token": createCsrfToken(who, process.env.CSRF_SECRET!),
      "Idempotency-Key": randomUUID(),
    };
    for (const [k, v] of Object.entries(over))
      if (v === undefined) delete headers[k];
      else headers[k] = v;
    return fetch(origin + "/api/v1/me/profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    });
  };
  const nameOf = async (id: string) =>
    (
      await main.query("SELECT display_name FROM impuls.users WHERE id=$1", [
        id,
      ])
    ).rows[0].display_name;

  beforeAll(async () => {
    for (const [i, t] of [token, other].entries()) {
      await main.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
        [
          ids[i],
          String(55555550000 + Math.floor(Math.random() * 9e6)),
          `Start${i}${suffix}`,
        ],
      );
      await main.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [ids[i], createHash("sha256").update(t).digest()],
      );
    }
  });
  afterAll(() => main.end());

  it("refuses unguarded or malformed requests without changing the name", async () => {
    const start = await nameOf(ids[0]!);
    const body = { displayName: `Valid${suffix}` };
    const refused: [string, Response, number][] = [
      [
        "foreign origin",
        await call(body, { Origin: "https://foreign.invalid" }),
        403,
      ],
      ["bad csrf", await call(body, { "X-CSRF-Token": "invalid" }), 403],
      ["no key", await call(body, { "Idempotency-Key": undefined }), 400],
      ["no cookie", await call(body, { Cookie: undefined }), 401],
      ["extra field", await call({ ...body, active: false }), 400],
      ["too short", await call({ displayName: "a" }), 400],
      ["too long", await call({ displayName: "a".repeat(41) }), 400],
      ["control char", await call({ displayName: "ab\u0000cd" }), 400],
      ["bidi override", await call({ displayName: "ab\u202Ecd" }), 400],
      ["zero width", await call({ displayName: "ab\u200Bcd" }), 400],
      ["emoji", await call({ displayName: "ab\u{1F600}" }), 400],
      ["markup", await call({ displayName: "<b>bold</b>" }), 400],
      ["not a string", await call({ displayName: 42 }), 400],
    ];
    for (const [name, response, status] of refused)
      expect(response.status, name).toBe(status);
    expect(await nameOf(ids[0]!)).toBe(start);
  });

  it("renames the caller, reports repeats and name clashes", async () => {
    const wanted = `Anna ${suffix}`;
    const done = await call({
      displayName: `  ${wanted.replace(" ", "   ")} `,
    });
    expect(done.status).toBe(200);
    expect(done.headers.get("cache-control")).toContain("no-store");
    expect(await done.json()).toEqual({
      user: { id: ids[0], displayName: wanted },
      changed: true,
    });
    expect(await nameOf(ids[0]!)).toBe(wanted);
    const again = await call({ displayName: wanted });
    expect(again.status).toBe(200);
    expect((await again.json()).changed).toBe(false);
    const clash = await call({ displayName: wanted.toUpperCase() }, {}, other);
    expect(clash.status).toBe(409);
    expect((await clash.json()).code).toBe("NAME_TAKEN");
    expect(await nameOf(ids[1]!)).toBe(`Start1${suffix}`);
  });

  it("stops a revoked user", async () => {
    await main.query("UPDATE impuls.users SET active=false WHERE id=$1", [
      ids[1],
    ]);
    const response = await call({ displayName: `Late${suffix}` }, {}, other);
    expect([401, 403]).toContain(response.status);
    expect(await nameOf(ids[1]!)).toBe(`Start1${suffix}`);
  });
});
