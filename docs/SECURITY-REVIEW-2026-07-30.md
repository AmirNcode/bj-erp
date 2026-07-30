# Codebase and security review — 2026-07-30

Scope: the Next.js application, all server actions, Supabase schema/RLS/functions,
authentication flow, deployment scripts, Docker/Caddy configuration, and the running local
database/container stack.

The review combined source inspection with live catalog checks (`pg_policies`, function owners,
function grants, view grants), rollback-only role simulations, unit/type/lint/build gates, and a
production-browser smoke test. The migration containing the database fixes is
`supabase/migrations/20260730120001_security_review_fixes.sql`.

## Findings and fixes

| Severity | Finding | Impact before the fix | Fix / proof |
|---|---|---|---|
| High | Deactivation was cosmetic | An inactive employee could keep or obtain an Auth session, read their own leave records, submit/cancel requests, and call employee RPCs. | Added `private.is_active`, active-gated RLS/views/RPCs, fail-closed app layout, and login-time profile check + session clear. Live inactive-user simulation sees one profile shell and **zero** company, request, ledger, or calendar rows. |
| High | Reporting relationship granted manager authority without the manager role | Removing a user's manager role did not remove approval, employee-edit, or broad-read powers while reports still pointed to them. | `private.is_manager_of` now requires an active manager role and same-company relationship. Rollback test after deleting the role returned false for both manager authority and broad read. |
| High | Audit rows could be forged and real audit writes were best-effort | Any signed-in user could insert arbitrary audit events attributed to themselves; app actions ignored audit insert errors. | Removed authenticated audit INSERT permission/policy. Actual direct profile/config changes are now recorded by owner-run triggers; privileged RPCs keep their transactional audit writes. Live grant check is false and a rollback update wrote exactly one audit row. |
| High | Guarded role/profile creation RPCs could be bypassed | Admin clients could directly mutate `user_roles`, bypassing atomic replacement, the self-lockout guard, and audit; direct profile insertion could orphan Auth/profile state. | Removed direct authenticated role writes and profile inserts. `app_set_user_roles` / `app_create_employee` remain the only runtime paths. |
| High | The single company row could be deleted at runtime | The admin DELETE policy could cascade through the HR schema and orphan Auth accounts. There is no company-lifecycle feature in v1. | Removed runtime company INSERT/UPDATE/DELETE policies and grants. Company lifecycle is installer/migration-only. |
| High | Bulk password reset was not atomic | If reset 2 of 10 failed, earlier passwords were already changed but no credentials were returned, locking those employees out. | Added `app_bulk_set_employee_passwords(jsonb)`: validates the complete 1–100-user payload, then changes every password in one PostgreSQL transaction. Live valid-call test passed under rollback. |
| Medium | Password reset authority accepted weak/missing targets; bcrypt truncation was invisible | The reset RPC accepted passwords under 8 characters, silently logged success for unknown users, and all password writers accepted more than bcrypt's 72-byte input limit. | Authority-layer min/max checks, exact target row check, client max length, localized errors, and a 72-character regression test. |
| Medium | Hourly approval used date-only overlap | Two valid non-overlapping hourly requests on the same date could be submitted, but the second could not be approved. | Approval now applies the shared strict time predicate. Live rollback test approved both 07:00–08:00 and 08:00–09:00 requests. |
| Medium | Approval cover warning also used date-only overlap | Managers saw a false replacement conflict when hourly absences shared a date but not a time. | Added and tested `leavePeriodsOverlap`; approval reads now include unit/times and use it. |
| Medium | A manager could be assigned as their own manager | A manager-role employee could then satisfy the relationship predicate for their own request. | Added `profiles_manager_not_self`, server validation, localized error, and removed the current employee from manager options. |
| Medium | The only active administrator could be deactivated | The installation could be left with nobody able to administer or reactivate accounts. | Added a database invariant/trigger that refuses to deactivate the last active admin. |
| Medium | Submit silently ignored accrual failure | A newly earned balance could fail to post, then the request could be rejected as unaffordable using stale data. | Read-only balance pages still tolerate stale accrual, but daily/hourly submit now stops and reports the accrual error. |
| Medium | Installer address input was written into a root-sourced `.env` without validation | Shell syntax/newlines in interactive host or port input could become commands on a later root run. Older secret files could also remain too permissive. | Host and port allow-list/range validation; existing `.env` is forced to mode 600 before sourcing. |
| Medium | App container ran as root | A compromised Next.js process had unnecessary root privileges inside the container. | Runtime uses `USER node`, `no-new-privileges`, and drops all Linux capabilities. Live container inspection confirms all three. |
| Medium | Production page had a React hydration mismatch | The server formatted the “Updated” time in UTC while the browser used the device timezone, causing React error #418. | Formatting is pinned to the company timezone (`Asia/Tehran`) with a regression test. |
| Low | Calendar view had excessive table-style grants | `authenticated` held INSERT/UPDATE/DELETE-style privileges on a read-only joined view (writes failed structurally, but the grants were unnecessary). | Revoked all and granted SELECT only; live privilege checks confirm writes are false. |
| Low | Unbounded leave reason and malformed settings/date inputs | Direct action/RPC calls could store oversized reason text or report success for impossible dates, invalid windows, or missing rows. | 500-character DB constraint; strict Gregorian/work-window/cap validation; all relevant mutations require exactly one returned row. |
| Low | Missing browser hardening / process disclosure | Responses lacked CSP/HSTS/cross-origin isolation headers and exposed `X-Powered-By`. | Added CSP (including the configured Supabase API origin), HSTS, COOP/CORP and disabled the powered-by header. Local HTTPS response verified. |
| Low | Project lint command scanned hidden generated worktrees | `npm run lint` produced 13,587 false problems from `.claude/**/.next`, hiding real source findings. | Added generated/local-worktree ignores; lint now exits cleanly on project source. |
| Low | Refresh action accepted arbitrary absolute paths | Any active user could feed unusual paths into cache revalidation. | Requires an active profile and a bounded `fa`/`en` app-local route pattern. |

## Review checks that found no issue

- No tracked `.env`, private key, database dump, backup archive, or embedded production secret.
- No `dangerouslySetInnerHTML`, `eval`, `new Function`, browser `innerHTML`, or command-execution
  use in the application.
- All live exposed `SECURITY DEFINER` functions are owner-run with a fixed empty `search_path`;
  privileged public RPCs are revoked from `anon` and self-guard.
- Leave reasons remain absent from the explicit `team_leave_calendar` column list.
- The app container receives the anon key only; no service-role key is passed to it.

## Verification

- Unit tests: 35 files / 217 tests passing after the fixes.
- `npm run lint`: passing.
- `npx tsc --noEmit`: passing.
- `npm run build`: production build passing.
- Migration applied and replayed successfully as `supabase_admin` on PostgreSQL 15.
- Live rollback-only SQL checks: inactive RLS, removed-manager authority, audit trigger,
  atomic password reset, and adjacent-hourly approval all passing.
- Docker image rebuilt and current app container recreated; database/auth/rest containers were
  not replaced. Runtime log is clean and the container is non-root/capability-free.
- Browser: login, authenticated home, hourly route, time selection, and two-hour preview render;
  a fresh production-console pass had no application errors (browser-extension warnings excluded).

## Review limitation

`npm audit` could not be run because the environment blocked sending the dependency manifest to
the external npm registry without separate data-transfer approval. Lockfile review, local build,
typecheck, lint, and tests were completed; a registry-backed vulnerability check remains a release
gate on a network-authorized machine.
