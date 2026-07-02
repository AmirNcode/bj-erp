# Navigation performance — findings & fix plan (2026-07-02)

> Status: **investigation only — nothing implemented.** Each fix below must be
> verified against current library docs (Context7) before coding, per CLAUDE.md.

## Symptom

Switching tabs takes **1–2 s** before the page appears (dev server, `npm run dev`).
The Next.js dev indicator shows "rendering…" the whole time. All authed screens
are affected; heavier pages (home, calendar) feel worst.

## Measured facts

- Supabase project lives in **eu-central-1**; from the dev machine one HTTPS
  round-trip to it costs **~65 ms warm, ~140 ms cold** (measured against
  `auth/v1/health`, 3 samples).
- Every navigation is a full server render (`force-dynamic` pages, cookies in
  every request) — nothing is reused between tab switches.

## Root cause: a serial waterfall of network round-trips on every navigation

One tab click on `/home` triggers, **in sequence**:

| # | Step | Where | Cost |
|---|------|-------|------|
| 1 | `auth.getUser()` — session validation | `proxy.ts` middleware, every request | 1 network RTT to Supabase Auth |
| 2 | `auth.getUser()` again | `lib/auth/context.ts` via the `(app)` layout guard | 1 more RTT (React `cache()` does not span middleware → RSC) |
| 3 | `user_roles` select | layout (`getCachedRoles`) | 1 RTT to Postgres |
| 4 | `profiles` select | page shell (`getCachedProfile`, for the greeting) | 1 RTT |
| 5 | board data (`Promise.all` of 4 reads) | Suspense child | ~1 RTT (parallel — already good) |
| 6 | pending approvals (managers/admins only) | Suspense child, after #5 | 1 RTT |

That is **5–6 serial legs × 65–140 ms ≈ 0.4–0.8 s of pure network wait**, before
React renders anything. On top of that, dev mode adds:

- **Compile-on-first-visit** — `next dev` compiles each route the first time it
  is opened (often 0.5–2 s per route, once per server start).
- **No prefetching** — `<Link>` prefetch and `router.prefetch()` are disabled in
  dev, so every click starts cold. (`RoutePrefetcher` is a no-op in dev.)

Together these fully explain the 1–2 s. **Production will be faster than dev by
default**, but the round-trip waterfall (root cause) ships to production too and
must be fixed.

A minor aggravator: the demo DB has accumulated e2e throwaway employees and
requests (calendar days showing 40–57 entries), which inflates calendar/home
query payloads. Cleanup tracked separately.

## Fix plan (ranked by impact ÷ effort — not yet implemented)

### P1 — Validate the session locally instead of over the network (saves ~2 RTTs)

Replace both `auth.getUser()` calls (middleware + `getCachedUser`) with
`auth.getClaims()`, which verifies the JWT **signature locally** (no network)
when the project uses **asymmetric JWT signing keys**.

- Prerequisite: switch the Supabase project from the legacy shared secret to
  the new JWT signing keys (dashboard → JWT keys migration). With the legacy
  secret, `getClaims()` silently falls back to a network call — verify which
  mode the project is in first.
- Security note: RLS remains the real enforcement layer (unchanged); the
  middleware/layout check only answers "is there a valid session?", which a
  locally verified signature answers just as strongly.
- supabase-js `^2.108` already ships `getClaims`; confirm exact usage via
  Context7 at implementation time.

### P2 — Put roles inside the JWT; parallelize what remains (saves 1–2 RTTs)

- Add a **Custom Access Token hook** (Supabase auth hook) that embeds the
  user's role slugs as a claim. The layout then reads roles from the (locally
  verified) token — the `user_roles` query per navigation disappears.
  Fallback if hooks are undesirable: cache roles per user in-process for
  30–60 s.
- In `home/page.tsx`, the greeting `profile` read (#4) blocks the shell; move
  it inside the Suspense boundary (or fetch it in parallel with roles via
  `Promise.all`) so the shell paints immediately.

### P3 — Reuse recently visited tabs (biggest perceived win for tab switching)

Configure the Next.js **client router cache** so a tab visited in the last
~30 s re-renders instantly from cache instead of re-fetching:
`staleTimes` for dynamic routes (Next 15 had it under `experimental.staleTimes`;
confirm the Next 16 location/name via Context7). The refresh pill
(`PageRefreshButton`) already gives users an explicit "get fresh data" action,
so a 30–60 s reuse window is safe for this app's data.

### P4 — Keep streaming fast paint (partially done, uncommitted)

`app/[locale]/(app)/loading.tsx` (currently uncommitted WIP) already shows an
instant skeleton on navigation — keep it. Optional later: Next 16 cache
components / PPR for a prefetchable static shell.

### P5 — Production placement (the big real-world lever)

- **Demo (Vercel):** pin the function region to Frankfurt (`fra1`) so the
  server↔Supabase legs drop to ~1–5 ms; only the single user↔Vercel leg
  remains user-visible.
- **Production (self-hosted):** run Next.js and Supabase on the same
  network/host at the company — the waterfall legs become sub-millisecond.
  This is why dev feels worst: the dev machine pays the full Iran↔Frankfurt
  RTT on every leg.

### P6 — Clean e2e test data out of the demo DB

Delete throwaway `mgr*/emp*/ovl*`-coded employees and their requests/ledger
rows (or reseed). Shrinks calendar/home payloads and unclutters the demo.

## Expected result

P1+P2 cut the per-navigation server work from 5–6 serial RTTs to **~1–2**
(page data only). P3 makes repeat tab switches near-instant. In production
(P5) remaining legs are intra-datacenter. Dev will still pay compile-on-first-
visit per route per server start — that part is normal and does not ship.

## Verification plan (when implementing)

1. Before/after: log `Server-Timing` (or simple `console.time`) around
   middleware auth, layout auth+roles, and page data; compare per-nav totals.
2. `npm run build` + `npm run test:unit` + full e2e (21 specs, serial) —
   especially `seed-roles`/`nav`/`approval` specs after the roles-claim change
   (role changes take effect on next token refresh, not instantly — decide
   whether that UX is acceptable or needs a forced refresh on role edit).
3. Manual: throttled network profile in devtools, fa + en, mobile + desktop.
