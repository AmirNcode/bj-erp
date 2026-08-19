# REQUIREMENTS

Numbered and traceable. `FR` = functional, `NFR` = non-functional. Status: ☐ todo · ◐ partial ·
☑ done. Statuses reflect the current build: v1 (Phases 0–6) is complete and merged to `main`.

## Functional — Identity & Org

- **FR-1** ☑ A single **admin** (the owner) can create, edit, deactivate employees.
- **FR-2** ☑ Admin can assign/change an employee's **role(s)**, **team/department**, and **manager**.
- **FR-3** ☑ Roles: **admin, manager, employee, security**, plus **hr** (2026-08-18, FR-35).
  A user may hold more than one.
- **FR-4** ☑ Org model: company → departments (3 teams + 1 Security department) → employees, with
  a **manager hierarchy** (`manager_id` self-reference).
- **FR-5** ☑ **Managers** can edit employees that **directly report** to them (subset of fields).
- **FR-6** ☑ Employees can edit a limited set of their own profile fields.
- **FR-7** ☑ Login is **username (employee code) + password**, issued by admin. **No email
  required.** Self-service password change (Profile → Change password; verifies current password).

- **FR-35** ☑ **HR role.** A fifth role, `hr` (منابع انسانی), added to `app_role`. It reads
  company-wide (via `can_read_all`), reaches `/manage/*`, and **may add employees to any department**
  — but every account it creates is forced in-database to the `employee` role alone, so promotion to
  manager/hr/security/admin stays admin-only and an HR account can never mint an admin. HR does not
  reach company Settings or Departments. It is also a required approval step (FR-36) and owns the
  reports screen (FR-37). *(**Role, company-wide read, `/manage` access, employee onboarding into any
  department, request review/printing (FR-38), co-signing (FR-36) and reports (FR-37) all shipped
  2026-08-18.**)*

## Functional — Time-Off

- **FR-8** ◐ Configurable **leave types** seeded with Iranian statutory defaults: paid **annual**
  (~26 working days/yr), **sick**, **unpaid**. Admin can add/edit types.
- **FR-9** ☑ Per-employee, per-type **yearly allocation** (entitlement).
- **FR-10** ☑ **Balance ledger**: every allocation/consumption/adjustment is a ledger row; balance
  is derived, auditable.
- **FR-11** ☑ Employee submits a request: type, date range, **full or half day** (am/pm). Schema
  reserves room for **hourly** leave later without migration.
- **FR-12** ☑ **Working-day count** excludes configured **weekend** days and **holidays**;
  half-day = 0.5. Computed **server-side**. *(Amended by FR-41: a weekday may be off
  every other week, decided by an admin-chosen reference date.)*
- **FR-13** ☑ Paid-leave forms show the **requested duration**, **projected remaining paid
  balance**, and any **unpaid excess** before submit. A request may exceed the available paid
  balance: approval atomically consumes only the available paid minutes, leaves that balance at
  zero, and records the rest as unpaid time. Durations use the configured workday, default 8 hours.
  *(Extended 2026-08-05.)*
- **FR-14** ☑ **Approval**: the employee's **direct manager** approves/rejects; **admin can
  override** any decision. Approval requires the deciding manager/admin to draw a fresh digital
  signature and explicitly authorize its use; rejection requires neither. The signature, consent
  timestamp, decision, audit event, and ledger update are committed atomically. *(Extended
  2026-08-05.)* **Amended by FR-36 (planned 2026-08-18):** approval becomes a chain of required
  signed steps rather than one decision. The manager step described here is retained as the first
  step; the ledger update moves to whichever signature completes the chain. **Shipped 2026-08-18.**
- **FR-15** ☑ Employee can **cancel** a pending request, and an **approved future** request
  (`start_date` after today) — balance restored via a `reversal` ledger row. *(Pending-cancel
  shipped in Phase 2; approved-future in Phase 6.)*

- **FR-26** ☑ **Hourly leave (مرخصی ساعتی).** A worker requests hours on a single date from a separate
  screen mirroring form BJ-F 50208: one date, a from-time and a to-time drawn from the company
  work-hours window, capped per day (default 4h) across that day's requests, and gated by
  `leave_types.allow_hourly` — annual and unpaid only, never sick. Overlap is time-aware, so two
  non-overlapping errands in a day are both allowed. *(2026-07-29; supersedes FR-11's "reserves room
  for hourly later" and the v1 spec's D7 deferral.)*
- **FR-29** ☑ **Request tracking numbers.** Every request carries a human-readable `1404-0042`,
  gapless per company, Jalali year **and request kind**, allocated server-side and shown on the
  employee's own requests and on approval cards. *(2026-07-29; relabelled 2026-07-30.)*
  Originally described as "the شماره on the client's paper forms" — **that reading was wrong.** The
  client has since clarified that the paper شماره is the requester's personnel number. The generated
  value is kept because it is genuinely useful, but it is labelled **شماره پیگیری / Tracking no.** so
  the two cannot be confused. Leave and errands number independently, matching the separate form books.
- **FR-28** ☑ **Replacement / cover person (جانشین · جایگزین).** Optional on both request screens,
  searchable, drawn from the requester's own department. Anyone with overlapping pending or approved
  leave is refused at submit and re-checked at approval; unavailable colleagues are shown disabled with
  the reason rather than hidden. The named person sees "you are covering X" on Home — no consent gate.
  Being named as cover never blocks that person's own leave (deliberate asymmetry, spec §2.1).
  *(2026-07-29.)*
- **FR-27** ☑ **Monthly accrual.** Each employee has a per-leave-type policy (days earned per
  month, yearly cap, carryover cap, start month), defaulted from the leave type and editable by an
  admin. Accrual is posted lazily and idempotently, anchored to **Jalali month starts**, with the
  hire month pro-rated by calendar days and the excess above the carryover cap forfeited via an
  audited ledger row at Farvardin 1. Admins can also post it for everyone from Manage → Settings.
  *(2026-07-29; supersedes FR-8's fixed annual quota — entitlement is per employee.)*
- **FR-30** ☑ **Hourly work errand (ماموریت ساعتی).** A worker requests an off-site work trip on a
  single date from a separate screen mirroring form BJ-F 50207: departure time, return time,
  **محل ماموریت** (required) and an optional **شرح ماموریت**. An errand is **work, not leave** — it
  deducts no balance, needs no leave type, is not bound by the work-hours window, is not capped by the
  hourly daily limit, and names no replacement. It is approved by the direct manager in the same queue
  as leave, carries its own tracking-number sequence, and **conflicts with overlapping leave in both
  directions** — you cannot be on leave and on an errand at once. Teammates see it on the calendar but
  never see the location or the description. *(2026-07-30.)*
- **FR-31** ☑ **Login codes without a department prefix.** New employee codes are the personnel
  number alone (`1042`), not `departments.code || '-' || personnel_no`. Accounts created before
  2026-07-30 keep their prefixed codes and both forms log in; there is no backfill. `departments.code`
  survives as an auto-generated, unread column, and admin editing of it is deactivated pending the
  client's decision. *(2026-07-30; supersedes the code formula in the 2026-07-13 onboarding spec.)*
- **FR-32** ☑ **Explicit daily dates and requester signature.** Daily leave uses separate
  **Start date** and **End date** calendar fields; hourly leave and hourly errands remain
  single-date. Every new daily leave, hourly leave, daily errand, and hourly errand request requires
  a freshly drawn mouse/touch signature and an unchecked-by-default authorization checkbox. The
  database permanently stores the bounded PNG and records its own consent timestamp. The requester,
  direct manager, security, and admin may open it; teammates cannot. *(2026-08-05.)*
- **FR-33** ☑ **Daily work errand (ماموریت روزانه).** A worker requests an inclusive off-site work
  trip with separate Persian-calendar **Start date** and **End date** fields, a required location,
  and an optional description. It is work rather than leave: it has no leave type, replacement, or
  balance effect; may include weekends/holidays; uses the existing errand tracking sequence; and
  follows the same signed request and signed manager/admin approval flow as hourly work errands.
  Any overlapping leave or errand conflicts in both directions. *(2026-08-05.)*

- **FR-36** ☑ **Configurable approval chain.** A request requires a signed approval from every
  **active step** configured for its kind, not a single decision. Steps ship seeded as
  **manager** (order 1) then **hr** (order 2), applying to all four request kinds. Whether the order
  binds is the company setting `work_settings.approval_order_enforced`, **default false** — so by
  default either party may sign first and the request completes when both have. An admin may fill any
  unfilled step but must still sign; rejection by any required approver is unilateral and immediate.
  `leave_status` is unchanged: a request stays `pending` until the chain completes, and the ledger
  consumption happens in the transaction that completes it. A non-admin may never sign a step on
  their own request; an admin may, deliberately, so a company whose admin has no manager above them
  is not stuck. If an admin deactivates every step, approval degrades to the pre-chain single
  manager/admin decision rather than becoming impossible. *(2026-08-18; amends FR-14. Spec
  `2026-08-18-hr-role-and-locale-persistence-design.md`.)*
- **FR-37** ☑ **HR reports and export.** An `hr` or `admin` user gets `/manage/reports`: leave balance
  by employee, requests by period and status, absence by department, pending-approval ageing, and
  headcount by department, over a Jalali month range. Each downloads as a UTF-8-BOM CSV that opens
  directly in Excel with Farsi intact — no new dependency, reusing the existing credentials-export
  writer. Reports read through existing RLS and add no SECURITY DEFINER surface. Durations export as
  **decimal days**, not formatted strings, because HR sums and sorts them in the spreadsheet. The
  period is a URL parameter, so a report can be linked and reloaded. *(2026-08-18.)*

- **FR-38** ☑ **HR reviews and prints every request.** An `hr` or `admin` user gets
  `/manage/requests`: every request in the company in every status (pending, approved, rejected and
  cancelled), filterable by status, kind and free text over name / personnel number / tracking
  number. Each row opens `/print/request/[id]`, a printable sheet reproducing the client's own
  stationery — **BJ-F 50210(R0)** daily leave, **50208(R0)** hourly leave, **50207(R0)** hourly
  errand — with that form's own four signature boxes. The two signatures the app captures (requester,
  approver) are printed as images with their consent timestamps; جانشین, حراست and the HR box print
  empty for a wet signature until FR-36 fills them. The daily work errand has no photographed paper
  original and reuses the 50207 layout, saying so on the sheet. *(2026-08-18.)*

- **FR-39** ☑ **A taken personnel number is reported on the field.** Creating an employee with a
  personnel number that already exists names the problem beside the Personnel number input, with
  `aria-invalid` and `aria-describedby`, instead of the page-level banner. Root cause of the
  original bug: the database raises `personnel number already exists`, no rule in
  `lib/errors/db-error.ts` matched it, and the unmapped-error fallback turned it into "an
  unexpected error occurred". The unique-index message and `invalid personnel number` are mapped
  too, and errors now carry an optional `field` so placement is decided once, by the rule, rather
  than at each call site. No live check as the user types — deliberately, so the company's
  personnel numbering is not probeable. *(2026-08-18.)*
- **FR-40** ☑ **Bulk holiday upload.** Admin uploads a CSV of official holidays with a downloadable
  template carrying the same four fields as the form: date, Farsi name, English name, repeats
  yearly. The date column accepts Jalali or Gregorian, disambiguated by the year (below 1600 =
  Jalali), the same rule the employee import's hire-date column already uses. The whole file is
  validated before anything is written; a date that already exists is then **updated** rather than
  duplicated or skipped, so re-uploading a corrected file is the natural fix. Written through the
  existing `holidays` admin policies — no new RPC, and one upsert statement so the set lands
  atomically. Every bad line is listed by number so a file is never half-imported, and the result
  reports added and updated counts. *(2026-08-18.)*
- **FR-41** ☑ **Weekend frequency.** A weekday may be off **every week** or **every other week**,
  because the real working week is Friday off weekly and Thursday off fortnightly. The alternation
  is anchored on one admin-chosen reference date and alternates from it indefinitely; the week grid
  starts Saturday so a whole Iranian week shares one parity. `weekend_days` keeps its meaning and is
  not migrated — `biweekly_weekend_days` defaults to empty, making the new branch a no-op on every
  existing install. The rule lives once in `private.is_company_weekend`, mirrored by
  `lib/leave/weekend.ts`. Alternating days are **full** days off; fractional weekdays are out of
  scope, and a reference date is **required** whenever any day is fortnightly — without one the
  parity is undefined, so the save is refused rather than guessed. Work errands deliberately still
  ignore weekends (FR-30/FR-33). *(2026-08-18; extends FR-12 and FR-24.)*
- **FR-42** ☑ **Approval steps may name a person, and HR may configure them.** Admin **and hr** can
  add approval steps beyond the seeded manager + HR: either another role, or a **specific person**
  searchable by name or personnel number, whose signature is then required on every request. A
  named approver who is deactivated **blocks** the step and is flagged in Settings rather than
  falling back to their role or silently disappearing from the chain. Steps beyond the four boxes on
  the client's paper stationery print in an additional-approvals strip below them. **A named step
  admits that person ONLY — an admin may not override it**, because an override cannot be reconciled
  with a deactivated approver blocking the step, and naming someone means that signature
  specifically is required. Evidence rows key on the STEP rather than its role, so several named
  people may share a role without one of them completing another's step. The order-enforcement
  switch stays admin-only: it writes `work_settings`, which HR does not gain.
  *(2026-08-18; extends FR-36.)*

## Functional — Visibility (see also PERMISSIONS.md)

- **FR-16** ☑ **Employee** sees only **their own team's** time-off + their own requests.
- **FR-17** ☑ **Every manager** sees **company-wide** time-off (read), edits/approves only reports.
- **FR-18** ☑ **Security** staff see **everyone's** calendar and time-off (read-only).
- **FR-19** ☑ **Admin** sees and edits everything.
- **FR-25** ☑ A leave request's free-text **`reason` is private**: visible only to the requester,
  their manager, security, admin, and — since 2026-08-18 (FR-38) — **hr**. NOT to teammates. The team calendar shows coworkers' dates +
  status only. (Decided 2026-06-23; enforced in the Phase 3 team-calendar read path via the
  reason-less `team_leave_calendar` view — see PERMISSIONS.md.)

## Functional — UI / App shell

- **FR-20** ☑ **Home page = status board** (notification surrogate): employee sees own request
  statuses, balances, and **My Team** (manager, teammates, role/title context, upcoming time-off);
  manager additionally sees a pending-approval queue + reports' status.
- **FR-21** ☑ **Bottom tab bar**, role-driven. v1: Home · Request · Calendar · Profile/Settings;
  Admin & Manager get a Manage/Approvals tab. Future roles inject their own tabs.
- **FR-22** ☑ **Calendar view** of time-off, scoped by the viewer's visibility (FR-16–19).
  Supports both agenda/list and month-grid views; month cells show per-day off counts, visible names
  with overflow, and selected-day return-to-work details.
- **FR-23** ☑ **Settings**: switch language **Farsi ⇄ English**. The Persian (Jalali) calendar is
  the only calendar used by every picker and date display; it is no longer configurable. Calendar
  labels/digits follow the selected language, while user names are not translated. *(Calendar
  preference removed 2026-08-05.)*
- **FR-34** ☑ **The chosen language persists across every entry into the app.** `language_pref` is
  currently written by Settings and read by nothing that decides the locale, so any URL without an
  `/en` prefix — most importantly the PWA's `start_url: '/'` — renders Farsi regardless of the
  setting, which is why Settings can show English while the app shows Persian. The stored preference
  becomes authoritative **at entry** (carried by a `bj-locale` cookie plus an `app_locale` JWT claim,
  neither costing a database round-trip), while an explicit `/en` prefix in the URL still
  wins so deep links and the switcher keep working. `accept-language` stays ignored deliberately: a
  device's browser language must never override a worker's choice. **Accepted edge:** under
  `localePrefix: 'as-needed'` next-intl normalises `/fa/x` to `/x` before the app sees it, so a user
  whose preference is English cannot reach the Farsi UI by typing `/fa/…` — the preference wins,
  which is the point of the fix. *(2026-08-18.)*
- **FR-24** ☑ Admin can edit **work settings** (weekend days; default `[Friday]`) and the
  **holiday list** (add/edit/delete) at `/manage/settings`. Editor shipped in Phase 6; the
  authoritative Iranian 1404–1405 dates are entered in-app (placeholder seed retained).

## Non-functional

- **NFR-1** ☑ **Responsive** for mobile and desktop; **detect** device (UA + viewport) so future
  modules can serve mobile-optimized forms vs desktop dashboards.
- **NFR-2** ☑ **PWA**: installable to home screen; **persistent session** ("log in once").
- **NFR-3** ☑ **RTL** correctness in Farsi; clean LTR in English.
- **NFR-4** ☑ **Portability**: no proprietary cloud lock-in in data/auth; production self-hosts
  Supabase + Next.js with config-only changes.
- **NFR-5** ☑ **Security**: RLS on all employee-data tables; passwords hashed by Supabase Auth;
  **audit log** of admin/manager changes; minimize sensitive PII (avoid storing national ID unless
  required).
- **NFR-6** ☑ **Performance**: target a few hundred employees comfortably; list/calendar queries
  indexed. App-tab routes are prefetched after login and each page exposes a manual update pill for
  explicit refresh when fresher data is needed.
- **NFR-7** ☑ **Accessibility**: keyboard-navigable, adequate contrast, labelled controls; touch
  targets sized for factory-floor phone use.
- **NFR-8** ☑ **Documentation** stays current (CLAUDE.md, this file, DATA_MODEL, PERMISSIONS,
  TASKS, CHANGELOG, specs) so any agent can resume cold.

## Out of scope (v1)

Push/SMS/email notifications · payroll calculation · attendance/check-in · shift
scheduling · performance · recruitment · the non-HR modules (QC/finance/procurement). All are on
the roadmap (PLAN §6) and the schema is designed not to block them.
