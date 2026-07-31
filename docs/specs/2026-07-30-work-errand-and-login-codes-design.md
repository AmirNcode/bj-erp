# Design Spec — Hourly Work Errand · Departments Card · Login Codes Without a Prefix

- **Date**: 2026-07-30
- **Status**: Approved (design). Implementation follows in this same branch.
- **Module**: HR → Time-Off, plus admin settings and employee onboarding.
- **Builds on**: `2026-07-29-hourly-accrual-replacement-design.md` (leave v2) and
  `2026-07-13-employee-onboarding-design.md` (in-DB employee codes).
- **Supersedes**: the employee-code formula `departments.code || '-' || personnel_no` from the
  onboarding spec, for **new accounts only**.

This is a **frozen point-in-time record** of the approved design. Living detail belongs in
`docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`, `docs/REQUIREMENTS.md`.

---

## 1. Context

The client sent a third paper form, `docs/forms/hourly_work_errand_form.jpeg` —
**BJ-F 50207(R0), فرم درخواست ماموریت ساعتی**. Its fields:

| Farsi | Meaning | Where it goes |
|---|---|---|
| شماره | number | see §5 — *not* a serial, it is the personnel number |
| تاریخ | date | `start_date` = `end_date` |
| نام · نام خانوادگی | first + last name | from the profile |
| شماره پرسنلی | personnel number | from the profile |
| محل ماموریت | errand location | new column `errand_location` |
| ساعت خروج | departure time | `start_time` |
| ساعت برگشت | return time | `end_time` |
| شرح ماموریت | errand description | reuses `reason` |
| 4 signature blocks | درخواست کننده · تصویب کننده · حراست · امور اداری و منابع انسانی | one approval step; multi-step stays deferred |

An errand is **work**, not leave. It deducts no balance and earns no entitlement. It matters
operationally because the worker is off-site during work hours: the gate (حراست) needs to know,
the manager authorises it, HR files it.

Alongside it the client clarified two things about numbering and login codes, recorded in §5 and §6.

## 2. Decisions

Fifteen questions were put to the user on 2026-07-30. The answers, as decided:

| # | Decision |
|---|---|
| D1 | An errand is a **discriminated row on `leave_requests`**, not a separate table. |
| D2 | An errand **conflicts with overlapping leave** and vice versa. |
| D3 | An errand is **not** bound by the work-hours window, **not** capped by the 4h/day hourly limit, and has **no** replacement person. |
| D4 | Approved by the **direct manager** in the **existing approvals queue**; entry point `/request/errand` plus a Home button. |
| D5 | Errands get their **own serial sequence** per Jalali year, separate from leave. |
| D6 | Errands appear on the **team calendar**, with محل ماموریت and شرح ماموریت hidden from teammates. |
| D7 | Department **code editing is deactivated** — the edit path only. Creation still needs a code. |
| D8 | The existing code-editing e2e test is **kept, skipped**, with a pointer to this spec. |
| D9 | *Add New Department* **moves** to Settings; it leaves the Employees page. |
| D10 | The department panel groups **Managers, then Workers**. |
| D11 | New employee codes **drop the department prefix**; existing accounts are untouched. |
| D12 | `departments.code` is **auto-generated** and its form field removed. |
| D13 | Department codes are **hidden** from the Settings card. |
| D14 | No login-screen hint about the mixed old/new code formats. |
| D15 | The app's serial is **relabelled شماره پیگیری / Tracking no.** so it cannot be confused with the paper form's شماره. |

Superseded mid-design: an earlier decision to build a bulk department-code editor with a
dirty-state confirmation dialog. The client dropped department-code editing entirely instead
(D7), so that work was never built. It is recorded here only so the reversal is legible.

## 3. Errand data model

One migration, `20260730130001_work_errand.sql`.

```
create type public.request_kind as enum ('leave', 'errand');

alter table public.leave_requests
  add column kind            public.request_kind not null default 'leave',
  add column errand_location text,
  alter column leave_type_id drop not null;
```

`leave_type_id` becoming nullable is the load-bearing choice. It is what makes an errand
structurally incapable of touching a balance: `approve_leave_request` and `cancel_leave_request`
both gate their ledger writes on

```sql
select affects_balance into v_affects from public.leave_types where id = v_type;
if v_affects then ...
```

With a NULL type that select returns no row, `v_affects` stays NULL, and the ledger write is
skipped. **No change to either function was needed** — verified against both bodies in
`20260730120001_security_review_fixes.sql` and `20260729130012_leave_replacement_guard.sql`.
An errand therefore cannot consume leave even if a future writer forgets to special-case it.

A CHECK makes a malformed row impossible, in the style of `leave_requests_unit_shape`:

```
leave_requests_kind_shape:
  kind = 'leave'  ->  leave_type_id is not null and errand_location is null
  kind = 'errand' ->  leave_type_id is null
                      and errand_location is not null and btrim(errand_location) <> ''
                      and length(errand_location) <= 200
                      and unit = 'hour'
```

The `unit = 'hour'` clause chains into the existing `leave_requests_unit_shape`, which already
forces one date, both times, `end_time > start_time`, and `day_part = 'full'`. The two constraints
compose; neither is relaxed.

**شرح ماموریت reuses `reason`.** It is the requester's own free text, needs exactly the FR-25
privacy `reason` already has, and is already excluded from `team_leave_calendar` by that view's
explicit column list. A second column would mean maintaining that privacy twice.

## 4. Errand write path

`private.submit_leave_impl` gains `p_kind` and `p_location`; a new wrapper mirrors the paper form:

```sql
public.submit_errand_request(p_date date, p_start_time time, p_end_time time,
                             p_location text, p_description text default null)
```

Per D3, the errand path **skips** the `allow_hourly` check (there is no type), the work-hours
window, the 4h/day cap, the balance check, and the replacement guard. It **keeps** the advisory
lock, the overlap check, and serial allocation. The overlap check needs no modification at all:
errands are `unit = 'hour'`, so the existing time-aware rule already makes an errand conflict with
an overlapping leave and with another errand, while leaving adjacent slots free.

**An errand may fall on a weekend or a holiday.** `compute_requested_minutes` returns 0 for a
non-working day, which the writer turns into a rejection. For `kind = 'errand'` that gate is
skipped and the pure time difference returned — urgent company business does not respect the
holiday calendar. This is a deliberate divergence from hourly leave, where the gate is correct.

### 4.1 A bug this design expected to fix, and did not need to

**Withdrawn during implementation — no such bug exists.** The design asserted that
`approve_leave_request` re-checked overlap with dates only, while `submit_leave_impl` checked dates
and times, so two hourly requests on one date would pass submission and fail approval.

That reading came from the **superseded** function body in `20260729130012_leave_replacement_guard.sql`.
The live definition is in `20260730120001_security_review_fixes.sql:804-819`, under a section
titled "Hourly-aware approval overlap", and already carries
`r.unit = 'day' or v_unit = 'day' or (r.start_time < v_et and r.end_time > v_st)` — the submit rule
exactly, modulo the deliberate `status = 'approved'` vs `in ('pending','approved')` difference that
distinguishes an approval re-check from a submission check.

`approve_leave_request` is therefore **not touched** by the errand migration. Re-emitting an
identical body would only create an opportunity for drift. Recorded rather than deleted because
"we checked, and the older body in the migration history is not the one that runs" is the useful
fact for the next reader.

## 5. Serial numbers, and what شماره actually means

The client clarified that the شماره printed on all three paper forms is simply the **personnel
number of the requester** — not a per-form sequence, as the leave v2 spec assumed (§7.6 of
`2026-07-29-hourly-accrual-replacement-design.md`, which read it as a serial HR files by).

The generated serials built in leave v2 are **kept** (D5, D15). They are genuinely useful: unique,
ordered, and year-scoped. But they no longer claim to be the form's شماره. Two consequences:

1. **The label changes to شماره پیگیری / Tracking no.** The value used to render with no label at
   all, so this adds one rather than replacing one. `lib/leave/serial.ts`'s header comment, which
   asserts the value is "the شماره on the client's paper forms", is corrected — it is not.
2. **Errands get their own sequence.** `leave_request_serials`' primary key becomes
   `(company_id, jalali_year, kind)`; existing counter rows become `kind = 'leave'`. Errands number
   from `1404-0001` independently, matching how BJ-F 50207 and BJ-F 50208 are separate form books.

Worth telling the client: the app's شماره پیگیری and the paper form's شماره are different numbers.
Harmless while the app is the system of record; relevant if HR ever cross-references the paper
archive.

## 6. Login codes without a department prefix

Migration `20260730130002_employee_code_no_prefix.sql` replaces `private.create_employee_impl` so
that

```
employee_code := personnel_no        -- was: departments.code || '-' || personnel_no
```

and the synthetic auth email follows it (`1042@bj-app.internal`). The department is still required
and still validated — it drives team scoping, manager defaults and directory reads. It simply stops
contributing to the code.

**Existing accounts are not migrated** (D11). `prod-1042` and `1042` both log in; the login field
already accepts any latin code. The mixed state is permanent and intentional.

Two consequences that are easy to miss:

- **The e2e cleanup regex stops matching.** `20260713120001` reaps test accounts with
  `employee_code ~ '^[a-z0-9]{2,6}-999[0-9]{7}$'`. New test accounts in the reserved
  `999#######` personnel range now produce a bare code, so without widening that pattern to
  `^999[0-9]{7}$` every future e2e run would leave rows behind — on the client's own database,
  since that is where e2e runs. Both patterns are kept, so old test rows still reap.
- **`employee_code` uniqueness is global, not per company.** The prefix used to keep `prod-1042`
  and `acme-1042` apart. Bare numbers collide. This is irrelevant at one company and a real
  constraint on the multi-tenant plan in `PLAN.md`; a future second tenant needs either a
  per-company unique index plus a company-aware login lookup, or its own prefix scheme. Recorded
  so it is a known cost rather than a surprise.

### 6.1 `departments.code` becomes vestigial

Nothing reads it once the prefix is gone. Rather than drop the column — the client said they would
revisit codes later — it is kept `NOT NULL` and unique, but no human touches it again (D12, D13):

- **Removed from the Add Department form.** `createDepartment` derives the code from the English
  name (first 4 latin characters, lowercased, the rule `suggestDepartmentCode` already uses),
  appends a digit suffix when taken, and retries on a `23505` race so two admins creating
  departments at once cannot fail. Fallback base `dep` when the name yields fewer than two latin
  characters, so a Farsi-only English field still produces a valid code.
- **Hidden from the Settings card**, from the "existing departments" list on the create form, and
  from the creation confirmation. A code that prefixes nothing is a number an admin should not be
  invited to reason about.
- `updateDepartmentCode` and the `departments_update_admin` RLS policy **stay in place**,
  unreachable from the UI, so the feature can return without a migration (D7).

## 7. Settings → Departments

`DepartmentCodesForm` becomes `DepartmentsCard`, retitled from "کد بخش‌ها" to **واحدهای سازمانی /
Departments**, listing names only. Each row is a button opening a members dialog; the card ends
with **افزودن واحد**, which navigates to `/manage/departments/new` — whose Cancel now returns to
Settings rather than the Employees list. The Employees page loses its copy of the button (D9).

The dialog (D10) shows the department name, then a **Managers** group — anyone holding the
`manager` role in that department, plus the department's own `manager_id` — then a **Workers**
group, both sorted by name, with an empty state for a department nobody is in. Data comes from a
new admin-only `getDepartmentMembers(departmentId)` server action reading `profiles` + `user_roles`
under the existing `can_read_all` policies; no new RLS.

Radix `Dialog` supplies outside-click and Esc dismissal. Its close button is already positioned
`top-4 end-4`, which renders **top-left under RTL Farsi** and top-right under LTR English — the
requested placement, with correct mirroring, without overriding the primitive.

## 8. Testing

- **Unit** — `lib/leave/errand.ts` duration and validation mirroring the SQL; department-code
  auto-generation including collision suffixes and the `dep` fallback; `buildEmployeeCode`
  collapsed to the personnel number.
- **E2E** — errand submit → appears in My Requests → manager approves → visible on the calendar
  with the location hidden from a teammate; department members dialog opens, groups, and closes by
  X, outside click, and Esc; Add Department from Settings with Cancel returning there; employee
  creation yielding a bare numeric login code that then logs in.
- **Repaired** — four assertions of `/^[a-z0-9]{2,6}-999[0-9]{7}$/` in `tests/e2e/_helpers.ts`,
  `approval.spec.ts` and `team.spec.ts`, plus the helper that extracts a generated code to log in
  with.
- **Skipped** — the department-code editing test, with a comment pointing at D7.

## 9. Deployment

Both migrations stack on leave v2, which is **still not applied to the client's server**. Nothing
here reaches them until that backlog clears, and the ordering matters: leave v2's serial migration
must run before `20260730130001` re-keys the counter table.

Neither migration backfills. `20260730130002` changes only the behaviour of a function, so it is
safe to re-run and safe to roll back by restoring the previous function body.

## 10. Deferred, unchanged

Multi-step approval with the four signature blocks (درخواست کننده · تصویب کننده · حراست · امور
اداری و منابع انسانی) remains deferred to its own spec. The errand form carries the same four, so
it strengthens the case without changing the plan. Signature and insurance evidence likewise stay
where leave v2 left them — the next step there is a question for the client's insurer, not code.
