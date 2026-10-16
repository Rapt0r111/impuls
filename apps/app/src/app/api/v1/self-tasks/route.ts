import {
  selfTaskListResponseSchema,
  selfTaskOptionsResponseSchema,
  selfTaskQuerySchema,
} from "@impuls/contracts";
import { listSelfTasks, readSelfTaskOptions } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";
import { handleSelfTaskMutation } from "@/shared/server/self-task-mutation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleSelfTaskMutation(request, "propose", null);
}

// view=options: scopes and verifier candidates for the form. Other views list tasks.
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
    const params = request.nextUrl.searchParams;
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length) {
      return errorResponse(400, "BAD_REQUEST", "Неверные параметры списка", id);
    }
    const query = selfTaskQuerySchema.safeParse(Object.fromEntries(params));
    if (!query.success) {
      return errorResponse(400, "BAD_REQUEST", "Неверные параметры списка", id);
    }
    const options = { enabled: process.env.TASK_MANAGEMENT_ENABLED === "true" };
    if (query.data.view === "options") {
      const result = await readSelfTaskOptions(
        getPool(),
        session.user.id,
        query.data.scopeId ?? null,
        options,
      );
      return jsonResponse(selfTaskOptionsResponseSchema.parse(result), 200, id);
    }
    const items = await listSelfTasks(
      getPool(),
      session.user.id,
      query.data.view,
      options,
    );
    return jsonResponse(selfTaskListResponseSchema.parse({ items }), 200, id);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}
