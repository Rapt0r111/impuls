import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { checkAuthority } from "./access";

type Common = {
  actorId: string;
  sessionHash: Buffer;
  scope: string;
  reason: string;
  idempotencyKey: string;
  requestId: string;
  allowMemberManagement: boolean;
};
export type MemberChangeInput =
  | (Common & {
      kind: "admit";
      telegramId: number;
      displayName: string;
      validUntil: string | null;
    })
  | (Common & {
      kind: "remove";
      membershipId: string;
      expectedVersion: number;
    });
type Member = {
  membershipId: string;
  userId: string;
  displayName: string;
  version: number;
  validUntil: string | null;
};
export type MemberChangeResponse = {
  scope: string;
  changeId: string;
  member: Member;
  updatedAt: string;
} & (
  | { kind: "admit"; userCreated: boolean; userReactivated: boolean }
  | { kind: "remove"; revokedBindings: number; userDeactivated: boolean }
);
export type MemberChangeResult =
  | { kind: "ok"; response: MemberChangeResponse }
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

const rights = ["admin.access", "admin.members.manage"] as const;
// SQLSTATEs raised by impuls.admit_member / impuls.remove_member (migration 000033).
const outcomes: Record<
  string,
  "not_found" | "forbidden_target" | "conflict" | "invalid_term"
> = {
  IM001: "not_found",
  IM002: "forbidden_target",
  IM003: "conflict",
  IM004: "invalid_term",
  IM005: "not_found",
};
const iso = (value: Date | null) => (value ? value.toISOString() : null);

// One transaction: authority, idempotency, per-scope serialisation, then the definer
// function writes user, membership, role bindings and the immutable change together.
export async function changeMember(
  pool: Pool,
  input: MemberChangeInput,
): Promise<MemberChangeResult> {
  const client = await pool.connect();
  const reject = async (result: MemberChangeResult) => {
    await client.query("ROLLBACK");
    return result;
  };
  const operation = input.kind === "admit" ? "member.admit" : "member.remove";
  try {
    await client.query("BEGIN");
    const access = await checkAuthority(client, input, rights, true);
    if (access !== "ok") return await reject({ kind: access });
    if (!input.allowMemberManagement) return await reject({ kind: "disabled" });
    const hash = createHash("sha256")
      .update(
        JSON.stringify(
          input.kind === "admit"
            ? [
                operation,
                input.scope,
                input.telegramId,
                input.displayName,
                input.validUntil,
                input.reason,
              ]
            : [
                operation,
                input.scope,
                input.membershipId,
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
        response_body: MemberChangeResponse | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records
         WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE`,
        [input.actorId, operation, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    // Same lock key as the definer functions: changes of one scope never interleave.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('members:'||$1::text,0))",
      [input.scope],
    );
    const afterWait = await checkAuthority(client, input, rights, false);
    if (afterWait !== "ok") return await reject({ kind: afterWait });
    if (saved.response_body) {
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    let response: MemberChangeResponse;
    try {
      // A failed statement aborts the transaction; the caller maps the SQLSTATE below.
      if (input.kind === "admit") {
        const row = (
          await client.query<{
            change_id: string;
            membership_id: string;
            user_id: string;
            display_name: string;
            membership_version: number;
            valid_until: Date | null;
            user_created: boolean;
            user_reactivated: boolean;
            changed_at: Date;
          }>("SELECT * FROM impuls.admit_member($1,$2,$3,$4,$5,$6,$7)", [
            input.actorId,
            input.scope,
            input.telegramId,
            input.displayName,
            input.validUntil,
            input.requestId,
            input.reason,
          ])
        ).rows[0]!;
        response = {
          kind: "admit",
          scope: input.scope,
          changeId: row.change_id,
          member: {
            membershipId: row.membership_id,
            userId: row.user_id,
            displayName: row.display_name,
            version: row.membership_version,
            validUntil: iso(row.valid_until),
          },
          userCreated: row.user_created,
          userReactivated: row.user_reactivated,
          updatedAt: row.changed_at.toISOString(),
        };
      } else {
        const row = (
          await client.query<{
            change_id: string;
            membership_id: string;
            user_id: string;
            display_name: string;
            membership_version: number;
            revoked_bindings: number;
            user_deactivated: boolean;
            changed_at: Date;
          }>("SELECT * FROM impuls.remove_member($1,$2,$3,$4,$5,$6)", [
            input.actorId,
            input.scope,
            input.membershipId,
            input.expectedVersion,
            input.requestId,
            input.reason,
          ])
        ).rows[0]!;
        response = {
          kind: "remove",
          scope: input.scope,
          changeId: row.change_id,
          member: {
            membershipId: row.membership_id,
            userId: row.user_id,
            displayName: row.display_name,
            version: row.membership_version,
            validUntil: null,
          },
          revokedBindings: row.revoked_bindings,
          userDeactivated: row.user_deactivated,
          updatedAt: row.changed_at.toISOString(),
        };
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      const outcome = code ? outcomes[code] : undefined;
      if (!outcome) throw error;
      return await reject({ kind: outcome });
    }
    // A concurrent revocation of the actor waits on the FOR SHARE locks above; re-check anyway.
    const beforeCommit = await checkAuthority(client, input, rights, false);
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
