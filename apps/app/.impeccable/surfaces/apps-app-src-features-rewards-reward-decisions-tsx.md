# Reward decisions

Mode: Operate. Primary target: apps/app/src/features/rewards/reward-decisions.tsx.

4 October expiry continuation: show the immutable explicit deadline in Moscow time, or state it is unset. The existing native selector gains “Истечение срока” only for a request with a deadline; the compact label fits 320 px. Server verification controls premature expiry and late approval; two specific conflict messages name the recovery. Recorded expiry returns points/place once; pending deadline alone does not claim a return. Same reason/checkbox/immutable replay and guard behavior. No CSS/tokens/motion change. Contract and evidence: docs/implementation/2026-10-04-f06-expiry-slice.md, docs/verification/2026-10-04-f06-expiry.md.

4 October pagination refinement: reader/scope/purpose-bound cursors, 400 invalid page or 409 changed queue, inline explanation naming the existing refresh action. Refresh trims older pages, keeps the first confirmed page on recoverable errors and restarts at the beginning. A 404 hides cached work rows. No visual tokens/layout/motion change. Evidence: docs/verification/2026-10-04-f06-pagination.md.

Extend the existing reward workspace and its navy/Manrope, flat divided rows, native selects, mint primary action, gold points and 44/48 px controls. The user confirmed the compact list and inline form. No visual identity or token change, new imagery, dependencies or motion.

Task: an exact-scope reward.decide actor reviews another participant's saved cosmetic request. Show recipient and saved terms before reserving-consumption/release consequences. Mandatory reason and checkbox precede a single explicit approve/reject/expire action. Approval copy must state issuance is still unconfirmed. Own requests are excluded server-side.

States: loading, empty, disabled/no authority, paginated, stale/offline, 401/403 revocation, 409 conflict, unknown outcome/manual immutable replay and 429 retry. Guard departure and prioritize the form in Telegram Back. Only fresh data starts a new decision. Current actor name is labeled in private owner history; UUIDs are supporting server identifiers, not the main UI.

Quality bar: match the incumbent reservation form's readable conditions, flat hierarchy, confirmation before financial operations, visible focus and 320 px wrapping. Code-led extension, no approved comp required. Inspect populated list/form at 320/360/390/1280, error/empty/disabled/unknown states and large text; save cropped target and viewport captures. Reference: docs/implementation/2026-10-03-f06-decisions-slice.md; ADR-0009.
