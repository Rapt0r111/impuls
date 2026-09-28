import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifiedTelegramData = { telegramId: string };
export type TelegramValidation =
  | { kind: "valid"; data: VerifiedTelegramData }
  | { kind: "invalid" }
  | { kind: "expired" };

const MAX_AGE_SECONDS = 600;
const FUTURE_SKEW_SECONDS = 60;

export function verifyTelegramInitData(
  raw: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramValidation {
  if (!raw || raw.length > 8192 || !botToken) return { kind: "invalid" };

  const params = new URLSearchParams(raw);
  const fields = new Map<string, string>();
  for (const [key, value] of params) {
    if (!key || fields.has(key)) return { kind: "invalid" };
    fields.set(key, value);
  }

  const receivedHash = fields.get("hash");
  const authDate = fields.get("auth_date");
  const userJson = fields.get("user");
  if (!receivedHash || !/^[a-fA-F0-9]{64}$/.test(receivedHash))
    return { kind: "invalid" };
  if (!authDate || !/^[0-9]+$/.test(authDate) || !userJson)
    return { kind: "invalid" };

  const dataCheckString = [...fields]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest();
  if (!timingSafeEqual(computedHash, Buffer.from(receivedHash, "hex"))) {
    return { kind: "invalid" };
  }

  const signedAt = Number(authDate);
  if (!Number.isSafeInteger(signedAt)) return { kind: "invalid" };
  if (
    signedAt < nowSeconds - MAX_AGE_SECONDS ||
    signedAt > nowSeconds + FUTURE_SKEW_SECONDS
  ) {
    return { kind: "expired" };
  }

  try {
    const user: unknown = JSON.parse(userJson);
    if (typeof user !== "object" || user === null || !("id" in user)) {
      return { kind: "invalid" };
    }
    const id = user.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      return { kind: "invalid" };
    }
    return { kind: "valid", data: { telegramId: String(id) } };
  } catch {
    return { kind: "invalid" };
  }
}
