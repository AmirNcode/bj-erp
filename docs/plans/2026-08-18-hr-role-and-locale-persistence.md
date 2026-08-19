# Plan — HR role, approval chain, language persistence

**Spec:** [`docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md`](../specs/2026-08-18-hr-role-and-locale-persistence-design.md)
**Date:** 2026-08-18
**Branch:** `feat/hr-role-and-locale` off `main` @ `c778c7b`

Six batches. **Each ships working software on its own** and ends at a green gate, so work can stop
between any two of them. Batches 1–3 are independent of each other; batch 5 depends on 2; batch 6
depends on 2.

Standing gates for every batch: `npx tsc --noEmit` · `npm run lint` · `npm run test:unit` ·
`npm run build`, all clean, plus the batch's own e2e. Every mutating server action calls
`invalidateAppCache()`. fa/en message trees stay key-identical and same-order. Every element e2e
reads gets its own `data-testid`.

---

## Batch 0 — Local dev unblocked ✅ DONE 2026-08-18

Already landed this session, before the plan was written.

- `deploy/docker-compose.local-arm64.yml` — publish Caddy's plain-HTTP listener as
  `127.0.0.1:8080:8080`, loopback-only, with the reasoning inline. Never added to
  `docker-compose.yml`: the port staying unpublished is what makes the listener inert in production.
- `.env.local` — `NEXT_PUBLIC_SUPABASE_URL` → `http://127.0.0.1:8080` (loopback, so a DHCP lease
  change can no longer break it) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the local stack's key, which
  did not match and was returning 401 from PostgREST.
- Verified: preflight 204, `POST /auth/v1/token` 200 with a real credential and 400 with a wrong one,
  `app_roles` claim present, no CSP/CORS console errors, HTTPS site on 3500 and the Caddy CA
  untouched.

---

## Batch 1 — Language preference actually persists (FR-34) ✅ DONE 2026-08-18

No migration. No new dependency. Independent of everything else.

**Write the failing tests first.**

| File | Change |
|---|---|
| `lib/i18n/locale.ts` | **new.** `LOCALE_COOKIE = 'bj-locale'`; `resolveEntryLocale(cookieValue, claimValue, fallback)` — pure, precedence cookie → claim → `fa`, ignoring anything not in `routing.locales`. |
| `tests/unit/entry-locale.test.ts` | **new.** Precedence, junk-value rejection, both-absent fallback. |
| `proxy.ts` | On a path carrying no locale prefix, resolve via `resolveEntryLocale` from the `bj-locale` cookie and the `app_locale` JWT claim (already verified locally in the middleware — no extra round-trip). If it resolves to a non-default locale, redirect to the prefixed path. Prefixed paths pass through untouched, so `localeDetection` stays `false` and `accept-language` stays ignored (spec D2). |
| `lib/actions/profile.ts` | `updateMyPrefs` sets the `bj-locale` cookie (1 year, `sameSite: 'lax'`, `httpOnly: false`) in the same action as the database write. |
| `app/[locale]/(auth)/login/page.tsx` | After sign-in, read the profile's `language_pref`, set the cookie, and push `/{pref}/home` instead of `/{urlLocale}/home`. |
| `app/[locale]/page.tsx` | Redirect using the resolved preference, not the URL locale. |
| `supabase/migrations/2026xxxx_locale_claim.sql` | Extend `custom_access_token_hook` to add `app_locale` from `profiles.language_pref` beside the existing `app_roles`. `create or replace`; idempotent. |
| `lib/supabase/types.ts` | No change (no new column). |

**e2e** `tests/e2e/settings.spec.ts` — extend: set English in Settings → navigate to the **bare**
`/` → assert the app renders English, not Farsi. This is the exact reported bug and currently fails.

**Watch for:** `app/[locale]/(app)/layout.tsx` cannot set cookies (Server Components may not), which
is why the JWT claim carries the durable copy. Do not "fix" this by writing cookies from a layout.

---

## Batch 2 — `hr` role exists and can see (FR-35, part 1) ✅ DONE 2026-08-18

**Two migrations, and the split is mandatory** — verified: Postgres rejects using a new enum value in
the transaction that added it, and each migration file runs in one `--single-transaction`.

| File | Change |
|---|---|
| `supabase/migrations/2026xxxxA_hr_role_enum.sql` | **Contains one statement and nothing else:** `alter type public.app_role add value if not exists 'hr';` |
| `supabase/migrations/2026xxxxB_hr_role_access.sql` | `private.is_hr(uid)`; `private.can_read_all` gains `or private.has_role(uid,'hr')`. No other policy changes — every read path HR needs already routes through `can_read_all`. |
| `lib/nav/tabs.ts` | `canManage` includes `hr`. |
| `app/[locale]/(app)/manage/layout.tsx` | Allow `hr`. |
| `app/[locale]/(app)/manage/settings/page.tsx` | Unchanged — still bounces non-admins, so HR cannot reach company configuration. |
| `app/[locale]/(app)/manage/employees/[id]/EditEmployeeForm.tsx`, `new/NewEmployeeForm.tsx` | `hr` appears in the role checkbox list (admin-only to tick). |
| `messages/{fa,en}.json` | `roles.hr` — «منابع انسانی» / "HR". |
| `lib/supabase/types.ts` | Hand-add `'hr'` to the `app_role` enum union. |

**Tests:** `tests/unit/nav_tabs.test.ts` — hr gets Manage. **e2e** `tests/e2e/hr-role.spec.ts` (new) —
create an hr user from the reserved `999#######` range, assert it reaches `/manage/employees`, is
redirected away from `/manage/settings`, and can read a colleague's requests.

---

## Batch 3 — HR adds employees (FR-35, part 2) ✅ DONE 2026-08-18

| File | Change |
|---|---|
| `supabase/migrations/2026xxxx_hr_create_employee.sql` | `app_create_employee` gains a third authorization path. `hr` → free choice of department and manager, **`p_roles` forced to `{employee}` in-database** regardless of input (spec D4). Admin and manager paths byte-unchanged. Same for `app_bulk_create_employees`, which shares `private.create_employee_impl`. |
| `lib/actions/employees.ts` | `createEmployee` / bulk import accept `hr` in the fast-path role check. The database check remains the authority. |
| `app/[locale]/(app)/manage/employees/page.tsx` | Add-employee and import controls visible to `hr`. |

**Tests:** unit for the role gate. **e2e** — an hr user creates an employee, and an hr user
attempting to send `p_roles: ['admin']` gets an ordinary employee back, proving the override is
in-database and not merely hidden in the UI.

---

## Batch 4 — Configurable approval chain (FR-36) ✅ DONE 2026-08-18

Land this as its own reviewed unit. Four sub-steps, each committed separately.

### 4a — Schema
`supabase/migrations/2026xxxx_approval_chain.sql`: `approval_steps` and `leave_request_approvals` per
the spec's shape, `work_settings.approval_order_enforced boolean not null default false`, RLS
(select: own · manager-of · `can_read_all`; **no client write policy** — writes go through the RPC),
CHECK-enforced bounded PNG + database-generated consent timestamp, and the two seed rows
(manager order 1, hr order 2, both kinds, active).

### 4b — Backfill
Same or adjacent migration, idempotent: one `leave_request_approvals` row per historically approved
request, carrying its existing signature, `step_role` from the decider's roles defaulting to
`manager`, `on conflict do nothing`. **Rehearse against a restored copy of the client dump before
this ships** — their database now holds real approvals.

### 4c — Engine
Rewrite `public.approve_leave_request(uuid, text, boolean)`:

1. Validate signature (unchanged rules).
2. Resolve which step the caller may fill: `manager` step iff `private.is_manager_of(uid, employee)`;
   `hr` step iff `has_role(uid,'hr')`; an **admin may fill any unfilled step**.
3. If `approval_order_enforced`, refuse a step whose lower-ordered active steps are not yet approved.
4. Insert the approval row (unique constraint makes double-signing impossible).
5. **If and only if every active step applying to this request's kind is now approved:** take the
   per-employee advisory lock, re-check overlap, recompute the paid/unpaid split, write the ledger
   consumption, set `status='approved'`, `decided_by`, `decided_at`, and copy the finalising
   signature into the legacy `approver_signature_*` columns.
6. Audit row inside the same transaction, recording the step — never the PNG.

`reject_leave_request` — any required approver may reject; writes a `rejected` approval row and flips
the request immediately. Stays unsigned.

New error strings + `lib/errors/db-error.ts` rules + `dbErrors.*` in both message files: *not your
step to sign*, *step already signed*, *earlier signature still required*.

### 4d — UI
| File | Change |
|---|---|
| `lib/leave/approvals.ts` | `filterApprovable` generalises to "steps this caller can fill **now**", taking the caller's roles, the manager relationship, the step config, and the signatures already present. Pure, heavily unit-tested — this is where a mistake either hides work or shows people requests they cannot sign. |
| `manage/approvals/ApprovalQueue.tsx` | Per-request progress line ("مدیر ✓ · منابع انسانی در انتظار"), and the approve control only where the caller has a fillable step. |
| `calendar/CalendarView.tsx` | Its inline `DecideButtons` obey the identical rule. |
| `manage/settings/ApprovalStepsCard.tsx` | **new**, admin-only: list steps, reorder, activate/deactivate, and one switch for `approval_order_enforced`. This is what makes "give it an order or no order" a setting rather than a rebuild. |
| `home/HomeBoard.tsx` | Pending-approvals card counts what the caller can act on. |
| `lib/supabase/types.ts` | Hand-add both tables and the new column. |

**Must not change:** `team_leave_calendar`'s column list. Signatures and step state stay off it.

**Tests:** unit for the step engine (order enforced/not, admin filling either step, double-sign
refused, rejection short-circuit). **e2e** `tests/e2e/approval-chain.spec.ts` — manager signs, request
stays pending and the balance is untouched; HR signs, request approves and the ledger debits exactly
once. Then the reverse order, with enforcement off. Then enforcement on, and the out-of-order
signature is refused.

---

## Batch 5 — HR reports and CSV export (FR-37) ✅ DONE 2026-08-18

Shipped, plus an unplanned **FR-38** (HR request review + printable paper form) added mid-way at the
owner's request — see the spec's Part 3b.

| File | Change |
|---|---|
| `lib/reports/*.ts` | **new.** Pure aggregation builders, one per report, fed plain rows. No I/O. |
| `tests/unit/reports.test.ts` | **new.** Per builder. |
| `lib/actions/reports.ts` | **new.** Reads through existing RLS (`can_read_all` covers hr after Batch 2). No new SECURITY DEFINER surface. |
| `app/[locale]/(app)/manage/reports/page.tsx` + `ReportsDashboard.tsx` | **new.** `hr` + `admin`. The five reports from the spec, Jalali month-range filter. |
| `components/ReportDownload.tsx` | **new.** Reuses `buildCsv` + the `CredentialsDownload` blob pattern — UTF-8 BOM, so Excel opens it with Farsi intact. |
| `messages/{fa,en}.json` | `reports.*`. |

**e2e** `tests/e2e/reports.spec.ts` — hr reaches the screen, a report renders rows, the download
produces a non-empty CSV whose header row matches the visible columns.

---

## Sequencing and deployment

Suggested order: **1 → 2 → 3 → 4 → 5**. Batch 1 is worth shipping on its own — it is small, carries no
migration risk, and fixes a bug the client is living with daily.

Deployment reality for every batch after 1:

- The client's server is live with **real data**; there is no fresh-install escape hatch. Migrations
  go out via `./deploy/bj-deploy update client`, which applies only pending files by checksum.
- Never re-run `release.sh` to recover a broken upload — re-run the same `rsync`, verify the SHA-256
  by hand, then `bj-deploy resume RUN_ID`.
- Batch 2's enum migration and the migration that first uses `'hr'` **must be separate files.**
- Before Batch 4 reaches the client: restore their dump locally, run the backfill against it, and
  confirm approved requests keep exactly their current balances.
- Tell the client that requests pending at the moment Batch 4 lands will need both signatures, so a
  manager may re-sign something they had already approved.
