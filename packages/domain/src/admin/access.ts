import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Common = {
  actorId: string;
  sessionHash: Buffer;
  scope: string;
  reason: string;
  idempotencyKey: string;
  requestId: string;
  allowAccessManagement: boolean;
};
export type AccessChangeInput =
  | (Common & {
      kind: "grant";
      subjectId: string;
      action: string;
      validUntil: string | null;
    })
  | (Common & { kind: "revoke"; bindingId: string; expectedVersion: number });
export type AccessChangeResponse = {
  mode: "synthetic";
  kind: "grant" | "revoke";
  scope: string;
  changeId: string;
  binding: {
    id: string;
    subjectId: string;
    action: string;
    validUntil: string | null;
    version: number;
  };
  updatedAt: string;
};
type Result =
  | { kind: "ok"; response: AccessChangeResponse }
  | {
      kind:
        | "revoked"
        | "unauthorized"
        | "disabled"
        | "not_found"
        | "idempotency_conflict"
        | "conflict"
        | "invalid_term"
        | "forbidden_target";
    };

const protectedActions = [
  "admin.access",
  "admin.access.manage",
  "admin.members.manage",
];
const iso = `to_char($X AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const stamp = (column: string) => iso.replace("$X", column);

// Exact scope; every listed right is required, matching the project's split between
// reading and changing. Shared with member management.
export async function checkAuthority(
  client: PoolClient,
  input: { actorId: string; sessionHash: Buffer; scope: string },
  rights: readonly string[],
  lock: boolean,
): Promise<"ok" | "revoked" | "unauthorized" | "not_found"> {
  const user = (
    await client.query<{ active: boolean }>(
      `SELECT active FROM impuls.users WHERE id=$1${lock ? " FOR SHARE" : ""}`,
      [input.actorId],
    )
  ).rows[0];
  if (!user?.active) return "revoked";
  const held = (
    await client.query<{ action: string }>(
      `SELECT action FROM impuls.role_bindings
       WHERE user_id=$1 AND scope_id=$2 AND action=ANY($3::text[])
         AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())
       ORDER BY id${lock ? " FOR SHARE" : ""}`,
      [input.actorId, input.scope, rights],
    )
  ).rows;
  if (!rights.every((right) => held.some((p) => p.action === right)))
    return "not_found";
  const session = await client.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
     AND revoked_at IS NULL AND expires_at>clock_timestamp()${lock ? " FOR SHARE" : ""}`,
    [input.actorId, input.sessionHash],
  );
  return session.rowCount === 1 ? "ok" : "unauthorized";
}
const accessRights = ["admin.access", "admin.access.manage"] as const;
const authority = (client: PoolClient, input: Common, lock: boolean) =>
  checkAuthority(client, input, accessRights, lock);

export async function changeAccess(
  pool: Pool,
  input: AccessChangeInput,
): Promise<Result> {
  const client = await pool.connect();
  const reject = async (result: Result) => {
    await client.query("ROLLBACK");
    return result;
  };
  const operation = input.kind === "grant" ? "access.grant" : "access.revoke";
  try {
    await client.query("BEGIN");
    const access = await authority(client, input, true);
    if (access !== "ok") return await reject({ kind: access });
    if (!input.allowAccessManagement) return await reject({ kind: "disabled" });
    const hash = createHash("sha256")
      .update(
        JSON.stringify(
          input.kind === "grant"
            ? [
                operation,
                input.scope,
                input.subjectId,
                input.action,
                input.validUntil,
                input.reason,
              ]
            : [
                operation,
                input.scope,
                input.bindingId,
                input.expectedVersion,
                input.reason,
              ],
        ),
      )
      .digest();
    await client.query(
      `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash)
       VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,operation,key) DO NOTHING`,
      [input.actorId, operation, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: AccessChangeResponse | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records
         WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE`,
        [input.actorId, operation, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    // Serialise all access changes of one scope, then re-check authority.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('access:'||$1::text,0))",
      [input.scope],
    );
    const afterWait = await authority(client, input, false);
    if (afterWait !== "ok") return await reject({ kind: afterWait });
    if (saved.response_body) {
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    let binding: {
      id: string;
      subjectId: string;
      action: string;
      validUntil: string | null;
      version: number;
    };
    if (input.kind === "grant") {
      if (
        input.subjectId === input.actorId ||
        protectedActions.includes(input.action)
      )
        return await reject({ kind: "forbidden_target" });
      if (
        input.validUntil &&
        (
          await client.query<{ past: boolean }>(
            "SELECT $1::timestamptz<=clock_timestamp() past",
            [input.validUntil],
          )
        ).rows[0]!.past
      )
        return await reject({ kind: "invalid_term" });
      const member = await client.query(
        `SELECT 1 FROM impuls.task_scope_members m JOIN impuls.users u ON u.id=m.user_id
         WHERE m.scope_id=$1 AND m.user_id=$2 AND m.synthetic AND u.active AND m.revoked_at IS NULL
           AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) FOR SHARE OF m, u`,
        [input.scope, input.subjectId],
      );
      if (member.rowCount !== 1) return await reject({ kind: "not_found" });
      const duplicate = await client.query(
        `SELECT 1 FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2 AND action=$3
         AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until>clock_timestamp())`,
        [input.subjectId, input.scope, input.action],
      );
      if (duplicate.rowCount) return await reject({ kind: "conflict" });
      const row = (
        await client.query<typeof binding>(
          `INSERT INTO impuls.role_bindings(user_id,action,scope_id,valid_until,granted_by,reason)
           VALUES($1,$2,$3,$4,$5,$6)
           RETURNING id,user_id AS "subjectId",action,version,${stamp("valid_until")} AS "validUntil"`,
          [
            input.subjectId,
            input.action,
            input.scope,
            input.validUntil,
            input.actorId,
            input.reason,
          ],
        )
      ).rows[0]!;
      binding = row;
    } else {
      const target = (
        await client.query<
          typeof binding & { revoked: boolean; expired: boolean }
        >(
          `SELECT id,user_id AS "subjectId",action,version,${stamp("valid_until")} AS "validUntil",
             revoked_at IS NOT NULL revoked,(valid_until IS NOT NULL AND valid_until<=clock_timestamp()) expired
           FROM impuls.role_bindings WHERE id=$1 AND scope_id=$2 FOR UPDATE`,
          [input.bindingId, input.scope],
        )
      ).rows[0];
      if (!target) return await reject({ kind: "not_found" });
      if (
        target.subjectId === input.actorId ||
        protectedActions.includes(target.action)
      )
        return await reject({ kind: "forbidden_target" });
      if (
        target.revoked ||
        target.expired ||
        target.version !== input.expectedVersion
      )
        return await reject({ kind: "conflict" });
      const row = (
        await client.query<typeof binding>(
          `UPDATE impuls.role_bindings SET revoked_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
           WHERE id=$1 RETURNING id,user_id AS "subjectId",action,version,${stamp("valid_until")} AS "validUntil"`,
          [input.bindingId],
        )
      ).rows[0]!;
      binding = row;
    }
    const change = (
      await client.query<{ id: string; at: string }>(
        `INSERT INTO impuls.access_changes(kind,binding_id,actor_id,subject_id,scope_id,action,valid_until,request_id,reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,${stamp("created_at")} at`,
        [
          input.kind,
          binding.id,
          input.actorId,
          binding.subjectId,
          input.scope,
          binding.action,
          binding.validUntil,
          input.requestId,
          input.reason,
        ],
      )
    ).rows[0]!;
    const response: AccessChangeResponse = {
      mode: "synthetic",
      kind: input.kind,
      scope: input.scope,
      changeId: change.id,
      binding,
      updatedAt: change.at,
    };
    const beforeCommit = await authority(client, input, false);
    if (beforeCommit !== "ok") return await reject({ kind: beforeCommit });
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=201,response_body=$4::jsonb
       WHERE actor_id=$1 AND operation=$2 AND key=$3`,
      [
        input.actorId,
        operation,
        input.idempotencyKey,
        JSON.stringify(response),
      ],
    );
    await client.query("COMMIT");
    return { kind: "ok", response };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type ListResult =
  | { kind: "ok"; response: AccessListResponseShape }
  | { kind: "revoked" | "unauthorized" | "disabled" | "not_found" };
type AccessListResponseShape = {
  mode: "synthetic";
  scope: string;
  canManage: boolean;
  canManageMembers: boolean;
  members: {
    userId: string;
    membershipId: string;
    membershipVersion: number;
    displayName: string;
    isSelf: boolean;
    bindings: {
      id: string;
      action: string;
      validUntil: string | null;
      version: number;
    }[];
  }[];
};

// Read needs only admin.access; canManage reports the write right and flag.
export async function readAccess(
  pool: Pool,
  input: {
    actorId: string;
    sessionHash: Buffer;
    scope: string;
    enabled: boolean;
    allowAccessManagement: boolean;
    allowMemberManagement: boolean;
  },
): Promise<ListResult> {
  const user = (
    await pool.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id=$1",
      [input.actorId],
    )
  ).rows[0];
  if (!user?.active) return { kind: "revoked" };
  const held = (
    await pool.query<{ action: string }>(
      `SELECT action FROM impuls.role_bindings
       WHERE user_id=$1 AND scope_id=$2 AND action IN ('admin.access','admin.access.manage','admin.members.manage')
         AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())`,
      [input.actorId, input.scope],
    )
  ).rows;
  if (!held.some((p) => p.action === "admin.access"))
    return { kind: "not_found" };
  const session = await pool.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
     AND revoked_at IS NULL AND expires_at>clock_timestamp()`,
    [input.actorId, input.sessionHash],
  );
  if (session.rowCount !== 1) return { kind: "unauthorized" };
  if (!input.enabled) return { kind: "disabled" };
  const rows = (
    await pool.query<{
      userId: string;
      membershipId: string;
      membershipVersion: number;
      displayName: string;
      bindings: AccessListResponseShape["members"][number]["bindings"];
    }>(
      `SELECT u.id "userId",m.id "membershipId",m.version "membershipVersion",u.display_name "displayName",
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'action',b.action,'version',b.version,
           'validUntil',CASE WHEN b.valid_until IS NULL THEN NULL ELSE to_char(b.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ORDER BY b.action)
           FROM impuls.role_bindings b WHERE b.user_id=u.id AND b.scope_id=m.scope_id AND b.revoked_at IS NULL
             AND b.valid_from<=clock_timestamp() AND (b.valid_until IS NULL OR b.valid_until>clock_timestamp())
             AND b.action NOT IN ('admin.access','admin.access.manage','admin.members.manage')),'[]'::jsonb) bindings
       FROM impuls.task_scope_members m JOIN impuls.users u ON u.id=m.user_id
       WHERE m.scope_id=$1 AND m.synthetic AND u.active AND m.revoked_at IS NULL
         AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
       ORDER BY u.display_name,u.id LIMIT 200`,
      [input.scope],
    )
  ).rows;
  return {
    kind: "ok",
    response: {
      mode: "synthetic",
      scope: input.scope,
      canManage:
        input.allowAccessManagement &&
        held.some((p) => p.action === "admin.access.manage"),
      canManageMembers:
        input.allowMemberManagement &&
        held.some((p) => p.action === "admin.members.manage"),
      members: rows.map((r) => ({ ...r, isSelf: r.userId === input.actorId })),
    },
  };
}
