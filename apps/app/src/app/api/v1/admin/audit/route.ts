import { auditQuerySchema, auditResponseSchema } from "@impuls/contracts";
import { hashSessionToken, readAudit } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind === "missing")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Повторите вход через Telegram",
        id,
      );
    if (session.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    const query = auditQuerySchema.safeParse(Object.fromEntries(params));
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры журнала",
        id,
      );
    const result = await readAudit(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      {
        ...query.data,
        allowSyntheticAudit: process.env.AUDIT_ENABLED === "true",
      },
    );
    if (result.kind === "unauthorized")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    if (result.kind === "disabled")
      return errorResponse(
        404,
        "AUDIT_DISABLED",
        "Синтетический журнал выключен",
        id,
      );
    if (result.kind === "not_found")
      return errorResponse(
        404,
        "NOT_FOUND",
        "Журнал в этой области недоступен",
        id,
      );
    if (result.kind === "invalid_cursor")
      return errorResponse(
        400,
        "INVALID_CURSOR",
        "Страница недоступна. Обновите журнал с начала",
        id,
      );
    return jsonResponse(auditResponseSchema.parse(result.response), 200, id);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Журнал временно недоступен", id);
  }
}
