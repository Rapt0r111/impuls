import {
  createCsrfToken,
  createLoginSession,
  consumeLoginAttempt,
  verifyTelegramInitData,
} from "@impuls/domain";
import { telegramLoginRequestSchema } from "@impuls/contracts";
import type { NextRequest } from "next/server";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "@/shared/server/http";
import { getPool } from "@/shared/server/db";
import { SESSION_COOKIE } from "@/shared/server/auth";

export const runtime = "nodejs";

function rateLimited(id: string, retryAfter: number) {
  const response = errorResponse(
    429,
    "RATE_LIMITED",
    "Слишком много попыток. Повторите через минуту",
    id,
  );
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}

export async function POST(request: NextRequest) {
  const id = requestId();
  if (
    !process.env.APP_ORIGIN ||
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.CSRF_SECRET
  ) {
    return errorResponse(503, "UNAVAILABLE", "Вход временно недоступен", id);
  }
  if (!isAllowedOrigin(request)) {
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
  }
  try {
    // Vercel sets this header at its edge. Locally, requests share one bucket.
    const ip = process.env.VERCEL
      ? (request.headers.get("x-vercel-forwarded-for") ?? "unknown")
      : "local";
    const limit = await consumeLoginAttempt(
      getPool(),
      "login-ip",
      ip,
      process.env.CSRF_SECRET,
      30,
    );
    if (!limit.allowed) return rateLimited(id, limit.retryAfter);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Вход временно недоступен", id);
  }

  let body: unknown;
  try {
    body = await readJsonLimited(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
  }
  const parsed = telegramLoginRequestSchema.safeParse(body);
  if (!parsed.success)
    return errorResponse(400, "BAD_REQUEST", "Неверные данные входа", id);

  const verified = verifyTelegramInitData(
    parsed.data.initData,
    process.env.TELEGRAM_BOT_TOKEN,
  );
  if (verified.kind === "expired") {
    return errorResponse(
      401,
      "AUTH_EXPIRED",
      "Срок запуска истёк. Откройте приложение снова",
      id,
    );
  }
  if (verified.kind === "invalid") {
    return errorResponse(
      401,
      "AUTH_INVALID",
      "Данные Telegram не прошли проверку",
      id,
    );
  }
  try {
    const limit = await consumeLoginAttempt(
      getPool(),
      "login-telegram",
      verified.data.telegramId,
      process.env.CSRF_SECRET,
      10,
    );
    if (!limit.allowed) return rateLimited(id, limit.retryAfter);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Вход временно недоступен", id);
  }

  try {
    const login = await createLoginSession(getPool(), verified.data.telegramId);
    if (login.kind === "denied") {
      return errorResponse(
        403,
        "ACCESS_DENIED",
        "Доступ к приложению не предоставлен",
        id,
      );
    }
    const response = jsonResponse(
      {
        user: login.user,
        csrfToken: createCsrfToken(login.sessionToken, process.env.CSRF_SECRET),
      },
      200,
      id,
    );
    response.cookies.set(SESSION_COOKIE, login.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    return response;
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Вход временно недоступен", id);
  }
}
