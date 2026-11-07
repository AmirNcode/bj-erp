# View as (FR-86)

Status: approved by owner, 2026-11-07. Nothing built. The core mechanism passed a spike (§10).

## 1. Why

People report that they can or can't see something. Today the owner has to wait for that person to
log in and check whether a fix worked. View as lets the admin open the app as any employee and check
it directly, without their password and without waiting for them.

Reported problems are mostly about what appears on a page, not about buttons failing (owner,
2026-11-07), so seeing is enough for now.

**Owner decisions (2026-11-07):**

- Strictly read-only. Nothing can be saved while viewing.
- The person being viewed is not notified. Each view is recorded in Admin › Audit only.
- Search by name or personnel number, same as elsewhere in the app. Clicking a person starts the view.
- An Exit button is always available while viewing.
- The admin can switch language while viewing, and nothing is saved by doing so. Which language the
  view opens in does not matter.
- The banner is a strip across the top (option A in the mockups).
- Buttons stay visible, so the page matches what the person sees. Pressing one shows a read-only message.
- Trial mode (run an action, then cancel it) is dropped for now. Revisit only if needed. PostgREST's
  `Prefer: tx=rollback` would make it possible later.

## 2. Goals, non-goals, anti-goals

**Goals**

- The admin sees the real app as the person: their nav, pages, data and permission outcomes, enforced
  by the same RLS and RPCs, with no second copy of the permission logic.
- No write of any kind reaches the database while viewing, enforced by the database.
- No measurable cost for ordinary users.

**Non-goals**

- Acting as someone, trial mode, or testing an action to completion.
- Use by anyone but the single admin. HR and custom roles do not get this.
- Viewing as a job title or role in the abstract, rather than as a real person.
- Live screen sharing or watching what someone is doing.

**Anti-goals** (a failure even if it works)

- A signing key or `service_role` in the app. CLAUDE.md forbids it, and a leak could forge any login.
- Anything that lets a non-admin reach another person's view.
- The admin losing their session, or the person being affected in any way, by a view.
- The admin forgetting they are viewing and believing they are acting as themselves.
- A UI-only simulation that shows the admin's data under someone else's menus.

## 3. How it works

The admin keeps their own login throughout. A view is a short-lived row in the database, named by an
httpOnly cookie. On each database call the app sends that ID in a header. A PostgREST pre-request
function checks it, swaps the user ID for the target's and makes the transaction read-only. Because
`auth.uid()` reads `request.jwt.claims`, every RLS policy and RPC then treats the request as the target.

SQL does not read the `app_roles` or `app_perms` claims. Only the token hook writes them, so RLS uses
live tables and needs no other change.

```
Admin browser ── cookie bj-view-as=<session id> ──> Next.js server
Next.js ── admin's JWT + x-view-as: <session id> ──> PostgREST
PostgREST pre-request: caller is live admin? session theirs, not ended, not expired?
   yes -> sub := target, transaction read-only     no -> 403
```

## 4. Database

One migration file (migrations are frozen once applied).

**`private.view_as_sessions`**: `id uuid pk`, `admin_id uuid`, `target_id uuid`, `expires_at timestamptz`,
`ended_at timestamptz null`. In `private`, so PostgREST does not expose it.

**`private.view_as_pre_request()`**, `security definer`, `search_path ''`, execute granted to `anon` and
`authenticated`:

1. Read `x-view-as` from `request.headers`. Absent: return at once, with no table read. No logged-in
   caller: also return, because `anon` has nothing to swap and a leftover cookie must not break the
   login page.
2. Not a valid UUID, or no matching row: raise `PT403` with the message `view-as refused`. The check
   requires `admin_id = auth.uid()`, not ended, not expired, an active target, and the caller holding
   `admin` in `user_roles` now. The spike's version let a garbage ID reach the cast and return a 400; the real
   one must return 403.
3. In `request.jwt.claims`, set `sub` to the target and remove `app_roles` and `app_perms`.
4. `set_config('transaction_read_only', 'on', true)`.

**`public.app_view_as_start(p_target uuid)`**, security definer, runs as the real admin:

- Refuses a non-admin, the admin themself, an inactive target, and a target in another company.
- Ends the admin's earlier live session, so each admin has at most one. A second browser's view then
  ends. Deletes this admin's ended and expired rows.
- Inserts the row with `expires_at = now() + 30 minutes`.
- Writes `audit_log` (`actor_id` = admin, `action` `view_as.start`, `entity_id` = target).
- Returns the session ID and expiry.

Run while already viewing, the identity is the target, so it refuses. Views cannot nest.

**`public.app_view_as_end()`**: sets `ended_at` on the caller's live session and writes `view_as.end`.
A view with no end row ended by timeout.

**`public.app_view_as_session(p_id uuid)`**, `stable`: for the caller, returns target ID, name,
personnel number and `expires_at`, or nothing when the session is not usable. It also returns nothing
when the target has since become inactive.

**`public.app_view_as_probe()`**, `stable`: returns `auth.uid()` and
`current_setting('transaction_read_only')`. Called with the header, it proves the swap really happened.

**Activating the hook.** The setting cannot live in a migration, for two reasons:

- Role settings are cluster-level and are not in `pg_dump -d postgres` backups, while the migration
  ledger is. Restored onto a new cluster, the migration would never rerun and the hook would stay off.
- Restored over the same cluster from a pre-feature dump, the setting would outlive its function, and
  a setting naming a missing function fails every request for every user.

So the migration creates the functions only, and an idempotent file, `deploy/lib/sync-view-as-hook.sql`,
owns the setting:

- If `private.view_as_pre_request` exists: `alter role authenticator in database postgres set
  pgrst.db_pre_request = 'private.view_as_pre_request'`. Otherwise reset it.
- Then `notify pgrst, 'reload config'`.
- `in database postgres` keeps clones and other databases on the local cluster unaffected.

`bj_apply_migrations` (`deploy/lib/migrations.sh`) runs it after the last migration, so every install
and update re-asserts it. The restore instructions printed by `deploy/update.sh` and the procedure in
`docs/DEPLOY-LIARA.md` run it after `pg_restore`. It is a reviewed file in the release, not hand-run SQL.

**Not yet tested;** the spike used the environment variable. Prove the in-database setting on a clone
first. A Compose variable is the fallback, and would need the same answer for both cases above.

## 5. App

**Fail closed.** The rule: a press on a page already on screen must never run as the admin because the
view died underneath it. So the cookie's presence, not the session's health, decides the header.

**`lib/supabase/server.ts`:** `createClient()` adds `x-view-as` whenever the `bj-view-as` cookie exists.
A dead session then gets 403 from the hook on every call, so nothing runs as the admin. A separate
real-identity client, which never sends the header, serves `getViewAs`, start and exit.

**`lib/auth/viewAs.ts`** (new): `getViewAs()`, wrapped in React `cache()`:

- No cookie: `null`, with no database call.
- `live`: `app_view_as_session` returned a row through the real-identity client, and
  `app_view_as_probe` through the header client returned the target's ID and read-only `on`.
- `dead`: anything else, including any error or a probe that shows the hook is off.

**Dead sessions:** `(app)/layout.tsx` and `(print)/layout.tsx` check `getViewAs()` first, before reading
the profile. On `dead` they redirect to a new route handler, `/api/view-as/clear`, which deletes the
cookie and goes to `/{locale}/admin/view-as?ended=1`. A non-admin who inherited a stale cookie lands on
Home through the existing guard. Only Exit and this route remove the cookie, so `dead` reaches every
open page on its next load, and a server action there gets 403. Add a `dbErr` rule mapping
`view-as refused` to a translated "this view has ended, reload the page".

**`lib/auth/context.ts`:**

- `getCachedUser()` returns the target while `live`, and the real user otherwise.
  `getCachedClaims()` always returns the real claims.
- `getCachedRoles` and `getCachedPermissions` already compare `claims.sub` with `userId`, so they fall
  through to their database reads, which return the target's values (spike test 3 and 7).
- `requireAdminPage` then sends the viewer away from `/admin`, as it would the person.

**Layouts:** `(app)/layout.tsx` and `(print)/layout.tsx` skip the `must_change_password` redirect while
viewing. Otherwise such a person could not be viewed, because the redirect goes to a screen that needs
a write.

**Read-only feedback:** add a `dbErr` rule mapping `/read-only transaction/` to a translated message.
Existing error handling then shows it for every refused save. It does not name the person, because `dbErr` has no access to them and the strip already does.

**Actions the database cannot refuse.** Most writes need no app change: password changes are RPCs
(`app_change_my_password`) and SMS is queued in `sms_outbox` inside the transaction. These are not
covered, and need a guard:

| Action | Problem while viewing | Fix |
|---|---|---|
| `signOut` (`lib/actions/profile.ts:54`) | Signs the admin out through GoTrue | Check for the cookie, and show the read-only message instead |
| `auth.refreshSession` (`lib/actions/roles.ts:147`) | Runs after a role write, which is refused first | Confirm unreachable |
| `updateMyPrefs` from `LanguageSwitch` | Refused, so language would not change | Path-only switch (§6) |
| `accrueBeforeRead` | Refused and logged on Home and balance reads | Skip while viewing (§8) |

**Caching:** data caching is React `cache()` per request and `revalidatePath`, so nothing is shared
across identities on the server. The browser's router cache is cleared by a full page load on start and
exit. Never use client navigation for either.

## 6. Screens

Mockup: `.superpowers/brainstorm/33789-1794035030/content/view-as.html` (git-ignored).

**Admin › View as** (`/admin/view-as`, a new `AdminTabs` tab, English only like the panel):

- One search box using `PersonSearch`, over active people except the admin, loaded on this page only.
- Add an `autoChoose={false}` prop. The component auto-picks a single match, which here would start a
  view by accident. Starting a view always takes a click.
- Each result shows the person's role as a small label. `PersonSearch` needs an optional hint per option.
- A line under the box: read-only, 30 minutes, recorded in Audit.

**The strip** (new `ViewAsBar`, rendered by `AppShell` when viewing):

- In the content column at the top, `sticky`, respecting the iPhone safe-area inset.
- Amber (`--warning` tokens), so it reads differently from the app's blue.
- Desktop: "Viewing as {name} ({personnel no}) · Read-only", language switch, Exit.
- Phone: name, "Read-only", language, Exit.
- Translated into `fa` and `en` and following page direction. It is outside the admin panel, so the
  English-only rule does not apply, and the mockup's English LTR is not final.
- Not shown on print pages or in the printed output.

**Language:** while viewing, `LanguageSwitch` swaps the locale in the URL and calls nothing. Same for the
one on Profile. The locale cookie and both people's `language_pref` stay untouched. Farsi URLs carry no
prefix (`localePrefix: 'as-needed'`), so `proxy.ts` step 4 would send an admin whose preference is `en`
straight back to English. It must skip that redirect when the `bj-view-as` cookie exists. That is a
cookie read, with no database call.

**Start and exit:**

- Start: server action calls `app_view_as_start` through the real-identity client and sets the cookie,
  then runs the probe. If the probe fails, it ends the session, deletes the cookie and shows "View as
  is unavailable" on the tab. Otherwise `window.location.assign('/{locale}/home')`.
- Exit: server action calls `app_view_as_end` and deletes the cookie. If the call fails, the cookie is
  still deleted. Then a full load of `/{locale}/admin/view-as`.
- Cookie: `bj-view-as`, httpOnly, `secure` in production, `sameSite=lax`, `path=/`, `maxAge` 24 hours.
  It deliberately outlives the 30-minute session, because the database holds the real limit and the
  cookie is what keeps a dead view failing closed.
- Both post on a `BroadcastChannel`, and other tabs reload.

**Expiry:** `ViewAsBar` sets a timer for `expires_at`, then does a full load of `/api/view-as/clear`,
which lands on the View as page with an "ended" note. Viewing again needs a new search.

## 7. Cases

| Case | Behaviour |
|---|---|
| Target made inactive during a view | Session is `dead`. The next load goes to the View as tab with a note; a press on the open page gets 403 |
| Admin role moved during a view | The hook checks live `user_roles`, so the session is `dead` |
| Admin's own login ends during a view | Sent to login as normal; the cookie is ignored while logged out |
| Someone else logs in on that browser | Session is `dead` for them. The layout clears the cookie and they land on Home |
| Session ends between `getViewAs` and a later call in one render | That call gets 403 and the page shows an error once; the next load is clean |
| Second browser starts a view | The first browser's session is `dead`, handled as above. Its strip stays until its next load, but presses get 403 |
| `getViewAs` hits a transient error | `dead`. The view ends and the admin searches again. Nothing runs as the admin |
| Hook switched off or not reloaded | The probe fails, so no view starts and a running one is `dead` |
| Tab left open after Exit | Reloaded by `BroadcastChannel`. See §9 for the remainder |
| `/api/photo/[id]` | Uses `createClient()`, so it respects the view. The middleware matcher excludes `/api`; nothing there depends on it |
| `(print)` pages | Same identity through `getCachedUser`, same `dead` check |
| Middleware | Session handling unchanged. One change: skip the locale redirect when the cookie exists (§6) |

## 8. Known differences from the person's real view

Accepted, so nobody spends time chasing them:

- **Balances** can be behind: reads normally post earned months first, and that is a write. The next
  time the person loads Home it catches up.
- **The strip** takes about 36px at the top.
- **Photos** can come from the admin's browser cache.
- **The Home profile reminder** snooze is per browser, so dismissing it while viewing also snoozes it for the admin.

## 9. Security

| Threat | Defence |
|---|---|
| Non-admin sends the header | Hook requires the session's `admin_id` to be the caller and a live `admin` role. Refused in the spike |
| Stolen cookie or session ID | Useless without the admin's JWT. httpOnly, 30-minute limit |
| Forged login | No signing key added. The admin's JWT stays the only credential |
| Write while viewing | `transaction_read_only` in the database covers tables and every RPC, whatever the app does. Postgres refuses switching back to read-write |
| Strip says read-only but the hook is off (restore onto a new cluster, missed reload) | The probe proves the swap on every render. No proof, no view |
| Press on a page whose view has died | The cookie stays, so the header is still sent and the hook refuses. Nothing runs as the admin |
| Hook setting names a missing function after a restore | `sync-view-as-hook.sql` runs in the restore procedure and on every deploy |
| Non-database side effect | The table in §5 |
| Header sent straight from a browser | `x-view-as` is absent from the gateway's CORS allow-list. Server-side calls are unaffected. The same checks apply anyway |
| Header through the gateway | Server calls use the internal gateway. Must be confirmed in the e2e test; the spike went directly to PostgREST |
| Accountability | Start and end go to `audit_log`, visible only to the admin |
| Cross-site start | Next.js server actions check origin; `sameSite=lax` cookie |

**Accepted by owner's design:**

- Viewing as HR or finance shows the admin whatever that person can see, which may include personal
  info, signatures or costs the admin does not normally open. The audit log is the record.
- Nothing tells the person, per the owner's decision.

**Remaining risk:** only Exit removes the cookie while a page may still be open. A tab in the same
browser that missed the `BroadcastChannel` message (a frozen background tab on a phone) can still show
the person's screen after Exit, and a button pressed there would run as the admin. Low: it needs a
stale tab and a deliberate press, by the admin who just pressed Exit. Every other way a view ends fails
closed.

## 10. Performance and spike evidence

Run 2026-11-07 on a throwaway clone of the local database with PostgREST v12.2.3 (the production
version), since removed.

| # | Test | Result |
|---|---|---|
| 1, 2, 3 | Permissions: admin / employee / admin viewing as employee | 20 / 0 / 0 |
| 4, 5, 6 | `profiles` rows: admin / employee / viewing | 19 / 5 / 5 |
| 7 | `user_roles` while viewing | Target's own row only |
| 8 | PATCH `profiles` while viewing | 405, code 25006 |
| 9 | Target's own token with the session ID | 403 |
| 10, 11 | Expired / ended session | 403 |
| 12 | Garbage ID | 400, to become 403 (§4) |
| 13 | No login with the session ID | 403, to become "header ignored" (§4) |
| 14 | Admin afterwards | 20 permissions; nothing stuck |

Latency over 3 rounds of 400 calls: p50 2.48–2.81 ms without the hook, 2.50–3.10 ms with it and no
header, which is within noise. Connection, role and `set_config` work is per request either way.

Added load:

- Ordinary users: one function call per database request that parses `request.headers` and returns.
- Admin not viewing: nothing more.
- While viewing: one primary-key read per request, plus `app_view_as_session` and the probe per
  render, plus the `user_roles` and `app_my_permissions` reads that the JWT claims normally avoid.
- The roster loads on the View as page only.

## 11. Deploy

- Forward-only and compatible with the running app: the hook does nothing without the header, and the
  old app never sends it.
- No Compose change if the in-database setting works (§4).
- New: `deploy/lib/sync-view-as-hook.sql`, shipped with `deploy/lib`, called from `bj_apply_migrations`,
  and added to the restore instructions.
- Local: restart `bj-erp-rest-1` after migrating, as usual.

## 12. Tests

- **`tests/sql/view-as.sql`:** start refusals (non-admin, self, inactive, nested), one live session per
  admin, audit rows, hook refusals, the anon case, and writes refused on a table and on an RPC.
- **`tests/deploy/`:** the sync file sets the hook when the function exists and resets it when not, and
  is safe to run twice.
- **Unit:** the two new `dbErr` rules, `getViewAs` with no cookie makes no database call, every failure
  gives `dead`, `createClient` sends the header for a dead session, `PersonSearch` with
  `autoChoose={false}`, and the proxy skipping the locale redirect with the cookie present.
- **Clone, by hand:** with the hook setting removed, no view starts and a running one ends.
- **e2e, through the gateway, `999…` users only:**
  - Start, the strip appears, nav matches the target, `/admin` redirects, a save shows the read-only
    message, Farsi and English both reach the page with an `en` admin, Exit returns to the admin.
  - A second browser's start, then a press in the first browser: refused, and the person's data is unchanged.
  - Walk every nav page for an employee, a manager and an HR user while viewing, and fail on any
    unexpected 25006. That shows which pages write on load. `accrue_*` is the only known one; the
    function-name sweep found no other read-named function that is volatile.

## 13. Docs to update when built

`docs/REQUIREMENTS.md` (FR-86), `docs/PERMISSIONS.md`, `docs/DATA_MODEL.md`, `docs/CHANGELOG.md`,
`docs/AGENT-LOG.md`, `docs/DEPLOY-LIARA.md` (restore step), and CLAUDE.md gotchas about the real-identity
client and the hook setting not being in backups.

## 14. Left to the builder

Names of new files and props, how the bar reaches `LanguageSwitch` and the logout button (context or
prop), exact copy (run Farsi past the owner), and the wording of the "ended" note.

## 15. Claude's calls, not the owner's

- 30-minute limit, restarted only by a new search. No extension button.
- Inactive people cannot be viewed.
- The view opens in the admin's current language.
- Exit returns to the View as tab, ready for the next person.
- No permission catalog item: this is fixed to the admin role.
- A person's role label in search results.
- Skipping accrual while viewing (§8).
- Fail closed: a dead view refuses presses instead of running them as the admin (§5).
- A failed session check ends the view rather than retrying.
- The hook setting lives in a synced deploy file, not a migration (§4).
