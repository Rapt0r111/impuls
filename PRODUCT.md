# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Confirmed: 40 soldiers, aged 20–27, in a scientific company of the Russian Armed Forces; commanders assign tasks and award results.

## Product Purpose

Confirmed: track completed assigned work, award points, show a leaderboard and exchange points for rewards. Game-like presentation and animations are requested.

## Operating Context

Confirmed: intended product is a Telegram Mini App. Work ranges from websites and research projects to routine assignments. The repository retains the local presentation and now contains an initial R1 service implementation. A test schema with no rows is installed in the selected existing Supabase project. A Vercel Production deployment is available at `https://impuls-eta.vercel.app`; the service is not admitted for real participants.

## Capabilities and Constraints

Confirmed proposed reward types: leave, acknowledgements, statuses, privileges and duty exemptions. Exact eligibility, authority and availability remain undecided. Demo must not imply any actual award or authorization.
Proposed assumptions for this presentation: two main roles plus administrator; multiple commanders; assignment and voluntary task pool; experience distinct from spendable points; every service reward requires explicit commander approval. These are design proposals, not confirmed policy.

## Stack

Presentation implementation choice: self-contained offline HTML/CSS/JavaScript and a Markdown project specification, built and checked with Bun. The technical direction in IMPLEMENTATION_PLAN.md and ADR-0001 is Bun workspaces and lockfile, Next.js App Router with Node.js Route Handlers on Vercel, Supabase-managed PostgreSQL, Tailwind v4 and adapted shadcn/ui/Radix components, Motion and Phosphor icons. The repository has workspaces, a Next.js access screen, F01 API routes and two auth migrations. Vercel Project `impuls` is configured and linked to the local workspace; five Production environment variables are set as Secret. The selected existing Supabase project `Rapt0r111's Project` (organization Codex) runs PostgreSQL 17.6; private `impuls` tables were last confirmed empty. A synthetic `GET /api/v1/me` request to Production returned `401` after a database lookup; this confirms PostgreSQL connectivity from the deployed Function. The app has not been tested in a real Telegram WebView or with an admitted Telegram identity. Approval of the data and deployment contour and service-reward policy remains open; no real identities are included.

## Evidence on Hand

Only conversation brief. All sample names, task records, prices and analytics are illustrative. No official brand assets or real unit data provided.

## Product Principles

Clear reward criteria before work; confirmed results before accrual; auditable transactions; cooperative progress alongside competition; minimal data in Telegram.
