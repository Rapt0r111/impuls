import { accessListResponseSchema, accessQuerySchema } from "@impuls/contracts";
import { hashSessionToken, readAccess } from "@impuls/domain";
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
    const query = accessQuerySchema.safeParse(Object.fromEntries(params));
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(400, "BAD_REQUEST", "Неверная область", id);
    const manage = process.env.SYNTHETIC_ACCESS_MANAGEMENT_ENABLED === "true";
    const result = await readAccess(getPool(), {
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      scope: query.data.scope,
      enabled: manage,
      allowAccessManagement: manage,
      allowMemberManagement:
        process.env.SYNTHETIC_MEMBER_MANAGEMENT_ENABLED === "true",
    });
    if (result.kind === "unauthorized")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    if (result.kind !== "ok")
      return errorResponse(
        404,
        "ACCESS_MANAGEMENT_UNAVAILABLE",
        "Управление доступом в этой области недоступно",
        id,
      );
    return jsonResponse(
      accessListResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Список доступа временно недоступен",
      id,
    );
  }
}
