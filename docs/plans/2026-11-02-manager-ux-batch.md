# 2026-11-02 — manager UX batch (owner request)

Owner answers (2026-11-02): absences card = fixed next 30 days, no picker/arrows; custom login
code = free text without spaces/@; editing the personnel number sets login code = new number;
approvals history = requests the viewer personally signed or rejected (admin: all decided).

## 1. Employees page only for `people` read (small)
- `lib/nav/tabs.ts` employees entry: drop the `hasReports` / manager branch.
- `manage/employees/page.tsx` (+ `[id]`, `/team` redirect): redirect to `/organization` without `people` read.
- Unit tests in `tests/unit` for tabs.

## 2. Home: absences card (small)
- One card "Approved absences in the next 30 days": approved requests overlapping today..today+30
  (`getUpcomingAbsences` switches to overlap), two sections: Work errands / Leave.
- Day picker board removed from Home (admin `/absences` page keeps its day board, gets the new card).
- Card renders right after the greeting (slot passed into `HomeBoardData`).

## 3. Admin login code + personnel number edit (DB)
- Migration: `app_create_employee` gains `p_login_code text default null`; admin only; validated
  `^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$`, no leading/trailing/double dot; unique case-insensitively
  (employee_code and auth email). Non-admin passing it → 42501.
- New `app_admin_set_personnel_no(p_user, p_personnel_no)`: admin only; updates `profiles.personnel_no`,
  `employee_code` (= new number), `auth.users.email`, `auth.identities` email; audit row.
- UI: New Employee form shows an editable login code input for admin (defaults to personnel no.);
  Edit Employee page: admin clicks the personnel number in the header → dialog to change it.
- SQL test file in `tests/sql/`.

## 4. Approvals history (DB)
- New `app_approval_history(p_limit, p_offset)`: decided requests with a `leave_request_approvals`
  row whose `approver_id = auth.uid()`; admin sees every decided request. Returns the caller's
  decision + time + note and the final status.
- Approvals page: "History" section under the queue, paged.

## Verify
tsc, lint, unit, SQL tests on a cloned DB, then apply locally, schema dump, UI check.
