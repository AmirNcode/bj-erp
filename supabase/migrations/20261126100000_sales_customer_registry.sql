-- FR-98 ERP › Sales customer registry (spec docs/specs/2026-11-26-sales-customer-registry-design.md §4, §5).
-- Customers get a full profile (English name, CEO, address, contractor rank + category, a contact
-- book), stored completeness (`missing`), two pick lists (cities, contractor categories) and a
-- province reference. Every new table is function-only, like the rest of Sales.
-- Additive only: the still-running old app keeps working until the swap.

-- ---------------------------------------------------------------- word key (search)
-- Must equal the TS nameKey (lib/sales/inquiry.ts): Persian / Arabic digits → ASCII, lower case,
-- ي → ی, ك → ک, then drop combining marks and everything that is not a letter or a digit
-- (ZWNJ, spaces, punctuation). [:alnum:] follows the database ctype (UTF-8: Unicode letters).
create function private.sales_word_key(p text) returns text
  language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p, '')), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يك', '01234567890123456789یک'),
             '[\u064B-\u065F\u0670\u06D6-\u06ED]', '', 'g'),
           '[^[:alnum:]]', '', 'g');
$$;

-- The folded, non-empty words of a search text (split on white space before folding).
create function private.sales_words(p text) returns text[]
  language sql immutable set search_path = '' as $$
  select coalesce(array_agg(k), '{}'::text[])
    from (select private.sales_word_key(w) as k
            from regexp_split_to_table(btrim(coalesce(p, '')), '\s+') as w) x
   where k <> '';
$$;

-- ---------------------------------------------------------------- reference: provinces
create table public.iran_provinces (
  code     text primary key check (code ~ '^[A-Z]{2}$'),
  name_fa  text not null check (char_length(name_fa) between 1 and 60),
  name_en  text not null check (char_length(name_en) between 1 and 60),
  position integer not null default 0
);
comment on table public.iran_provinces is 'FR-98: the 31 provinces of Iran (global reference, read through app_sales_customer_lists).';
alter table public.iran_provinces enable row level security;
revoke all on public.iran_provinces from public, anon, authenticated;

-- ---------------------------------------------------------------- company lists
create table public.sales_cities (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  province_code text not null references public.iran_provinces(code),
  name_fa       text not null check (char_length(btrim(name_fa)) between 1 and 80),
  name_key      text not null check (name_key <> ''),
  name_en       text check (name_en is null or char_length(btrim(name_en)) between 1 and 80),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  unique (company_id, province_code, name_key),
  unique (id, province_code)
);
comment on table public.sales_cities is 'FR-98: company city list per province (seeded with county seats; grows through "Create …" and Settings). Functions only.';
alter table public.sales_cities enable row level security;
revoke all on public.sales_cities from public, anon, authenticated;

create table public.sales_contractor_categories (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name_fa    text not null check (char_length(btrim(name_fa)) between 1 and 80),
  name_key   text not null check (name_key <> ''),
  name_en    text check (name_en is null or char_length(btrim(name_en)) between 1 and 80),
  active     boolean not null default true,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (company_id, name_key)
);
comment on table public.sales_contractor_categories is 'FR-98: contractor rank categories (رسته). Functions only.';
alter table public.sales_contractor_categories enable row level security;
revoke all on public.sales_contractor_categories from public, anon, authenticated;

-- ---------------------------------------------------------------- customer profile
alter table public.sales_import_batches drop constraint sales_import_batches_kind_check;
alter table public.sales_import_batches add constraint sales_import_batches_kind_check
  check (kind in ('ledger', 'inquiry', 'customers'));

alter table public.sales_customers
  add column name_en         text check (name_en is null or char_length(btrim(name_en)) between 1 and 200),
  add column name_en_key     text check (name_en_key is null or name_en_key <> ''),
  add column ceo_name        text check (ceo_name is null or char_length(btrim(ceo_name)) between 1 and 120),
  add column province_code   text references public.iran_provinces(code),
  add column city_id         uuid,
  add column address         text check (address is null or char_length(btrim(address)) between 1 and 500),
  add column rank            smallint check (rank is null or rank between 1 and 5),
  add column category_id     uuid references public.sales_contractor_categories(id) on delete restrict,
  add column missing         text[] not null default '{}'::text[],
  add column import_batch_id uuid references public.sales_import_batches(id) on delete set null,
  add column updated_at      timestamptz,
  add column updated_by      uuid,
  add constraint sales_customers_city_fkey foreign key (city_id, province_code)
    references public.sales_cities(id, province_code) on delete restrict,
  add constraint sales_customers_city_province check (city_id is null or province_code is not null),
  add constraint sales_customers_contractor_only
    check (kind = 'contractor' or (rank is null and category_id is null));
create unique index sales_customers_name_en_key on public.sales_customers (company_id, name_en_key)
  where name_en_key is not null;

create table public.sales_customer_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.sales_customers(id) on delete cascade,
  person      text not null check (char_length(btrim(person)) between 1 and 120),
  title       text check (title is null or char_length(btrim(title)) between 1 and 80),
  label       text not null check (label in ('office', 'mobile', 'fax', 'other')),
  phone       text not null check (phone ~ '^\+?[0-9]{5,15}$'),
  email       text check (email is null or (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  position    integer not null default 0
);
create index sales_customer_contacts_customer on public.sales_customer_contacts (customer_id, position);
comment on table public.sales_customer_contacts is 'FR-98: a customer''s contact book. Private: only sales_customers holders read it. Functions only.';
alter table public.sales_customer_contacts enable row level security;
revoke all on public.sales_customer_contacts from public, anon, authenticated;

-- ---------------------------------------------------------------- completeness
-- The empty required fields of a customer row, in form order (spec §4). p_contacts = its contact count.
create function private.sales_customer_missing_of(c public.sales_customers, p_contacts integer)
  returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when c.name_en is null then 'name_en' end,
    case when c.kind is null then 'kind' end,
    case when c.ceo_name is null then 'ceo_name' end,
    case when c.province_code is null then 'province' end,
    case when c.city_id is null then 'city' end,
    case when c.address is null then 'address' end,
    case when coalesce(p_contacts, 0) = 0 then 'contacts' end,
    case when c.kind = 'contractor' and c.rank is null then 'rank' end,
    case when c.kind = 'contractor' and c.category_id is null then 'category' end
  ], null);
$$;

create function private.sales_customer_missing_trg() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  new.missing := private.sales_customer_missing_of(new,
    (select count(*)::integer from public.sales_customer_contacts where customer_id = new.id));
  return new;
end $$;
create trigger sales_customers_missing before insert or update on public.sales_customers
  for each row execute function private.sales_customer_missing_trg();

-- A contact change re-runs the customer trigger (a no-op update of `missing` itself).
create function private.sales_contacts_missing_trg() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.sales_customers set missing = missing where id = old.customer_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.customer_id <> old.customer_id) then
    update public.sales_customers set missing = missing where id = new.customer_id;
  end if;
  return null;
end $$;
create trigger sales_customer_contacts_missing after insert or update or delete on public.sales_customer_contacts
  for each row execute function private.sales_contacts_missing_trg();

update public.sales_customers set missing = missing;

-- ---------------------------------------------------------------- permissions (FR-55 catalog)
create or replace function private.permission_keys() returns setof text
  language sql immutable set search_path = '' as $$
  select unnest(array['people','people_create','reset_employee_password','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'annual_leave_borrow','special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','finance_forms','travel_booking',
    'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own',
    'sales','sales_prices','sales_bonds','sales_decide','sales_reports','sales_settings','project_items',
    'sales_customers','sales_customers_import']);
$$;

create or replace function private.permission_allows(p_key text, p_level text) returns boolean
  language sql immutable set search_path = '' as $$
  select case
    when p_key in ('people_create','reset_employee_password','role_manager','role_assign','leave_accrual',
      'personal_info_own','annual_leave_borrow','special_leave','approval_delegate','travel_booking',
      'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly',
      'edit_requests_own','sales_decide','sales_settings','sales_customers','sales_customers_import') then p_level = 'edit'
    when p_key in ('calendar','reports','finance','finance_forms','sales_reports') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays',
      'sales','sales_prices','sales_bonds','project_items') then p_level in ('read','edit')
    else false end;
$$;

create or replace function private.permission_deps() returns table(key text, key_level text, needs text)
  language sql immutable set search_path = '' as $$
  values
    ('finance_forms','read','finance'),
    ('people_create','read','people'), ('reset_employee_password','read','people'),
    ('role_manager','read','people'), ('role_manager','read','leave_balances'),
    ('role_manager','read','calendar'), ('role_assign','read','people'),
    ('personal_info','read','people'), ('clearance','edit','people'),
    ('departments','read','people'), ('leave_balances','read','people'),
    ('leave_accrual','read','departments'), ('leave_requests','read','people'),
    ('approval_steps','read','people'), ('reports','read','people'),
    ('reports','read','leave_balances'), ('reports','read','leave_requests'),
    ('special_leave','read','people'), ('special_leave','read','leave_balances'),
    ('edit_leave_daily','read','leave_requests'), ('edit_leave_hourly','read','leave_requests'),
    ('edit_errand_daily','read','leave_requests'), ('edit_errand_hourly','read','leave_requests'),
    ('edit_requests_own','read','leave_requests'),
    ('sales_prices','read','sales'), ('sales_bonds','read','sales'), ('sales_decide','read','sales'),
    ('sales_reports','read','sales'), ('sales_settings','read','sales'), ('project_items','read','sales'),
    ('sales_customers','read','sales'), ('sales_customers_import','read','sales_customers');
$$;

-- Transition (spec §5): whoever could create customers before (sales = edit) keeps it.
insert into public.role_permissions (role_id, permission, level)
select rp.role_id, 'sales_customers', 'edit' from public.role_permissions rp
 where rp.permission = 'sales' and rp.level = 'edit'
   and not exists (select 1 from public.role_permissions x
                    where x.role_id = rp.role_id and x.permission = 'sales_customers');

revoke all on function private.sales_word_key(text) from public, anon, authenticated;
revoke all on function private.sales_words(text) from public, anon, authenticated;
revoke all on function private.sales_customer_missing_of(public.sales_customers, integer) from public, anon, authenticated;
revoke all on function private.sales_customer_missing_trg() from public, anon, authenticated;
revoke all on function private.sales_contacts_missing_trg() from public, anon, authenticated;
