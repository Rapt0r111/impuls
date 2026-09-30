import { createCsrfToken } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = requestId();
  if (!process.env.CSRF_SECRET) {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
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
    return jsonResponse(
      {
        user: session.user,
        csrfToken: createCsrfToken(session.token, process.env.CSRF_SECRET),
      },
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
