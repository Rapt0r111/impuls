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

Presentation implementation choice: self-contained offline HTML/CSS/JavaScript and a Markdown project specification, built and checked with Bun. The technical direction in IMPLEMENTATION_PLAN.md and ADR-0001 is Bun workspaces and lockfile, Next.js App Router with Node.js Route Handlers on Vercel, Supabase-managed PostgreSQL, Tailwind v4 and adapted shadcn/ui/Radix components, Motion and Phosphor icons. The repository has workspaces, a Next.js access screen, F01 API routes and five access migrations. The F02 foundation adds exact-scope permission reads and a permissions API; assignment management and action/scope permission checks on task mutations are not yet implemented. Vercel Project `impuls` is configured and linked to the local workspace; five Production environment variables are set as Secret. The selected existing Supabase project `Rapt0r111's Project` (organization Codex) runs PostgreSQL 17.6. A synthetic `GET /api/v1/me` request to Production returned `401` after a database lookup, confirming PostgreSQL connectivity from the deployed Function. A Telegram Web launch first reached the allowlist and returned `403`; after a test record was added, `POST /api/v1/auth/telegram` returned `200` and the access screen showed the test participant. This verifies one login path, not completed F01 or an approved pilot. Android/iOS WebView, full access revocation and an admitted production flow remain unverified. P-01/P-02 and the service-reward policy remain open.

As of 30 September 2026, the source contains an F03 slice for reading assigned tasks, starting work and submitting a text report. Migrations 000006–000007 add synthetic rule versions, one R1 assignment per task, immutable submissions and idempotency records. Authenticated APIs and the report form validate ownership, session, version and request key; submission does not award XP or points. Local PostgreSQL 18.6 integration tests include real HTTP and a browser-to-database path under the runtime role; the selected Supabase PostgreSQL 17.6 project received both migrations and Production was updated on 30 September 2026. A synthetic deployed API test verified submission, idempotent replay, ownership and access revocation; its records were removed. PostgreSQL 17.6 CI, Telegram Android/iOS, creation/assignment operations, return, acceptance and accrual remain unverified or absent. F03/F04 and R1 remain incomplete; P-01…P-06 are still open.

## Evidence on Hand

Only conversation brief. All sample names, task records, prices and analytics are illustrative. No official brand assets or real unit data provided.

## Product Principles

Clear reward criteria before work; confirmed results before accrual; auditable transactions; cooperative progress alongside competition; minimal data in Telegram.

On 30 September 2026, an F01 cookie defect reported in Telegram Web was reproduced locally in a cross-site HTTPS iframe. ADR-0002 changes the session policy to HttpOnly, Secure, SameSite=None and Partitioned for both login and logout. Synthetic browser checks cover cookie transport, reload, top-level site isolation and logout; they do not establish production acceptance, PostgreSQL integration or Android/iOS compatibility. Results are recorded in docs/verification/2026-09-30-telegram-web-session.md. P-01…P-06 remain open.
