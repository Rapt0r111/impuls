import {
  ledgerCorrectionRequestSchema,
  ledgerCorrectionQuerySchema,
  ledgerCorrectionResponseSchema,
  ledgerCorrectionsResponseSchema,
  taskSubmissionHeadersSchema,
} from "@impuls/contracts";
import {
  hashSessionToken,
  listCorrectableAwards,
  reverseAcceptance,
} from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { checkTaskMutationLimit } from "@/shared/server/task-rate-limit";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "@/shared/server/http";

export const runtime = "nodejs";
const enabled = () => process.env.LEDGER_CORRECTIONS_ENABLED === "true";

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
    const query = ledgerCorrectionQuerySchema.safeParse(
      Object.fromEntries(params),
    );
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(400, "BAD_REQUEST", "Неверные параметры списка", id);
    const result = await listCorrectableAwards(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      { ...query.data, allowSyntheticCorrections: enabled() },
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
    if (result.kind === "forbidden")
      return errorResponse(
        403,
        "FORBIDDEN",
        "Нет права исправлять начисления",
        id,
      );
    return jsonResponse(
      ledgerCorrectionsResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Начисления временно недоступны",
      id,
    );
  }
}

export async function POST(request: NextRequest) {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET)
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  if (!isAllowedOrigin(request))
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
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
    if (!hasValidCsrf(request, session.token))
      return errorResponse(403, "CSRF_DENIED", "Запрос не принят", id);
    const limited = await checkTaskMutationLimit(session.user.id, id);
    if (limited) return limited;
    const headers = taskSubmissionHeadersSchema.safeParse({
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (!headers.success)
      return errorResponse(400, "BAD_REQUEST", "Неверный ключ запроса", id);
    let raw: unknown;
    try {
      raw = await readJsonLimited(request, 16_384);
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
    }
    const body = ledgerCorrectionRequestSchema.safeParse(raw);
    if (!body.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Проверьте основание и версию баланса",
        id,
      );
    const result = await reverseAcceptance(getPool(), {
      ...body.data,
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      idempotencyKey: headers.data.idempotencyKey,
      requestId: id,
      allowSyntheticCorrections: enabled(),
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
    if (result.kind === "not_found")
      return errorResponse(404, "NOT_FOUND", "Начисление недоступно", id);
    if (result.kind === "self_correction")
      return errorResponse(
        403,
        "SELF_CORRECTION",
        "Нельзя исправлять собственное начисление",
        id,
      );
    if (result.kind === "recipient_revoked")
      return errorResponse(
        422,
        "RECIPIENT_REVOKED",
        "Доступ получателя отозван",
        id,
      );
    if (result.kind === "disabled" || result.kind === "rules_invalid")
      return errorResponse(
        422,
        "CORRECTIONS_DISABLED",
        "Синтетические корректировки выключены или правила недоступны",
        id,
      );
    if (result.kind === "insufficient_balance")
      return errorResponse(
        422,
        "INSUFFICIENT_BALANCE",
        "Недостаточно доступных XP или баллов. Нужен отдельный порядок исправления",
        id,
      );
    if (result.kind === "already_corrected")
      return errorResponse(
        409,
        "ALREADY_CORRECTED",
        "Начисление уже возвращено. Обновите данные",
        id,
      );
    if (result.kind === "idempotency_conflict")
      return errorResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Ключ использован для другого запроса",
        id,
      );
    if (result.kind === "conflict")
      return errorResponse(
        409,
        "BALANCE_CONFLICT",
        "Баланс изменился. Обновите данные и проверьте суммы",
        id,
        result.currentVersion,
      );
    return jsonResponse(
      ledgerCorrectionResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Корректировка временно недоступна. Повторите тот же запрос",
      id,
    );
  }
}
