# HR role, configurable approval chain, and language persistence

**Date:** 2026-08-18
**Status:** Accepted — decisions D1–D6 answered by the owner on 2026-08-18
**Module:** Shared core (roles, locale) + HR → Time-Off (approvals, reports)
**Plan:** [`docs/plans/2026-08-18-hr-role-and-locale-persistence.md`](../plans/2026-08-18-hr-role-and-locale-persistence.md)

## Scope

Three unrelated pieces of work, specified together because they were requested together and two of
them touch the same files (`user_roles`, the approval path, the `manage/*` guard).

1. **Language preference does not survive** entering the app anywhere except an `/en`-prefixed URL.
   Settings shows English while the app renders Farsi. (FR-34)
2. **A new `hr` role** that can add employees, must co-sign every request alongside the manager, and
   has a reports screen with a downloadable export. (FR-35, FR-36, FR-37)
3. The co-signing requirement generalises the single-approver model into a **configurable approval
   chain**, because the owner requires the order to be admin-changeable and the client's paper forms
   already carry four signatures.

Out of scope, deliberately: the حراست (security) signature step — the chain built here accommodates
it without further schema work, but no step is seeded for it and no UI names it.

---

## Part 1 — Language preference (FR-34)

### Root cause (verified, not inferred)

`profiles.language_pref` is written by Settings and **read by nothing that decides the locale**.
Confirmed by grep: the only reads are the Settings dropdown's own initial value
(`profile/page.tsx:85`) and the admin employee forms. The rendered locale comes exclusively from the
URL.

`i18n/routing.ts` sets `localeDetection: false`. Per next-intl's own `resolveLocaleFromPrefix`
(verified against the library source via Context7), that flag gates **both** the `NEXT_LOCALE` cookie
*and* the `accept-language` header, leaving the resolution order as: path prefix → default locale.
Combined with `localePrefix: 'as-needed'`, under which Farsi carries no prefix, **every URL without
an `/en` prefix resolves to Farsi unconditionally.**

Entry points that produce such a URL:

| Entry point | Behaviour today |
|---|---|
| PWA launch — `manifest.ts` `start_url: '/'` | `/` → `/fa/login` → `/login`. Farsi, every launch. |
| Bare origin typed or bookmarked (`https://10.10.10.50:3500`) | Same. |
| `app/[locale]/page.tsx` | Redirects to `/${locale}/…` using the **URL** locale, never the preference. |
| `login/page.tsx:40` | Pushes `/${locale}/home` using the **URL** locale. |

The installed PWA is the dominant cause: the home-screen icon always opens `start_url`, so an
English user is returned to Farsi on **every single launch**, which matches the reported "many times".

The symptom is precisely explained: the Settings dropdown reads the database (`en`), the page around
it reads the URL (`fa`). The two can disagree forever, and nothing reconciles them.

### Decisions

- **D1 — The URL stays authoritative while inside the app; the stored preference becomes
  authoritative at entry.** A prefix-less URL is treated as "unspecified", not as "Farsi". A user can
  still force a language by typing `/en/...`, which keeps deep links and the language switcher
  working.
- **D2 — `accept-language` stays disabled.** `localeDetection` is a single boolean covering cookie
  and header, so it is left `false` and the cookie is handled explicitly in `proxy.ts`. Turning it on
  would let an English-locale phone browser flip a Farsi worker's UI — the opposite of the bug being
  fixed. This is a deliberate departure from the library default.
- **D3 — Two carriers, both cheap.** A `bj-locale` cookie gives an instant effect on change; an
  `app_locale` JWT claim (via the existing `custom_access_token_hook`, already enabled in
  `deploy/docker-compose.yml:80`) survives cookie loss and reaches a new device on next sign-in.
  Middleware reads whichever is present — no database round-trip, preserving the nav-performance
  work. A dedicated cookie name is used rather than `NEXT_LOCALE` so next-intl's own cookie handling
  can never fight ours.
- The manifest's `lang: 'fa'` / `dir: 'rtl'` stay as they are: a web manifest is static and cannot be
  per-user. It affects the install prompt's presentation only, not the running app.

---

## Part 2 — The `hr` role (FR-35)

### Decisions

- **D4 — HR adds employees to any department, but can only create ordinary employees.** Every
  privileged input is overwritten in-database: `p_roles` is forced to `{employee}` regardless of what
  the client sends. Promotion to manager/hr/security/admin stays admin-only, so an HR account can
  never manufacture an admin. This mirrors the existing manager path, which already forces roles, and
  differs from it only in dropping the "own department" restriction.
- HR reads company-wide. `private.can_read_all` gains `has_role(uid,'hr')`, which is enough on its
  own: every read path HR needs (`leave_requests`, `leave_ledger`, `profiles`, `leave_allocations`,
  `employee_leave_policies`) already routes through that helper. **No new RLS policy is required for
  reads** — a smaller change than it first appears.
- HR reaches `/manage/*`. Within it: Employees (list, add, bulk import) and the new Reports screen.
  HR does **not** get Settings (company configuration stays admin-only) or Departments.

### The enum trap (verified empirically, must shape the migration layout)

`bj_apply_migrations` runs each migration file inside one `--single-transaction`. Postgres refuses to
*use* a new enum value in the transaction that added it. Tested on the live local database:

```
alter type public.app_role add value if not exists 'hr';   -- ALTER TYPE (ok)
… then referencing 'hr'::public.app_role in the same tx:
ERROR: unsafe use of new value "hr" of enum type app_role
```

Therefore **`alter type … add value 'hr'` must be a migration file containing nothing else**, and
every migration that references `'hr'` must be a strictly later file. Getting this wrong fails on the
client's server, not here, because the ledger skips already-applied files.

---

## Part 3 — Configurable approval chain (FR-36, amends FR-14)

### Decisions

- **D5 — Order is configuration, not code.** The owner asked for "any order, whoever is free, but
  built so that later I can give it an order or have no order at all". So:
  - `approval_steps` rows define **who must sign**, each with a `step_order`.
  - `work_settings.approval_order_enforced boolean default false` decides whether that order
    **binds**. Default `false` ships the requested behaviour today (either party signs first);
    flipping it to `true` later makes the chain sequential with no code change.
  - Reordering is editing `step_order`. Removing a signature requirement is deactivating a step.
- **D6 — All four request kinds require the HR signature** (daily leave, hourly leave, daily errand,
  hourly errand), per the client's "all requests that come in". A step's `applies_to request_kind[]`
  makes narrowing this to leave-only a data change, not a code change, if the HR queue proves too
  noisy in practice.
- **`leave_status` does not change.** A request stays `pending` until every active required step has
  an `approved` row, then flips to `approved` in the same transaction as the ledger write. This is
  the single most important structural choice here: **every existing query, view, index, RLS policy,
  home-board card and calendar read keeps working untouched.** An intermediate status value would
  have forced changes through all of them.
- **Rejection is unilateral.** Any required approver may reject; the request flips to `rejected`
  immediately and the remaining steps become moot. Rejection stays unsigned (unchanged from FR-14).
- **Admin override is preserved but not a bypass.** An admin may fill *any* unfilled step, and still
  has to draw a signature to do it. An admin cannot skip a step that nobody has signed. This keeps
  FR-14's override while honouring the client's requirement that both parties sign.
- **The ledger moves to the final signature.** The advisory lock, overlap re-check, and paid/unpaid
  split all run in the finalising transaction — the same work as today, just triggered by the last
  approval instead of the only one.

### Why a table rather than more columns

Adding `hr_signature_data` / `hr_signature_consent_at` / `hr_decided_by` columns beside the existing
approver columns would be less work today and wrong within one feature. The client's paper forms
carry **four** signatures, and `docs/TASKS.md` already carries "Deferred, own spec: multi-step
approval + حراست gate check" as a known future item. A per-step table absorbs that with a seed row.
Column-per-role does not, and would mean restructuring the approval path a second time against a
database that by then holds real signed evidence.

### Shape

```
approval_steps
  id · company_id → companies · role app_role · applies_to request_kind[]
  step_order int · active bool · created_at · updated_at
  unique (company_id, role)
  seed: (manager, {leave,errand}, 1, true) · (hr, {leave,errand}, 2, true)

leave_request_approvals
  id · request_id → leave_requests · step_role app_role
  approver_id → profiles · decision leave_status ('approved' | 'rejected')
  signature_data text · signature_consent_at timestamptz · note text · created_at
  unique (request_id, step_role)

work_settings
  + approval_order_enforced bool not null default false
```

- **`step_role = 'manager'` means the requester's own direct manager**, resolved per request via
  `private.is_manager_of`. It is not "anyone holding the manager role" — that would let any manager
  in the company approve anyone, which contradicts FR-17's narrow-write rule.
- Signature columns carry the same CHECK-enforced bounded-PNG shape and database-generated consent
  timestamp as `leave_requests.signature_data`. They inherit the strict base-row RLS scope, are
  fetched only on demand, and are **never** added to `team_leave_calendar`.
- `leave_requests.approver_signature_data` / `_consent_at` / `decided_by` / `decided_at` are retained
  and populated from the **finalising** approval, so every existing reader keeps working unchanged.

### Backfill

Every historically `approved` request gets one `leave_request_approvals` row carrying its existing
approver signature, with `step_role` derived from the decider's roles (defaulting to `manager`).
Idempotent via `on conflict do nothing`. **The client's database now holds real approvals**, so this
must be rehearsed against a restored dump before it reaches their server.

Requests already `pending` when this ships acquire the new requirement: they will need both
signatures. That is correct — the client asked for HR to sign what comes in — but the manager may
have to re-sign a request they had already approved if it was mid-flight. Worth telling them.

---

## Part 3b — HR reads and prints every request (FR-38, amends FR-25)

Added 2026-08-18 after the owner reviewed batch 2: HR must see every request —
pending, approved and rejected — **with all signatures on it**, and be able to
print it in the shape of the paper form they file today.

### The paper forms, read off the photographs

`docs/forms/` holds three photographs, and they answer several questions the
written docs had left open:

| Form | Code | Signature boxes, right to left as printed |
|---|---|---|
| فرم درخواست مرخصی روزانه (daily leave) | **BJ-F 50210(R0)** | درخواست کننده · جانشین · تصویب کننده · مدیر اداری و منابع انسانی |
| فرم درخواست مرخصی ساعتی (hourly leave) | BJ-F 50208(R0) | درخواست کننده · تصویب کننده · حراست · امور اداری |
| فرم درخواست ماموریت ساعتی (hourly errand) | BJ-F 50207(R0) | درخواست کننده · تصویب کننده · حراست · امور اداری و منابع انسانی |

Three things worth recording:

- **BJ-F 50210 was not in the docs at all.** FR-26 names 50208 for hourly leave
  and FR-30 names 50207 for the errand, but the daily leave form had only ever
  been described by name.
- **Every form carries four signatures, and the last is HR's.** This is direct
  confirmation of the FR-36 chain design — the "hr step" is not an invention, it
  is the امور اداری و منابع انسانی box that already exists on paper.
- **The box sets differ between forms.** 50210 has جانشین and no حراست; the two
  hourly forms have حراست and no جانشین. They are modelled per form rather than
  assumed identical.
- There is **no photograph of a daily work errand form** — that request type was
  added at the client's request on 2026-08-05 and may have no paper original. It
  reuses 50207's code and boxes, because the database already numbers daily and
  hourly errands from one sequence (i.e. one book), and the printed sheet says so.
  **Worth confirming with the client.**

### Decisions

- **D7 — HR reads the full request row, which widens FR-25.** `hr` joins
  requester / direct manager / security / admin on `leave_requests_select`, so HR
  sees the private `reason`, the errand location, the decision note and both
  signature images. This is a real widening of reason privacy and was asked for
  explicitly. It matches the paper process: an HR officer signs and files the
  completed form today, reason included. `team_leave_calendar` is untouched, so
  teammates are unaffected.
- **D8 — The print view lives outside the app shell**, at `/print/request/[id]`,
  in its own route group with its own auth guard. Printing from inside `(app)`
  would carry the header and tab bar onto the paper and would rely on every
  future piece of chrome remembering to hide itself.
- **D9 — Only two of the four boxes can be filled.** The app captures the
  requester's and the approver's signatures. جانشین, حراست and the HR box print
  empty for a wet signature, and the sheet says so in a footnote. They fill
  themselves as FR-36 lands.
- **D10 — The review screen is `hr` + `admin`, not managers.** A manager decides
  their own reports through `/manage/approvals`; giving them a company-wide list
  one click from every colleague's private reason is a different and unrequested
  widening.
- Cancelled requests appear too, behind the status filter. The owner asked for
  pending/approved/rejected; silently dropping cancelled would make the screen
  disagree with the employee's own list for no stated reason.
- The BJ-F 50210 balance line (متقاضی دارای مرخصی … می باشد) is filled from the
  employee's **current** balance, with a printed note saying so — the ledger
  stores no as-of-request snapshot.

---

## Part 4 — HR reports (FR-37)

- New screen `/manage/reports`, visible to `hr` and `admin`.
- Starting set — deliberately small, extended once HR says what they actually use:
  1. **Leave balance by employee** — current balance per leave type, with department and manager.
  2. **Requests by period and status** — counts and total days, filterable by Jalali month range.
  3. **Absence by department** — days taken per department per Jalali month.
  4. **Pending approvals ageing** — what is waiting, on whom, and for how long.
  5. **Headcount by department** — active employees, with the joiners in the period.
- **Export is CSV with a UTF-8 BOM** (D — owner's choice). No new dependency: `lib/csv/parse.ts`'s
  `buildCsv` and the `CredentialsDownload` blob pattern already produce files that open correctly in
  Excel with Farsi text intact. The cost is that column widths and number formatting are lost.
- Report queries read through existing RLS; `can_read_all` covering `hr` (Part 2) is what makes them
  return company-wide rows. Aggregation happens in pure, unit-tested builders in `lib/reports/`,
  fed by plain selects — no new SECURITY DEFINER surface.
- Dates in exports are rendered Jalali at the edge, per the standing convention.

---

## Risks

- **The enum-in-transaction trap** (Part 2) fails on the client's server rather than locally, because
  the migration ledger skips files already applied here. The layout rule is non-negotiable.
- **The client is live and entering real data.** Every migration here is a real-data migration; there
  is no fresh-install escape hatch any more. The approval backfill is the sharp edge.
- **`supabase gen types` cannot run on this machine**, so `lib/supabase/types.ts` is hand-edited for
  the two new tables and the new column. `tsc --noEmit` + `next build` are the substitute gate.
- **In-flight pending requests** change meaning the moment the chain ships (see Backfill).
- The approvals queue becomes a two-audience screen. Getting "what can *I* act on right now" wrong
  either hides work or shows people requests they cannot sign.

## Requirements touched

New: **FR-34** (language persistence), **FR-35** (hr role), **FR-36** (configurable approval chain),
**FR-37** (HR reports + export), **FR-38** (HR request review + printable paper form).
Amended: **FR-14** — approval is now a chain of required signed steps rather than a single
manager/admin decision. **FR-25** — the private `reason` is now also visible to `hr` (FR-38 D7).
