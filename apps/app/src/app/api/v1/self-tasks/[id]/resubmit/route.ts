import type { NextRequest } from "next/server";
import { handleSelfTaskMutation } from "@/shared/server/self-task-mutation";

export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleSelfTaskMutation(request, "resubmit", id);
}
