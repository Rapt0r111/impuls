import "server-only";
import {
  selfTaskDecideRequestSchema,
  selfTaskProposeRequestSchema,
  selfTaskResponseSchema,
  selfTaskResubmitRequestSchema,
  selfTaskVerifyRequestSchema,
  taskIdSchema,
  taskSubmissionHeadersSchema,
} from "@impuls/contracts";
import {
  decideSelfTask,
  hashSessionToken,
  proposeSelfTask,
  resubmitSelfTask,
  verifySelfTask,
  type SelfTaskResult,
} from "@impuls/domain";
import type { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSession, hasValidCsrf } from "./auth";
import { getPool } from "./db";
import { checkTaskMutationLimit } from "./task-rate-limit";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJsonLimited,
  requestId,
} from "./http";

export type SelfTaskAction = "propose" | "verify" | "decide" | "resubmit";

export async function handleSelfTaskMutation(
  request: NextRequest,
  action: SelfTaskAction,
  taskId: string | null,
): Promise<NextResponse> {
  const id = requestId();
  if (!process.env.APP_ORIGIN || !process.env.CSRF_SECRET) {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
  if (!isAllowedOrigin(request)) {
    return errorResponse(403, "ORIGIN_DENIED", "Запрос не принят", id);
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
    if (!hasValidCsrf(request, session.token)) {
      return errorResponse(403, "CSRF_DENIED", "Запрос не принят", id);
    }
    const limited = await checkTaskMutationLimit(session.user.id, id);
    if (limited) return limited;
    if (taskId !== null && !taskIdSchema.safeParse(taskId).success) {
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    }
    const headers = taskSubmissionHeadersSchema.safeParse({
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    if (!headers.success) {
      return errorResponse(400, "BAD_REQUEST", "Неверный ключ запроса", id);
    }
    let rawBody: unknown;
    try {
      rawBody = await readJsonLimited(request, 32_768);
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Неверный формат запроса", id);
    }
    const common = {
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      idempotencyKey: headers.data.idempotencyKey,
      enabled: process.env.TASK_MANAGEMENT_ENABLED === "true",
    };
    let result: SelfTaskResult;
    if (action === "propose") {
      const body = selfTaskProposeRequestSchema.safeParse(rawBody);
      if (!body.success) {
        return errorResponse(400, "BAD_REQUEST", "Неверные данные задачи", id);
      }
      result = await proposeSelfTask(getPool(), { ...common, ...body.data });
    } else if (action === "verify") {
      const body = selfTaskVerifyRequestSchema.safeParse(rawBody);
      if (!body.success || taskId === null) {
        return errorResponse(
          400,
          "BAD_REQUEST",
          "Неверные данные проверки",
          id,
        );
      }
      result = await verifySelfTask(getPool(), {
        ...common,
        taskId,
        ...body.data,
      });
    } else if (action === "resubmit") {
      const body = selfTaskResubmitRequestSchema.safeParse(rawBody);
      if (!body.success || taskId === null) {
        return errorResponse(400, "BAD_REQUEST", "Неверные данные отчёта", id);
      }
      result = await resubmitSelfTask(getPool(), {
        ...common,
        taskId,
        ...body.data,
      });
    } else {
      const body = selfTaskDecideRequestSchema.safeParse(rawBody);
      if (!body.success || taskId === null) {
        return errorResponse(400, "BAD_REQUEST", "Неверные данные решения", id);
      }
      result = await decideSelfTask(getPool(), {
        ...common,
        taskId,
        ...body.data,
      });
    }
    return mapSelfTaskResult(result, id);
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Сервис временно недоступен", id);
  }
}

function mapSelfTaskResult(result: SelfTaskResult, id: string): NextResponse {
  switch (result.kind) {
    case "ok":
      return jsonResponse(
        selfTaskResponseSchema.parse(result.response),
        result.status,
        id,
      );
    case "unauthorized":
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Откройте приложение через Telegram",
        id,
      );
    case "revoked":
      return errorResponse(
        403,
        "ACCESS_REVOKED",
        "Доступ к приложению отозван",
        id,
      );
    case "disabled":
    case "not_found":
      return errorResponse(404, "NOT_FOUND", "Задача не найдена", id);
    case "idempotency_conflict":
      return errorResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Ключ уже использован для другого запроса",
        id,
      );
    case "conflict":
      return errorResponse(
        409,
        "TASK_CONFLICT",
        "Задача изменилась. Обновите данные",
        id,
        result.currentVersion,
      );
    case "verifiers_invalid":
      return errorResponse(
        422,
        "VERIFIERS_INVALID",
        "Выберите проверяющих из своей области, не себя",
        id,
      );
    case "points_missing":
      return errorResponse(
        409,
        "POINTS_MISSING",
        "Проверяющий ещё не указал баллы для этого отчёта",
        id,
      );
    case "self_review":
      return errorResponse(
        403,
        "SELF_REVIEW",
        "Нельзя проверять собственную задачу",
        id,
      );
    case "recipient_revoked":
      return errorResponse(
        409,
        "RECIPIENT_REVOKED",
        "Участник больше не в приложении. Задача не передана",
        id,
      );
    case "rules_invalid":
      return errorResponse(
        503,
        "UNAVAILABLE",
        "Сервис временно недоступен",
        id,
      );
  }
}
