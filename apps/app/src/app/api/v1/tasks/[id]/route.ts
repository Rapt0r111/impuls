import { taskDetailResponseSchema, taskIdSchema } from "@impuls/contracts";
import { getAssignedTask } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";
import { handleTaskMutation } from "@/shared/server/task-mutation";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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

    const { id: taskId } = await context.params;
    if (!taskIdSchema.safeParse(taskId).success) {
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    }
    const task = await getAssignedTask(getPool(), session.user.id, taskId);
    if (!task) {
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    }
    return jsonResponse(taskDetailResponseSchema.parse({ task }), 200, id);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleTaskMutation(request, id, "start");
}
