import { createTaskRequestSchema } from "@impuls/contracts";
import { createTask, listTasks } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getPool } from "@/shared/server/db";
import { taskMutation, taskRead } from "@/shared/server/task-http";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return taskRead(request, (actorId) =>
    listTasks(
      getPool(),
      actorId,
      request.nextUrl.searchParams.get("cursor") ?? undefined,
    ),
  );
}

export function POST(request: NextRequest) {
  return taskMutation(request, createTaskRequestSchema, (actorId, key, body) =>
    createTask(getPool(), actorId, key, body),
  );
}
