import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  LEVEL_NAME_MAX,
  syntheticLevelNames,
  syntheticLevelThresholds,
} from "../profile/progression";

export type RuleSettings = {
  timeZone: string;
  acceptanceEnabled: boolean;
  minPercent: number | null;
  bonuses: { code: string; title: string; percent: number }[];
  levelThresholds: number[] | null;
  levelNames: string[];
  openTaskLimit: number | null;
};
export type CurrentRules = RuleSettings & {
  versionNumber: number;
  effectiveFrom: string;
  legacyOptions: boolean;
};
export type RulesRead = {
  current: CurrentRules | null;
  history: {
    versionNumber: number;
    effectiveFrom: string;
    publishedBy: string | null;
    reason: string | null;
  }[];
};
export type RulesPublishInput = RuleSettings & {
  actorId: string;
  sessionHash: Buffer;
  idempotencyKey: string;
  requestId: string;
  reason: string;
  allowPublication: boolean;
};
export type RulesPublished = {
  versionNumber: number;
  publicationId: string;
  publishedAt: string;
};
type Denied = "revoked" | "unauthorized" | "forbidden" | "disabled";

// Owner decision P-04 (10.10.2026): rules are counted in Europe/Moscow.
const DEFAULT_ZONE = "Europe/Moscow";
const isPercent = (value: unknown, min: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= 100;
const isZone = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const openTaskLimitFrom = (rule: Record<string, unknown>) =>
  typeof rule.openTaskLimit === "number" &&
  Number.isInteger(rule.openTaskLimit) &&
  rule.openTaskLimit >= 1 &&
  rule.openTaskLimit <= 50
    ? rule.openTaskLimit
    : null;

// What the form can show from a saved definition. Anything the form cannot express
// (absolute amounts from ADR-0030, malformed entries) is flagged, not guessed.
export function settingsFromDefinition(
  definition: unknown,
): RuleSettings & { legacyOptions: boolean } {
  const rule = record(definition) ?? {};
  const acceptance = record(rule.acceptance) ?? {};
  const adjustment = record(acceptance.adjustment);
  let legacyOptions = false;
  let minPercent: number | null = null;
  if (adjustment) {
    if (
      isPercent(adjustment.minPercent, 0) &&
      !("maxXp" in adjustment) &&
      !("maxPoints" in adjustment)
    )
      minPercent = adjustment.minPercent;
    else legacyOptions = true;
  }
  const bonuses: RuleSettings["bonuses"] = [];
  if (acceptance.bonuses !== undefined) {
    if (Array.isArray(acceptance.bonuses)) {
      for (const item of acceptance.bonuses) {
        const entry = record(item);
        if (
          entry &&
          typeof entry.code === "string" &&
          /^[a-z][a-z0-9_]{1,39}$/.test(entry.code) &&
          typeof entry.title === "string" &&
          entry.title.length >= 1 &&
          entry.title.length <= 80 &&
          isPercent(entry.percent, 1) &&
          !("xp" in entry) &&
          !("points" in entry)
        )
          bonuses.push({
            code: entry.code,
            title: entry.title,
            percent: entry.percent,
          });
        else legacyOptions = true;
      }
    } else legacyOptions = true;
  }
  return {
    timeZone: isZone(rule.timeZone) ? rule.timeZone : DEFAULT_ZONE,
    acceptanceEnabled: acceptance.enabled === true,
    minPercent,
    bonuses,
    levelThresholds: syntheticLevelThresholds(rule),
    levelNames: syntheticLevelNames(rule),
    openTaskLimit: openTaskLimitFrom(rule),
    legacyOptions,
  };
}

// The new definition keeps every key the form does not own, so a rules version published
// here never drops fields written by a migration.
export function definitionFromSettings(
  previous: unknown,
  settings: RuleSettings,
): Record<string, unknown> {
  const base = { ...(record(previous) ?? {}) };
  const acceptance = { ...(record(base.acceptance) ?? {}) };
  delete acceptance.adjustment;
  delete acceptance.bonuses;
  delete base.openTaskLimit;
  acceptance.enabled = settings.acceptanceEnabled;
  if (settings.minPercent !== null)
    acceptance.adjustment = { minPercent: settings.minPercent };
  if (settings.bonuses.length)
    acceptance.bonuses = settings.bonuses.map((b) => ({
      code: b.code,
      title: b.title,
      percent: b.percent,
    }));
  return {
    ...base,
    mode: "synthetic",
    timeZone: settings.timeZone,
    ...(settings.openTaskLimit !== null
      ? { openTaskLimit: settings.openTaskLimit }
      : {}),
    acceptance,
    // An empty progression keeps "levels are not configured" explicit: without it the
    // profile would fall back to the thresholds of an older version.
    progression: settings.levelThresholds
      ? {
          levelThresholds: settings.levelThresholds,
          ...(settings.levelNames?.length
            ? { levelNames: settings.levelNames }
            : {}),
        }
      : {},
  };
}

async function authority(
  client: PoolClient,
  actorId: string,
  sessionHash: Buffer,
  lock: boolean,
): Promise<"ok" | Denied> {
  const share = lock ? " FOR SHARE" : "";
  const user = (
    await client.query<{ active: boolean }>(
      `SELECT active FROM impuls.users WHERE id=$1${share}`,
      [actorId],
    )
  ).rows[0];
  if (!user?.active) return "revoked";
  const session = await client.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
     AND revoked_at IS NULL AND expires_at>clock_timestamp()${share}`,
    [actorId, sessionHash],
  );
  if (session.rowCount !== 1) return "unauthorized";
  const binding = await client.query(
    `SELECT 1 FROM impuls.role_bindings WHERE user_id=$1 AND action='admin.rules'
     AND revoked_at IS NULL AND valid_from<=clock_timestamp()
     AND (valid_until IS NULL OR valid_until>clock_timestamp())
     ORDER BY id LIMIT 1${share}`,
    [actorId],
  );
  return binding.rowCount === 1 ? "ok" : "forbidden";
}

type RuleRow = {
  version_number: number;
  definition: unknown;
  effective_from: Date;
};
const LATEST = `SELECT version_number, definition, effective_from FROM impuls.rule_sets
  WHERE definition->>'mode'='synthetic' AND effective_from<=clock_timestamp()
  ORDER BY version_number DESC LIMIT 1`;

export async function readRules(
  pool: Pool,
  input: {
    actorId: string;
    sessionHash: Buffer;
    enabled: boolean;
  },
): Promise<{ kind: "ok"; response: RulesRead } | { kind: Denied }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const access = await authority(
      client,
      input.actorId,
      input.sessionHash,
      false,
    );
    if (access !== "ok") {
      await client.query("ROLLBACK");
      return { kind: access };
    }
    if (!input.enabled) {
      await client.query("ROLLBACK");
      return { kind: "disabled" };
    }
    const latest = (await client.query<RuleRow>(LATEST)).rows[0];
    const history = (
      await client.query<{
        version_number: number;
        effective_from: Date;
        display_name: string | null;
        reason: string | null;
      }>(
        `SELECT r.version_number, r.effective_from, u.display_name, p.reason
         FROM impuls.rule_sets r
         JOIN impuls.users u ON u.id=r.created_by
         LEFT JOIN impuls.rule_publications p ON p.rule_set_id=r.id
         WHERE r.definition->>'mode'='synthetic'
         ORDER BY r.version_number DESC LIMIT 20`,
      )
    ).rows;
    await client.query("COMMIT");
    return {
      kind: "ok",
      response: {
        current: latest
          ? {
              versionNumber: latest.version_number,
              effectiveFrom: latest.effective_from.toISOString(),
              ...settingsFromDefinition(latest.definition),
            }
          : null,
        history: history.map((row) => ({
          versionNumber: row.version_number,
          effectiveFrom: row.effective_from.toISOString(),
          publishedBy: row.display_name,
          reason: row.reason,
        })),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function publishRules(
  pool: Pool,
  input: RulesPublishInput,
): Promise<
  | { kind: "ok"; response: RulesPublished }
  | { kind: Denied | "idempotency_conflict" | "invalid" }
> {
  const client = await pool.connect();
  const reject = async <T>(result: T) => {
    await client.query("ROLLBACK");
    return result;
  };
  try {
    await client.query("BEGIN");
    const access = await authority(
      client,
      input.actorId,
      input.sessionHash,
      true,
    );
    if (access !== "ok") return await reject({ kind: access });
    if (!input.allowPublication) return await reject({ kind: "disabled" });
    const settings: RuleSettings = {
      timeZone: input.timeZone,
      acceptanceEnabled: input.acceptanceEnabled,
      minPercent: input.minPercent,
      bonuses: input.bonuses,
      levelThresholds: input.levelThresholds,
      levelNames: input.levelNames ?? [],
      openTaskLimit: input.openTaskLimit ?? null,
    };
    if (
      !isZone(settings.timeZone) ||
      (settings.levelThresholds &&
        !syntheticLevelThresholds({
          mode: "synthetic",
          progression: { levelThresholds: settings.levelThresholds },
        })) ||
      settings.levelNames.length > (settings.levelThresholds?.length ?? 0) ||
      settings.levelNames.some((name) => name.length > LEVEL_NAME_MAX) ||
      new Set(settings.bonuses.map((b) => b.code)).size !==
        settings.bonuses.length
    )
      return await reject({ kind: "invalid" });
    const hash = createHash("sha256")
      .update(JSON.stringify({ ...settings, reason: input.reason }))
      .digest();
    await client.query(
      `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash)
       VALUES($1,'rules.publish',$2,$3) ON CONFLICT(actor_id,operation,key) DO NOTHING`,
      [input.actorId, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: RulesPublished | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records
         WHERE actor_id=$1 AND operation='rules.publish' AND key=$2 FOR UPDATE`,
        [input.actorId, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    // One publisher at a time: version numbers are assigned under this lock.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('impuls.rules.publish',0))",
    );
    const afterWait = await authority(
      client,
      input.actorId,
      input.sessionHash,
      false,
    );
    if (afterWait !== "ok") return await reject({ kind: afterWait });
    if (saved.response_body) {
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    const previous = (await client.query<RuleRow>(LATEST)).rows[0];
    const definition = definitionFromSettings(previous?.definition, settings);
    const rule = (
      await client.query<{ id: string; version_number: number }>(
        `INSERT INTO impuls.rule_sets(version_number, definition, effective_from, created_by)
         VALUES((SELECT coalesce(max(version_number),0)+1 FROM impuls.rule_sets),
           $1::jsonb, clock_timestamp(), $2)
         RETURNING id, version_number`,
        [JSON.stringify(definition), input.actorId],
      )
    ).rows[0]!;
    const publication = (
      await client.query<{ id: string; at: Date }>(
        `INSERT INTO impuls.rule_publications(rule_set_id, actor_id, request_id, reason)
         VALUES($1,$2,$3,$4) RETURNING id, created_at AS at`,
        [rule.id, input.actorId, input.requestId, input.reason],
      )
    ).rows[0]!;
    const response: RulesPublished = {
      versionNumber: rule.version_number,
      publicationId: publication.id,
      publishedAt: publication.at.toISOString(),
    };
    const beforeCommit = await authority(
      client,
      input.actorId,
      input.sessionHash,
      false,
    );
    if (beforeCommit !== "ok") return await reject({ kind: beforeCommit });
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=201,response_body=$3::jsonb
       WHERE actor_id=$1 AND operation='rules.publish' AND key=$2`,
      [input.actorId, input.idempotencyKey, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return { kind: "ok", response };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
