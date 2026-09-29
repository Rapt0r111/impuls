import { submitTaskRequestSchema } from "@impuls/contracts";
import { submitTask } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getPool } from "@/shared/server/db";
import { taskMutation } from "@/shared/server/task-http";

export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return taskMutation(request, submitTaskRequestSchema, (actorId, key, body) =>
    submitTask(getPool(), actorId, id, key, body),
  );
}
