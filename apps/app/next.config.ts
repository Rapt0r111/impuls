import path from "node:path";
import type { NextConfig } from "next";

// Telegram Web (web.telegram.org and its legacy k/z hosts) embeds the Mini App in an iframe;
// native clients use their own WebView and are not affected by frame-ancestors.
const frameAncestors = [
  "'self'",
  "https://web.telegram.org",
  "https://webk.telegram.org",
  "https://webz.telegram.org",
].join(" ");

// Referrer-Policy must not be no-referrer: for same-origin POSTs it makes the browser
// send `Origin: null`, which isAllowedOrigin rejects.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: `frame-ancestors ${frameAncestors}`,
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
