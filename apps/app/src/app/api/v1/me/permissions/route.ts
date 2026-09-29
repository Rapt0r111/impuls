import { listActivePermissions } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind === "missing") {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    }
    if (session.kind === "revoked") {
      return errorResponse(
        403,
        "ACCESS_REVOKED",
        "Доступ к приложению отозван",
        id,
      );
    }
    const permissions = await listActivePermissions(getPool(), session.user.id);
    return jsonResponse({ permissions }, 200, id);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
