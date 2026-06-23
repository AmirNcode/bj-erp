# PERMISSIONS & VISIBILITY

Source of truth for access control. Enforced by **Postgres Row-Level Security (RLS)** — the UI
only mirrors it. Every table holding employee data has policies.

## Roles

| Role | Meaning |
|---|---|
| **admin** | The owner. Full read/write across the company. Override on any decision. |
| **manager** | Leads a team. Reads company-wide time-off; edits/approves **direct reports** only. |
| **employee** | Standard worker. Self-service + own-team visibility. |
| **security** | Security department staff. **Read-only** visibility into **everyone's** calendar. |

A user may hold multiple roles (`user_roles` table). Highest applicable permission wins.

## Visibility matrix (time-off)

| Viewer | Whose time-off can they SEE | Whom can they EDIT / APPROVE |
|---|---|---|
| Employee | Own + **own team** | Self (limited profile fields) |
| Manager | **Everyone** (company-wide, read) | **Direct reports** (edit profile + approve leave) |
| Security | **Everyone** (read-only) | — |
| Admin | Everyone | Everyone (+ override approvals) |

## SQL helpers

```sql
has_role(uid uuid, r app_role) returns bool   -- EXISTS in user_roles
is_admin(uid)        := has_role(uid,'admin')
is_manager_of(uid, target) := EXISTS profile target WHERE target.manager_id = uid
same_team(uid, target)     := (SELECT department_id FROM profiles WHERE id=uid)
                              = (SELECT department_id FROM profiles WHERE id=target)
can_read_all(uid)    := is_admin(uid) OR has_role(uid,'manager') OR has_role(uid,'security')
```
Helpers are `SECURITY DEFINER` functions (with `SET search_path = ''`) to avoid recursive RLS on
`profiles`/`user_roles`. They live in a **`private` schema** that PostgREST does **not** expose, so
they are not callable via `/rest/v1/rpc/*` by `anon`/`authenticated` (closes an info-disclosure
surface); `EXECUTE` is granted to `authenticated` only. Policies reference them as `private.<fn>`.

## Policy intent per table

### `profiles`
- **SELECT**: self · `same_team` · `can_read_all`.
- **UPDATE**: `is_admin` (all fields) · `is_manager_of(target)` (managed subset) · self (own
  limited subset: language/calendar prefs, password handled by Auth, contact fields).
- **INSERT / deactivate**: `is_admin` only.

### `user_roles`
- **SELECT**: self · `can_read_all`.
- **INSERT/UPDATE/DELETE**: `is_admin` only. (Only the admin changes roles.)

### `departments`, `work_settings`, `holidays`, `leave_types`
- **SELECT**: any authenticated company member.
- **WRITE**: `is_admin` only.

### `leave_allocations`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **WRITE**: `is_admin` (managers may be allowed later; v1 = admin sets allocations).

### `leave_requests`
- **SELECT**: own · `same_team` (so employees see their team's calendar) · `can_read_all`.
- **INSERT**: self only, `status='pending'`, for own `employee_id`.
- **UPDATE**:
  - employee may **cancel** own `pending` request.
  - `is_manager_of(employee)` may set `approved`/`rejected`.
  - `is_admin` may set any status (override).
- **DELETE**: none (cancel via status; preserve history).

### `leave_ledger`
- **SELECT**: own · `is_manager_of` · `can_read_all`.
- **INSERT**: **server-side only** (Server Action / SQL function on approval & allocation). No
  direct client writes — clients must not fabricate balances.

### `audit_log`
- **SELECT**: `is_admin`.
- **INSERT**: `authenticated` with `WITH CHECK (actor_id = auth.uid())` — a user may only write log
  rows attributed to themselves (server actions set `actor_id` to the acting user). No
  `UPDATE`/`DELETE` policies — append-only.

## Notes

- The "managers see everyone, edit only reports" rule = **broad read, narrow write**. Read uses
  `can_read_all`; write uses `is_manager_of`.
- `same_team` gives employees their team calendar without exposing other teams.
- Validate every policy on **self-hosted Supabase** before production cutover (NFR-4).
