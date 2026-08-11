# REQUIREMENTS

Numbered and traceable. `FR` = functional, `NFR` = non-functional. Status: ☐ todo · ◐ partial ·
☑ done. Statuses reflect the current build: v1 (Phases 0–6) is complete and merged to `main`.

## Functional — Identity & Org

- **FR-1** ☑ A single **admin** (the owner) can create, edit, deactivate employees.
- **FR-2** ☑ Admin can assign/change an employee's **role(s)**, **team/department**, and **manager**.
- **FR-3** ☑ Roles: **admin, manager, employee, security**. A user may hold more than one.
- **FR-4** ☑ Org model: company → departments (3 teams + 1 Security department) → employees, with
  a **manager hierarchy** (`manager_id` self-reference).
- **FR-5** ☑ **Managers** can edit employees that **directly report** to them (subset of fields).
- **FR-6** ☑ Employees can edit a limited set of their own profile fields.
- **FR-7** ☑ Login is **username (employee code) + password**, issued by admin. **No email
  required.** Self-service password change (Profile → Change password; verifies current password).

## Functional — Time-Off

- **FR-8** ◐ Configurable **leave types** seeded with Iranian statutory defaults: paid **annual**
  (~26 working days/yr), **sick**, **unpaid**. Admin can add/edit types.
- **FR-9** ☑ Per-employee, per-type **yearly allocation** (entitlement).
- **FR-10** ☑ **Balance ledger**: every allocation/consumption/adjustment is a ledger row; balance
  is derived, auditable.
- **FR-11** ☑ Employee submits a request: type, date range, **full or half day** (am/pm). Schema
  reserves room for **hourly** leave later without migration.
- **FR-12** ☑ **Working-day count** excludes configured **weekend** days and **holidays**;
  half-day = 0.5. Computed **server-side**.
- **FR-13** ☑ Paid-leave forms show the **requested duration**, **projected remaining paid
  balance**, and any **unpaid excess** before submit. A request may exceed the available paid
  balance: approval atomically consumes only the available paid minutes, leaves that balance at
  zero, and records the rest as unpaid time. Durations use the configured workday, default 8 hours.
  *(Extended 2026-08-05.)*
- **FR-14** ☑ **Approval**: the employee's **direct manager** approves/rejects; **admin can
  override** any decision. Approval requires the deciding manager/admin to draw a fresh digital
  signature and explicitly authorize its use; rejection requires neither. The signature, consent
  timestamp, decision, audit event, and ledger update are committed atomically. *(Extended
  2026-08-05.)*
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

## Functional — Visibility (see also PERMISSIONS.md)

- **FR-16** ☑ **Employee** sees only **their own team's** time-off + their own requests.
- **FR-17** ☑ **Every manager** sees **company-wide** time-off (read), edits/approves only reports.
- **FR-18** ☑ **Security** staff see **everyone's** calendar and time-off (read-only).
- **FR-19** ☑ **Admin** sees and edits everything.
- **FR-25** ☑ A leave request's free-text **`reason` is private**: visible only to the requester,
  their manager, security, and admin — NOT to teammates. The team calendar shows coworkers' dates +
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
