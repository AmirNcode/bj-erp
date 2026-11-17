-- =============================================================================
-- Migration: 20261116200000_sales_tables.sql
-- Purpose  : ERP › Sales module (FR-94) — tables, permission catalog items, seed.
-- Spec     : docs/specs/2026-11-16-sales-rfp-module-design.md (§15 wins)
--
-- Access is function-only, like travel booking (FR-70): every table here has RLS on
-- and NO client policy or grant. Reads and writes go through the app_sales_* /
-- app_project_* SECURITY DEFINER functions of 20261116200100_sales_functions.sql,
-- which check private.has_perm and leave price / guarantee values out of the JSON
-- of a caller who may not see them.
-- =============================================================================

-- ---------------------------------------------------------------- settings
create table public.sales_settings (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  next_record_no integer not null default 1 check (next_record_no >= 1),
  warn_days      integer not null default 7 check (warn_days between 0 and 365),
  validity_days  integer not null default 90 check (validity_days between 1 and 3650),
  doc_template   text[] not null default '{}'
);
comment on table public.sales_settings is 'FR-94: per-company Sales settings. Functions only.';

-- ---------------------------------------------------------------- customers
create table public.sales_customers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 200),
  -- lower-case, single-spaced: how a typed or imported name is matched.
  name_key   text not null,
  kind       text check (kind in ('government','contractor')),
  notes      text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (company_id, name_key)
);
comment on table public.sales_customers is
  'FR-94: buyers and clients (end users) named on Sales records. Created by typing a new name or by the ledger import.';

-- ---------------------------------------------------------------- flows and stages
create table public.sales_flows (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind       text not null check (kind in ('bid','contract')),
  name_fa    text not null,
  name_en    text not null,
  unique (company_id, kind)
);

create table public.sales_stages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  flow_id       uuid not null references public.sales_flows(id) on delete cascade,
  position      integer not null,
  name_fa       text not null check (char_length(btrim(name_fa)) between 1 and 80),
  name_en       text not null check (char_length(btrim(name_en)) between 1 and 80),
  -- The fixed vocabulary reports and rules rely on; names are free.
  kind          text not null default 'open' check (kind in ('open','lost','no_bid','cancelled','done')),
  -- Stages with behaviour: the bid decision gate, the optional pricing step, submission.
  action        text check (action in ('decide','quote','submit')),
  -- Stable name of a seeded stage (the ledger import maps its Status column on it);
  -- survives a rename. Null on stages added later.
  code          text,
  owner_role_id uuid references public.roles(id) on delete set null,
  -- Record columns or custom field keys that must be filled to move forward out of this stage.
  required      text[] not null default '{}',
  active        boolean not null default true
);
create index sales_stages_flow on public.sales_stages (flow_id, position);
comment on table public.sales_stages is
  'FR-94: configurable stages of a flow. Never deleted (records point at them); retired with active=false.';

-- ---------------------------------------------------------------- custom fields
create table public.sales_field_defs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  entity       text not null check (entity in ('rfp','item')),
  -- Always x_…: can never collide with a real column or a built-in item column.
  key          text not null check (key ~ '^x_[a-z0-9_]{1,38}$'),
  label_fa     text not null check (char_length(btrim(label_fa)) between 1 and 80),
  label_en     text not null check (char_length(btrim(label_en)) between 1 and 80),
  type         text not null default 'text' check (type in ('text','number','date','select','yes_no')),
  options      text[] not null default '{}',
  position     integer not null default 0,
  show_in_list boolean not null default false,
  active       boolean not null default true,
  unique (company_id, entity, key)
);
comment on table public.sales_field_defs is
  'FR-94: the company''s library of extra columns for records (entity rfp) and item rows (entity item). Values live in custom jsonb.';

-- ---------------------------------------------------------------- import batches
create table public.sales_import_batches (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  file_name     text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  created_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0
);

-- ---------------------------------------------------------------- records
create table public.sales_rfps (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  record_no           integer not null check (record_no >= 1),
  revision            integer not null default 0 check (revision >= 0),
  buyer_id            uuid references public.sales_customers(id),
  client_id           uuid references public.sales_customers(id),
  customer_ref        text check (char_length(customer_ref) <= 200),
  project_site        text check (char_length(project_site) <= 200),
  source              text check (source in ('website','email','other')),
  title               text not null check (char_length(btrim(title)) between 1 and 300),
  description         text check (char_length(description) <= 4000),
  received_on         date,
  flow_id             uuid not null references public.sales_flows(id),
  stage_id            uuid not null references public.sales_stages(id),
  owner_id            uuid references public.profiles(id) on delete set null,
  -- A ledger name that matched no employee.
  in_charge_text      text check (char_length(in_charge_text) <= 200),
  bid_decision        text not null default 'pending' check (bid_decision in ('pending','bid','no_bid')),
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz,
  decision_reason     text check (char_length(decision_reason) <= 2000),
  needs_quote         boolean not null default false,
  needs_bond          boolean not null default false,
  proposal_due        date,
  quote_due           date,
  bond_due            date,
  submitted_on        date,
  delivery_method     text check (delivery_method in ('hand','courier')),
  received_by         text check (char_length(received_by) <= 200),
  validity_days       integer check (validity_days between 1 and 3650),
  bid_result          text check (bid_result in ('won','lost','cancelled')),
  result_at           timestamptz,
  result_by           uuid references public.profiles(id) on delete set null,
  result_reason       text check (char_length(result_reason) <= 2000),
  currency            text check (currency ~ '^[A-Z]{3}$'),
  -- Price values: only in the JSON of a caller with sales_prices.
  our_price           numeric(18,2) check (our_price >= 0),
  winning_bid         numeric(18,2) check (winning_bid >= 0),
  winner_name         text check (char_length(winner_name) <= 200),
  total_value         numeric(18,2) check (total_value >= 0),
  -- Contract phase (the ledger's columns).
  order_date          date,
  contract_start      date,
  delivery_amount     numeric check (delivery_amount >= 0),
  delivery_unit       text check (delivery_unit in ('day','week','month')),
  -- The ledger's duration when it is not one number ("4-12").
  delivery_text       text check (char_length(delivery_text) <= 100),
  delivery_date       date,
  prepayment          boolean,
  prepayment_date     date,
  addendum            boolean,
  custom              jsonb not null default '{}' check (jsonb_typeof(custom) = 'object'),
  -- Per tree depth, the ordered column keys the Items table shows for this record.
  item_columns        jsonb check (item_columns is null or jsonb_typeof(item_columns) = 'object'),
  -- Last dash number handed out at level 1. Only ever grows: numbers are never reused.
  node_seq            integer not null default 0,
  import_batch_id     uuid references public.sales_import_batches(id) on delete set null,
  edited_after_import boolean not null default false,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id) on delete set null,
  updated_at          timestamptz not null default now(),
  unique (company_id, record_no)
);
create index sales_rfps_stage on public.sales_rfps (stage_id);
create index sales_rfps_batch on public.sales_rfps (import_batch_id) where import_batch_id is not null;
comment on table public.sales_rfps is
  'FR-94: one record per RFP / contract; record_no is the company''s record ID and the root of the item numbers (project_nodes.code). Functions only.';

-- ---------------------------------------------------------------- the ID tree
-- Module-neutral on purpose (no sales_ prefix): later modules (QC) hang their rows on a node id.
create table public.project_nodes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  rfp_id       uuid not null references public.sales_rfps(id) on delete cascade,
  parent_id    uuid references public.project_nodes(id) on delete cascade,
  -- The dash number among its siblings, and the full number (8997-1-3).
  seq          integer not null check (seq >= 1),
  code         text not null,
  depth        integer not null check (depth >= 1),
  -- Last dash number handed out to a child. Only ever grows.
  child_seq    integer not null default 0,
  description  text check (char_length(description) <= 2000),
  product_type text check (char_length(product_type) <= 200),
  size         text check (char_length(size) <= 200),
  rating       text check (char_length(rating) <= 200),
  qty          numeric check (qty >= 0),
  unit         text check (char_length(unit) <= 40),
  custom       jsonb not null default '{}' check (jsonb_typeof(custom) = 'object'),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  unique (company_id, code)
);
create index project_nodes_rfp on public.project_nodes (rfp_id);
create index project_nodes_parent on public.project_nodes (parent_id);
comment on table public.project_nodes is
  'FR-94: mother-daughter numbering under a record (item, part, …). seq numbers are permanent; a deleted row retires its number. Functions only.';

create table public.sales_item_prices (
  node_id    uuid primary key references public.project_nodes(id) on delete cascade,
  unit_price numeric(18,2) not null check (unit_price >= 0)
);
comment on table public.sales_item_prices is 'FR-94: unit price of an item row; sales_prices holders only.';

-- What was actually quoted: the priced item rows as they stood when the record entered a
-- submit stage, per revision. Price history reads this, so later edits of the item rows
-- (engineering after the award) cannot rewrite it.
create table public.sales_quote_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  rfp_id       uuid not null references public.sales_rfps(id) on delete cascade,
  revision     integer not null,
  code         text not null,
  product_type text,
  size         text,
  rating       text,
  description  text,
  qty          numeric,
  unit         text,
  unit_price   numeric(18,2) not null,
  quoted_on    date not null
);
create index sales_quote_lines_rfp on public.sales_quote_lines (rfp_id, revision);
comment on table public.sales_quote_lines is 'FR-94: snapshot of quoted lines at submission; sales_prices holders only.';

-- ---------------------------------------------------------------- guarantees and payments
create table public.sales_bonds (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rfp_id     uuid not null references public.sales_rfps(id) on delete cascade,
  kind       text not null check (kind in ('bid','performance','advance_payment')),
  seq        integer not null default 1 check (seq >= 1),
  -- A fraction: 0.1 = 10%.
  percent    numeric check (percent >= 0 and percent <= 1),
  form       text check (form in ('bank','safteh','cheque')),
  amount     numeric(18,2) check (amount >= 0),
  currency   text check (currency ~ '^[A-Z]{3}$'),
  bank       text check (char_length(bank) <= 200),
  number     text check (char_length(number) <= 200),
  issued_on  date,
  expires_on date,
  status     text not null default 'needed'
               check (status in ('needed','requested','issued','delivered','released','expired','void')),
  note       text check (char_length(note) <= 2000),
  imported   boolean not null default false
);
create index sales_bonds_rfp on public.sales_bonds (rfp_id);

create table public.sales_payments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rfp_id     uuid not null references public.sales_rfps(id) on delete cascade,
  seq        integer not null default 1 check (seq >= 1),
  amount     numeric(18,2) check (amount >= 0),
  paid_on    date,
  note       text check (char_length(note) <= 2000),
  imported   boolean not null default false
);
create index sales_payments_rfp on public.sales_payments (rfp_id);

-- ---------------------------------------------------------------- deadlines
create table public.sales_deadlines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  rfp_id         uuid not null references public.sales_rfps(id) on delete cascade,
  kind           text not null check (kind in ('proposal_due','quote_due','bond_due',
                   'offer_valid_until','bond_expires','delivery_due','other')),
  -- The bond a bond_expires row follows.
  source_id      uuid,
  label          text check (char_length(label) <= 200),
  due_on         date not null,
  responsible_id uuid references public.profiles(id) on delete set null,
  done_at        timestamptz,
  done_by        uuid references public.profiles(id) on delete set null,
  -- Kept in step with its source field by private.sales_sync_deadlines; never typed.
  auto           boolean not null default false,
  created_at     timestamptz not null default now()
);
create unique index sales_deadlines_auto on public.sales_deadlines
  (rfp_id, kind, (coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid))) where auto;
create index sales_deadlines_open on public.sales_deadlines (company_id, due_on) where done_at is null;

-- ---------------------------------------------------------------- documents and activity
create table public.sales_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  rfp_id      uuid not null references public.sales_rfps(id) on delete cascade,
  position    integer not null default 0,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  assignee_id uuid references public.profiles(id) on delete set null,
  status      text not null default 'todo' check (status in ('todo','in_progress','ready')),
  -- Where the document lives (no file is stored in v1).
  note        text check (char_length(note) <= 500)
);
create index sales_documents_rfp on public.sales_documents (rfp_id);

create table public.sales_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rfp_id     uuid not null references public.sales_rfps(id) on delete cascade,
  at         timestamptz not null default clock_timestamp(),
  actor_id   uuid references public.profiles(id) on delete set null,
  kind       text not null check (kind in ('created','edit','stage','decision','result',
               'comment','import','items','finance')),
  -- Never holds a price or guarantee value: every Sales reader sees the log.
  body       jsonb not null default '{}'
);
create index sales_events_rfp on public.sales_events (rfp_id, at);

-- ---------------------------------------------------------------- RLS on, no client access
do $$
declare t text;
begin
  foreach t in array array['sales_settings','sales_customers','sales_flows','sales_stages',
    'sales_field_defs','sales_import_batches','sales_rfps','project_nodes','sales_item_prices',
    'sales_quote_lines','sales_bonds','sales_payments','sales_deadlines','sales_documents','sales_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- catalog items
-- Seven new keys in a new "ERP · Sales" section. No role receives any of them here: the
-- owner switches them on per role in Settings › Roles (the admin holds every key).
create or replace function private.permission_keys() returns setof text
    language sql immutable
    set search_path to ''
    as $$
  select unnest(array['people','people_create','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','finance_forms','travel_booking',
    'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own',
    'sales','sales_prices','sales_bonds','sales_decide','sales_reports','sales_settings','project_items']);
$$;

create or replace function private.permission_allows(p_key text, p_level text) returns boolean
    language sql immutable
    set search_path to ''
    as $$
  select case
    when p_key in ('people_create','role_manager','role_assign','leave_accrual',
      'personal_info_own','special_leave','approval_delegate','travel_booking',
      'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly',
      'edit_requests_own','sales_decide','sales_settings') then p_level = 'edit'
    when p_key in ('calendar','reports','finance','finance_forms','sales_reports') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays',
      'sales','sales_prices','sales_bonds','project_items') then p_level in ('read','edit')
    else false end;
$$;

create or replace function private.permission_deps() returns table(key text, key_level text, needs text)
    language sql immutable
    set search_path to ''
    as $$
  values
    ('finance_forms','read','finance'),
    ('people_create','read','people'),
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
    ('sales_reports','read','sales'), ('sales_settings','read','sales'), ('project_items','read','sales');
$$;

-- ---------------------------------------------------------------- seed
-- Idempotent: settings, the two flows and their starting stages. Run here for every
-- existing company, and by app_sales_bootstrap for a company created later.
create or replace function private.sales_ensure(p_company uuid) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare v_bid uuid; v_contract uuid;
begin
  insert into public.sales_settings (company_id, doc_template)
    values (p_company, array['Technical offer','Financial offer','Catalogs','Drawings','Certificates'])
    on conflict do nothing;

  insert into public.sales_flows (company_id, kind, name_fa, name_en)
    values (p_company, 'bid', 'استعلام و پیشنهاد', 'RFP'), (p_company, 'contract', 'قرارداد', 'Contract')
    on conflict do nothing;
  select id into v_bid from public.sales_flows where company_id = p_company and kind = 'bid';
  select id into v_contract from public.sales_flows where company_id = p_company and kind = 'contract';

  if not exists (select 1 from public.sales_stages where flow_id = v_bid) then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, action, code) values
      (p_company, v_bid, 1, 'دریافت‌شده', 'Received', 'open', null, 'received'),
      (p_company, v_bid, 2, 'تصمیم شرکت در مناقصه', 'Bid decision', 'open', 'decide', 'decision'),
      (p_company, v_bid, 3, 'پیشنهاد فنی', 'Technical proposal', 'open', null, 'technical'),
      (p_company, v_bid, 4, 'قیمت‌گذاری', 'Pricing', 'open', 'quote', 'pricing'),
      (p_company, v_bid, 5, 'آماده ارسال', 'Ready to send', 'open', null, 'ready'),
      (p_company, v_bid, 6, 'ارسال‌شده', 'Submitted', 'open', 'submit', 'submitted'),
      (p_company, v_bid, 7, 'بازنده', 'Lost', 'lost', null, 'lost'),
      (p_company, v_bid, 8, 'عدم شرکت', 'No bid', 'no_bid', null, 'no_bid'),
      (p_company, v_bid, 9, 'لغوشده', 'Cancelled', 'cancelled', null, 'cancelled');
  end if;
  if not exists (select 1 from public.sales_stages where flow_id = v_contract) then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, code) values
      (p_company, v_contract, 1, 'جدید', 'New', 'open', 'new'),
      (p_company, v_contract, 2, 'جاری', 'Current', 'open', 'current'),
      (p_company, v_contract, 3, 'متوقف', 'Hold', 'open', 'hold'),
      (p_company, v_contract, 4, 'پایان‌یافته', 'Finish', 'done', 'finish'),
      (p_company, v_contract, 5, 'لغوشده', 'Cancel', 'cancelled', 'cancel');
  end if;
end $$;
revoke all on function private.sales_ensure(uuid) from public, anon, authenticated;

select private.sales_ensure(id) from public.companies;

-- A company created later is seeded on insert (read functions must never write:
-- View as runs them in read-only transactions).
create or replace function private.companies_seed_sales() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  perform private.sales_ensure(new.id);
  return new;
end $$;
revoke all on function private.companies_seed_sales() from public, anon, authenticated;
create trigger companies_seed_sales after insert on public.companies
  for each row execute function private.companies_seed_sales();
