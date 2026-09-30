# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Confirmed: 40 soldiers, aged 20–27, in a scientific company of the Russian Armed Forces; commanders assign tasks and award results.

## Product Purpose

Confirmed: track completed assigned work, award points, show a leaderboard and exchange points for rewards. Game-like presentation and animations are requested.

## Operating Context

Confirmed: intended product is a Telegram Mini App. Work ranges from websites and research projects to routine assignments. The repository retains the local presentation and now contains an initial R1 service implementation. A test schema is installed in the selected existing Supabase project. A Vercel Production deployment is available at `https://impuls-eta.vercel.app`; a pilot for real participants has not been approved.

## Capabilities and Constraints

Confirmed proposed reward types: leave, acknowledgements, statuses, privileges and duty exemptions. Exact eligibility, authority and availability remain undecided. Demo must not imply any actual award or authorization.
Proposed assumptions for this presentation: two main roles plus administrator; multiple commanders; assignment and voluntary task pool; experience distinct from spendable points; every service reward requires explicit commander approval. These are design proposals, not confirmed policy.

## Stack

Presentation implementation choice: self-contained offline HTML/CSS/JavaScript and a Markdown project specification, built and checked with Bun. The technical direction in IMPLEMENTATION_PLAN.md and ADR-0001 is Bun workspaces and lockfile, Next.js App Router with Node.js Route Handlers on Vercel, Supabase-managed PostgreSQL, Tailwind v4 and adapted shadcn/ui/Radix components, Motion and Phosphor icons. The repository has workspaces, a Next.js access screen, F01 API routes and five access migrations. The F02 foundation adds exact-scope permission reads and a permissions API; local F03 slices add scoped review, synthetic acceptance, task creation and assignment. Assignment management is implemented locally in migration 000010 and has not been deployed; its verification status is recorded below. Vercel Project `impuls` is configured and linked to the local workspace; five Production environment variables are set as Secret. The selected existing Supabase project `Rapt0r111's Project` (organization Codex) runs PostgreSQL 17.6. A synthetic `GET /api/v1/me` request to Production returned `401` after a database lookup, confirming PostgreSQL connectivity from the deployed Function. A Telegram Web launch first reached the allowlist and returned `403`; after a test record was added, `POST /api/v1/auth/telegram` returned `200` and the access screen showed the test participant. This verifies one login path, not completed F01 or an approved pilot. Android/iOS WebView, full access revocation and an admitted production flow remain unverified. P-01/P-02 and the service-reward policy remain open.

As of 30 September 2026, the source contains an F03 slice for reading assigned tasks, starting work and submitting a text report. Migrations 000006–000007 add synthetic rule versions, one R1 assignment per task, immutable submissions and idempotency records. Authenticated APIs and the report form validate ownership, session, version and request key; submission does not award XP or points. Local PostgreSQL 18.6 integration tests include real HTTP and a browser-to-database path under the runtime role; the selected Supabase PostgreSQL 17.6 project received both migrations and Production was updated on 30 September 2026. A synthetic deployed API test verified submission, idempotent replay, ownership and access revocation; its records were removed. PostgreSQL 17.6 CI for subsequent changes and Telegram Android/iOS remain unverified; deployed creation/assignment, return, acceptance and accrual remain absent. The new local return slice is documented below. F03/F04 and R1 remain incomplete; P-01…P-06 are still open.

## Evidence on Hand

The next F03 slice adds migration 000008, a scoped review queue, immutable return decisions with required reasons, and a participant view of the latest return. It checks active review permission and session before idempotent replay, forbids a decision on one's own result, and serializes competing returns in PostgreSQL. Local production-server checks include a reviewer return, participant revision and resubmission through real APIs and PostgreSQL 18.6; synthetic browser checks cover mobile states and a 20-record queue. These new changes have not been deployed to Supabase/Vercel. This records the earlier return-only slice. Full history and F03/F04 completion remain outstanding; the subsequent synthetic acceptance slice follows. Details and exact commands are in docs/verification/2026-09-30-f03-returns.md. No new product policy is approved.

The subsequent local F03/F04 slice adds migration 000009: synthetic acceptance credits the saved task fund into separate immutable XP/points entries, updates the account projection, and records audit and neutral outbox in one transaction. A server flag (off by default) and explicitly synthetic rule version gate acceptance; neither approves real economics or a pilot. The reviewer confirms recipient, funds and version before submitting a reason; the participant can read confirmed balances and their own paginated journal. Local PostgreSQL 18.6 checks include conflicting decisions, concurrent credits, expiry during balance-lock waits, rollback, consistent reads and an actual browser-to-API-to-database flow. These changes are not deployed to Supabase/Vercel. Corrections, spending, full history, notification delivery, PostgreSQL 17.6 CI and physical Telegram devices remain outside this evidence. P-01…P-06 and phase completion remain open. Exact commands and limits: docs/verification/2026-09-30-f03-acceptance.md.

The local F02/F03 task-management slice adds migration 000010 and server operations for creating a draft and assigning it within an exact scope. `task.create` and `task.assign` remain separate permissions; assignment also requires an active synthetic scope membership that runtime code cannot change. Both operations are gated by `SYNTHETIC_TASK_MANAGEMENT_ENABLED` (off by default) and effective synthetic rules. Assignment writes audit and neutral outbox atomically and does not credit XP or points. Local PostgreSQL 18.6 integration and HTTP tests pass under `impuls_app`, and the browser-to-API-to-database creation/assignment path passes. Browser checks cover 320/360/390 px, keyboard activation and a synthetic large-text stress case. The slice has not been deployed to Supabase/Vercel and has not been checked on physical Telegram Android/iOS. The evidence report records exact commands at `docs/verification/2026-09-30-f03-task-management.md`. Full task history, editing/cancellation, mutation rate limits, PostgreSQL 17.6 CI, P-01…P-06 and F02/F03/R1 completion remain open.

Product requirements originate from the conversation brief. All sample names, task records, prices and analytics are illustrative. No official brand assets or real unit data provided.

The next local F03 extension exposes every submitted report and its review through an owner-only paginated API and an inline history below the report form. It uses existing immutable submissions/reviews, checks the active session and assignment again in the domain query, and preserves the unsent report while refreshing or paging. Return reasons, reviewers, decision times and separate accepted XP/points snapshots are visible. This is report/review history; creation, assignment, start, editing and cancellation history remain outside the slice. No schema, dependency, product-policy or deployment change is introduced. Verification and limits: `docs/verification/2026-09-30-f03-report-history.md`.

## Product Principles

Clear reward criteria before work; confirmed results before accrual; auditable transactions; cooperative progress alongside competition; minimal data in Telegram.

On 30 September 2026, an F01 cookie defect reported in Telegram Web was reproduced locally in a cross-site HTTPS iframe. ADR-0002 changes the session policy to HttpOnly, Secure, SameSite=None and Partitioned for both login and logout. Synthetic browser checks cover cookie transport, reload, top-level site isolation and logout; they do not establish production acceptance, PostgreSQL integration or Android/iOS compatibility. Results are recorded in docs/verification/2026-09-30-telegram-web-session.md. P-01…P-06 remain open.
