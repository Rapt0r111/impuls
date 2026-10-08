import "server-only";
import {
  accessChangeResponseSchema,
  accessGrantRequestSchema,
  accessRevocationRequestSchema,
  taskSubmissionHeadersSchema,
} from "@impuls/contracts";
import { changeAccess, hashSessionToken } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "./auth";
import { getPool } from "./db";
import { checkTaskMutationLimit } from "./task-rate-limit";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "./http";

function accessHandler(kind: "grant" | "revoke") {
  return async function handle(request: NextRequest) {
    const id = requestId();
    if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET)
      return errorResponse(503, "UNAVAILABLE", "Сервис недоступен", id);
    if (!isAllowedOrigin(request))
      return errorResponse(
        403,
        "ORIGIN_DENIED",
        "Недопустимый источник запроса",
        id,
      );
    try {
      const headers = taskSubmissionHeadersSchema.safeParse({
        idempotencyKey: request.headers.get("idempotency-key"),
      });
      if (
        !headers.success ||
        request.nextUrl.searchParams.size ||
        request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        return errorResponse(400, "BAD_REQUEST", "Неверные параметры", id);
      let raw;
      try {
        raw = await readJsonLimited(request);
      } catch (error) {
        return errorResponse(
          error instanceof Error && error.message === "body too large"
            ? 413
            : 400,
          "BAD_REQUEST",
          "Неверное или слишком большое тело запроса",
          id,
        );
      }
      const grant = accessGrantRequestSchema.safeParse(raw);
      const revoke = accessRevocationRequestSchema.safeParse(raw);
      if (kind === "grant" ? !grant.success : !revoke.success)
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Проверьте получателя, право и основание",
          id,
        );
      const session = await getAuthorizedSession(request);
      if (session.kind !== "authorized")
        return errorResponse(
          session.kind === "missing" ? 401 : 403,
          "ACCESS_REVOKED",
          "Повторите вход через Telegram",
          id,
        );
      if (!hasValidCsrf(request, session.token))
        return errorResponse(
          403,
          "CSRF_DENIED",
          "Повторите вход через Telegram",
          id,
        );
      const limited = await checkTaskMutationLimit(session.user.id, id);
      if (limited) return limited;
      const common = {
        actorId: session.user.id,
        sessionHash: hashSessionToken(session.token),
        idempotencyKey: headers.data.idempotencyKey,
        requestId: id,
        allowAccessManagement:
          process.env.SYNTHETIC_ACCESS_MANAGEMENT_ENABLED === "true",
      };
      const result = await changeAccess(
        getPool(),
        kind === "grant" && grant.success
          ? { ...grant.data, ...common, kind }
          : { ...revoke.data!, ...common, kind: "revoke" },
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
