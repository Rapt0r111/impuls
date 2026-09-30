# F01 regression checks — 2026-09-29

## Scope

Added synthetic negative cases in `packages/domain/src/auth/telegram.test.ts` for empty/oversized input, missing bot-token configuration, missing required fields, malformed hash/user JSON, and non-positive, fractional, non-numeric, or null Telegram IDs. These exercise existing validation behavior; no production auth code, schema, or contract changed. The test fixtures use local synthetic values only.

This is a regression-test addition, not completion of F01. F01 also requires the HTTP/API and allowlist/session flows, revocation behavior, integration checks against PostgreSQL, UI states, and the remaining acceptance criteria in `IMPLEMENTATION_PLAN.md` §§ 11–12.

## Commands and results

Commands were run from the repository root, `C:\Users\Aquarius\Documents\Codex\2026-09-22\f`.

| Command                                                           | Result                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx vitest run packages/domain/src/auth/telegram.test.ts`       | Passed: 1 test file, 8 tests.                                                                                                                                                                                  |
| `bunx vitest run tests/integration/auth.test.ts`                  | Skipped: 1 test file, 2 tests. The integration suite is gated on `TEST_DATABASE_URL`; no PostgreSQL integration assertions ran in this environment.                                                            |
| `bunx eslint packages/domain/src/auth/telegram.test.ts`           | Passed, exit code 0.                                                                                                                                                                                           |
| `bunx prettier --check packages/domain/src/auth/telegram.test.ts` | Passed after formatting, exit code 0. The first check before `bunx prettier --write packages/domain/src/auth/telegram.test.ts` reported style issues; the file was formatted and the check rerun successfully. |
| `bun run --cwd packages/domain typecheck`                         | Passed: `tsc --noEmit`, exit code 0.                                                                                                                                                                           |

Additional checks from the main executor:

| Command                           | Result                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:unit`               | Passed: 10 tests; 5 PostgreSQL integration tests skipped without `TEST_DATABASE_URL`.                                                                                                                                                                   |
| `bunx next typegen` in `apps/app` | Passed: regenerated route types. Ignored `.next/types` previously referenced task routes absent from this checkout.                                                                                                                                     |
| `bun run check`                   | Passed after regeneration: formatting, lint, four TypeScript projects, 10 unit tests and app/worker builds. The first run stopped on this report's formatting; the second on stale `.next/types`. Both issues were corrected before the successful run. |

## Not checked

- PostgreSQL-backed session, allowlist, logout, revocation, and shared rate-limit scenarios were skipped because the integration database was unavailable through `TEST_DATABASE_URL`.
- HTTP route behavior, cookie flags, Origin/CSRF handling, production deployment, and Telegram Android/iOS WebView behavior were not exercised by these domain tests.
- This change does not establish F01 completion or product decisions P-01/P-02/P-06.
