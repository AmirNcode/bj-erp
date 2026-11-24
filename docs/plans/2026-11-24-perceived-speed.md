# Speed on Slow Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app faster and faster-feeling for users on slow Iranian connections: cheaper connections to Liara, instant feedback on every tap, static files kept on the device, and an offline page.

**Architecture:** Three parts shipped separately. Part 1 changes only `deploy/liara/Caddyfile`, in two deploys with an owner test gate after each. Part 2 adds a `pending` state to the shared `Button`, a `LinkPending` hint inside links, transition-based row pending, and per-section `loading.tsx`. Part 3 adds a hand-written allowlist-only service worker (`public/sw.js`) plus a static `public/offline.html`.

**Tech Stack:** Caddy 2.11.4, Next 16.4.6 App Router, React 19.2.4, Vitest + Testing Library (jsdom, no jest-dom), lucide-react, Playwright.

**Spec:** `docs/specs/2026-11-24-perceived-speed-design.md`

## Global Constraints

- Users in Iran come first. If a Caddy step works from Iran but stalls from Canada, keep it and document the Canada workaround (VPN or SSH tunnel). If it stalls from Iran, revert that step.
- Only `deploy/liara/Caddyfile`'s public site block changes. The private `http://:8080` listener and `deploy/caddy/Caddyfile` stay unchanged. No HTTP/3.
- The service worker caches **only** `/_next/static/*`, `/icons/*`, `/bj-logo.png` and `/offline.html`. It must never call `respondWith` for any other request, except navigations (network pass-through, offline page on network error, never stored).
- No employee, leave, price or guarantee data stored on the device by our code.
- Service worker registers in production builds only, never under `next dev`.
- UI follows `docs/DESIGN.md`: no `shadow-*`, no pills, `rounded-full` only for circles, light only. New user-facing strings in `messages/fa.json` + `messages/en.json` (offline page is static HTML: Farsi + English in the file itself).
- Verify Next APIs against `node_modules/next/dist/docs/` (`03-api-reference/04-functions/use-link-status.md`, `02-guides/progressive-web-apps.md`). `useLinkStatus` must be used inside a descendant of `<Link>`; render the hint always and toggle opacity (no layout shift).
- Push to `main` deploys to Liara. Each part goes through a PR; merge only on the owner's OK. Commit steps below run on the feature branch as part of executing this approved plan.
- Log the session in `docs/AGENT-LOG.md` before finishing.

## Review Focus

1. **Login redirect through the worker:** a navigation that the server answers with a redirect (signed-out user opening `/fa/home`) must still redirect. Test: navigation response is returned unchanged even when its `type` is `opaqueredirect` (Task 7).
2. **Deploy while a tab is open:** old chunk URLs return 404 after a deploy; the worker must not store or serve a 404, so Next can hard-reload. Test: non-200 static response is not stored (Task 7).
3. **File uploads and downloads under the worker:** `POST /api/sales/files/...` (raw body stream) and `GET /api/...` downloads must bypass the worker. Tests: POST and `/api` GET get no `respondWith` (Task 7).
4. **Double submit on a slow link:** a second tap while saving must not fire again. Test: `onClick` not called while `pending` (Task 3).
5. **Soft navigation data (RSC) and PostgREST reads:** must never be cached (they carry personal data and would go stale after View as / logout). Tests: `?_rsc=` GET and `/rest/v1/` GET get no `respondWith` (Task 7).

---

### Task 1: Caddy step 1a — keep-alive + zstd

**Files:**
- Modify: `deploy/liara/Caddyfile` (public `https://{$APP_HOST}` block)
- Test: `tests/deploy/liara-config.test.sh` (append)

**Interfaces:** none.

- [ ] **Step 1: Branch** — `git checkout -b perf/caddy-keepalive main`.
- [ ] **Step 2: Write the failing test** — append to `tests/deploy/liara-config.test.sh`:

```bash
CADDY="$ROOT/deploy/liara/Caddyfile"
public_block=$(sed -n '/^https:\/\/{\$APP_HOST}/,/^}/p' "$CADDY")
! grep -q 'Connection close' <<<"$public_block" || { echo 'not ok - public block still closes connections'; exit 1; }
grep -qE '^\s*encode zstd gzip\s*$' <<<"$public_block" || { echo 'not ok - public block must encode zstd gzip'; exit 1; }
docker run --rm -e APP_HOST=example.invalid -v "$CADDY:/etc/caddy/Caddyfile:ro" caddy:2.11.4-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
echo 'ok - Liara Caddyfile keeps connections open, compresses with zstd, and validates'
```

- [ ] **Step 3: Run it** — `bash tests/deploy/liara-config.test.sh` → Expected: `not ok - public block still closes connections`.
- [ ] **Step 4: Edit `deploy/liara/Caddyfile`** — delete the `header Connection close` line and its comment; change `encode gzip` to `encode zstd gzip`. Leave `protocols h1` (and its comment) for Task 2.
- [ ] **Step 5: Run it** — `bash tests/deploy/liara-config.test.sh` → Expected: both `ok - …` lines. Then `npm run test:deploy` → all pass.
- [ ] **Step 6: Commit + PR** — commit `perf(liara): keep public connections open and add zstd`; open PR; owner merges → CI deploys.
- [ ] **Step 7: Owner gate (manual, blocks Task 2).** Owner tests per spec §5 from an Iranian mobile network, the office network, and Canada: log in, Home, Request, Sales list, one record, upload + download a file; note works/stalls and rough load time vs before. Iran stalls → revert PR, stop Part 1, report. Record the result in `docs/AGENT-LOG.md`.

### Task 2: Caddy step 1b — HTTP/2

**Files:**
- Modify: `deploy/liara/Caddyfile` (global `servers` block)
- Modify: `docs/DEPLOY-LIARA.md` ("HTTPS currently uses HTTP/1.1…" paragraph)
- Test: `tests/deploy/liara-config.test.sh`

**Interfaces:** none. Starts only after Task 1's owner gate passed from Iran.

- [ ] **Step 1: Branch** — `git checkout -b perf/caddy-h2 main`.
- [ ] **Step 2: Write the failing test** — append:

```bash
grep -qE '^\s*protocols h1 h2\s*$' "$CADDY" || { echo 'not ok - public server must offer h1 h2'; exit 1; }
echo 'ok - Liara Caddyfile offers HTTP/2'
```

- [ ] **Step 3: Run it** → Expected: `not ok - public server must offer h1 h2`.
- [ ] **Step 4: Edit** — `protocols h1` → `protocols h1 h2`; replace its comment with one line: date + "re-enabled for users in Iran; see DEPLOY-LIARA.md".
- [ ] **Step 5: Run** `npm run test:deploy` → all pass.
- [ ] **Step 6: Commit + PR**, owner merges → deploy.
- [ ] **Step 7: Owner gate** (same checks as Task 1 Step 7). Iran stalls → revert this PR only.
- [ ] **Step 8: Docs** — rewrite the DEPLOY-LIARA paragraph with the measured outcome of 1a and 1b (per network: works/stalls, rough times), and if Canada stalls, the workaround the owner uses. Commit `docs: Liara HTTP/2 + keep-alive results [skip ci]`.

### Task 3: `Button` pending state

**Files:**
- Modify: `components/ui/button.tsx`
- Test: `tests/unit/button-pending.test.tsx` (create)

**Interfaces:**
- Produces: `Button` accepts `pending?: boolean`. When `true`: `disabled` (or `aria-disabled="true"` with `asChild`), `aria-busy="true"`, `data-pending=""`, and (not `asChild`) a `<Loader2 data-slot="button-spinner" aria-hidden className="animate-spin" />` centred over the label while the label stays in the DOM with `visibility: hidden` so the width does not change. Base classes gain `relative` and a pressed look (`active:brightness-95`).

- [ ] **Step 1: Write the failing tests** (`cleanup` after each; no jest-dom):

```tsx
it('pending disables the button and marks it busy', () => {
  render(<Button pending>Save</Button>);
  const b = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  expect(b.disabled).toBe(true);
  expect(b.getAttribute('aria-busy')).toBe('true');
});
it('pending shows a spinner and keeps the label', () => {
  const { container } = render(<Button pending>Save</Button>);
  expect(container.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
  expect(screen.getByText('Save')).toBeTruthy();
});
it('not pending: enabled, no spinner, no aria-busy', () => {
  const { container } = render(<Button>Save</Button>);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  expect(container.querySelector('[data-slot="button-spinner"]')).toBeNull();
  expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
});
it('click while pending does not fire onClick', () => {
  const onClick = vi.fn();
  render(<Button pending onClick={onClick}>Save</Button>);
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).not.toHaveBeenCalled();
});
it('asChild + pending marks the child busy without a spinner', () => {
  const { container } = render(<Button asChild pending><a href="/x">Go</a></Button>);
  const a = screen.getByText('Go');
  expect(a.getAttribute('aria-busy')).toBe('true');
  expect(a.getAttribute('aria-disabled')).toBe('true');
  expect(container.querySelector('[data-slot="button-spinner"]')).toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/button-pending.test.tsx` → Expected: FAIL (no `pending` prop).
- [ ] **Step 3: Implement** in `components/ui/button.tsx` per Interfaces. Do not forward `pending` to the DOM.
- [ ] **Step 4: Run** the test → PASS; then `npm run test:unit` → no regressions.
- [ ] **Step 5: Commit** on branch `feat/speed-feedback` (create from `main`): `feat(ui): Button pending state`.

### Task 4: Pending links and rows

**Files:**
- Create: `components/LinkPending.tsx`
- Modify: `app/[locale]/(app)/_components/MainNav.tsx` (side links, bottom-bar tabs, Profile tab, Manage items)
- Modify: tab components using `tabClass` / `subTabClass` with `<Link>`: `settings/_components/SettingsTabs.tsx`, `sales/_components/SalesTabs.tsx`, `profile/_components/ProfileTabs.tsx`, `admin/_components/AdminTabs.tsx`, and any other `<Link>` tab found by `grep -rln "tabClass" app`
- Modify: `app/[locale]/(app)/sales/_components/RecordsTable.tsx` (row `onClick` → transition)
- Modify: list rows in `manage/requests/RequestsReview.tsx`, `manage/approvals/ApprovalQueue.tsx` that open another page
- Test: `tests/unit/link-pending.test.tsx` (create)

**Interfaces:**
- Produces: `export function LinkPending({ className }: { className?: string }): JSX.Element` — `'use client'`; calls `useLinkStatus()` from `next/link`; always renders `<span aria-hidden="true" data-slot="link-pending" data-pending={pending ? 'true' : 'false'}>` containing a small `Loader2` (`size-3.5 animate-spin`), absolutely positioned (caller's link gets `relative`), `opacity-0` → `opacity-100` when pending. Must be rendered inside a `<Link>`.
- Row pattern (no `<Link>`): `const [isPending, startTransition] = useTransition(); const [openingId, setOpeningId] = useState<string|null>(null);` row click → `setOpeningId(id); startTransition(() => router.push(href));` row with `id === openingId && isPending` gets `data-pending` + `opacity-60` and a `LinkPending`-styled spinner (reuse the same `Loader2` classes).

- [ ] **Step 1: Write the failing tests:**

```tsx
const status = { pending: false };
vi.mock('next/link', () => ({ useLinkStatus: () => status }));
it('hidden hint when idle', () => {
  const { container } = render(<LinkPending />);
  const s = container.querySelector('[data-slot="link-pending"]')!;
  expect(s.getAttribute('data-pending')).toBe('false');
  expect(s.getAttribute('aria-hidden')).toBe('true');
});
it('shows the hint while the link is pending', () => {
  status.pending = true;
  const { container } = render(<LinkPending />);
  expect(container.querySelector('[data-slot="link-pending"]')!.getAttribute('data-pending')).toBe('true');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/link-pending.test.tsx` → FAIL (module missing).
- [ ] **Step 3: Implement** `components/LinkPending.tsx` per Interfaces.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Wire it in** — add `<LinkPending />` inside each nav/tab `<Link>` listed above (add `relative` where missing; on the phone bottom bar place it at the icon's top end corner so it doesn't cover the label). Apply the row pattern to `RecordsTable` and to the Manage rows that navigate. Add `active:` pressed classes to nav links (`active:opacity-80`).
- [ ] **Step 6: Verify** — `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` pass; `npx playwright test tests/e2e/nav.spec.ts --workers=1` passes (nav testids unchanged).
- [ ] **Step 7: Commit** `feat(ui): pending hint on nav, tabs and list rows`.

### Task 5: Buttons that save show pending

**Files:**
- Modify: every client component where a `<Button>` starts a server action, `fetch`, or `router.refresh()` and does not already disable itself while running (audit of the ~100 files matching `grep -rl "<Button" app components`).

**Interfaces:**
- Consumes: `Button`'s `pending` (Task 3).

- [ ] **Step 1: Audit** — list each such button as `file:line — action — current state (none / disabled only / has spinner)` in the PR description. Buttons already wired to `useTransition`/`useFormStatus`/`busy` state switch from `disabled={x}` to `pending={x}`; buttons with no state get a `useTransition` (or `useFormStatus` inside a `<form action>`).
- [ ] **Step 1b: Optimistic-update candidates** (spec §6.4, optional): list single-field toggles where instant update + rollback is obvious (e.g. `manage/requests/TravelTickToggle.tsx`) in the PR description. Implement none unless the owner asks.
- [ ] **Step 2: Fix them** — Sales pages and the four request forms first, then Manage, Settings, Profile, Admin.
- [ ] **Step 3: Verify** — `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` pass. Existing e2e that click saves still pass: `npx playwright test tests/e2e/leave.spec.ts tests/e2e/settings.spec.ts tests/e2e/sales-products.spec.ts --workers=1` (needs local stack; skip with a note if unavailable).
- [ ] **Step 4: Browser check** on the `:3501` stack with DevTools network throttled to "Slow 4G": tap Save on a Sales record stage page and on a leave request → button shows spinner at once and cannot be tapped twice. Screenshot both for the PR.
- [ ] **Step 5: Commit** `feat(ui): show pending on save buttons`.

### Task 6: Section loading skeletons

**Files:**
- Modify: `components/Skeletons.tsx` (add `TableSkeleton`)
- Create `loading.tsx` in `app/[locale]/(app)/`: `home/`, `request/`, `manage/requests/`, `manage/approvals/`, `manage/employees/`, `sales/`, `sales/[id]/`, `sales/reports/`
- Test: `tests/unit/skeletons.test.tsx` (create)

**Interfaces:**
- Produces: `export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number })` — a real `<table className="data-table">` with one header row and `rows` body rows of `cols` `Skeleton` cells, root `aria-hidden`.

- [ ] **Step 1: Failing test:**

```tsx
it('TableSkeleton draws a data-table with the asked rows and cols', () => {
  const { container } = render(<TableSkeleton rows={4} cols={3} />);
  expect(container.querySelector('table.data-table')).not.toBeNull();
  expect(container.querySelectorAll('tbody tr').length).toBe(4);
  expect(container.querySelectorAll('tbody tr:first-child td').length).toBe(3);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/skeletons.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `TableSkeleton`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Add the `loading.tsx` files** — lists (`sales/`, `manage/*`) use a title bar `Skeleton` + `TableSkeleton`; the Sales list root carries `data-wide` like its page; `sales/[id]/` uses `CardSkeleton`s; `home/` uses `BoardSkeleton`; `request/` uses `FormSkeleton`; `sales/reports/` uses `CardSkeleton`s. Server components, no data, no translations needed.
- [ ] **Step 6: Verify** — `npx tsc --noEmit`, `npm run build` pass; on `:3501` with "Slow 4G", tapping each section shows its skeleton at once.
- [ ] **Step 7: Commit** `feat(ui): per-section loading skeletons`.

### Task 7: Service worker + offline page

**Files:**
- Create: `public/sw.js`, `public/offline.html`, `components/ServiceWorkerRegister.tsx`
- Modify: `app/[locale]/layout.tsx` (mount `<ServiceWorkerRegister />` in `<body>`), `next.config.ts` (`headers()`), `docs/DEPLOY-LIARA.md` (kill switch section)
- Test: `tests/unit/service-worker.test.ts` (create)

**Interfaces:**
- `public/sw.js` (plain JS, no imports): `CACHE = 'bj-static-v1'`, `MAX_ENTRIES = 300`, `OFFLINE = '/offline.html'`.
  - `install`: `waitUntil(caches.open(CACHE).then(c => c.add(OFFLINE)))`, `self.skipWaiting()`.
  - `activate`: delete caches whose name starts with `bj-static-` and is not `CACHE`; `self.clients.claim()`.
  - `fetch`: return (no `respondWith`) if method ≠ `GET` or origin ≠ `self.location.origin`. If `request.mode === 'navigate'`: `respondWith(fetch(request).catch(() => caches.match(OFFLINE)))`, store nothing. If path starts `/_next/static/` or `/icons/`, or equals `/bj-logo.png` or `OFFLINE`: cache-first; on miss fetch, store only if `res.status === 200 && res.type === 'basic'`, then trim the cache to `MAX_ENTRIES` by deleting the oldest keys (`cache.keys()` order). Anything else: return without `respondWith`.
- `ServiceWorkerRegister`: `'use client'`, returns `null`; in `useEffect`, if `process.env.NODE_ENV === 'production'` and `'serviceWorker' in navigator`, `navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })`, errors swallowed.
- `next.config.ts` headers: `/sw.js` → `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Type: application/javascript; charset=utf-8`; `/offline.html` → `Cache-Control: no-cache`.
- `public/offline.html`: `<html lang="fa" dir="rtl">`, inline `<style>` only (CSP allows inline styles), `<img src="/bj-logo.png">`, Farsi line «اتصال به اینترنت برقرار نیست» + English "No internet connection", a link «تلاش دوباره / Try again» to `/`. No script. Colours `#2E3C92` / `#F7F8FB`, system fonts.

- [ ] **Step 1: Write the failing tests** — load `public/sw.js` into `node:vm` with a fake `self` (`location.origin = 'https://bjeng.app'`, `addEventListener` capturing handlers, `skipWaiting`, `clients.claim` as `vi.fn()`), a Map-backed fake `caches` (`open`, `match`, `keys`, `delete`, `put`, `add`), and a mocked `fetch`. Requests are plain objects `{ url, method, mode, headers }`; the event is `{ request, respondWith: vi.fn(), waitUntil: vi.fn() }`. Tests:
  - `leaves POST /api/sales/files/x alone` → `respondWith` not called.
  - `leaves GET /api/sales/files/x alone` → not called.
  - `leaves GET /rest/v1/profiles alone` → not called.
  - `leaves RSC fetch GET /fa/sales?_rsc=abc (mode cors) alone` → not called.
  - `leaves cross-origin GET alone` → not called.
  - `navigation returns the network response and stores nothing` → resolves to fetch's response; cache size unchanged.
  - `navigation passes a redirect through unchanged` → fetch resolves `{ type: 'opaqueredirect', status: 0 }`; respondWith resolves to that same object.
  - `navigation offline returns /offline.html` → fetch rejects; resolves to the cached offline response.
  - `static file is cache-first` → two requests for `/_next/static/chunks/a.js`; `fetch` called once.
  - `non-200 static response is not stored` → fetch resolves `{ status: 404, type: 'basic' }`; cache has no entry.
  - `cache trims to 300 entries` → 301 distinct static URLs; cache size 300 and first URL gone.
  - `activate deletes old bj-static caches only` → pre-seed `bj-static-v0` and `other`; after activate, `bj-static-v0` gone, `other` kept.
- [ ] **Step 2: Run** `npx vitest run tests/unit/service-worker.test.ts` → FAIL (file missing).
- [ ] **Step 3: Implement** `public/sw.js` per Interfaces.
- [ ] **Step 4: Run** → all PASS.
- [ ] **Step 5: Implement** `ServiceWorkerRegister`, mount it, add headers, write `offline.html`.
- [ ] **Step 6: Verify in a production build** — `npm run build`, start the standalone server (or the `:3501` stack rebuilt from the branch). In the browser: Application › Service Workers shows `/sw.js` active; reload → `/_next/static/*` served "from ServiceWorker"; Network shows `/rest/v1/*`, `?_rsc=` and `/api/*` not from ServiceWorker; DevTools "Offline" + reload → offline page; back online → app works; log in/out works; a Sales file upload works. `curl -sI http://localhost:<port>/sw.js` shows the no-cache header.
- [ ] **Step 7: Docs** — `docs/DEPLOY-LIARA.md` new short section "Service worker kill switch": replace `public/sw.js` with a worker that, on `activate`, deletes every `bj-static-*` cache and calls `self.registration.unregister()`, then deploy.
- [ ] **Step 8: Commit** `feat(pwa): static-file service worker and offline page`.

### Task 8: Close-out

**Files:**
- Modify: `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/AGENT-LOG.md`, `CLAUDE.md` (Gotchas), `docs/MEMORY.md` if a lesson applies

- [ ] **Step 1:** CHANGELOG entry for Parts 2–3 (and Part 1 if not yet recorded).
- [ ] **Step 2:** TASKS: remove done items in "Speed on slow links"; keep the "Later" line and the user-speed measurement until the owner reports numbers.
- [ ] **Step 3:** CLAUDE.md gotchas (one line each): "Service worker `public/sw.js` is allowlist-only (static files + offline page); never add a page, `/api`, `/rest` or `/auth` path — it would store personal data on devices." and "Liara Caddy runs keep-alive + h2 since <date> (users in Iran first); stalls from Canada → VPN/SSH tunnel, see DEPLOY-LIARA.md." (adjust the second to the measured outcome).
- [ ] **Step 4:** Full check — `npm run lint`, `npm run test:unit`, `npm run test:deploy`, `npm run build` all pass.
- [ ] **Step 5:** Commit `docs: speed on slow links` and open the PR for `feat/speed-feedback` (Tasks 3–8); owner reviews on `:3501`, merges on OK.
