import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramInitData } from "./telegram";

const token = "123456:local-test-token";
const now = 1_800_000_000;

function signedData(fields: Record<string, string>): string {
  const params = new URLSearchParams(fields);
  const checked = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set(
    "hash",
    createHmac("sha256", secret).update(checked).digest("hex"),
  );
  return params.toString();
}

const validFields = {
  auth_date: String(now),
  query_id: "AAH3test",
  signature: "synthetic-ed25519-signature",
  user: JSON.stringify({ id: 7_654_321, first_name: "Test" }),
};

describe("Telegram initData validation", () => {
  it("accepts a signed current launch and extracts only the verified Telegram ID", () => {
    expect(verifyTelegramInitData(signedData(validFields), token, now)).toEqual(
      {
        kind: "valid",
        data: { telegramId: "7654321" },
      },
    );
  });

  it("rejects a changed user, missing hash and duplicate fields", () => {
    const valid = signedData(validFields);
    expect(
      verifyTelegramInitData(valid.replace("7654321", "7654322"), token, now),
    ).toEqual({
      kind: "invalid",
    });
    expect(
      verifyTelegramInitData(
        new URLSearchParams(valid).toString().replace(/&hash=[^&]+/, ""),
        token,
        now,
      ),
    ).toEqual({
      kind: "invalid",
    });
    expect(
      verifyTelegramInitData(`${valid}&auth_date=${now}`, token, now),
    ).toEqual({
      kind: "invalid",
    });
  });

  it("includes the Telegram third-party signature field in the bot-token hash", () => {
    const valid = signedData(validFields);
    expect(verifyTelegramInitData(valid, token, now).kind).toBe("valid");
    const tampered = new URLSearchParams(valid);
    tampered.set("signature", "changed-signature");
    expect(verifyTelegramInitData(tampered.toString(), token, now)).toEqual({
      kind: "invalid",
    });
  });

  it("accepts a signed launch without the optional signature field", () => {
    expect(
      verifyTelegramInitData(
        signedData({
          auth_date: validFields.auth_date,
          query_id: validFields.query_id,
          user: validFields.user,
        }),
        token,
        now,
      ).kind,
    ).toBe("valid");
  });

  it("rejects old and future launches", () => {
    expect(
      verifyTelegramInitData(
        signedData({ ...validFields, auth_date: String(now - 601) }),
        token,
        now,
      ),
    ).toEqual({
      kind: "expired",
    });
    expect(
      verifyTelegramInitData(
        signedData({ ...validFields, auth_date: String(now + 61) }),
        token,
        now,
      ),
    ).toEqual({
      kind: "expired",
    });
  });

  it("requires a safe positive numeric user ID", () => {
    const unsafe = signedData({
      ...validFields,
      user: JSON.stringify({ id: 9_007_199_254_740_992 }),
    });
    expect(verifyTelegramInitData(unsafe, token, now)).toEqual({
      kind: "invalid",
    });
    const absent = signedData({ ...validFields, user: "{}" });
    expect(verifyTelegramInitData(absent, token, now)).toEqual({
      kind: "invalid",
    });
  });
});
