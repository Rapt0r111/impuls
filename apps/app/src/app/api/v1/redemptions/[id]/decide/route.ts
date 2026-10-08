import type { NextRequest } from "next/server";
import { handleRewardMutation } from "@/shared/server/rewards";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleRewardMutation(request, (await context.params).id, "decide");
}
