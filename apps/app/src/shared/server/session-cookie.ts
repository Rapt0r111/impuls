export const SESSION_COOKIE = "impuls_session";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
  partitioned: true,
  path: "/",
} as const;
