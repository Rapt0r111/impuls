# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Confirmed: 40 soldiers, aged 20–27, in a scientific company of the Russian Armed Forces; commanders assign tasks and award results.

## Product Purpose
Confirmed: track completed assigned work, award points, show a leaderboard and exchange points for rewards. Game-like presentation and animations are requested.

## Operating Context
Confirmed: intended product is a Telegram Mini App. Work ranges from websites and research projects to routine assignments. The current deliverable is a local presentation file with detailed project description and a visual demonstration, not a deployed service.

## Capabilities and Constraints
Confirmed proposed reward types: leave, acknowledgements, statuses, privileges and duty exemptions. Exact eligibility, authority and availability remain undecided. Demo must not imply any actual award or authorization.
Proposed assumptions for this presentation: two main roles plus administrator; multiple commanders; assignment and voluntary task pool; experience distinct from spendable points; every service reward requires explicit commander approval. These are design proposals, not confirmed policy.

## Stack
Presentation implementation choice: self-contained offline HTML/CSS/JavaScript and a Markdown project specification, built and checked with Bun. IMPLEMENTATION_PLAN.md fixes the production technical baseline: Bun workspaces and lockfile, Node.js runtime, Caddy HTTPS transport, PostgreSQL, Next.js App Router with Route Handlers, Tailwind v4 and adapted shadcn/ui/Radix components, Motion and Phosphor icons. It also fixes R1/R2 scope; organizational deployment and service-reward policy are still unapproved. No production backend, Telegram connection or real identities in the current delivery.

## Evidence on Hand
Only conversation brief. All sample names, task records, prices and analytics are illustrative. No official brand assets or real unit data provided.

## Product Principles
Clear reward criteria before work; confirmed results before accrual; auditable transactions; cooperative progress alongside competition; minimal data in Telegram.
