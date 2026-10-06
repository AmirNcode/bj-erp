-- =============================================================================
-- Migration: 20261005120001_department_codes_upper.sql
-- Purpose  : Department codes become 2-4 uppercase latin letters or digits.
-- Requirement: FR-46 (spec docs/specs/2026-10-05-org-chart-and-personnel-import-design.md §3)
-- Depends  : 20260713120001_employee_onboarding.sql (departments.code + departments_code_format)
--
-- The code stopped prefixing login codes on 2026-07-30 and nothing read it. The
-- client's personnel list now carries a short uppercase code per department
-- (ADM, AS1, QC …) and the bulk import matches departments on it, so the column
-- gets the format the client uses.
--
-- Existing rows on live data:
--   * lowercase codes are uppercased (qc → QC). The old format was lowercase
--     only, so two rows can never collide on case alone;
--   * codes that still do not fit (longer than 4, e.g. e2e `zz1a2b`) are
--     regenerated from the English name with the same rule as
--     lib/departments/code.ts generateDepartmentCode: first 4 latin chars,
--     'DEP' fallback, numeric suffix on collision truncating the base.
-- Codes are not used to log in (employee_code = personnel_no since FR-31), so no
-- user sees a difference.
--
-- Idempotent: the constraint is dropped and re-added; the updates are no-ops on
-- a second run.
-- =============================================================================

alter table public.departments drop constraint if exists departments_code_format;

update public.departments set code = upper(code) where code <> upper(code);

do $$
declare
  r      record;
  v_base text;
  v_cand text;
  n      int;
begin
  for r in
    select id, company_id, name_en
      from public.departments
     where code !~ '^[A-Z0-9]{2,4}$'
     order by created_at, id
  loop
    v_base := left(upper(regexp_replace(coalesce(r.name_en, ''), '[^A-Za-z0-9]', '', 'g')), 4);
    if length(v_base) < 2 then
      v_base := 'DEP';
    end if;
    v_cand := v_base;
    n := 2;
    while exists (
      select 1 from public.departments
       where company_id = r.company_id and code = v_cand and id <> r.id
    ) loop
      v_cand := left(v_base, 4 - length(n::text)) || n::text;
      n := n + 1;
    end loop;
    update public.departments set code = v_cand where id = r.id;
  end loop;
end $$;

alter table public.departments
  add constraint departments_code_format check (code ~ '^[A-Z0-9]{2,4}$');
