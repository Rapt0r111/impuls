import type { ComponentProps } from "react";
import type { SpeedInsights } from "@vercel/speed-insights/next";

type BeforeSend = NonNullable<
  ComponentProps<typeof SpeedInsights>["beforeSend"]
>;

// Telegram launch data can appear in query strings and fragments. Aggregate
// the Mini App under one route; object identifiers must not leave the app.
export const redactSpeedEvent: BeforeSend = (event) => {
  try {
    const url = new URL(event.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { type: "vital", url: `${url.origin}/`, route: "/" };
  } catch {
    return null;
  }
};
