import { revokeSession } from "@impuls/domain";
import type { NextRequest } from "next/server";
import {
  getAuthorizedSession,
  hasValidCsrf,
  SESSION_COOKIE,
} from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import {
  errorResponse,
  isAllowedOrigin,
  requestId,
} from "@/shared/server/http";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_OPTIONS } from "@/shared/server/session-cookie";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET) {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
  if (!isAllowedOrigin(request)) {
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
  }
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind !== "authorized") {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    }
    if (!hasValidCsrf(request, session.token)) {
      return errorResponse(403, "CSRF_DENIED", "Запрос не принят", id);
    }
    await revokeSession(getPool(), session.token);
    const response = new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store", "X-Request-Id": id },
    });
    response.cookies.set(SESSION_COOKIE, "", {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 0,
    });
    return response;
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
