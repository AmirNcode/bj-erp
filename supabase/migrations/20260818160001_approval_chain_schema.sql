-- =============================================================================
-- Migration: 20260818160001_approval_chain_schema.sql
-- Purpose  : Schema for the configurable approval chain — a request needs a
--            signed approval from every ACTIVE step configured for its kind,
--            instead of one manager/admin decision.
-- Requirement: FR-36 (amends FR-14)
-- Spec     : docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md §3
-- Depends  : 20260818130001_hr_role_enum.sql (uses the 'hr' enum value)
--
-- Schema only. The backfill is 20260818160002 and the engine is 20260818160003,
-- split so a failure in one leaves the others resumable — the migration ledger
-- records each file separately.
--
-- ── The single most important choice here: `leave_status` is UNCHANGED. ──────
--
-- A request stays 'pending' until every required step has approved, and only
-- then flips to 'approved' in the same transaction as the ledger write. No new
-- status value was added, so every existing query, view, index, RLS policy,
-- home-board card, calendar read and e2e assertion keeps working untouched. An
-- intermediate status would have forced changes through all of them.
--
-- ── Ordering is configuration, not code ─────────────────────────────────────
--
-- `approval_steps.step_order` says what the order IS; `work_settings.
-- approval_order_enforced` says whether it BINDS. It ships false, which is the
-- behaviour the owner asked for (either party may sign first). Turning it on
-- later makes the chain sequential with no code change, and reordering is an
-- UPDATE on step_order.
--
-- Idempotent: create table if not exists + guarded seeds. Safe to re-run.
-- =============================================================================

-- ── config: who must sign ────────────────────────────────────────────────────
create table if not exists public.approval_steps (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- WHICH role fills this step. 'manager' means the requester's OWN direct
  -- manager, resolved per request via private.is_manager_of — not "anybody
  -- holding the manager role", which would contradict FR-17's narrow-write rule.
  role         public.app_role not null,
  -- Which request kinds need it. Narrowing HR to leave-only later is a data
  -- change, not a code change.
  applies_to   public.request_kind[] not null default array['leave','errand']::public.request_kind[],
  step_order   int not null default 1,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint approval_steps_company_role_uniq unique (company_id, role),
  -- An employee cannot be a required approver of their own request, and
  -- 'security' is allowed here for the deferred حراست step even though nothing
  -- seeds it yet.
  constraint approval_steps_role_allowed check (role in ('manager','hr','security','admin')),
  constraint approval_steps_applies_to_nonempty check (array_length(applies_to, 1) >= 1)
);

comment on table public.approval_steps is
  'FR-36: which roles must sign a request, per company. step_order is binding only when work_settings.approval_order_enforced is true.';

create index if not exists approval_steps_company_active_idx
  on public.approval_steps (company_id, active, step_order);

-- ── evidence: one row per (request, step) ────────────────────────────────────
create table if not exists public.leave_request_approvals (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.leave_requests(id) on delete cascade,
  -- The step this row fills. Not a FK to approval_steps: config can be
  -- deactivated or reordered later, and recorded evidence must not change or
  -- disappear when it is.
  step_role     public.app_role not null,
  approver_id   uuid references public.profiles(id) on delete set null,
  decision      public.leave_status not null,
  signature_data       text,
  signature_consent_at timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  constraint leave_request_approvals_uniq unique (request_id, step_role),
  constraint leave_request_approvals_decision check (decision in ('approved','rejected')),
  constraint leave_request_approvals_note_len check (note is null or length(note) <= 500),
  -- Same bounded-PNG contract as leave_requests.signature_data. An approval must
  -- carry both evidence fields or neither; rejection carries neither (FR-14).
  constraint leave_request_approvals_signature_shape check (
    (signature_data is null and signature_consent_at is null)
    or (
      signature_data is not null
      and signature_consent_at is not null
      and length(signature_data) between 100 and 350000
      and mod(length(signature_data), 4) = 2
      and signature_data ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
    )
  )
);

-- Signed-ness is added by ALTER rather than inside CREATE TABLE so re-running
-- this migration corrects an earlier definition; `create table if not exists`
-- would silently leave an old constraint in place.
--
-- A rejection must be unsigned (FR-14 — rejection needs no signature). An
-- approval must be signed, EXCEPT for rows written by the backfill in
-- 20260818160002: approvals made before FR-14 shipped (2026-08-05) have no
-- approver signature at all, and refusing them here would abort the backfill on
-- a database that predates it. Exactly the allowance
-- `leave_requests_approver_signature_shape` already makes, for the same reason.
--
-- New rows cannot exploit that: this table has no client write policy, and its
-- only writer (approve_leave_request) validates the PNG before inserting.
alter table public.leave_request_approvals
  drop constraint if exists leave_request_approvals_signed_when_approved;
alter table public.leave_request_approvals
  add constraint leave_request_approvals_signed_when_approved check (
    decision = 'approved' or (decision = 'rejected' and signature_data is null)
  );

comment on table public.leave_request_approvals is
  'FR-36: one signed decision per (request, step). The request itself stays pending until every active applicable step has an approved row.';

create index if not exists leave_request_approvals_request_idx
  on public.leave_request_approvals (request_id);

-- ── does the order bind? ─────────────────────────────────────────────────────
alter table public.work_settings
  add column if not exists approval_order_enforced boolean not null default false;

comment on column public.work_settings.approval_order_enforced is
  'FR-36: when true, a step cannot be signed until every lower-ordered active step has been. Ships false — any order, whoever is free.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.approval_steps enable row level security;
alter table public.leave_request_approvals enable row level security;

-- Steps are company config: everyone active may read them (the UI shows the
-- chain's progress to the requester), only an admin may change them.
drop policy if exists "approval_steps_select" on public.approval_steps;
create policy "approval_steps_select" on public.approval_steps
  for select to authenticated
  using (private.is_active((select auth.uid())));

drop policy if exists "approval_steps_insert_admin" on public.approval_steps;
create policy "approval_steps_insert_admin" on public.approval_steps
  for insert to authenticated
  with check (private.is_admin((select auth.uid())));

drop policy if exists "approval_steps_update_admin" on public.approval_steps;
create policy "approval_steps_update_admin" on public.approval_steps
  for update to authenticated
  using (private.is_admin((select auth.uid())))
  with check (private.is_admin((select auth.uid())));

drop policy if exists "approval_steps_delete_admin" on public.approval_steps;
create policy "approval_steps_delete_admin" on public.approval_steps
  for delete to authenticated
  using (private.is_admin((select auth.uid())));

-- Approval rows inherit the request's own visibility exactly: whoever may read
-- the request may read who signed it. Mirrors leave_requests_select rather than
-- joining to it, because a join inside a policy on a table the policy also
-- guards invites recursion.
drop policy if exists "leave_request_approvals_select" on public.leave_request_approvals;
create policy "leave_request_approvals_select" on public.leave_request_approvals
  for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and exists (
      select 1 from public.leave_requests r
       where r.id = leave_request_approvals.request_id
         and (
           r.employee_id = (select auth.uid())
           or private.is_manager_of((select auth.uid()), r.employee_id)
           or private.has_role((select auth.uid()), 'security')
           or private.is_admin((select auth.uid()))
           or private.has_role((select auth.uid()), 'hr')
         )
    )
  );

-- NO client write policy, deliberately. Every row is written by
-- approve_leave_request / reject_leave_request inside their own transaction,
-- exactly like leave_ledger. A client that could insert here could forge a
-- signature.

grant select on public.approval_steps to authenticated;
grant select on public.leave_request_approvals to authenticated;
revoke all on public.approval_steps from anon;
revoke all on public.leave_request_approvals from anon;

-- ── seed: manager then hr, for every company, all request kinds ─────────────
-- Guarded by the (company_id, role) unique key so re-running changes nothing and
-- an admin's later edits to step_order/active are never stamped back.
insert into public.approval_steps (company_id, role, applies_to, step_order, active)
select c.id, 'manager'::public.app_role,
       array['leave','errand']::public.request_kind[], 1, true
  from public.companies c
on conflict (company_id, role) do nothing;

insert into public.approval_steps (company_id, role, applies_to, step_order, active)
select c.id, 'hr'::public.app_role,
       array['leave','errand']::public.request_kind[], 2, true
  from public.companies c
on conflict (company_id, role) do nothing;

drop trigger if exists approval_steps_set_updated_at on public.approval_steps;
create trigger approval_steps_set_updated_at
  before update on public.approval_steps
  for each row execute function public.set_updated_at();
