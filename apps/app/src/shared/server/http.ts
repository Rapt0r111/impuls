import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ApiError } from "@impuls/contracts";

const baseHeaders = { "Cache-Control": "private, no-store" };

export function requestId(): string {
  return randomUUID();
}

export function jsonResponse(
  data: unknown,
  status: number,
  id: string,
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { ...baseHeaders, "X-Request-Id": id },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  id: string,
  currentVersion?: number,
): NextResponse {
  if (status >= 500) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "api_error",
        requestId: id,
        status,
      }),
    );
  }
  const body: ApiError = {
    code,
    message,
    requestId: id,
    ...(currentVersion === undefined ? {} : { currentVersion }),
  };
  return jsonResponse(body, status, id);
}

export function isAllowedOrigin(request: Request): boolean {
  const configured = process.env.APP_ORIGIN;
  if (!configured) return false;
  return request.headers.get("origin") === configured;
}

export async function readJsonLimited(
  request: Request,
  maxBytes = 16_384,
): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new Error("invalid content type");
  }
  if (!request.body) throw new Error("empty body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new Error("body too large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
