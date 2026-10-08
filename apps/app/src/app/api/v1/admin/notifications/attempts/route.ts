import {
  notificationAttemptsQuerySchema,
  notificationAttemptsResponseSchema,
} from "@impuls/contracts";
import { hashSessionToken, readNotificationAttempts } from "@impuls/domain";
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
    const query = notificationAttemptsQuerySchema.safeParse(
      Object.fromEntries(params),
    );
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры журнала попыток",
        id,
      );
    const result = await readNotificationAttempts(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      {
        ...query.data,
        enabled: process.env.SYNTHETIC_NOTIFICATION_STATUS_ENABLED === "true",
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
        "NOTIFICATION_STATUS_DISABLED",
        "Просмотр симуляции выключен",
        id,
      );
    if (result.kind === "not_found")
      return errorResponse(
        404,
        "NOT_FOUND",
        "Журнал в этой области недоступен",
        id,
      );
    if (result.kind === "invalid")
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Страница журнала изменилась. Обновите журнал",
        id,
      );
    return jsonResponse(
      notificationAttemptsResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Журнал попыток временно недоступен",
      id,
    );
  }
}
