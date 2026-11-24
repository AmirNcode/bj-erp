# Faster and faster-feeling app on slow links

**Date:** 2026-11-24 · **Branch:** none yet (work starts from `main`) ·
**Status:** draft for owner review. Decisions below were made in chat on 2026-11-24.

## 1. Why

Users report the app is slow. Their internet is slow (owner estimate 1–5 Mbps, not yet
measured); the Liara VM itself is fast (Tehran speedtest 2026-11-24: ~850 Mbps down, 3 ms).
Two problems add up:

1. **Real cost per request is high.** `deploy/liara/Caddyfile` forces HTTP/1.1 (`protocols h1`)
   and `header Connection close`, so every request (page, script, font, data call) opens a new
   TCP + TLS connection. On a slow, high-latency link each handshake costs several round trips,
   and a page makes dozens of requests. This was a workaround for stalls seen **from Canada**
   (`docs/DEPLOY-LIARA.md` "HTTPS currently uses HTTP/1.1…"; cause never confirmed), not for
   users in Iran.
2. **Taps feel dead.** Many buttons and links show nothing until the server answers, so a slow
   answer reads as "the app ignored me". Only one generic `app/[locale]/(app)/loading.tsx`
   exists.

Success = a user on a slow Iranian mobile connection sees a reaction to every tap at once, and
pages and saves finish noticeably sooner than today.

## 2. Goals, non-goals, anti-goals

**Goals**
- Fewer and cheaper connections between users and the server.
- Every tap shows visible feedback right away (pressed / working state).
- Static files (JS, CSS, fonts, icons) download once per release, not on every visit.
- With no connection, the app opens to a clear "no connection" page instead of a browser error.

**Non-goals (this round)**
- Caching any page HTML or data on the device (ERP offline levels 2 and 3, §8).
- HTTP/3 (needs UDP 443; Liara VM allows only TCP 80/443 inbound).
- A CDN, a second server, or moving hosts.
- Changing Next's default link prefetching.
- Upload changes (chunked / resumable uploads, §8).

**Anti-goals (would be a failure even if it works)**
- Any employee, leave, price or guarantee data stored on the device by our code.
- Losing the owner's access from Canada with no workaround.
- A stale app after a deploy (users stuck on old JS that no longer matches the server).
- Buttons that can be pressed twice and submit twice.

## 3. Constraints

- Owner decision (2026-11-24): **users in Iran come first.** If a network change helps Iran but
  stalls from Canada, keep it; the owner reaches the app through a VPN or SSH tunnel and we
  revisit if that is not easy enough.
- Push to `main` deploys to Liara; config-only Caddy changes ship the same way and are undone by
  reverting the commit.
- Next 16.4.6 / React 19.2.4. Verify `useLinkStatus`, `loading.tsx` and service-worker guidance in
  `node_modules/next/dist/docs/` before coding (Context7 was unreachable when this was written).
- CSP already allows `worker-src 'self' blob:`; `proxy.ts` matcher skips paths with a dot, so
  `/sw.js` and `/offline.html` are not touched by next-intl.
- UI follows `docs/DESIGN.md` (Blueprint); new strings in `fa` + `en`.

## 4. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Three parts, shipped separately: network → tap feedback → offline level 1** | Each part measured on its own; easy to undo the network part | **Chosen** |
| B. One release with everything | Faster to ship, but no way to tell what helped or what broke | Dropped |
| C. Service worker via Serwist | Full-featured, but a build plugin with uncertain Next 16/Turbopack support; we need ~60 lines | Dropped |
| D. Third-party top-of-page loading bar | Another dependency; App Router has no clean route-change events | Dropped (use `useLinkStatus` + `loading.tsx`) |

## 5. Part 1 — Network (Caddy, Liara only)

Change `deploy/liara/Caddyfile` in two steps, each deployed and tested before the next:

- **1a.** Remove `header Connection close` (allow keep-alive). Change `encode gzip` to
  `encode zstd gzip`.
- **1b.** Change `protocols h1` to `protocols h1 h2`.

**Test after each step** (owner arranges the Iran side):
- From Iran: one mobile network (MCI or Irancell) and the company office network. Log in, open
  Home, Request, Sales list, one Sales record, upload and download a file.
- From Canada: the same, directly.
- Record per network: works / stalls, and rough time to open Home and the Sales list (stopwatch
  is enough) compared with before.

**Outcomes**
- Iran works, Canada works → keep.
- Iran works, Canada stalls → keep (owner decision); write the Canada workaround into
  `docs/DEPLOY-LIARA.md`; revisit if it is not easy.
- Iran stalls → revert that step.

Update the HTTP/1.1 paragraph in `docs/DEPLOY-LIARA.md` with the result. Private listener
(`:8080`) and local `deploy/caddy/Caddyfile` stay unchanged.

## 6. Part 2 — Tap feedback

1. **`Button` gets `pending?: boolean`** (`components/ui/button.tsx`): when true the button is
   disabled, shows a small spinner before its label, sets `aria-busy`, and keeps its width (no
   layout jump). Every button that starts a server action or fetch passes its pending state
   (`useTransition` / `useFormStatus` / local state). The builder audits the ~100 files using
   `<Button` and fixes those that save without feedback or can submit twice.
2. **Pending links:** a small `LinkPending` indicator (uses `useLinkStatus`, so it sits inside
   the `<Link>`) on the side nav and phone bottom tabs (`MainNav`), section tabs (`lib/ui/tabs.ts`
   users) and list rows that open a record (Sales list, Manage › Requests, Approvals). The tapped
   item looks pressed/working until the new page renders.
3. **Section skeletons:** `loading.tsx` for the main sections whose pages fetch the most —
   at least Home, Request, Manage, Approvals (`manage/approvals`), Sales list, Sales record
   (`sales/[id]`), Sales reports. Shapes match each page (table skeleton for lists, card
   skeletons for forms) using `components/Skeletons.tsx`. The existing `(app)/loading.tsx` stays
   as the fallback.
4. **Optimistic updates (optional, small):** only for single-field actions where undo is obvious
   (e.g. a checkbox or status toggle). The plan lists candidates; none are required.

## 7. Part 3 — Offline level 1 (whole app)

A hand-written service worker, `public/sw.js`, registered from a small client component in the
root layout (production only; never in `next dev`).

- **Cache first:** `/_next/static/*` (file names change per build, so safe), `/icons/*`,
  `/bj-logo.png`. One cache (e.g. `bj-static-v1`), trimmed to a fixed number of entries so old
  builds don't pile up.
- **Allowlist only:** the worker caches nothing outside the paths above. Every other request is
  left alone: the worker returns without `respondWith`, so the browser handles it directly (keeps
  file uploads streaming and avoids a second hop). This includes page HTML, App Router RSC fetches
  (GET to page paths with `RSC: 1` / `?_rsc=`), `/api/*`, `/rest/v1/*`, `/auth/v1/*`, `/print/*`,
  and any non-GET request. Only `200` same-origin responses are stored.
- **Offline page:** `public/offline.html`, precached on install. Plain static HTML in Farsi + English
  (logo, "No connection — try again", a reload button), no app data. The one exception to the
  allowlist rule: navigation requests (`request.mode === 'navigate'`) go through the worker, are
  fetched from the network unchanged and never stored; only if that fetch fails with a network
  error does the worker return the offline page.
- **Updates:** `/sw.js` served with `Cache-Control: no-cache` (header in `next.config.ts`) so a
  deploy is picked up on the next visit; new worker activates immediately (`skipWaiting` +
  `clients.claim`) — safe because it holds only immutable files.
- **Kill switch:** documented in `docs/DEPLOY-LIARA.md`: if the worker misbehaves, deploy a
  `sw.js` that clears its caches and unregisters itself.
- Logout and View as need no change: no data is cached.

## 8. Later (noted, not in this round)

- **ERP offline level 2 — local read cache:** Sales list and recently opened records saved in
  IndexedDB, shown instantly, refreshed in the background, read-only offline. Must cache prices /
  guarantees only for users allowed to see them, wipe on logout and on View as, and expire
  quickly (shared devices).
- **ERP offline level 3 — offline edits:** queued writes sent on reconnect. Hard: conflicting
  edits, item numbers (`project_nodes.code`) assigned offline, server checks (closed records,
  permissions) running late.
- **Uploads on slow links:** 1 Mbps ≈ 125 KB/s, below the ~170 KB/s a 50 MB upload needs within
  Node's 300 s `requestTimeout`. Revisit (chunked / resumable upload or a longer timeout) once
  user speeds are measured.
- **HTTP/3** if Liara opens UDP 443.

## 9. Left to the builder

- Exact spinner look and the `LinkPending` style (within DESIGN.md: no shadows, no pills).
- Which buttons need fixing (from the audit) and which list rows get `LinkPending`.
- Skeleton shapes per section.
- Cache entry limit and how trimming is done.
- Whether optimistic updates are worth doing anywhere this round.
- Tests: unit test for `Button` pending (disabled + `aria-busy`); a Playwright check that a tapped
  save button disables at once; a check that `/sw.js` never stores a navigation or `/rest/v1`
  response.
