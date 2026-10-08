import { participantProfileResponseSchema } from "@impuls/contracts";
import { hashSessionToken, readParticipantProfile } from "@impuls/domain";
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
    if ([...request.nextUrl.searchParams].length)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Профиль не принимает параметры",
        id,
      );
    const result = await readParticipantProfile(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      {
        allowSyntheticProfile: process.env.SYNTHETIC_PROFILE_ENABLED === "true",
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
        "NOT_FOUND",
        "Синтетический профиль выключен",
        id,
      );
    return jsonResponse(
      participantProfileResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Профиль временно недоступен", id);
  }
}
