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

Presentation implementation choice: self-contained offline HTML/CSS/JavaScript and a Markdown project specification, built and checked with Bun. The technical direction in IMPLEMENTATION_PLAN.md and ADR-0001 is Bun workspaces and lockfile, Next.js App Router with Node.js Route Handlers on Vercel, Supabase-managed PostgreSQL, Tailwind v4 and adapted shadcn/ui/Radix components, Motion and Phosphor icons. The repository has workspaces, a Next.js access screen, F01 API routes and five access migrations. The F02 foundation adds exact-scope permission reads and a permissions API; assignment management and authorization on domain objects are not yet implemented. Vercel Project `impuls` is configured and linked to the local workspace; five Production environment variables are set as Secret. The selected existing Supabase project `Rapt0r111's Project` (organization Codex) runs PostgreSQL 17.6. A synthetic `GET /api/v1/me` request to Production returned `401` after a database lookup, confirming PostgreSQL connectivity from the deployed Function. A Telegram Web launch first reached the allowlist and returned `403`; after a test record was added, `POST /api/v1/auth/telegram` returned `200` and the access screen showed the test participant. This verifies one login path, not completed F01 or an approved pilot. Android/iOS WebView, full access revocation and an admitted production flow remain unverified. P-01/P-02 and the service-reward policy remain open.

After F02, a Telegram Web launch returned `200` from login and then `401` from the permissions API. ADR-0002 changes the session cookie attributes for embedded Telegram Web. After the Production deployment, the user supplied a Telegram Web screenshot showing confirmed access for the test participant. Android/iOS WebView remain unverified; see `docs/verification/2026-09-29-embedded-telegram-login.md`.

The next local implementation step adds a partial F03 task lifecycle: synthetic rules can bound task funds, a scoped creator can create a draft and assign an allowlisted user, the assignee can start and submit a report, and a different authorized reviewer can return it with a reason. The Mini App now shows assigned tasks and the report form. Acceptance and any XP or points transaction are not exposed; the migration and PostgreSQL race test still require execution before calling this a verified server flow. See `docs/verification/2026-09-29-f03-task-flow.md`.

## Evidence on Hand

Only conversation brief. All sample names, task records, prices and analytics are illustrative. No official brand assets or real unit data provided.

## Product Principles

Clear reward criteria before work; confirmed results before accrual; auditable transactions; cooperative progress alongside competition; minimal data in Telegram.
