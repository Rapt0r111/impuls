import {
  leaderboardQuerySchema,
  leaderboardResponseSchema,
} from "@impuls/contracts";
import { hashSessionToken, readLeaderboard } from "@impuls/domain";
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
    const query = leaderboardQuerySchema.safeParse(Object.fromEntries(params));
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры рейтинга",
        id,
      );
    const result = await readLeaderboard(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      {
        ...query.data,
        allowSyntheticRanking: process.env.RANKING_ENABLED === "true",
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
        "RANKING_DISABLED",
        "Синтетический рейтинг выключен",
        id,
      );
    if (result.kind === "not_found")
      return errorResponse(404, "NOT_FOUND", "Область рейтинга недоступна", id);
    if (result.kind === "changed")
      return errorResponse(
        409,
        "RANKING_CHANGED",
        "Рейтинг изменился. Обновите список с начала",
        id,
      );
    return jsonResponse(
      leaderboardResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Рейтинг временно недоступен", id);
  }
}
