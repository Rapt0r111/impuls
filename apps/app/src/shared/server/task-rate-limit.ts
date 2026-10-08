import "server-only";
import { consumeTaskMutationAttempt } from "@impuls/domain";
import { getPool } from "./db";
import { errorResponse } from "./http";

export async function checkTaskMutationLimit(
  actorId: string,
  requestId: string,
) {
  const result = await consumeTaskMutationAttempt(getPool(), actorId);
  if (result.allowed) return null;
  const response = errorResponse(
    429,
    "RATE_LIMITED",
    `Слишком много действий. Повторите через ${result.retryAfter} с`,
    requestId,
  );
  response.headers.set("Retry-After", String(result.retryAfter));
  return response;
}
