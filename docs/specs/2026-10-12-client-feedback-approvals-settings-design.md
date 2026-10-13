# Client feedback, 2026-10-12: security board, approvals, HR settings, carryover, per diem

Status: approved in chat by Amir on 2026-10-12. Built on `main`, independent of the unfinished FR-55
branch (`fr55-configurable-roles`), which absorbs the role notes in §8 when it resumes.

## 1. Security board (FR-56)

- Security does not approve. A migration deactivates every `approval_steps` row whose role is
  `security` or `admin` (§3). The CHECK `approval_steps_role_allowed` now allows those two roles only
  on an inactive row, and the step editor no longer offers them. Past signatures stay.
- New page `/absences` («غایبین تأییدشده», "Approved absences"): every **fully approved** request
  (`status = 'approved'`) covering one day — daily leave, hourly leave, daily errand, hourly errand.
  Defaults to today (Tehran); a Persian date picker moves it. Pending, rejected and cancelled never
  show. Columns: name, personnel no., department, kind (leave type or errand), all day or from–to.
  Errand location and leave reason are **not** shown.
- Audience: `security` and `admin` (permission `absences.view`). Security reads `leave_requests`
  company-wide through existing RLS already, so the page adds no new read surface.
- Placement (amended the same day): the board sits at the top of **security's Home screen**
  (`/home?date=`), not in a tab. `/absences` remains for admins via the Manage group.

## 2. Hourly leave: one per day, at most 4 hours (FR-57)

- At most **one** hourly leave request per person per day (pending or approved; rejected and
  cancelled do not count). Enforced in `private.submit_leave_impl`; message «برای این روز قبلاً
  مرخصی ساعتی ثبت شده است». Hourly errands are unaffected.
- `work_settings.max_hourly_minutes_per_day` stays a setting but is now capped at 240 (CHECK
  `<= 240`; any stored value above 240 is lowered to 240 by the migration). Default 240 unchanged.
  The settings form refuses more than 4 hours.

## 3. Admin is not an approval step; admin override (FR-58)

- `admin` is no longer a configurable step role (see §1). Pending requests still show for an admin.
- Approving as admin:
  - If the admin has a **natural** step on the request (they are the named approver, the direct or
    department manager, or hold the step's role, e.g. `hr`), the dialog signs that step by default,
    and offers a checkbox **"Approve all remaining steps (admin override)"**.
  - Otherwise the only action is the override, and the dialog says so.
  - The override writes one signed `leave_request_approvals` row per outstanding step — named-person
    steps included (amends FR-42's "no admin override on named steps") — and completes the request
    in the same transaction. Order enforcement does not apply to the override.
- `approve_leave_request` gains `p_override boolean default false` and `p_per_diem_rials bigint
  default null` (old three-argument calls still resolve). An admin call with no natural step
  overrides even when `p_override` is false.
- Rejection: an admin may reject any pending request (named steps included).
- An admin may still approve their own request (override only — they never hold a natural step on it).

## 4. HR edits company settings (FR-59)

- `/settings` (work start/end, hourly cap, weekly and every-other-week days off, official holidays
  incl. CSV import) opens to `hr` as well as `admin` (permission `settings.edit`).
- RLS: `work_settings` and `holidays` insert/update/delete admit `has_permission(uid,'settings.edit')`
  on the caller's own company. A trigger keeps `approval_order_enforced` and `hours_per_day`
  admin-only.

## 5. Unlimited carryover (FR-60)

- The Farvardin-1 `carryover_forfeit` step is removed from the accrual function and from its TS
  mirror: whatever remains at year end carries over in full, days and hours, no cap. Existing
  forfeit rows (none expected on real data) are left as history.
- `carryover_cap_minutes` columns stay (schema compatibility) but are no longer read; the policy
  editor hides the field.

## 6. Per diem on HR's step (FR-61)

- New `leave_requests.per_diem_rials bigint` (nullable, `>= 0`, errands only by CHECK).
- When the approval being signed includes a step with role `hr` (natural hr step, or an admin
  override that fills an hr step) **on an errand**, the approve dialog shows an optional
  «فوق‌العاده ماموریت (ریال)» amount. Sent anywhere else, the database refuses it.
- Audited in the step's audit row.

## 7. Finance sees completed approvals (FR-62)

- New page `/finance`: every fully approved request, filtered by a Jalali month range (default this
  month) and kind, with per diem column and total, CSV export (UTF-8 BOM, like FR-37).
- Data via `public.finance_approved_requests(p_from date, p_to date)`, SECURITY DEFINER, guarded by
  `has_permission(uid,'finance.view')` (finance, admin) and the caller's company. Returns only
  approved rows and non-sensitive columns (no signatures, no reason).
- Nav: top-level tab for finance; Manage group item for admin.

## 8. Notes for FR-55 (configurable roles)

New permission keys `absences.view`, `settings.edit`, `finance.view` go through
`private.has_permission`. When FR-55 replaces its body with a table lookup, presets must keep:
**security** = `absences.view` only (read approved absences; never an approver), **hr** gains
`settings.edit`, **finance** gains `finance.view`. Approval steps can no longer name the
`security` or `admin` roles.

## 9. Own personal information is view only (FR-63, added the same day)

- The owner reads their row on Profile › Personal information; the form renders read-only with a
  note. hr and admin edit other people's from Manage › Employees › Edit (hr never an admin's).
- Editing one's own row needs `personal_info.edit_own` — admin only today. FR-55 exposes it as a
  per-role switch ("may edit own personal information").
- Enforced in the `employee_personal_info_update` policy and in `app_import_personal_info` (an hr
  file containing hr's own row fails). Migration `20261012130001_personal_info_read_only_self.sql`.
- The Home "complete your profile" nudge asks only people who can edit their own info.

## 10. Follow-ups 2026-10-13 (FR-65–FR-67)

- **FR-65 «مرخصی خارج از لیست»** (Amir's answers): the 3 days go onto the Annual Leave balance
  (allocation ledger row); marriage only while marital status is single, once, and the grant sets it
  to married; bereavement once per death; HR may remove a grant made by mistake (reversing
  adjustment; a removed marriage grant restores the previous marital status). Annual Leave is found
  by `name_en = 'Annual Leave'`. Each bereavement grant needs a note (≤ 500 chars), migration
  `20261013140001`.
- **FR-66** hr may set approval-order enforcement.
- **FR-67** single-match auto-select in every person picker (600 ms pause in PersonSearch).
- The 4h / one-per-day hourly rule (FR-57) stays on hourly leave only, not hourly errands (confirmed).

## Testing

- SQL scenarios `tests/sql/client-feedback-2026-10-12.sql` (begin … rollback): one hourly per day,
  cap CHECK, admin natural vs override, override with named step, per diem allowed/refused, HR
  writes work_settings but not approval order, finance RPC guard, forfeit gone.
- Unit: approvals mirror (admin natural step, override), nav, settings validation (4h).
- Manual in the local stack (demo seed).
