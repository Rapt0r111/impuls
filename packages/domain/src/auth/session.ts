import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function isSessionToken(token: string | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function createCsrfToken(sessionToken: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`csrf:${sessionToken}`)
    .digest("base64url");
}

export function verifyCsrfToken(
  sessionToken: string,
  secret: string,
  supplied: string | null,
): boolean {
  if (!supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  const expected = Buffer.from(createCsrfToken(sessionToken, secret));
  return timingSafeEqual(expected, Buffer.from(supplied));
}
