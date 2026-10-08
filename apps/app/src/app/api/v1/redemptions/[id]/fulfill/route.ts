import type { NextRequest } from "next/server";
import { handleRewardMutation } from "@/shared/server/rewards";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleRewardMutation(request, id, "fulfill");
}
