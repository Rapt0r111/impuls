import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { readParticipantProfile } from "../../packages/domain/src/profile/read";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  definitionFromSettings,
  publishRules,
  readRules,
  settingsFromDefinition,
} from "../../packages/domain/src/admin/rules";
import { acceptanceOptions } from "../../packages/domain/src/ledger/economy";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "F07 rules versions published from the app",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
      application_name: "rules-management-tests",
      max: 8,
    });
    const [owner, plain, revoked] = [randomUUID(), randomUUID(), randomUUID()];
    const tokens = [owner, plain, revoked].map(() =>
      randomBytes(32).toString("base64url"),
    );
    const hashes = tokens.map((t) => createHash("sha256").update(t).digest());
    const settings = {
      timeZone: "Europe/Moscow",
      acceptanceEnabled: true,
      minPercent: 60,
      bonuses: [{ code: "plus_15", title: "Бонус +15 %", percent: 15 }],
      levelThresholds: [0, 100, 300],
      openTaskLimit: null as number | null,
    };
    const input = (who: number, over: Record<string, unknown> = {}) => ({
      ...settings,
      actorId: [owner, plain, revoked][who]!,
      sessionHash: hashes[who]!,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      reason: "Пороги уровней и бонус для пилота",
      allowPublication: true,
      ...over,
    });
    const publicationsBefore = { rules: 0 };
    beforeAll(async () => {
      for (const u of [owner, plain, revoked]) {
        await admin.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic rules operator',true)",
          [u, randomInt(7e12, 8e12)],
        );
      }
      const scope = randomUUID();
      await admin.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic rules scope')",
        [scope],
      );
      for (const u of [owner, revoked])
        await admin.query(
          "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,'admin.rules',$1,'Synthetic fixture')",
          [u, scope],
        );
      // Granting rights revokes open sessions (trigger), so sessions are opened last.
      for (const [i, u] of [owner, plain, revoked].entries()) {
        await admin.query(
          "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [u, hashes[i]],
        );
      }
      publicationsBefore.rules = Number(
        (await admin.query("SELECT count(*) n FROM impuls.rule_sets")).rows[0]
          .n,
      );
    });
    afterAll(async () => {
      await runtime.end();
      await admin.end();
    });

    it("publishes a new version that profile and reviewer options read, without editing history", async () => {
      const before = await readRules(runtime, {
        actorId: owner,
        sessionHash: hashes[0]!,
        enabled: true,
      });
      expect(before.kind).toBe("ok");
      const result = await publishRules(runtime, input(0));
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      const read = await readRules(runtime, {
        actorId: owner,
        sessionHash: hashes[0]!,
        enabled: true,
      });
      if (read.kind !== "ok") throw new Error("read");
      expect(read.response.current).toMatchObject({
        versionNumber: result.response.versionNumber,
        ...settings,
        legacyOptions: false,
      });
      expect(read.response.history[0]).toMatchObject({
        versionNumber: result.response.versionNumber,
        publishedBy: "Synthetic rules operator",
        reason: "Пороги уровней и бонус для пилота",
      });
      // Independent expectation: 15 % of a 200 XP / 100 point fund is floor(30) / floor(15).
      const stored = (
        await admin.query(
          "SELECT definition FROM impuls.rule_sets WHERE version_number=$1",
          [result.response.versionNumber],
        )
      ).rows[0].definition;
      expect(acceptanceOptions(stored, { xp: 200, points: 100 })).toEqual({
        adjustment: { minXp: 120, minPoints: 60, maxXp: 200, maxPoints: 100 },
        bonuses: [
          { code: "plus_15", title: "Бонус +15 %", xp: 30, points: 15 },
        ],
      });
      expect(stored.progression.levelThresholds).toEqual([0, 100, 300]);
      expect(stored.timeZone).toBe("Europe/Moscow");
      const count = Number(
        (await admin.query("SELECT count(*) n FROM impuls.rule_sets")).rows[0]
          .n,
      );
      expect(count).toBeGreaterThan(publicationsBefore.rules);
    });

    it("replays the same key once and rejects the same key with another body", async () => {
      const key = randomUUID();
      const a = await publishRules(runtime, input(0, { idempotencyKey: key }));
      const b = await publishRules(
        runtime,
        input(0, { idempotencyKey: key, requestId: randomUUID() }),
      );
      expect(a.kind).toBe("ok");
      expect(b).toEqual(a);
      const c = await publishRules(
        runtime,
        input(0, { idempotencyKey: key, minPercent: 70 }),
      );
      expect(c.kind).toBe("idempotency_conflict");
    });

    it("serializes concurrent publications into consecutive version numbers", async () => {
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) =>
          publishRules(runtime, input(0, { minPercent: 50 + i })),
        ),
      );
      const numbers = results
        .map((r) => (r.kind === "ok" ? r.response.versionNumber : -1))
        .sort((x, y) => x - y);
      expect(numbers[0]).toBeGreaterThan(0);
      expect(numbers.map((n, i) => (i ? n - numbers[i - 1]! : 1))).toEqual([
        1, 1, 1, 1,
      ]);
    });

    it("denies without admin.rules, with a revoked session and with the flag off", async () => {
      expect((await publishRules(runtime, input(1))).kind).toBe("forbidden");
      expect(
        (
          await readRules(runtime, {
            actorId: plain,
            sessionHash: hashes[1]!,
            enabled: true,
          })
        ).kind,
      ).toBe("forbidden");
      expect(
        (await publishRules(runtime, input(0, { allowPublication: false })))
          .kind,
      ).toBe("disabled");
      await admin.query(
        "UPDATE impuls.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [revoked],
      );
      expect((await publishRules(runtime, input(2))).kind).toBe("unauthorized");
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        revoked,
      ]);
      expect((await publishRules(runtime, input(2))).kind).toBe("revoked");
    });

    it("rejects invalid thresholds, zones and duplicate bonus codes", async () => {
      for (const over of [
        { levelThresholds: [5, 10] },
        { levelThresholds: [0, 10, 10] },
        { timeZone: "Mars/Base" },
        { bonuses: [settings.bonuses[0], settings.bonuses[0]] },
      ])
        expect((await publishRules(runtime, input(0, over))).kind).toBe(
          "invalid",
        );
    });

    it("changes the profile levels without a migration, and unsets them honestly", async () => {
      await admin.query(
        "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,150,0) ON CONFLICT DO NOTHING",
        [plain],
      );
      const level = async () => {
        const profile = await readParticipantProfile(
          runtime,
          plain,
          hashes[1]!,
          {
            allowSyntheticProfile: true,
          },
        );
        if (profile.kind !== "ok") throw new Error(profile.kind);
        return profile.response.progression.level;
      };
      expect(
        (
          await publishRules(
            runtime,
            input(0, { levelThresholds: [0, 100, 300] }),
          )
        ).kind,
      ).toBe("ok");
      // 150 XP with thresholds 0/100/300 is level 2, 150 XP to go for level 3.
      expect(await level()).toMatchObject({
        level: 2,
        nextLevelXp: 300,
        remainingXp: 150,
      });
      expect(
        (await publishRules(runtime, input(0, { levelThresholds: null }))).kind,
      ).toBe("ok");
      expect(await level()).toBeNull();
      const state = await readParticipantProfile(runtime, plain, hashes[1]!, {
        allowSyntheticProfile: true,
      });
      if (state.kind !== "ok") throw new Error(state.kind);
      expect(state.response.progression.state).toBe("unconfigured");
    });

    it("keeps history immutable for the runtime role", async () => {
      await expect(
        runtime.query("UPDATE impuls.rule_sets SET definition='{}'::jsonb"),
      ).rejects.toThrow();
      await expect(
        runtime.query("DELETE FROM impuls.rule_sets"),
      ).rejects.toThrow();
      await expect(
        runtime.query("UPDATE impuls.rule_publications SET reason='x'"),
      ).rejects.toThrow();
      await expect(
        runtime.query("DELETE FROM impuls.rule_publications"),
      ).rejects.toThrow();
    });

    it("round-trips settings and keeps keys the form does not own", () => {
      const next = definitionFromSettings(
        {
          mode: "synthetic",
          custom: { keep: 1 },
          acceptance: {
            enabled: false,
            extra: true,
            adjustment: { maxXp: 5, maxPoints: 5 },
          },
        },
        { ...settings, levelThresholds: null },
      );
      expect(next).toMatchObject({
        custom: { keep: 1 },
        acceptance: { extra: true, enabled: true },
        progression: {},
      });
      expect((next.acceptance as Record<string, unknown>).adjustment).toEqual({
        minPercent: 60,
      });
      expect(settingsFromDefinition(next)).toMatchObject({
        ...settings,
        levelThresholds: null,
        legacyOptions: false,
      });
      // The free-task limit is stored only when set, and a new save without it clears it.
      const limited = definitionFromSettings(next, {
        ...settings,
        openTaskLimit: 3,
      });
      expect(limited.openTaskLimit).toBe(3);
      expect(settingsFromDefinition(limited).openTaskLimit).toBe(3);
      expect("openTaskLimit" in definitionFromSettings(limited, settings)).toBe(
        false,
      );
      expect(
        settingsFromDefinition({ mode: "synthetic", openTaskLimit: 0 })
          .openTaskLimit,
      ).toBeNull();
      expect(
        settingsFromDefinition({
          mode: "synthetic",
          acceptance: { enabled: true, adjustment: { maxXp: 5, maxPoints: 5 } },
        }).legacyOptions,
      ).toBe(true);
    });
  },
);
