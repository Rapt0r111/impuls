import {
  participantProfileResponseSchema,
  profileNameRequestSchema,
  profileNameResponseSchema,
} from "@impuls/contracts";
import {
  hashSessionToken,
  readParticipantProfile,
  renameSelf,
} from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getAuthorizedSession } from "@/shared/server/auth";
import { openAdminMutation } from "@/shared/server/admin-mutation";
import { getPool } from "@/shared/server/db";
import { errorResponse, jsonResponse, requestId } from "@/shared/server/http";

export const runtime = "nodejs";
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
    if ([...request.nextUrl.searchParams].length)
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Профиль не принимает параметры",
        id,
      );
    const result = await readParticipantProfile(
      getPool(),
      session.user.id,
      hashSessionToken(session.token),
      {
        allowSyntheticProfile: process.env.PROFILE_ENABLED === "true",
      },
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
    if (result.kind === "disabled")
      return errorResponse(
        404,
        "NOT_FOUND",
        "Синтетический профиль выключен",
        id,
      );
    return jsonResponse(
      participantProfileResponseSchema.parse(result.response),
      200,
      id,
    );
  } catch {
    return errorResponse(503, "UNAVAILABLE", "Профиль временно недоступен", id);
  }
}

// A participant changes only their own display name. Naturally idempotent: repeating the
// same name reports changed=false, so the Idempotency-Key required by the shared preamble is not stored.
export async function PATCH(request: NextRequest) {
  const id = requestId();
  try {
    const opened = await openAdminMutation(
      request,
      id,
      (raw) => {
        const parsed = profileNameRequestSchema.safeParse(raw);
        return parsed.success ? parsed.data : undefined;
      },
      "Имя: от 2 до 40 символов — буквы, цифры, пробел и . _ ' -",
    );
    if (opened instanceof Response) return opened;
    const { body, session } = opened;
    const result = await renameSelf(getPool(), {
      actorId: session.user.id,
      sessionHash: hashSessionToken(session.token),
      displayName: body.displayName,
      requestId: id,
      allowSyntheticProfile: process.env.PROFILE_ENABLED === "true",
    });
    if (result.kind === "ok")
      return jsonResponse(
        profileNameResponseSchema.parse({
          mode: "synthetic",
          user: { id: session.user.id, displayName: result.displayName },
          changed: result.changed,
        }),
        200,
        id,
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
    if (result.kind === "disabled")
      return errorResponse(
        404,
        "NOT_FOUND",
        "Синтетический профиль выключен",
        id,
      );
    return errorResponse(
      409,
      "NAME_TAKEN",
      "Такое имя уже занято. Выберите другое",
      id,
    );
  } catch {
    return errorResponse(
      503,
      "UNAVAILABLE",
      "Результат не подтверждён. Повторите тот же запрос",
      id,
    );
  }
}
