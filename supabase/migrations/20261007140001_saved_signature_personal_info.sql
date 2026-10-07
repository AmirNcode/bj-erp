-- FR-52 saved signature + FR-53 personal information.
-- Spec: docs/specs/2026-10-07-saved-signature-and-personal-info-design.md.
--
-- Two new tables, both kept out of `profiles` so the views and policies that
-- expose profiles (team calendar, org chart, managers) cannot leak them:
--   user_signatures         one saved PNG per user, owner-only (not even admin).
--   employee_personal_info  one row per profile; owner + hr/admin of the company.
-- Adds only; the app version still running during the deploy keeps working.

-- ── validators (also used by the UI's mirror in lib/personal-info/fields.ts) ──

-- Iranian national ID (کد ملی): 10 digits, check digit = weighted sum mod 11.
create function private.is_valid_national_id(p text) returns boolean
    language plpgsql immutable
    set search_path to ''
    as $$
declare
  v_sum int := 0;
  v_rem int;
  v_chk int;
begin
  if p is null or p !~ '^[0-9]{10}$' then return false; end if;
  -- All-same-digit numbers pass the arithmetic but are never issued.
  if p ~ '^(.)\1{9}$' then return false; end if;
  for i in 1..9 loop
    v_sum := v_sum + substr(p, i, 1)::int * (11 - i);
  end loop;
  v_rem := v_sum % 11;
  v_chk := substr(p, 10, 1)::int;
  return (v_rem < 2 and v_chk = v_rem) or (v_rem >= 2 and v_chk = 11 - v_rem);
end; $$;

-- Sheba (Iranian IBAN): IR + 24 digits, ISO 13616 mod-97 = 1.
-- Rearranged: BBAN (22 digits) || 'IR' as 1827 || check digits.
create function private.is_valid_sheba(p text) returns boolean
    language plpgsql immutable
    set search_path to ''
    as $$
declare
  v_digits text;
  v_rem    int := 0;
begin
  if p is null or p !~ '^IR[0-9]{24}$' then return false; end if;
  v_digits := substr(p, 5) || '1827' || substr(p, 3, 2);
  for i in 1..length(v_digits) loop
    v_rem := (v_rem * 10 + substr(v_digits, i, 1)::int) % 97;
  end loop;
  return v_rem = 1;
end; $$;

-- Bank card number: 16 digits, Luhn.
create function private.is_valid_card_no(p text) returns boolean
    language plpgsql immutable
    set search_path to ''
    as $$
declare
  v_sum int := 0;
  v_d   int;
begin
  if p is null or p !~ '^[0-9]{16}$' then return false; end if;
  for i in 1..16 loop
    v_d := substr(p, i, 1)::int;
    if i % 2 = 1 then            -- 16 digits: odd positions from the left are doubled
      v_d := v_d * 2;
      if v_d > 9 then v_d := v_d - 9; end if;
    end if;
    v_sum := v_sum + v_d;
  end loop;
  return v_sum % 10 = 0;
end; $$;

grant execute on function private.is_valid_national_id(text) to authenticated;
grant execute on function private.is_valid_sheba(text) to authenticated;
grant execute on function private.is_valid_card_no(text) to authenticated;

-- ── permission seam (FR-51 D7): two new keys ─────────────────────────────────
create or replace function private.has_permission(uid uuid, p_permission text) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select case p_permission
    when 'employees.edit'     then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'departments.edit'   then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'accruals.run'       then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'roles.manager'      then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.view' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.edit' then private.is_admin(uid) or private.has_role(uid, 'hr')
    else false
  end;
$$;

-- ── user_signatures (FR-52) ─────────────────────────────────────────────────
create table public.user_signatures (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  signature_data text not null,
  source         text not null,
  updated_at     timestamptz not null default now(),
  constraint user_signatures_source check (source in ('drawn', 'upload')),
  -- Same bounded-PNG shape as leave_requests.signature_data: the saved image is
  -- copied verbatim into a request by the existing signed RPCs.
  constraint user_signatures_shape check (
    length(signature_data) between 100 and 350000
    and mod(length(signature_data), 4) = 2
    and signature_data ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
  )
);

comment on table public.user_signatures is
  'FR-52: one saved signature per user. Owner-only by RLS (no admin path). Requests keep their own copy.';

alter table public.user_signatures enable row level security;
revoke all on table public.user_signatures from anon;
revoke all on table public.user_signatures from authenticated;
grant select, insert, update, delete on table public.user_signatures to authenticated;

create policy user_signatures_owner on public.user_signatures for all to authenticated
  using (user_id = (select auth.uid()) and private.is_active((select auth.uid())))
  with check (user_id = (select auth.uid()) and private.is_active((select auth.uid())));

create function private.user_signatures_touch() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
  new.updated_at := now();
  return new;
end; $$;

create trigger user_signatures_touch
  before insert or update on public.user_signatures
  for each row execute function private.user_signatures_touch();

-- Audit without the image.
create function private.audit_user_signature() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    auth.uid(),
    case when tg_op = 'DELETE' then 'signature.deleted' else 'signature.saved' end,
    'user_signatures',
    coalesce(new.user_id, old.user_id),
    case when tg_op = 'DELETE' then null else jsonb_build_object('source', new.source) end
  );
  return coalesce(new, old);
end; $$;

create trigger user_signatures_audit
  after insert or update or delete on public.user_signatures
  for each row execute function private.audit_user_signature();

-- ── employee_personal_info (FR-53) ──────────────────────────────────────────
create table public.employee_personal_info (
  employee_id     uuid primary key references public.profiles(id) on delete cascade,
  company_id      uuid not null references public.companies(id),
  national_id     text,
  birth_cert_no   text,
  father_name     text,
  birth_date      date,
  birth_place     text,
  gender          text,
  marital_status  text,
  bank_name       text,
  bank_account_no text,
  sheba           text,
  card_no         text,
  mobile          text,
  home_phone      text,
  address         text,
  postal_code     text,
  emergency_name  text,
  emergency_phone text,
  insurance_no    text,
  education       text,
  military_status text,
  children_count  smallint,
  complete        boolean generated always as (
    national_id is not null and father_name is not null and birth_date is not null
    and sheba is not null and mobile is not null
  ) stored,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null,

  constraint epi_national_id     check (national_id is null or private.is_valid_national_id(national_id)),
  constraint epi_birth_cert_no   check (birth_cert_no is null or birth_cert_no ~ '^[0-9]{1,10}$'),
  constraint epi_father_name     check (father_name is null or char_length(btrim(father_name)) between 1 and 100),
  constraint epi_birth_date      check (birth_date is null or birth_date between date '1920-01-01' and date '2020-12-31'),
  constraint epi_birth_place     check (birth_place is null or char_length(btrim(birth_place)) between 1 and 100),
  constraint epi_gender          check (gender is null or gender in ('male', 'female')),
  constraint epi_marital_status  check (marital_status is null or marital_status in ('single', 'married')),
  constraint epi_bank_name       check (bank_name is null or char_length(btrim(bank_name)) between 1 and 100),
  constraint epi_bank_account_no check (bank_account_no is null or bank_account_no ~ '^[0-9]{5,20}$'),
  constraint epi_sheba           check (sheba is null or private.is_valid_sheba(sheba)),
  constraint epi_card_no         check (card_no is null or private.is_valid_card_no(card_no)),
  constraint epi_mobile          check (mobile is null or mobile ~ '^09[0-9]{9}$'),
  constraint epi_home_phone      check (home_phone is null or home_phone ~ '^0[0-9]{10}$'),
  constraint epi_address         check (address is null or char_length(btrim(address)) between 1 and 500),
  constraint epi_postal_code     check (postal_code is null or postal_code ~ '^[0-9]{10}$'),
  constraint epi_emergency_name  check (emergency_name is null or char_length(btrim(emergency_name)) between 1 and 100),
  constraint epi_emergency_phone check (emergency_phone is null or emergency_phone ~ '^0[0-9]{10}$'),
  constraint epi_insurance_no    check (insurance_no is null or insurance_no ~ '^[0-9]{6,12}$'),
  constraint epi_education       check (education is null or education in
    ('below_diploma', 'diploma', 'associate', 'bachelor', 'master', 'doctorate')),
  constraint epi_military_status check (military_status is null or military_status in
    ('completed', 'exempt', 'educational_exempt', 'eligible', 'not_applicable')),
  constraint epi_children_count  check (children_count is null or children_count between 0 and 20)
);

comment on table public.employee_personal_info is
  'FR-53: identity, bank, contact and employment details. Owner + hr/admin of the company (RLS). Never join into profile views.';

create index employee_personal_info_company_idx on public.employee_personal_info (company_id, complete);

alter table public.employee_personal_info enable row level security;
revoke all on table public.employee_personal_info from anon;
revoke all on table public.employee_personal_info from authenticated;
-- No insert/delete for users: the profile trigger inserts, the FK cascade deletes.
grant select, update on table public.employee_personal_info to authenticated;

create policy employee_personal_info_select on public.employee_personal_info for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or (private.has_permission((select auth.uid()), 'personal_info.view')
          and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
    )
  );

create policy employee_personal_info_update on public.employee_personal_info for update to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or (private.has_permission((select auth.uid()), 'personal_info.edit')
          and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()))
          -- An admin's record is admin-only (FR-51 D2): check the role row, so a
          -- deactivated admin stays protected too.
          and (private.is_admin((select auth.uid()))
               or not exists (select 1 from public.user_roles r
                               where r.user_id = employee_id and r.role = 'admin')))
    )
  )
  with check (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or (private.has_permission((select auth.uid()), 'personal_info.edit')
          and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
    )
  );

-- Pin the keys, stamp who and when.
create function private.personal_info_before_update() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
  if new.employee_id is distinct from old.employee_id
     or new.company_id is distinct from old.company_id then
    raise exception 'not permitted to modify restricted personal info fields' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

create trigger employee_personal_info_before_update
  before update on public.employee_personal_info
  for each row execute function private.personal_info_before_update();

-- Audit field NAMES only, never values.
create function private.audit_personal_info() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_fields text[];
begin
  if auth.uid() is null then return new; end if;
  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_fields
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value
     and n.key not in ('updated_at', 'updated_by', 'complete');
  if cardinality(v_fields) = 0 then return new; end if;
  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'personal_info.update', 'employee_personal_info', new.employee_id,
          jsonb_build_object('fields', to_jsonb(v_fields)));
  return new;
end; $$;

create trigger employee_personal_info_audit
  after update on public.employee_personal_info
  for each row execute function private.audit_personal_info();

-- Every profile gets its (empty) row, so lists can inner-join it.
create function private.profiles_create_personal_info() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  insert into public.employee_personal_info (employee_id, company_id)
  values (new.id, new.company_id)
  on conflict (employee_id) do nothing;
  return new;
end; $$;

create trigger profiles_create_personal_info
  after insert on public.profiles
  for each row execute function private.profiles_create_personal_info();

insert into public.employee_personal_info (employee_id, company_id)
select id, company_id from public.profiles
on conflict (employee_id) do nothing;

-- ── export / import (HR bulk work) ──────────────────────────────────────────

create function public.app_export_personal_info()
returns table (
  personnel_no text, employee_code text, full_name text, active boolean,
  national_id text, birth_cert_no text, father_name text, birth_date date, birth_place text,
  gender text, marital_status text, bank_name text, bank_account_no text, sheba text,
  card_no text, mobile text, home_phone text, address text, postal_code text,
  emergency_name text, emergency_phone text, insurance_no text, education text,
  military_status text, children_count smallint
)
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_count   int;
begin
  if not private.has_permission(v_uid, 'personal_info.view') then
    raise exception 'not permitted to export personal info' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;

  select count(*) into v_count from public.employee_personal_info where company_id = v_company;
  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'personal_info.export', 'employee_personal_info', null,
          jsonb_build_object('rows', v_count));

  return query
    select p.personnel_no, p.employee_code, p.full_name, p.active,
           i.national_id, i.birth_cert_no, i.father_name, i.birth_date, i.birth_place,
           i.gender, i.marital_status, i.bank_name, i.bank_account_no, i.sheba,
           i.card_no, i.mobile, i.home_phone, i.address, i.postal_code,
           i.emergency_name, i.emergency_phone, i.insurance_no, i.education,
           i.military_status, i.children_count
      from public.employee_personal_info i
      join public.profiles p on p.id = i.employee_id
     where i.company_id = v_company
     order by p.active desc, p.personnel_no nulls last, p.full_name;
end; $$;

revoke all on function public.app_export_personal_info() from public, anon;
grant execute on function public.app_export_personal_info() to authenticated;

-- p_rows: [{"personnel_no": "123", "<field>": "<value>", ...}]. Only keys present
-- with a non-null value are written; an empty cell never erases. One transaction.
create function public.app_import_personal_info(p_rows jsonb) returns jsonb
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid      uuid := auth.uid();
  v_company  uuid;
  v_is_admin boolean := private.is_admin(auth.uid());
  v_row      jsonb;
  v_pno      text;
  v_target   uuid;
  v_updated  int := 0;
  v_fields   constant text[] := array[
    'national_id','birth_cert_no','father_name','birth_date','birth_place','gender',
    'marital_status','bank_name','bank_account_no','sheba','card_no','mobile','home_phone',
    'address','postal_code','emergency_name','emergency_phone','insurance_no','education',
    'military_status','children_count'];
  v_key      text;
begin
  if not private.has_permission(v_uid, 'personal_info.edit') then
    raise exception 'not permitted to import personal info' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too many rows (max 2000)' using errcode = '22023';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;

  if (select count(distinct r->>'personnel_no') <> count(*) from jsonb_array_elements(p_rows) r) then
    raise exception 'duplicate personnel number in file' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_pno := v_row->>'personnel_no';
    select id into v_target from public.profiles
     where company_id = v_company and personnel_no = v_pno;
    if v_target is null then
      raise exception 'unknown personnel number: %', coalesce(v_pno, '(empty)') using errcode = '22023';
    end if;
    if not v_is_admin and exists (select 1 from public.user_roles
                                   where user_id = v_target and role = 'admin') then
      raise exception 'not permitted to edit an admin''s personal info: %', v_pno using errcode = '42501';
    end if;
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key <> 'personnel_no' and not (v_key = any (v_fields)) then
        raise exception 'unknown field: %', v_key using errcode = '22023';
      end if;
    end loop;

    update public.employee_personal_info i set
      national_id     = coalesce(v_row->>'national_id', i.national_id),
      birth_cert_no   = coalesce(v_row->>'birth_cert_no', i.birth_cert_no),
      father_name     = coalesce(v_row->>'father_name', i.father_name),
      birth_date      = coalesce((v_row->>'birth_date')::date, i.birth_date),
      birth_place     = coalesce(v_row->>'birth_place', i.birth_place),
      gender          = coalesce(v_row->>'gender', i.gender),
      marital_status  = coalesce(v_row->>'marital_status', i.marital_status),
      bank_name       = coalesce(v_row->>'bank_name', i.bank_name),
      bank_account_no = coalesce(v_row->>'bank_account_no', i.bank_account_no),
      sheba           = coalesce(v_row->>'sheba', i.sheba),
      card_no         = coalesce(v_row->>'card_no', i.card_no),
      mobile          = coalesce(v_row->>'mobile', i.mobile),
      home_phone      = coalesce(v_row->>'home_phone', i.home_phone),
      address         = coalesce(v_row->>'address', i.address),
      postal_code     = coalesce(v_row->>'postal_code', i.postal_code),
      emergency_name  = coalesce(v_row->>'emergency_name', i.emergency_name),
      emergency_phone = coalesce(v_row->>'emergency_phone', i.emergency_phone),
      insurance_no    = coalesce(v_row->>'insurance_no', i.insurance_no),
      education       = coalesce(v_row->>'education', i.education),
      military_status = coalesce(v_row->>'military_status', i.military_status),
      children_count  = coalesce((v_row->>'children_count')::smallint, i.children_count)
     where i.employee_id = v_target;
    v_updated := v_updated + 1;
  end loop;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'personal_info.import', 'employee_personal_info', null,
          jsonb_build_object('rows', v_updated));

  return jsonb_build_object('updated', v_updated);
end; $$;

revoke all on function public.app_import_personal_info(jsonb) from public, anon;
grant execute on function public.app_import_personal_info(jsonb) to authenticated;

notify pgrst, 'reload schema';
