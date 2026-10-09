import "server-only";
import { taskSubmissionHeadersSchema } from "@impuls/contracts";
import type { NextRequest } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "./auth";
import { checkTaskMutationLimit } from "./task-rate-limit";
import { errorResponse, isAllowedOrigin, readJsonLimited } from "./http";

type Authorized = Extract<
  Awaited<ReturnType<typeof getAuthorizedSession>>,
  { kind: "authorized" }
>;

// Shared preamble of the idempotent admin mutations: origin, exact headers, bounded JSON body,
// body schema, live session, CSRF and the per-subject mutation limit, in that order.
// Returns a ready error response, or everything the domain call needs.
export async function openAdminMutation<T>(
  request: NextRequest,
  id: string,
  parseBody: (raw: unknown) => T | undefined,
  invalidBody: string,
): Promise<
  Response | { body: T; idempotencyKey: string; session: Authorized }
> {
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET)
    return errorResponse(503, "UNAVAILABLE", "Сервис недоступен", id);
  if (!isAllowedOrigin(request))
    return errorResponse(
      403,
      "ORIGIN_DENIED",
      "Недопустимый источник запроса",
      id,
    );
  const headers = taskSubmissionHeadersSchema.safeParse({
    idempotencyKey: request.headers.get("idempotency-key"),
  });
  if (
    !headers.success ||
    request.nextUrl.searchParams.size ||
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json"
  )
    return errorResponse(400, "BAD_REQUEST", "Неверные параметры", id);
  let raw;
  try {
    raw = await readJsonLimited(request);
  } catch (error) {
    return errorResponse(
      error instanceof Error && error.message === "body too large" ? 413 : 400,
      "BAD_REQUEST",
      "Неверное или слишком большое тело запроса",
      id,
    );
  }
  const body = parseBody(raw);
  if (body === undefined)
    return errorResponse(400, "BAD_REQUEST", invalidBody, id);
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
  return { body, idempotencyKey: headers.data.idempotencyKey, session };
}
