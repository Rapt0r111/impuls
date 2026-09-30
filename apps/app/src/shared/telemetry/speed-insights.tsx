"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactSpeedEvent } from "./redact-speed-event";

export function AppSpeedInsights() {
  return <SpeedInsights beforeSend={redactSpeedEvent} debug={false} />;
}
