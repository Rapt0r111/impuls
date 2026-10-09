import "server-only";
import {
  memberAdmissionRequestSchema,
  memberChangeResponseSchema,
  memberRemovalRequestSchema,
  type MemberAdmissionRequest,
  type MemberRemovalRequest,
} from "@impuls/contracts";
import { changeMember, hashSessionToken } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { openAdminMutation } from "./admin-mutation";
import { getPool } from "./db";
import { errorResponse, jsonResponse, requestId } from "./http";

function memberHandler(kind: "admit" | "remove") {
  return async function handle(request: NextRequest) {
    const id = requestId();
    try {
      const opened = await openAdminMutation(
        request,
        id,
        (raw) => {
          const parsed = (
            kind === "admit"
              ? memberAdmissionRequestSchema
              : memberRemovalRequestSchema
          ).safeParse(raw);
          return parsed.success ? parsed.data : undefined;
        },
        "Проверьте участника, срок и основание",
      );
      if (opened instanceof Response) return opened;
      const { body, idempotencyKey, session } = opened;
      const common = {
        actorId: session.user.id,
        sessionHash: hashSessionToken(session.token),
        idempotencyKey,
        requestId: id,
        allowMemberManagement: process.env.MEMBER_MANAGEMENT_ENABLED === "true",
      };
      const result = await changeMember(
        getPool(),
        kind === "admit"
          ? { ...(body as MemberAdmissionRequest), ...common, kind }
          : { ...(body as MemberRemovalRequest), ...common, kind },
      );
      if (result.kind === "ok")
        return jsonResponse(
          memberChangeResponseSchema.parse(result.response),
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
          "MEMBER_MANAGEMENT_UNAVAILABLE",
          "Управление составом в этой области недоступно",
          id,
        );
      if (result.kind === "conflict")
        return errorResponse(
          409,
          "MEMBER_CONFLICT",
          "Состав изменился. Обновите список",
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
          ? "MEMBER_TERM_INVALID"
          : "MEMBER_TARGET_FORBIDDEN",
        result.kind === "invalid_term"
          ? "Срок допуска должен быть в будущем"
          : "Этого участника нельзя изменить",
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
export const handleMemberAdmission = memberHandler("admit");
export const handleMemberRemoval = memberHandler("remove");
