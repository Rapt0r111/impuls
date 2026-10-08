import {
  taskTimelineQuerySchema,
  taskTimelineResponseSchema,
  taskIdSchema,
} from "@impuls/contracts";
import { hashSessionToken, readTaskTimeline } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = requestId();
  try {
    const session = await getAuthorizedSession(request);
    if (session.kind === "missing")
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    if (session.kind === "revoked")
      return errorResponse(
        403,
        "ACCESS_REVOKED",
        "Доступ к приложению отозван",
        id,
      );
    const { id: taskId } = await context.params;
    if (!taskIdSchema.safeParse(taskId).success)
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    const query = taskTimelineQuerySchema.safeParse(Object.fromEntries(params));
    if (new Set(keys).size !== keys.length || !query.success)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Неверные параметры истории",
        id,
      );
    const result = await readTaskTimeline(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      taskId,
      query.data,
    );
    if (result.kind === "unauthorized")
      return errorResponse(401, "UNAUTHORIZED", "Сессия завершилась", id);
    if (result.kind === "revoked")
      return errorResponse(
        403,
        "ACCESS_REVOKED",
        "Доступ к приложению отозван",
        id,
      );
    if (result.kind === "not_found")
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    return jsonResponse(
      taskTimelineResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
