import {
  rulesPublishRequestSchema,
  rulesPublishResponseSchema,
  rulesResponseSchema,
  taskSubmissionHeadersSchema,
} from "@impuls/contracts";
import { hashSessionToken, publishRules, readRules } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "@/shared/server/http";
import { checkTaskMutationLimit } from "@/shared/server/task-rate-limit";

export const runtime = "nodejs";
const enabled = () => process.env.RULES_MANAGEMENT_ENABLED === "true";

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
    if (request.nextUrl.searchParams.size)
      return errorResponse(400, "BAD_REQUEST", "Неверные параметры правил", id);
    const result = await readRules(getPool(), {
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      enabled: enabled(),
    });
    if (result.kind === "ok")
      return jsonResponse(rulesResponseSchema.parse(result.response), 200, id);
    if (result.kind === "unauthorized")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Повторите вход через Telegram",
        id,
      );
    if (result.kind === "revoked")
      return errorResponse(403, "ACCESS_REVOKED", "Доступ отозван", id);
    return errorResponse(
      404,
      "RULES_UNAVAILABLE",
      "Управление правилами недоступно",
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Правила временно недоступны", id);
  }
}

export async function POST(request: NextRequest) {
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
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры публикации",
        id,
      );
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
    const body = rulesPublishRequestSchema.safeParse(raw);
    if (!body.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Проверьте часовой пояс, пороги уровней, бонусы и основание",
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
    const result = await publishRules(getPool(), {
      ...body.data,
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      idempotencyKey: headers.data.idempotencyKey,
      requestId: id,
      allowPublication: enabled(),
    });
    if (result.kind === "ok")
      return jsonResponse(
        rulesPublishResponseSchema.parse(result.response),
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
    if (result.kind === "forbidden" || result.kind === "disabled")
      return errorResponse(
        404,
        "RULES_UNAVAILABLE",
        "Управление правилами недоступно",
        id,
      );
    if (result.kind === "idempotency_conflict")
      return errorResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Ключ использован для другого запроса",
        id,
      );
    return errorResponse(422, "RULES_INVALID", "Параметры правил неверны", id);
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Результат не подтверждён. Повторите тот же запрос",
      id,
    );
  }
}
