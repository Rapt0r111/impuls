import "server-only";
import {
  accessChangeResponseSchema,
  accessGrantRequestSchema,
  accessRevocationRequestSchema,
  type AccessGrantRequest,
  type AccessRevocationRequest,
} from "@impuls/contracts";
import { changeAccess, hashSessionToken } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { openAdminMutation } from "./admin-mutation";
import { getPool } from "./db";
import { errorResponse, jsonResponse, requestId } from "./http";

function accessHandler(kind: "grant" | "revoke") {
  return async function handle(request: NextRequest) {
    const id = requestId();
    try {
      const opened = await openAdminMutation(
        request,
        id,
        (raw) => {
          const parsed = (
            kind === "grant"
              ? accessGrantRequestSchema
              : accessRevocationRequestSchema
          ).safeParse(raw);
          return parsed.success ? parsed.data : undefined;
        },
        "Проверьте получателя, право и основание",
      );
      if (opened instanceof Response) return opened;
      const { body, idempotencyKey, session } = opened;
      const common = {
        actorId: session.user.id,
        sessionHash: hashSessionToken(session.token),
        idempotencyKey,
        requestId: id,
        allowAccessManagement:
          process.env.SYNTHETIC_ACCESS_MANAGEMENT_ENABLED === "true",
      };
      const result = await changeAccess(
        getPool(),
        kind === "grant"
          ? { ...(body as AccessGrantRequest), ...common, kind }
          : { ...(body as AccessRevocationRequest), ...common, kind: "revoke" },
      );
      if (result.kind === "ok")
        return jsonResponse(
          accessChangeResponseSchema.parse(result.response),
          201,
          id,
        );
      if (result.kind === "revoked" || result.kind === "unauthorized")
        return errorResponse(
          result.kind === "revoked" ? 403 : 401,
          "ACCESS_REVOKED",
          "Повторите вход через Telegram",
          id,
        );
      if (result.kind === "not_found" || result.kind === "disabled")
        return errorResponse(
          404,
          "ACCESS_MANAGEMENT_UNAVAILABLE",
          "Управление доступом в этой области недоступно",
          id,
        );
      if (result.kind === "conflict")
        return errorResponse(
          409,
          "ACCESS_CONFLICT",
          "Право изменилось. Обновите список",
          id,
        );
      if (result.kind === "idempotency_conflict")
        return errorResponse(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Ключ использован для другого запроса",
          id,
        );
      return errorResponse(
        422,
        result.kind === "invalid_term"
          ? "ACCESS_TERM_INVALID"
          : "ACCESS_TARGET_FORBIDDEN",
        result.kind === "invalid_term"
          ? "Срок права должен быть в будущем"
          : "Это право или получателя нельзя изменить",
        id,
      );
    } catch {
      return errorResponse(
        503,
        "UNAVAILABLE",
        "Результат не подтверждён. Повторите тот же запрос",
        id,
      );
    }
  };
}
export const handleAccessGrant = accessHandler("grant");
export const handleAccessRevocation = accessHandler("revoke");
