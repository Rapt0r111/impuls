import "server-only";
import { isSessionToken, readSession, verifyCsrfToken } from "@impuls/domain";
import type { NextRequest } from "next/server";
import { getPool } from "./db";

export const SESSION_COOKIE = "impuls_session";

export async function getAuthorizedSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!isSessionToken(token)) return { kind: "missing" } as const;
  const session = await readSession(getPool(), token);
  return { ...session, token };
}

export function hasValidCsrf(request: NextRequest, token: string): boolean {
  const secret = process.env.CSRF_SECRET;
  return Boolean(
    secret &&
    verifyCsrfToken(token, secret, request.headers.get("x-csrf-token")),
  );
}
