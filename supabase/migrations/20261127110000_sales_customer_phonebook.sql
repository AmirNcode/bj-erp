-- FR-99 (2026-11-27) part 2: ERP › Sales customer phone book, activity description, Private type,
-- and change history for every customer write.
-- Spec docs/specs/2026-11-27-sales-customer-phonebook-history-design.md §6, §8, §9, §11; plan Task 2.
-- * New list sales_contact_titles (seeded per company, edited in Settings › Customer lists).
-- * sales_customer_contacts becomes the phone book's entries (person optional, title_id from the
--   list); numbers move to the new child table sales_customer_phones (an entry holds 0..5).
-- * sales_customers: ceo_phone, activity, created_by; kind 'private' (rank / category allowed).
-- * Completeness: phones (CEO line or any number) and grade_or_activity (a complete pair or an
--   activity description); rank / category only for a half pair.
-- * Every customer write logs to sales_audit (private.sales_log, part 1), customer history reader.
-- Lock order unchanged: private.sales_customer_lock(company) before any sales_rfps row lock.

-- ---------------------------------------------------------------- titles list
create table public.sales_contact_titles (
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
comment on table public.sales_contact_titles is 'FR-99: titles of a customer''s key people (picked, never typed). Functions only.';
alter table public.sales_contact_titles enable row level security;
revoke all on public.sales_contact_titles from public, anon, authenticated;

-- The owner's list (spec D6), only while the company has no titles.
create function private.sales_seed_contact_titles(p_company uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.sales_contact_titles where company_id = p_company) then return; end if;
  insert into public.sales_contact_titles (company_id, name_fa, name_key, name_en, position)
  select p_company, v.fa, private.sales_name_key(v.fa), v.en, v.pos
    from (values
      ('رئیس هیئت مدیره', 'Chairman of the board', 1),
      ('قائم‌مقام مدیرعامل', 'Deputy CEO', 2),
      ('مدیر بازرگانی', 'Commercial manager', 3),
      ('مدیر تأمین', 'Procurement manager', 4),
      ('کارشناس خرید', 'Purchasing expert', 5),
      ('مدیر فنی', 'Technical manager', 6),
      ('مدیر مهندسی', 'Engineering manager', 7),
      ('مدیر پروژه', 'Project manager', 8),
      ('مدیر کنترل کیفیت', 'QC manager', 9),
      ('مدیر برنامه‌ریزی', 'Planning manager', 10),
      ('مدیر مالی', 'Finance manager', 11),
      ('دفتر / منشی', 'Office / secretary', 12)) as v(fa, en, pos)
  on conflict (company_id, name_key) do nothing;
end $$;
select private.sales_seed_contact_titles(id) from public.companies;

-- Existing free-text titles: matched by name key against the list (fa or en); the rest are added
-- after the seed (active), so nothing is lost and the admin tidies them in Settings.
alter table public.sales_customer_contacts
  add column title_id uuid references public.sales_contact_titles(id) on delete restrict;
insert into public.sales_contact_titles (company_id, name_fa, name_key, name_en, position)
select u.company_id, u.title, u.key, null,
       (select coalesce(max(t.position), 0) from public.sales_contact_titles t where t.company_id = u.company_id)
         + row_number() over (partition by u.company_id order by u.first_pos, u.key)
  from (select distinct on (k.company_id, private.sales_name_key(k.title))
               k.company_id, btrim(k.title) as title, private.sales_name_key(k.title) as key, k.position as first_pos
          from public.sales_customer_contacts k
         where k.title is not null and private.sales_name_key(k.title) <> ''
           and not exists (select 1 from public.sales_contact_titles t
                            where t.company_id = k.company_id
                              and private.sales_name_key(k.title) in (t.name_key, private.sales_name_key(t.name_en)))
         order by k.company_id, private.sales_name_key(k.title), k.position, k.id) u;
update public.sales_customer_contacts k
   set title_id = (select t.id from public.sales_contact_titles t
                    where t.company_id = k.company_id
                      and private.sales_name_key(k.title) in (t.name_key, private.sales_name_key(t.name_en))
                    order by (private.sales_name_key(k.title) = t.name_key) desc, t.position, t.id limit 1)
 where k.title is not null and private.sales_name_key(k.title) <> '';

-- ---------------------------------------------------------------- numbers (child of an entry)
create table public.sales_customer_phones (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.sales_customer_contacts(id) on delete cascade,
  label      text not null check (label in ('office', 'mobile', 'fax', 'other')),
  phone      text not null check (phone ~ '^\+?[0-9]{5,15}$'),
  position   integer not null default 0
);
create index sales_customer_phones_contact on public.sales_customer_phones (contact_id, position);
comment on table public.sales_customer_phones is 'FR-99: numbers of a phone-book entry (at most 5). Private like the entries. Functions only.';
alter table public.sales_customer_phones enable row level security;
revoke all on public.sales_customer_phones from public, anon, authenticated;

insert into public.sales_customer_phones (company_id, contact_id, label, phone, position)
  select company_id, id, label, phone, 1 from public.sales_customer_contacts;

alter table public.sales_customer_contacts alter column person drop not null;
alter table public.sales_customer_contacts drop column title, drop column label, drop column phone;
comment on table public.sales_customer_contacts is 'FR-99: a customer''s phone book (key people and company lines; numbers in sales_customer_phones). Private: only sales_customers holders read it. Functions only.';

-- ---------------------------------------------------------------- customers
alter table public.sales_customers
  add column ceo_phone text constraint sales_customers_ceo_phone_check
    check (ceo_phone is null or ceo_phone ~ '^\+?[0-9]{5,15}$'),
  add column activity text constraint sales_customers_activity_check
    check (activity is null or char_length(btrim(activity)) between 1 and 1000),
  add column created_by uuid;
alter table public.sales_customers drop constraint sales_customers_kind_check,
  add constraint sales_customers_kind_check check (kind in ('government', 'contractor', 'private'));
alter table public.sales_customers drop constraint sales_customers_contractor_only,
  add constraint sales_customers_contractor_only
    check (kind in ('contractor', 'private') or (rank is null and category_id is null));

-- ---------------------------------------------------------------- completeness
-- FR-99: p_contacts (name kept from FR-98) is the number of phone rows in the customer's phone book.
create or replace function private.sales_customer_missing_of(c public.sales_customers, p_contacts integer) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select array_remove(array[
    case when c.name_en is null then 'name_en' end,
    case when c.kind is null then 'kind' end,
    case when c.ceo_name is null then 'ceo_name' end,
    case when c.province_code is null then 'province' end,
    case when c.city_id is null then 'city' end,
    case when c.address is null then 'address' end,
    case when c.ceo_phone is null and coalesce(p_contacts, 0) = 0 then 'phones' end,
    case when c.category_id is not null and c.rank is null then 'rank' end,
    case when c.rank is not null and c.category_id is null then 'category' end,
    case when not (c.rank is not null and c.category_id is not null) and c.activity is null then 'grade_or_activity' end
  ], null);
$$;

create function private.sales_customer_phone_count(p_customer uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.sales_customer_phones ph
    join public.sales_customer_contacts k on k.id = ph.contact_id
   where k.customer_id = p_customer;
$$;

create or replace function private.sales_customer_missing_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.missing := private.sales_customer_missing_of(new, private.sales_customer_phone_count(new.id));
  return new;
end $$;

-- A number added / removed / moved refreshes the customer of its entry (the entry trigger covers
-- entries that move or go; a cascaded delete finds no entry here and is a no-op).
create function private.sales_phones_missing_trg() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.sales_customers set missing = missing
     where id = (select customer_id from public.sales_customer_contacts where id = old.contact_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.contact_id <> old.contact_id) then
    update public.sales_customers set missing = missing
     where id = (select customer_id from public.sales_customer_contacts where id = new.contact_id);
  end if;
  return null;
end $$;
create trigger sales_customer_phones_missing after insert or delete or update on public.sales_customer_phones
  for each row execute function private.sales_phones_missing_trg();

-- Further pairs exist for contractors and private companies only.
create or replace function private.sales_customer_grades_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if coalesce(new.kind, '') not in ('contractor', 'private') then
    delete from public.sales_customer_grades where customer_id = new.id;
  elsif new.rank is not null and new.category_id is not null then
    delete from public.sales_customer_grades
     where customer_id = new.id and rank = new.rank and category_id = new.category_id;
  end if;
  return null;
end $$;

create or replace function private.sales_customer_set_grades(p_company uuid, p_customer uuid, p_grades jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_c public.sales_customers; v_e jsonb; v_rank numeric; v_cat uuid; v_pos integer := 0;
begin
  if p_grades is null or jsonb_typeof(p_grades) <> 'array' or jsonb_array_length(p_grades) > 9
     or exists (select 1 from jsonb_array_elements(p_grades) e where jsonb_typeof(e) <> 'object') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select * into v_c from public.sales_customers where id = p_customer and company_id = p_company;
  delete from public.sales_customer_grades where customer_id = p_customer;
  if coalesce(v_c.kind, '') not in ('contractor', 'private') then return; end if;
  for v_e in select e from jsonb_array_elements(p_grades) as t(e) loop
    v_rank := private.sales_num(translate(v_e->>'rank', '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
    v_cat := private.sales_uuid(v_e->>'category_id');
    if v_rank is null or v_rank not in (1, 2, 3, 4, 5) or v_cat is null
       or not exists (select 1 from public.sales_contractor_categories where id = v_cat and company_id = p_company) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    if (v_rank, v_cat) is not distinct from (v_c.rank::numeric, v_c.category_id) then continue; end if;
    v_pos := v_pos + 1;
    insert into public.sales_customer_grades (company_id, customer_id, rank, category_id, position)
      values (p_company, p_customer, v_rank::smallint, v_cat, v_pos)
      on conflict (customer_id, rank, category_id) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------- values, phone book writer
create or replace function private.sales_customer_values(p_company uuid, p jsonb) RETURNS public.sales_customers
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v public.sales_customers; v_rank numeric;
begin
  v.company_id := p_company;
  v.name := private.sales_clean(p->>'name');
  v.name_key := private.sales_name_key(v.name);
  v.name_en := private.sales_clean(p->>'name_en');
  v.name_en_key := nullif(private.sales_name_key(v.name_en), '');
  v.kind := nullif(p->>'kind', '');
  v.ceo_name := private.sales_clean(p->>'ceo_name');
  v.ceo_phone := private.sales_phone(p->>'ceo_phone');
  v.activity := nullif(btrim(coalesce(p->>'activity', '')), '');
  v.address := private.sales_clean(p->>'address');
  v.province_code := nullif(btrim(coalesce(p->>'province_code', '')), '');
  v.city_id := private.sales_uuid(p->>'city_id');
  v_rank := private.sales_num(translate(p->>'rank', '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
  v.category_id := private.sales_uuid(p->>'category_id');
  if v.name is null or v.name_key = ''
     or char_length(v.name) > 200 or char_length(coalesce(v.name_en, '')) > 200
     or char_length(coalesce(v.ceo_name, '')) > 120 or char_length(coalesce(v.address, '')) > 500
     or char_length(coalesce(v.activity, '')) > 1000
     or (v.ceo_phone is not null and v.ceo_phone !~ '^\+?[0-9]{5,15}$')
     or (v.kind is not null and v.kind not in ('government', 'contractor', 'private'))
     or (nullif(p->>'city_id', '') is not null and v.city_id is null)
     or (nullif(p->>'category_id', '') is not null and v.category_id is null)
     or (nullif(p->>'rank', '') is not null and (v_rank is null or v_rank not in (1, 2, 3, 4, 5)))
     or (v.province_code is not null and not exists (select 1 from public.iran_provinces where code = v.province_code))
     or (v.city_id is not null and not exists (select 1 from public.sales_cities
           where id = v.city_id and company_id = p_company and province_code = v.province_code))
     or (v.category_id is not null and not exists (select 1 from public.sales_contractor_categories
           where id = v.category_id and company_id = p_company)) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v.rank := v_rank::smallint;
  if coalesce(v.kind, '') not in ('contractor', 'private') then v.rank := null; v.category_id := null; end if;
  return v;
end $_$;

-- Replaces the customer's phone book. p_people: ≤ 50 of {name?, title_id?, email?, phones: [{label, phone}] ≤ 5}.
-- An entry with no name, no title and no number is dropped. A title must be active, or one this
-- customer's entries already used before the save (a hidden title stays where it is).
create function private.sales_customer_set_people(p_company uuid, p_customer uuid, p_people jsonb) returns void
  language plpgsql security definer set search_path = '' as $_$
declare v_used uuid[]; e jsonb; v_ph jsonb; v_name text; v_title uuid; v_email text; v_pos integer := 0;
  v_id uuid; v_phones jsonb; v_label text; v_phone text; v_n integer;
begin
  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) > 50
     or exists (select 1 from jsonb_array_elements(p_people) x
                 where jsonb_typeof(x) <> 'object'
                    or (x ? 'phones' and jsonb_typeof(x->'phones') not in ('array', 'null'))
                    or (jsonb_typeof(x->'phones') = 'array' and (jsonb_array_length(x->'phones') > 5
                        or exists (select 1 from jsonb_array_elements(x->'phones') y where jsonb_typeof(y) <> 'object')))) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct title_id) filter (where title_id is not null), '{}') into v_used
    from public.sales_customer_contacts where customer_id = p_customer;
  delete from public.sales_customer_contacts where customer_id = p_customer;
  for e in select x from jsonb_array_elements(p_people) with ordinality as t(x, o) order by o loop
    v_name := private.sales_clean(e->>'name');
    v_email := lower(private.sales_clean(e->>'email'));
    v_title := null;
    if nullif(btrim(coalesce(e->>'title_id', '')), '') is not null then
      v_title := private.sales_uuid(e->>'title_id');
      if v_title is null or not exists (select 1 from public.sales_contact_titles t
                                          where t.id = v_title and t.company_id = p_company
                                            and (t.active or t.id = any (v_used))) then
        raise exception 'sales: invalid input' using errcode = '22023';
      end if;
    end if;
    v_phones := '[]'::jsonb;
    for v_ph in select y from jsonb_array_elements(coalesce(case when jsonb_typeof(e->'phones') = 'array' then e->'phones' end,
                                                             '[]'::jsonb)) with ordinality as u(y, o) order by o loop
      v_phone := private.sales_phone(v_ph->>'phone');
      if v_phone is null then continue; end if;              -- an empty number row is dropped
      v_label := coalesce(nullif(v_ph->>'label', ''), 'office');
      if v_phone !~ '^\+?[0-9]{5,15}$' or v_label not in ('office', 'mobile', 'fax', 'other') then
        raise exception 'sales: invalid input' using errcode = '22023';
      end if;
      v_phones := v_phones || jsonb_build_array(jsonb_build_object('label', v_label, 'phone', v_phone));
    end loop;
    if v_name is null and v_title is null and jsonb_array_length(v_phones) = 0 then continue; end if;
    if char_length(coalesce(v_name, '')) > 120
       or (v_email is not null and (char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    v_pos := v_pos + 1;
    insert into public.sales_customer_contacts (company_id, customer_id, person, title_id, email, position)
      values (p_company, p_customer, v_name, v_title, v_email, v_pos) returning id into v_id;
    insert into public.sales_customer_phones (company_id, contact_id, label, phone, position)
      select p_company, v_id, x->>'label', x->>'phone', o::integer
        from jsonb_array_elements(v_phones) with ordinality as w(x, o);
  end loop;
end $_$;

-- ---------------------------------------------------------------- history helpers
-- Every user-visible field; list refs as {id, name} (names = fa) so a later rename does not rewrite history.
create function private.sales_customer_snapshot(p_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'name_en', c.name_en, 'kind', c.kind, 'rank', c.rank,
      'category', case when c.category_id is not null then jsonb_build_object('id', c.category_id, 'name', cat.name_fa) end,
      'grades', (select coalesce(jsonb_agg(jsonb_build_object('rank', g.rank, 'category', gc.name_fa)
                                           order by g.position, g.id), '[]'::jsonb)
                   from public.sales_customer_grades g
                   join public.sales_contractor_categories gc on gc.id = g.category_id
                  where g.customer_id = c.id),
      'province', case when c.province_code is not null then jsonb_build_object('code', c.province_code, 'name', pr.name_fa) end,
      'city', case when c.city_id is not null then jsonb_build_object('id', c.city_id, 'name', ci.name_fa) end,
      'address', c.address, 'ceo_name', c.ceo_name, 'ceo_phone', c.ceo_phone, 'activity', c.activity,
      'people', (select coalesce(jsonb_agg(jsonb_build_object('name', k.person, 'title', t.name_fa, 'email', k.email,
                     'phones', (select coalesce(jsonb_agg(jsonb_build_object('label', ph.label, 'phone', ph.phone)
                                                          order by ph.position, ph.id), '[]'::jsonb)
                                  from public.sales_customer_phones ph where ph.contact_id = k.id))
                   order by k.position, k.id), '[]'::jsonb)
                   from public.sales_customer_contacts k
                   left join public.sales_contact_titles t on t.id = k.title_id
                  where k.customer_id = c.id))
    from public.sales_customers c
    left join public.sales_contractor_categories cat on cat.id = c.category_id
    left join public.iran_provinces pr on pr.code = c.province_code
    left join public.sales_cities ci on ci.id = c.city_id
   where c.id = p_id;
$$;

-- The phone book diffed entry by entry (by position after the save): one change, not the whole book.
create function private.sales_people_diff(p_before jsonb, p_after jsonb) returns jsonb
  language plpgsql immutable set search_path = '' as $$
declare b jsonb := case when jsonb_typeof(p_before) = 'array' then p_before else '[]'::jsonb end;
  a jsonb := case when jsonb_typeof(p_after) = 'array' then p_after else '[]'::jsonb end;
  nb integer; na integer; i integer; v_add integer := 0; v_rem integer := 0; v_chg integer := 0;
  v_from jsonb := '[]'::jsonb; v_to jsonb := '[]'::jsonb;
begin
  nb := jsonb_array_length(b); na := jsonb_array_length(a);
  for i in 0 .. greatest(na, nb) - 1 loop
    if i < na and i < nb then
      if (b->i) is distinct from (a->i) then
        v_chg := v_chg + 1;
        v_from := v_from || jsonb_build_array(jsonb_build_object('position', i + 1) || (b->i));
        v_to := v_to || jsonb_build_array(jsonb_build_object('position', i + 1) || (a->i));
      end if;
    elsif i < nb then
      v_rem := v_rem + 1;
      v_from := v_from || jsonb_build_array(jsonb_build_object('position', i + 1) || (b->i));
    else
      v_add := v_add + 1;
      v_to := v_to || jsonb_build_array(jsonb_build_object('position', i + 1) || (a->i));
    end if;
  end loop;
  if v_add + v_rem + v_chg = 0 then return null; end if;
  return jsonb_build_object('field', 'people', 'private', true, 'added', v_add, 'removed', v_rem,
                            'changed', v_chg, 'from', v_from, 'to', v_to);
end $$;

-- Logs p_action on a customer with the diff p_before → now. p_before '{}' = a new customer (only
-- the values it was given). An `edited` / `imported_updated` with no change writes no row.
create function private.sales_customer_log_diff(p_company uuid, p_id uuid, p_action text, p_before jsonb,
                                                p_extra jsonb default '{}'::jsonb) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_after jsonb := coalesce(private.sales_customer_snapshot(p_id), '{}'::jsonb);
  v_b jsonb := coalesce(p_before, '{}'::jsonb); v_a jsonb; v_changes jsonb; v_people jsonb;
begin
  v_a := v_after - 'people';
  if v_b = '{}'::jsonb then
    v_a := coalesce((select jsonb_object_agg(t.k, t.v) from jsonb_each(v_a) as t(k, v)
                      where t.v not in ('null'::jsonb, '[]'::jsonb)), '{}'::jsonb);
  end if;
  v_changes := private.sales_diff(v_b - 'people', v_a, array['ceo_name', 'ceo_phone', 'address']);
  v_people := private.sales_people_diff(v_b->'people', v_after->'people');
  if v_people is not null then v_changes := v_changes || jsonb_build_array(v_people); end if;
  if v_changes = '[]'::jsonb and p_action in ('edited', 'imported_updated') then return; end if;
  perform private.sales_log(p_company, 'customer', p_id, coalesce(v_after->>'name', p_extra->>'name'), p_action,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object('changes', v_changes));
end $$;

-- ---------------------------------------------------------------- profile, list rows, filters
create or replace function private.sales_customer_profile(p_id uuid, p_private boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'name_en', c.name_en, 'kind', c.kind,
      'rank', c.rank, 'category_id', c.category_id, 'category_fa', cat.name_fa, 'category_en', cat.name_en,
      'grades', (select coalesce(jsonb_agg(jsonb_build_object('rank', g.rank, 'category_id', g.category_id,
                     'category_fa', gc.name_fa, 'category_en', gc.name_en) order by g.position, g.id), '[]'::jsonb)
                   from public.sales_customer_grades g
                   join public.sales_contractor_categories gc on gc.id = g.category_id
                  where g.customer_id = c.id),
      'province_code', c.province_code, 'province_fa', pr.name_fa, 'province_en', pr.name_en,
      'city_id', c.city_id, 'city_fa', ci.name_fa, 'city_en', ci.name_en,
      'missing', to_jsonb(c.missing), 'created_at', c.created_at, 'updated_at', c.updated_at,
      'activity', c.activity, 'created_by_name', cb.full_name)
    || case when p_private then jsonb_build_object('ceo_name', c.ceo_name, 'ceo_phone', c.ceo_phone,
         'address', c.address,
         'people', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.person, 'title_id', k.title_id,
                         'title_fa', t.name_fa, 'title_en', t.name_en, 'title_active', t.active, 'email', k.email,
                         'phones', (select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'label', ph.label,
                                                    'phone', ph.phone) order by ph.position, ph.id), '[]'::jsonb)
                                      from public.sales_customer_phones ph where ph.contact_id = k.id))
                       order by k.position, k.id), '[]'::jsonb)
                      from public.sales_customer_contacts k
                      left join public.sales_contact_titles t on t.id = k.title_id
                     where k.customer_id = c.id))
       else '{}'::jsonb end
  from public.sales_customers c
  left join public.sales_contractor_categories cat on cat.id = c.category_id
  left join public.iran_provinces pr on pr.code = c.province_code
  left join public.sales_cities ci on ci.id = c.city_id
  left join public.profiles cb on cb.id = c.created_by
  where c.id = p_id;
$$;

create or replace function private.sales_customer_rows(p_company uuid, p_prices boolean, p_id uuid DEFAULT NULL::uuid, p_f jsonb DEFAULT '{}'::jsonb) RETURNS SETOF jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with rf as (
    select r.id, r.buyer_id, r.client_id, r.received_on, r.bid_result, r.bid_decision, r.in_charge_text,
           r.owner_id, r.currency, r.our_price, r.total_value, s.kind as skind, f.kind as fkind,
           (r.bid_result = 'won' or (f.kind = 'contract' and s.kind <> 'cancelled')) as is_won
      from public.sales_rfps r
      join public.sales_stages s on s.id = r.stage_id
      join public.sales_flows f on f.id = r.flow_id
     where r.company_id = p_company and r.deleted_at is null
       and (r.buyer_id is not null or r.client_id is not null)
       and (p_id is null or r.buyer_id = p_id or r.client_id = p_id)
       and private.sales_rec_ok(p_f, r.received_on, r.bid_result, r.bid_decision, s.kind, r.owner_id)),
  agg as (
    select buyer_id,
           count(*) as records,
           count(*) filter (where skind = 'open') as open,
           count(*) filter (where bid_result = 'won') as won,
           count(*) filter (where bid_result = 'lost') as lost,
           count(*) filter (where bid_decision = 'no_bid') as no_bid,
           count(*) filter (where skind = 'archived') as archived,
           count(*) filter (where skind = 'cancelled') as cancelled,
           min(received_on) as first_inquiry, max(received_on) as last_inquiry
      from rf where buyer_id is not null group by buyer_id),
  cli as (select client_id, count(*) as n from rf where client_id is not null group by client_id),
  dl as (
    select rf.buyer_id, min(d.due_on) as next_deadline
      from rf join public.sales_deadlines d on d.rfp_id = rf.id
     where rf.buyer_id is not null and rf.skind = 'open' and d.done_at is null
     group by rf.buyer_id),
  own as (
    select distinct on (buyer_id) buyer_id, nm
      from (select rf.buyer_id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(rf.in_charge_text), '')) as nm, count(*) as n
              from rf left join public.profiles p on p.id = rf.owner_id
             where rf.buyer_id is not null group by 1, 2) t
     where nm is not null
     order by buyer_id, n desc, nm),
  cv as (
    select buyer_id, jsonb_object_agg(currency, amt) as j
      from (select buyer_id, currency, sum(total_value) as amt from rf
             where fkind = 'contract' and total_value is not null and currency is not null and buyer_id is not null
             group by buyer_id, currency) t group by buyer_id),
  qv as (
    select buyer_id, jsonb_object_agg(currency, amt) as j
      from (select buyer_id, currency, sum(our_price) as amt from rf
             where our_price is not null and currency is not null and buyer_id is not null
             group by buyer_id, currency) t group by buyer_id),
  sv as (
    select buyer_id, jsonb_object_agg(currency, amt) as j
      from (select buyer_id, currency, sum(coalesce(total_value, our_price)) as amt from rf
             where is_won and coalesce(total_value, our_price) is not null and currency is not null
               and buyer_id is not null
             group by buyer_id, currency) t group by buyer_id)
  select jsonb_build_object(
      'id', c.id, 'name', c.name, 'name_en', c.name_en, 'kind', c.kind, 'activity', c.activity,
      'missing', to_jsonb(c.missing),
      'records', coalesce(a.records, 0), 'as_client', coalesce(cli.n, 0),
      'open', coalesce(a.open, 0), 'won', coalesce(a.won, 0), 'lost', coalesce(a.lost, 0),
      'no_bid', coalesce(a.no_bid, 0), 'archived', coalesce(a.archived, 0), 'cancelled', coalesce(a.cancelled, 0),
      'decided', coalesce(a.won, 0) + coalesce(a.lost, 0),
      'win_rate', case when coalesce(a.won, 0) + coalesce(a.lost, 0) > 0
                       then round(a.won::numeric / (a.won + a.lost), 4) end,
      'first_inquiry', a.first_inquiry, 'last_inquiry', a.last_inquiry,
      'next_deadline', dl.next_deadline, 'main_owner_name', own.nm)
    || case when p_prices then jsonb_build_object(
         'contract_value', coalesce(cv.j, '{}'::jsonb), 'quoted', coalesce(qv.j, '{}'::jsonb),
         'sales', coalesce(sv.j, '{}'::jsonb))
       else '{}'::jsonb end
  from public.sales_customers c
  left join agg a on a.buyer_id = c.id
  left join cli on cli.client_id = c.id
  left join dl on dl.buyer_id = c.id
  left join own on own.buyer_id = c.id
  left join cv on cv.buyer_id = c.id
  left join qv on qv.buyer_id = c.id
  left join sv on sv.buyer_id = c.id
  where c.company_id = p_company and (p_id is null or c.id = p_id)
    and (nullif(p_f->>'kind', '') is null or c.kind = p_f->>'kind')
    and (nullif(p_f->>'incomplete', '') is null or cardinality(c.missing) > 0)
    and (not private.sales_filtered(p_f) or coalesce(a.records, 0) > 0)
  order by c.name;
$$;

create or replace function private.sales_filter_check(p jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare v text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  foreach v in array array['from', 'to'] loop
    if nullif(p->>v, '') is not null then
      if jsonb_typeof(p->v) <> 'string' or p->>v !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'sales: invalid input' using errcode = '22023';
      end if;
      perform (p->>v)::date;
    end if;
  end loop;
  if nullif(p->>'result', '') is not null
     and p->>'result' not in ('won', 'lost', 'no_bid', 'cancelled', 'open', 'archived') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if nullif(p->>'owner', '') is not null
     and p->>'owner' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if nullif(p->>'kind', '') is not null and p->>'kind' not in ('government', 'contractor', 'private') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if nullif(p->>'incomplete', '') is not null and p->>'incomplete' not in ('1', 'true') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'sales: invalid input' using errcode = '22023';
end $_$;

-- ---------------------------------------------------------------- save / add / record text path
create or replace function public.app_sales_save_customer(p_id uuid, p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_customers', 'edit');
  v_old public.sales_customers; v public.sales_customers; v_clash uuid; v_id uuid := p_id;
  v_before jsonb := '{}'::jsonb; v_alias boolean := false;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_customer_lock(v_company);
  if p_id is not null then
    select * into v_old from public.sales_customers where id = p_id and company_id = v_company for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
    v_before := private.sales_customer_snapshot(p_id);
  end if;
  v := private.sales_customer_values(v_company, p);
  -- FR-99 deploy swap: the old app sends no ceo_phone / activity / people: those stay as they were.
  if p_id is not null then
    if not (p ? 'ceo_phone') then v.ceo_phone := v_old.ceo_phone; end if;
    if not (p ? 'activity') then v.activity := v_old.activity; end if;
  end if;
  v_clash := private.sales_customer_name_clash(v_company, v.name_key, p_id);
  if v_clash is null and v.name_en_key is not null then
    v_clash := private.sales_customer_name_clash(v_company, v.name_en_key, p_id);
  end if;
  if v_clash is not null then perform private.sales_raise_duplicate(v_clash); end if;
  begin
    if p_id is null then
      insert into public.sales_customers (company_id, name, name_key, name_en, name_en_key, kind, ceo_name, ceo_phone,
                                          activity, province_code, city_id, address, rank, category_id,
                                          created_by, updated_at, updated_by)
        values (v_company, v.name, v.name_key, v.name_en, v.name_en_key, v.kind, v.ceo_name, v.ceo_phone,
                v.activity, v.province_code, v.city_id, v.address, v.rank, v.category_id,
                auth.uid(), now(), auth.uid())
        returning id into v_id;
    else
      update public.sales_customers set name = v.name, name_key = v.name_key, name_en = v.name_en,
          name_en_key = v.name_en_key, kind = v.kind, ceo_name = v.ceo_name, ceo_phone = v.ceo_phone,
          activity = v.activity, province_code = v.province_code,
          city_id = v.city_id, address = v.address, rank = v.rank, category_id = v.category_id,
          updated_at = now(), updated_by = auth.uid()
       where id = p_id;
      if v_old.name_key <> v.name_key then
        -- Like a rename: the old spelling keeps finding this customer.
        delete from public.sales_name_aliases
         where company_id = v_company and kind = 'customer' and alias_key = v.name_key;
        insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
          values (v_company, 'customer', v_old.name_key, v_old.name, p_id, auth.uid())
          on conflict (company_id, kind, alias_key) do update
            set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
        v_alias := true;
      end if;
    end if;
    -- The old `contacts` key is ignored (FR-99).
    if p ? 'people' or p_id is null then
      perform private.sales_customer_set_people(v_company, v_id, coalesce(p->'people', '[]'::jsonb));
    end if;
    if p ? 'grades' or p_id is null then
      perform private.sales_customer_set_grades(v_company, v_id, coalesce(p->'grades', '[]'::jsonb));
    end if;
  exception
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
         or numeric_value_out_of_range or string_data_right_truncation then
      raise exception 'sales: invalid input' using errcode = '22023';
    when unique_violation then
      raise exception 'sales: duplicate name' using errcode = '23505';
  end;
  perform private.sales_customer_log_diff(v_company, v_id, case when p_id is null then 'created' else 'edited' end,
                                          v_before);
  if v_alias then
    perform private.sales_log(v_company, 'customer', v_id, v.name, 'alias_added',
                              jsonb_build_object('name', v_old.name));
  end if;
  return private.sales_customer_profile(v_id, true);
end $$;

create or replace function public.app_sales_add_customer(p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_customers', 'edit'); v_name text; v_kind text; v_id uuid;
  v_found public.sales_customers;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_name := private.sales_clean(p->>'name');
  v_kind := nullif(p->>'kind', '');
  if v_name is null or char_length(v_name) > 200 or private.sales_name_key(v_name) = ''
     or (v_kind is not null and v_kind not in ('government', 'contractor', 'private')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_customer_lock(v_company);
  v_id := private.sales_customer_find(v_company, v_name);
  if v_id is not null then
    select * into v_found from public.sales_customers where id = v_id;
    return jsonb_build_object('id', v_found.id, 'existed', true, 'name', v_found.name, 'kind', v_found.kind);
  end if;
  insert into public.sales_customers (company_id, name, name_key, kind, created_by, updated_at, updated_by)
    values (v_company, v_name, private.sales_name_key(v_name), v_kind, auth.uid(), now(), auth.uid())
    returning id into v_id;
  perform private.sales_customer_log_diff(v_company, v_id, 'created', '{}'::jsonb,
                                          jsonb_build_object('source', 'record'));
  return jsonb_build_object('id', v_id, 'existed', false, 'name', v_name, 'kind', v_kind);
end $$;

-- Record save's text path and the ledger / inquiry imports. The creation source comes from
-- bj.sales_source (set by the imports, part 1): '<ledger_import|inquiry_import>:<batch>' or empty (record).
create or replace function private.sales_customer(p_company uuid, p_name text, p_kind text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_key text := private.sales_name_key(p_name); v_id uuid; v_name text;
  v_kind text := case when p_kind in ('government', 'contractor', 'private') then p_kind end;
  v_src text := coalesce(current_setting('bj.sales_source', true), ''); v_extra jsonb;
begin
  if v_key = '' then return null; end if;
  v_extra := case when v_src like '%:%'
    then jsonb_build_object('source', split_part(v_src, ':', 1), 'batch_id', split_part(v_src, ':', 2))
    else jsonb_build_object('source', 'record') end;
  perform private.sales_customer_lock(p_company);
  v_id := private.sales_customer_find(p_company, p_name);
  if v_id is not null then
    if v_kind is not null then
      update public.sales_customers set kind = v_kind where id = v_id and kind is null returning name into v_name;
      if found then
        perform private.sales_log(p_company, 'customer', v_id, v_name, 'edited', v_extra || jsonb_build_object(
          'changes', jsonb_build_array(jsonb_build_object('field', 'kind', 'from', null, 'to', v_kind))));
      end if;
    end if;
    return v_id;
  end if;
  insert into public.sales_customers (company_id, name, name_key, kind, created_by)
    values (p_company, left(regexp_replace(btrim(p_name), '\s+', ' ', 'g'), 200), v_key, v_kind, auth.uid())
    returning id into v_id;
  perform private.sales_customer_log_diff(p_company, v_id, 'created', '{}'::jsonb, v_extra);
  return v_id;
end $$;

-- ---------------------------------------------------------------- rename, merge
create or replace function public.app_sales_rename_customer(p_id uuid, p_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_name text; v_key text;
  v_old public.sales_customers;
begin
  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 200);
  v_key := private.sales_name_key(v_name);
  if v_key = '' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  perform private.sales_customer_lock(v_company);
  select * into v_old from public.sales_customers where id = p_id and company_id = v_company for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if private.sales_customer_name_clash(v_company, v_key, p_id) is not null then
    raise exception 'sales: customer exists' using errcode = '23505';
  end if;
  update public.sales_customers set name = v_name, name_key = v_key, updated_at = now(), updated_by = auth.uid()
   where id = p_id;
  if v_old.name is distinct from v_name then
    perform private.sales_log(v_company, 'customer', p_id, v_name, 'renamed',
                              jsonb_build_object('from', v_old.name, 'to', v_name));
  end if;
  if v_old.name_key <> v_key then
    -- The new name is now the real one: an alias with its key would only redirect it elsewhere.
    delete from public.sales_name_aliases where company_id = v_company and kind = 'customer' and alias_key = v_key;
    insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
      values (v_company, 'customer', v_old.name_key, v_old.name, p_id, auth.uid())
      on conflict (company_id, kind, alias_key) do update
        set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
    perform private.sales_log(v_company, 'customer', p_id, v_name, 'alias_added',
                              jsonb_build_object('name', v_old.name));
  end if;
end $$;

create or replace function public.app_sales_merge_customers(p_from uuid, p_into uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  v_from public.sales_customers; v_into public.sales_customers; v_ids uuid[]; v_n integer; v_kind text;
  v_pairs jsonb; v_after public.sales_customers; v_from_snap jsonb; v_into_before jsonb;
  v_nk integer; v_pos integer;
begin
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  -- Lock order: the customer lock, customers by id, then the affected records by id.
  perform private.sales_customer_lock(v_company);
  perform 1 from public.sales_customers where company_id = v_company and id in (p_from, p_into) order by id for update;
  select * into v_from from public.sales_customers where id = p_from and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  select * into v_into from public.sales_customers where id = p_into and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  v_from_snap := private.sales_customer_snapshot(p_from);
  v_into_before := private.sales_customer_snapshot(p_into);
  select coalesce(array_agg(id order by id), '{}') into v_ids from (
    select id from public.sales_rfps
     where company_id = v_company and (buyer_id = p_from or client_id = p_from)
     order by id for update) t;
  v_n := cardinality(v_ids);
  update public.sales_rfps set
      buyer_id = case when buyer_id = p_from then p_into else buyer_id end,
      client_id = case when client_id = p_from then p_into else client_id end,
      updated_by = auth.uid(), updated_at = now()
   where id = any (v_ids);
  insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
    select v_company, id, auth.uid(), 'edit',
           jsonb_build_object('side', 'customer_merge', 'from', v_from.name, 'into', v_into.name)
      from unnest(v_ids) as u(id);
  -- FR-99: the source's phone-book entries move with their numbers, after the target's own. An entry
  -- with numbers is skipped when the target already has every one of them; one without numbers when
  -- the target has an entry with the same name and title. At most 50 entries in all.
  select count(*)::integer, coalesce(max(position), 0) into v_nk, v_pos
    from public.sales_customer_contacts where customer_id = p_into;
  update public.sales_customer_contacts k set customer_id = p_into, position = v_pos + m.rn
    from (select x.id, row_number() over (order by x.position, x.id) as rn
            from public.sales_customer_contacts x
           where x.customer_id = p_from
             and not case
               when exists (select 1 from public.sales_customer_phones ph where ph.contact_id = x.id) then
                 not exists (select 1 from public.sales_customer_phones ph
                              where ph.contact_id = x.id
                                and not exists (select 1 from public.sales_customer_phones q
                                                  join public.sales_customer_contacts y on y.id = q.contact_id
                                                 where y.customer_id = p_into and q.phone = ph.phone))
               else exists (select 1 from public.sales_customer_contacts y
                             where y.customer_id = p_into
                               and private.sales_name_key(y.person) = private.sales_name_key(x.person)
                               and y.title_id is not distinct from x.title_id)
               end
           order by x.position, x.id
           limit greatest(0, 50 - v_nk)) m
   where k.id = m.id;
  -- Every complete pair either side holds, in order (target first), before the source row goes.
  select coalesce(jsonb_agg(jsonb_build_object('rank', rank, 'category_id', category_id) order by side, pos), '[]'::jsonb)
    into v_pairs
    from (
      select 0 as side, 0 as pos, v_into.rank as rank, v_into.category_id as category_id
       where v_into.rank is not null and v_into.category_id is not null
      union all
      select 1, position, rank, category_id from public.sales_customer_grades where customer_id = p_into
      union all
      select 2, 0, v_from.rank, v_from.category_id
       where v_from.rank is not null and v_from.category_id is not null
      union all
      select 3, position, rank, category_id from public.sales_customer_grades where customer_id = p_from
    ) t;
  delete from public.sales_customers where id = p_from;
  -- Empty fields of the target are filled from the source (names stay the target's own, except an empty English name).
  v_kind := coalesce(v_into.kind, v_from.kind);
  update public.sales_customers set
      kind = v_kind,
      name_en = coalesce(v_into.name_en, v_from.name_en),
      name_en_key = coalesce(v_into.name_en_key, v_from.name_en_key),
      ceo_name = coalesce(v_into.ceo_name, v_from.ceo_name),
      ceo_phone = coalesce(v_into.ceo_phone, v_from.ceo_phone),
      activity = coalesce(v_into.activity, v_from.activity),
      address = coalesce(v_into.address, v_from.address),
      province_code = case when v_into.province_code is null then v_from.province_code else v_into.province_code end,
      city_id = case when v_into.province_code is null then v_from.city_id
                     when v_into.city_id is null and v_from.province_code = v_into.province_code then v_from.city_id
                     else v_into.city_id end,
      rank = case when v_kind in ('contractor', 'private') then coalesce(v_into.rank, v_from.rank) end,
      category_id = case when v_kind in ('contractor', 'private') then coalesce(v_into.category_id, v_from.category_id) end,
      updated_at = now(), updated_by = auth.uid()
   where id = p_into;
  -- Further pairs: every distinct complete pair except the target's (new) first one, at most 9.
  select * into v_after from public.sales_customers where id = p_into;
  perform private.sales_customer_set_grades(v_company, p_into, coalesce((
    select jsonb_agg(e order by o) from (
      select e, min(o) as o from jsonb_array_elements(v_pairs) with ordinality as t(e, o)
       where (e->>'rank', e->>'category_id') is distinct from (v_after.rank::text, v_after.category_id::text)
       group by e order by min(o) limit 9) d), '[]'::jsonb));
  -- Aliases: the source's own aliases move to the target, and its names become ones.
  update public.sales_name_aliases set target_id = p_into
   where company_id = v_company and kind = 'customer' and target_id = p_from;
  insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
    values (v_company, 'customer', v_from.name_key, v_from.name, p_into, auth.uid())
    on conflict (company_id, kind, alias_key) do update
      set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  if v_from.name_en_key is not null and v_into.name_en_key is not null and v_from.name_en_key <> v_into.name_en_key then
    insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
      values (v_company, 'customer', v_from.name_en_key, v_from.name_en, p_into, auth.uid())
      on conflict (company_id, kind, alias_key) do update
        set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  end if;
  delete from public.sales_name_aliases
   where company_id = v_company and kind = 'customer'
     and alias_key in (v_into.name_key, coalesce(v_into.name_en_key, v_from.name_en_key, ''));
  -- History: on the removed customer (its name kept as the label) and on the kept one.
  perform private.sales_log(v_company, 'customer', p_from, v_from.name, 'merged_into',
    jsonb_build_object('into_id', p_into, 'into_name', v_into.name, 'snapshot', v_from_snap));
  perform private.sales_customer_log_diff(v_company, p_into, 'merged_from', v_into_before,
    jsonb_build_object('from_id', p_from, 'from_name', v_from.name, 'moved', v_n));
  perform private.sales_log(v_company, 'customer', p_into, v_into.name, 'alias_added',
                            jsonb_build_object('name', a.alias))
     from public.sales_name_aliases a
    where a.company_id = v_company and a.kind = 'customer' and a.target_id = p_into
      and a.alias_key in (v_from.name_key, coalesce(v_from.name_en_key, ''));
  return jsonb_build_object('moved', v_n);
end $$;

-- ---------------------------------------------------------------- customer import
create or replace function private.sales_customer_import_merge(m public.sales_customers, v public.sales_customers, p_overwrite boolean) RETURNS public.sales_customers
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare r public.sales_customers := m;
begin
  if p_overwrite then
    if v.name_en is not null then r.name_en := v.name_en; r.name_en_key := v.name_en_key; end if;
    r.kind := coalesce(v.kind, m.kind);
    r.ceo_name := coalesce(v.ceo_name, m.ceo_name);
    r.ceo_phone := coalesce(v.ceo_phone, m.ceo_phone);
    r.activity := coalesce(v.activity, m.activity);
    r.address := coalesce(v.address, m.address);
    if v.province_code is not null then
      -- A new province drops the old city (the city belongs to its province).
      if v.province_code is distinct from m.province_code then r.city_id := null; end if;
      r.province_code := v.province_code;
    end if;
    if v.city_id is not null then r.city_id := v.city_id; r.province_code := v.province_code; end if;
    r.rank := coalesce(v.rank, m.rank);
    r.category_id := coalesce(v.category_id, m.category_id);
  else
    if m.name_en is null and v.name_en is not null then r.name_en := v.name_en; r.name_en_key := v.name_en_key; end if;
    r.kind := coalesce(m.kind, v.kind);
    r.ceo_name := coalesce(m.ceo_name, v.ceo_name);
    r.ceo_phone := coalesce(m.ceo_phone, v.ceo_phone);
    r.activity := coalesce(m.activity, v.activity);
    r.address := coalesce(m.address, v.address);
    if m.province_code is null then r.province_code := v.province_code; end if;
    -- The city only together with its province, or when the customer already has that province.
    if m.city_id is null and v.city_id is not null and r.province_code is not distinct from v.province_code then
      r.city_id := v.city_id;
    end if;
    r.rank := coalesce(m.rank, v.rank);
    r.category_id := coalesce(m.category_id, v.category_id);
  end if;
  if coalesce(r.kind, '') not in ('contractor', 'private') then r.rank := null; r.category_id := null; end if;
  return r;
end $$;

create or replace function private.sales_customer_import_resolve(p_company uuid, p_rows jsonb, p_maps jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_e jsonb; v_o bigint; v_num numeric;
  v_out jsonb := '[]'::jsonb; v_ucat jsonb := '{}'::jsonb; v_ucity jsonb := '{}'::jsonb; v_utitle jsonb := '{}'::jsonb;
  v_new integer := 0; v_match integer := 0; v_err integer := 0;
  v_seen_ids uuid[] := '{}'; v_seen_keys text[] := '{}';
  v_row integer; v_status text; v_error text; v_name text; v_name_key text; v_en text; v_en_key text;
  v_match_id uuid; v_m public.sales_customers; v_m_kind text; v_m_prov text;
  v_vals jsonb; v_contact jsonb; v_dropped jsonb; v_unknown jsonb; v_incomplete boolean;
  v_txt text; v_k text; v_kind text; v_eff_kind text; v_ceo text; v_ceo_phone text; v_act text; v_addr text;
  v_prov text; v_ctx_prov text;
  v_city uuid; v_cat uuid; v_rank integer; v_mapped text;
  v_pers text; v_title text; v_tid uuid; v_label text; v_phone text; v_email text; v_cv public.sales_customers;
  v_merged public.sales_customers; v_nc integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  for v_e in select x from jsonb_array_elements(p_rows) as t(x) loop
    if jsonb_typeof(v_e) <> 'object'
       or exists (select 1 from jsonb_each(v_e) j where jsonb_typeof(j.value) not in ('string', 'number', 'null')) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
  end loop;

  for v_e, v_o in select x, n from jsonb_array_elements(p_rows) with ordinality as t(x, n) loop
    v_num := private.sales_num(v_e->>'row');
    v_row := case when v_num is not null and v_num = trunc(v_num) and v_num between 1 and 2147483647
                  then v_num::integer else v_o::integer end;
    v_status := 'new'; v_error := null; v_match_id := null; v_m := null; v_m_kind := null; v_m_prov := null;
    v_vals := '{}'::jsonb; v_contact := null; v_dropped := '[]'::jsonb; v_unknown := '[]'::jsonb;
    v_incomplete := false; v_en_key := null;

    v_name := private.sales_clean(v_e->>'name');
    v_name_key := private.sales_name_key(v_name);
    v_en := private.sales_clean(v_e->>'name_en');

    -- ---- identity: error / match / new / duplicate in the file
    if v_name is null or v_name_key = '' then
      v_status := 'error'; v_error := 'no_name';
    elsif char_length(v_name) > 200 then
      v_status := 'error'; v_error := 'invalid';
    else
      v_match_id := private.sales_customer_find(p_company, v_name);
      if v_match_id is null and v_en is not null then
        v_match_id := private.sales_customer_find(p_company, v_en);
      end if;
      if v_match_id is not null then
        select * into v_m from public.sales_customers where id = v_match_id;
        v_m_kind := v_m.kind; v_m_prov := v_m.province_code;
        if v_match_id = any (v_seen_ids) then
          v_status := 'error'; v_error := 'duplicate_in_file';
        else
          v_status := 'match'; v_seen_ids := v_seen_ids || v_match_id;
        end if;
      elsif v_name_key = any (v_seen_keys) then
        v_status := 'error'; v_error := 'duplicate_in_file';
      end if;
    end if;

    if v_status in ('new', 'match') then
      -- ---- English name
      if v_en is not null then
        v_en_key := nullif(private.sales_name_key(v_en), '');
        if char_length(v_en) > 200 or v_en_key is null then
          v_dropped := v_dropped || jsonb_build_object('field', 'name_en', 'reason', 'invalid');
          v_en := null; v_en_key := null;
        elsif private.sales_customer_name_clash(p_company, v_en_key, v_match_id) is not null
              or v_en_key = any (v_seen_keys) then
          v_dropped := v_dropped || jsonb_build_object('field', 'name_en', 'reason', 'duplicate');
          v_en := null; v_en_key := null;
        end if;
      end if;

      -- ---- kind
      v_kind := null;
      v_txt := private.sales_clean(v_e->>'kind');
      if v_txt is not null then
        v_k := private.sales_word_key(v_txt);
        if v_k in ('government', 'دولتی') then v_kind := 'government';
        elsif v_k in ('contractor', 'پیمانکار') then v_kind := 'contractor';
        elsif v_k in ('private', 'خصوصی') then v_kind := 'private';
        else v_dropped := v_dropped || jsonb_build_object('field', 'kind', 'reason', 'invalid');
        end if;
      end if;
      v_eff_kind := coalesce(v_kind, v_m_kind);

      -- ---- CEO, CEO phone, activity, address
      v_ceo := private.sales_clean(v_e->>'ceo_name');
      if v_ceo is not null and char_length(v_ceo) > 120 then
        v_dropped := v_dropped || jsonb_build_object('field', 'ceo_name', 'reason', 'invalid'); v_ceo := null;
      end if;
      v_ceo_phone := private.sales_phone(v_e->>'ceo_phone');
      if v_ceo_phone is not null and v_ceo_phone !~ '^\+?[0-9]{5,15}$' then
        v_dropped := v_dropped || jsonb_build_object('field', 'ceo_phone', 'reason', 'invalid'); v_ceo_phone := null;
      end if;
      v_act := nullif(btrim(coalesce(v_e->>'activity', '')), '');
      if v_act is not null and char_length(v_act) > 1000 then
        v_dropped := v_dropped || jsonb_build_object('field', 'activity', 'reason', 'invalid'); v_act := null;
      end if;
      v_addr := private.sales_clean(v_e->>'address');
      if v_addr is not null and char_length(v_addr) > 500 then
        v_dropped := v_dropped || jsonb_build_object('field', 'address', 'reason', 'invalid'); v_addr := null;
      end if;

      -- ---- province (fixed list), then city (active list of that province)
      v_prov := null;
      v_txt := private.sales_clean(v_e->>'province');
      if v_txt is not null then
        v_k := private.sales_word_key(v_txt);
        select p.code into v_prov from public.iran_provinces p
         where v_k <> '' and (private.sales_word_key(p.code) = v_k or private.sales_word_key(p.name_fa) = v_k
                              or private.sales_word_key(p.name_en) = v_k)
         order by p.position limit 1;
        if v_prov is null then
          v_dropped := v_dropped || jsonb_build_object('field', 'province', 'reason', 'unknown');
        end if;
      end if;
      v_ctx_prov := coalesce(v_prov, v_m_prov);

      v_city := null;
      v_txt := private.sales_clean(v_e->>'city');
      if v_txt is not null then
        v_k := private.sales_word_key(v_txt);
        if v_ctx_prov is null or v_k = '' then
          v_dropped := v_dropped || jsonb_build_object('field', 'city', 'reason', 'invalid');
        else
          v_mapped := p_maps->'cities'->>(v_ctx_prov || '|' || v_k);
          if v_mapped is not null then
            v_city := private.sales_uuid(v_mapped);
          else
            select c.id into v_city from public.sales_cities c
             where c.company_id = p_company and c.province_code = v_ctx_prov and c.active
               and (private.sales_word_key(c.name_fa) = v_k or private.sales_word_key(c.name_en) = v_k)
             limit 1;
          end if;
          if v_city is null then
            v_unknown := v_unknown || jsonb_build_object('field', 'city', 'key', v_k, 'value', v_txt);
            v_mapped := v_ctx_prov || '|' || v_k;
            v_ucity := v_ucity || jsonb_build_object(v_mapped, jsonb_build_object(
              'key', v_k, 'province_code', v_ctx_prov, 'value', coalesce(v_ucity->v_mapped->>'value', v_txt),
              'rows', coalesce((v_ucity->v_mapped->>'rows')::integer, 0) + 1,
              'first', coalesce((v_ucity->v_mapped->>'first')::integer, v_o::integer)));
          elsif v_prov is null then
            v_prov := v_ctx_prov;
          end if;
        end if;
      end if;

      -- ---- rank, category (contractors and private companies)
      v_rank := null; v_cat := null;
      v_txt := private.sales_clean(v_e->>'rank');
      if v_txt is not null then
        if coalesce(v_eff_kind, '') not in ('contractor', 'private') then
          v_dropped := v_dropped || jsonb_build_object('field', 'rank', 'reason', 'not_contractor');
        else
          v_num := private.sales_num(translate(v_txt, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
          if v_num is not null and v_num = trunc(v_num) and v_num between 1 and 5 then v_rank := v_num::integer;
          else v_dropped := v_dropped || jsonb_build_object('field', 'rank', 'reason', 'invalid');
          end if;
        end if;
      end if;
      v_txt := private.sales_clean(v_e->>'category');
      if v_txt is not null then
        if coalesce(v_eff_kind, '') not in ('contractor', 'private') then
          v_dropped := v_dropped || jsonb_build_object('field', 'category', 'reason', 'not_contractor');
        else
          v_k := private.sales_word_key(v_txt);
          if v_k = '' then
            v_dropped := v_dropped || jsonb_build_object('field', 'category', 'reason', 'invalid');
          else
            v_mapped := p_maps->'categories'->>v_k;
            if v_mapped is not null then
              v_cat := private.sales_uuid(v_mapped);
            else
              select c.id into v_cat from public.sales_contractor_categories c
               where c.company_id = p_company and c.active
                 and (private.sales_word_key(c.name_fa) = v_k or private.sales_word_key(c.name_en) = v_k)
               limit 1;
            end if;
            if v_cat is null then
              v_unknown := v_unknown || jsonb_build_object('field', 'category', 'key', v_k, 'value', v_txt);
              v_ucat := v_ucat || jsonb_build_object(v_k, jsonb_build_object(
                'key', v_k, 'value', coalesce(v_ucat->v_k->>'value', v_txt),
                'rows', coalesce((v_ucat->v_k->>'rows')::integer, 0) + 1,
                'first', coalesce((v_ucat->v_k->>'first')::integer, v_o::integer)));
            end if;
          end if;
        end if;
      end if;

      -- ---- phone-book entry (FR-99): name and title (from the list) optional, at most one number.
      -- A bad part is dropped, the rest of the entry stays; an entry with no name, title or number is none.
      v_pers := private.sales_clean(v_e->>'contact_person');
      v_title := private.sales_clean(v_e->>'contact_title');
      v_phone := private.sales_phone(v_e->>'phone');
      v_email := lower(private.sales_clean(v_e->>'email'));
      v_tid := null; v_label := null;
      if v_pers is not null or v_title is not null or v_phone is not null or v_email is not null then
        if v_pers is not null and char_length(v_pers) > 120 then
          v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'person');
          v_pers := null;
        end if;
        if v_phone is not null and v_phone !~ '^\+?[0-9]{5,15}$' then
          v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'phone');
          v_phone := null;
        end if;
        if v_phone is not null then
          v_k := private.sales_word_key(private.sales_clean(v_e->>'contact_label'));
          v_label := case
            when v_k = '' then 'office'
            when v_k in ('office', 'دفتر') then 'office'
            when v_k in ('mobile', 'موبایل', 'همراه') then 'mobile'
            when v_k in ('fax', 'فکس', 'نمابر') then 'fax'
            when v_k in ('other', 'سایر', 'دیگر') then 'other'
            else 'other' end;
          if v_k <> '' and v_k not in ('office', 'دفتر', 'mobile', 'موبایل', 'همراه', 'fax', 'فکس', 'نمابر',
                                        'other', 'سایر', 'دیگر') then
            v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'label');
          end if;
        end if;
        if v_title is not null then
          v_k := private.sales_word_key(v_title);
          if v_k = '' or char_length(v_title) > 80 then
            v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'title');
          else
            v_mapped := p_maps->'titles'->>v_k;
            if v_mapped is not null then
              v_tid := private.sales_uuid(v_mapped);
            else
              select t.id into v_tid from public.sales_contact_titles t
               where t.company_id = p_company and t.active
                 and (private.sales_word_key(t.name_fa) = v_k or private.sales_word_key(t.name_en) = v_k)
               order by t.position, t.name_fa limit 1;
            end if;
            if v_tid is null then
              -- Titles are never created by an import: pick one in the dialog or leave the entry without.
              v_unknown := v_unknown || jsonb_build_object('field', 'title', 'key', v_k, 'value', v_title);
              v_utitle := v_utitle || jsonb_build_object(v_k, jsonb_build_object(
                'key', v_k, 'value', coalesce(v_utitle->v_k->>'value', v_title),
                'rows', coalesce((v_utitle->v_k->>'rows')::integer, 0) + 1,
                'first', coalesce((v_utitle->v_k->>'first')::integer, v_o::integer)));
            end if;
          end if;
        end if;
        if v_email is not null and (char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
          v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'email');
          v_email := null;
        end if;
        if v_pers is not null or v_tid is not null or v_phone is not null then
          v_contact := jsonb_build_object('name', v_pers, 'title_id', v_tid, 'email', v_email,
            'phones', case when v_phone is not null
                           then jsonb_build_array(jsonb_build_object('label', v_label, 'phone', v_phone))
                           else '[]'::jsonb end);
        elsif v_email is not null then
          -- Only an email is left: no entry to hold it.
          v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'person');
        end if;
      end if;

      -- ---- values as the form would validate them (a match keeps its own kind for the rank / category check)
      v_vals := jsonb_strip_nulls(jsonb_build_object('name', v_name, 'name_en', v_en, 'kind', v_kind,
        'ceo_name', v_ceo, 'ceo_phone', v_ceo_phone, 'activity', v_act,
        'province_code', v_prov, 'city_id', v_city, 'address', v_addr,
        'rank', v_rank, 'category_id', v_cat));
      begin
        v_cv := private.sales_customer_values(p_company, v_vals || jsonb_build_object('kind', v_eff_kind));
      exception when others then
        v_status := 'error'; v_error := 'invalid';
      end;
    end if;

    if v_status in ('new', 'match') then
      -- The row's keys are taken now, so a later row cannot repeat them.
      if v_status = 'new' then v_seen_keys := v_seen_keys || v_name_key; end if;
      if v_en_key is not null then v_seen_keys := v_seen_keys || v_en_key; end if;
      if v_status = 'new' then
        v_incomplete := cardinality(private.sales_customer_missing_of(v_cv,
          case when v_phone is not null and v_contact is not null then 1 else 0 end)) > 0;
        v_new := v_new + 1;
      else
        -- A match is judged after the "update" action (fills only empty fields).
        v_merged := private.sales_customer_import_merge(v_m, v_cv, false);
        v_nc := private.sales_customer_phone_count(v_match_id);
        if v_contact is not null and v_phone is not null
           and (select count(*) from public.sales_customer_contacts where customer_id = v_match_id) < 50
           and not exists (select 1 from public.sales_customer_phones q
                             join public.sales_customer_contacts k on k.id = q.contact_id
                            where k.customer_id = v_match_id and q.phone = v_phone) then
          v_nc := v_nc + 1;
        end if;
        v_incomplete := cardinality(private.sales_customer_missing_of(v_merged, v_nc)) > 0;
        v_match := v_match + 1;
      end if;
    else
      v_err := v_err + 1; v_vals := '{}'::jsonb; v_contact := null;
      v_dropped := '[]'::jsonb; v_unknown := '[]'::jsonb;
    end if;

    v_out := v_out || jsonb_build_object('row', v_row, 'status', v_status, 'error', v_error,
      'match', case when v_match_id is not null then jsonb_build_object('id', v_m.id, 'name', v_m.name, 'name_en', v_m.name_en) end,
      'values', v_vals, 'contact', v_contact, 'dropped', v_dropped, 'unknown', v_unknown,
      'incomplete', v_incomplete);
  end loop;

  return jsonb_build_object('rows', v_out,
    'unknown', jsonb_build_object(
      'categories', coalesce((select jsonb_agg(j.x - 'first' order by (j.x->>'first')::integer)
                                from jsonb_each(v_ucat) as j(k, x)), '[]'::jsonb),
      'cities', coalesce((select jsonb_agg(j.x - 'first' order by (j.x->>'first')::integer)
                            from jsonb_each(v_ucity) as j(k, x)), '[]'::jsonb),
      'titles', coalesce((select jsonb_agg(j.x - 'first' order by (j.x->>'first')::integer)
                            from jsonb_each(v_utitle) as j(k, x)), '[]'::jsonb)),
    'counts', jsonb_build_object('new', v_new, 'match', v_match, 'error', v_err));
end $_$;

create or replace function public.app_sales_customer_import(p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_company uuid := private.sales_company('sales_customers_import', 'edit');
  v_default text; v_file text; v_first jsonb; v_res jsonb; v_maps jsonb;
  v_cats jsonb := '{}'::jsonb; v_cities jsonb := '{}'::jsonb; v_titles jsonb := '{}'::jsonb;
  v_u jsonb; v_dec jsonb; v_act text; v_id uuid; v_fa text; v_en text; v_key text; v_pc text;
  v_batch uuid; v_r jsonb; v_action text; v_m public.sales_customers; v_cv public.sales_customers;
  v_merged public.sales_customers; v_vals jsonb; v_c jsonb; v_nc integer; v_kid uuid; v_before jsonb;
  v_created integer := 0; v_updated integer := 0; v_skipped integer := 0; v_dropped integer := 0;
  v_touched uuid[] := '{}'; v_changed boolean; v_contact_added boolean; v_incomplete integer;
  v_lists integer := 0; v_new_list boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object'
     or (p ? 'titles' and jsonb_typeof(p->'titles') not in ('object', 'null')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_default := coalesce(nullif(p->>'default_action', ''), 'skip');
  if v_default not in ('skip', 'update', 'overwrite') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(case when jsonb_typeof(p->'actions') = 'object' then p->'actions' else '{}'::jsonb end) j
              where j.value #>> '{}' is null or j.value #>> '{}' not in ('skip', 'update', 'overwrite')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_file := left(private.sales_clean(p->>'file_name'), 200);

  perform private.sales_customer_lock(v_company);
  begin
    -- 1. The lists the file needs: create or map the unknown categories / cities, map titles, then resolve again.
    v_first := private.sales_customer_import_resolve(v_company, p->'rows');
    for v_u in select x from jsonb_array_elements(v_first->'unknown'->'categories') as t(x) loop
      v_dec := case when jsonb_typeof(p->'categories'->(v_u->>'key')) = 'object' then p->'categories'->(v_u->>'key') else '{}'::jsonb end;
      v_act := v_dec->>'action'; v_id := null;
      if v_act = 'create' then
        v_fa := private.sales_clean(v_u->>'value');
        if v_fa is not null and char_length(v_fa) <= 80 then
          v_key := private.sales_name_key(v_fa);
          select id into v_id from public.sales_contractor_categories where company_id = v_company and name_key = v_key;
          if v_id is null then
            v_en := case when v_fa !~ '[؀-ۿ]' then v_fa end;
            insert into public.sales_contractor_categories (company_id, name_fa, name_key, name_en, position, created_by)
              values (v_company, v_fa, v_key, v_en,
                      (select coalesce(max(position), 0) + 1 from public.sales_contractor_categories where company_id = v_company),
                      auth.uid())
              returning id into v_id;
            perform private.sales_log(v_company, 'settings', v_id, v_fa, 'category',
              jsonb_build_object('op', 'created', 'source', 'import', 'name', v_fa, 'name_en', v_en));
            v_lists := v_lists + 1;
          end if;
        end if;
      elsif v_act = 'use' then
        v_id := private.sales_uuid(v_dec->>'id');
        if v_id is null or not exists (select 1 from public.sales_contractor_categories
                                        where id = v_id and company_id = v_company) then
          raise exception 'sales: invalid input' using errcode = '22023';
        end if;
      end if;
      if v_id is not null then v_cats := v_cats || jsonb_build_object(v_u->>'key', v_id); end if;
    end loop;
    for v_u in select x from jsonb_array_elements(v_first->'unknown'->'cities') as t(x) loop
      v_pc := v_u->>'province_code';
      v_dec := case when jsonb_typeof(p->'cities'->(v_pc || '|' || (v_u->>'key'))) = 'object'
                    then p->'cities'->(v_pc || '|' || (v_u->>'key')) else '{}'::jsonb end;
      v_act := v_dec->>'action'; v_id := null;
      if v_act = 'create' then
        v_fa := private.sales_clean(v_u->>'value');
        if v_fa is not null and char_length(v_fa) <= 80 then
          v_key := private.sales_name_key(v_fa);
          select id into v_id from public.sales_cities
           where company_id = v_company and province_code = v_pc and name_key = v_key;
          if v_id is null then
            v_en := case when v_fa !~ '[؀-ۿ]' then v_fa end;
            insert into public.sales_cities (company_id, province_code, name_fa, name_key, name_en, created_by)
              values (v_company, v_pc, v_fa, v_key, v_en, auth.uid()) returning id into v_id;
            perform private.sales_log(v_company, 'settings', v_id, v_fa, 'city',
              jsonb_build_object('op', 'created', 'source', 'import', 'name', v_fa, 'name_en', v_en,
                                 'province_code', v_pc));
            v_lists := v_lists + 1;
          end if;
        end if;
      elsif v_act = 'use' then
        v_id := private.sales_uuid(v_dec->>'id');
        if v_id is null or not exists (select 1 from public.sales_cities
                                        where id = v_id and company_id = v_company and province_code = v_pc) then
          raise exception 'sales: invalid input' using errcode = '22023';
        end if;
      end if;
      if v_id is not null then
        v_cities := v_cities || jsonb_build_object(v_pc || '|' || (v_u->>'key'), v_id);
      end if;
    end loop;
    -- FR-99: titles are only mapped to an active one (use) or left empty (empty / no decision); never created.
    for v_u in select x from jsonb_array_elements(v_first->'unknown'->'titles') as t(x) loop
      v_dec := case when jsonb_typeof(p->'titles') = 'object' then p->'titles'->(v_u->>'key') end;
      if v_dec is null or jsonb_typeof(v_dec) = 'null' then continue; end if;
      if jsonb_typeof(v_dec) <> 'object' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
      v_act := v_dec->>'action';
      if v_act = 'empty' then continue; end if;
      if v_act is distinct from 'use' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
      v_id := private.sales_uuid(v_dec->>'id');
      if v_id is null or not exists (select 1 from public.sales_contact_titles
                                      where id = v_id and company_id = v_company and active) then
        raise exception 'sales: invalid input' using errcode = '22023';
      end if;
      v_titles := v_titles || jsonb_build_object(v_u->>'key', v_id);
    end loop;
    v_maps := jsonb_build_object('categories', v_cats, 'cities', v_cities, 'titles', v_titles);
    v_res := private.sales_customer_import_resolve(v_company, p->'rows', v_maps);

    -- 2. The batch (counts filled in at the end).
    insert into public.sales_import_batches (company_id, file_name, created_by, kind)
      values (v_company, v_file, auth.uid(), 'customers') returning id into v_batch;

    -- 3. The rows.
    for v_r in select x from jsonb_array_elements(v_res->'rows') as t(x) loop
      if v_r->>'status' = 'error' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_c := case when jsonb_typeof(v_r->'contact') = 'object' then v_r->'contact' end;
      if v_r->>'status' = 'new' then
        v_cv := private.sales_customer_values(v_company, v_r->'values');
        insert into public.sales_customers (company_id, name, name_key, name_en, name_en_key, kind, ceo_name, ceo_phone,
                                            activity, province_code, city_id, address, rank, category_id,
                                            import_batch_id, created_by)
          values (v_company, v_cv.name, v_cv.name_key, v_cv.name_en, v_cv.name_en_key, v_cv.kind, v_cv.ceo_name,
                  v_cv.ceo_phone, v_cv.activity, v_cv.province_code, v_cv.city_id, v_cv.address, v_cv.rank,
                  v_cv.category_id, v_batch, auth.uid())
          returning id into v_id;
        if v_c is not null then
          insert into public.sales_customer_contacts (company_id, customer_id, person, title_id, email, position)
            values (v_company, v_id, v_c->>'name', (v_c->>'title_id')::uuid, v_c->>'email', 1) returning id into v_kid;
          insert into public.sales_customer_phones (company_id, contact_id, label, phone, position)
            select v_company, v_kid, x->>'label', x->>'phone', o::integer
              from jsonb_array_elements(v_c->'phones') with ordinality as w(x, o);
        end if;
        v_created := v_created + 1; v_touched := v_touched || v_id;
        v_dropped := v_dropped + jsonb_array_length(v_r->'dropped') + jsonb_array_length(v_r->'unknown');
        perform private.sales_customer_log_diff(v_company, v_id, 'imported_created', '{}'::jsonb,
          jsonb_build_object('batch_id', v_batch, 'file', v_file));
      else
        v_action := coalesce(nullif(p->'actions'->>(v_r->>'row'), ''), v_default);
        if v_action = 'skip' then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        v_id := (v_r->'match'->>'id')::uuid;
        select * into v_m from public.sales_customers where id = v_id and company_id = v_company for update;
        v_before := private.sales_customer_snapshot(v_id);
        v_vals := (v_r->'values') || jsonb_build_object('kind', coalesce(v_r->'values'->>'kind', v_m.kind));
        v_cv := private.sales_customer_values(v_company, v_vals);
        v_merged := private.sales_customer_import_merge(v_m, v_cv, v_action = 'overwrite');
        -- Validate the merged row exactly like the form does.
        v_merged := private.sales_customer_values(v_company, jsonb_build_object(
          'name', v_m.name, 'name_en', v_merged.name_en, 'kind', v_merged.kind, 'ceo_name', v_merged.ceo_name,
          'ceo_phone', v_merged.ceo_phone, 'activity', v_merged.activity,
          'province_code', v_merged.province_code, 'city_id', v_merged.city_id, 'address', v_merged.address,
          'rank', v_merged.rank, 'category_id', v_merged.category_id));
        -- Update keeps an existing Government type: the file's rank / category cannot be kept.
        if coalesce(v_merged.kind, '') not in ('contractor', 'private') then
          v_dropped := v_dropped + (v_cv.rank is not null)::integer + (v_cv.category_id is not null)::integer;
        end if;
        v_changed := (v_merged.name_en, v_merged.name_en_key, v_merged.kind, v_merged.ceo_name, v_merged.ceo_phone,
                      v_merged.activity, v_merged.province_code, v_merged.city_id, v_merged.address, v_merged.rank,
                      v_merged.category_id)
          is distinct from (v_m.name_en, v_m.name_en_key, v_m.kind, v_m.ceo_name, v_m.ceo_phone,
                            v_m.activity, v_m.province_code, v_m.city_id, v_m.address, v_m.rank, v_m.category_id);
        -- The row's entry joins the phone book unless it is there already (spec §11.4): its number is
        -- on the customer, or (no number) an entry with the same name and title exists. At most 50.
        v_contact_added := false;
        if v_c is not null then
          select count(*)::integer into v_nc from public.sales_customer_contacts where customer_id = v_id;
          if v_nc < 50 and not (case
               when jsonb_array_length(v_c->'phones') > 0 then
                 exists (select 1 from public.sales_customer_phones q
                           join public.sales_customer_contacts k on k.id = q.contact_id
                          where k.customer_id = v_id and q.phone = v_c->'phones'->0->>'phone')
               else exists (select 1 from public.sales_customer_contacts k
                             where k.customer_id = v_id
                               and private.sales_name_key(k.person) = private.sales_name_key(v_c->>'name')
                               and k.title_id is not distinct from (v_c->>'title_id')::uuid)
               end) then
            insert into public.sales_customer_contacts (company_id, customer_id, person, title_id, email, position)
              values (v_company, v_id, v_c->>'name', (v_c->>'title_id')::uuid, v_c->>'email',
                      (select coalesce(max(position), 0) + 1 from public.sales_customer_contacts where customer_id = v_id))
              returning id into v_kid;
            insert into public.sales_customer_phones (company_id, contact_id, label, phone, position)
              select v_company, v_kid, x->>'label', x->>'phone', o::integer
                from jsonb_array_elements(v_c->'phones') with ordinality as w(x, o);
            v_contact_added := true;
          end if;
        end if;
        if v_changed then
          update public.sales_customers set name_en = v_merged.name_en, name_en_key = v_merged.name_en_key,
              kind = v_merged.kind, ceo_name = v_merged.ceo_name, ceo_phone = v_merged.ceo_phone,
              activity = v_merged.activity, province_code = v_merged.province_code,
              city_id = v_merged.city_id, address = v_merged.address, rank = v_merged.rank,
              category_id = v_merged.category_id, updated_at = now(), updated_by = auth.uid()
           where id = v_id;
        elsif v_contact_added then
          update public.sales_customers set updated_at = now(), updated_by = auth.uid() where id = v_id;
        end if;
        if v_changed or v_contact_added then
          v_updated := v_updated + 1; v_touched := v_touched || v_id;
          v_dropped := v_dropped + jsonb_array_length(v_r->'dropped') + jsonb_array_length(v_r->'unknown');
          perform private.sales_customer_log_diff(v_company, v_id, 'imported_updated', v_before,
            jsonb_build_object('batch_id', v_batch, 'file', v_file, 'mode', v_action));
        else
          v_skipped := v_skipped + 1;
        end if;
      end if;
    end loop;

    update public.sales_import_batches set created_count = v_created, updated_count = v_updated,
        skipped_count = v_skipped where id = v_batch;
    -- Nothing written: no batch to list or remove.
    if v_created + v_updated = 0 then
      delete from public.sales_import_batches where id = v_batch;
      v_batch := null;
    end if;
    select count(*)::integer into v_incomplete from public.sales_customers
     where id = any (v_touched) and cardinality(missing) > 0;
  exception
    when check_violation or not_null_violation or foreign_key_violation or unique_violation then
      raise exception 'sales: invalid input' using errcode = '22023';
  end;
  if v_created + v_updated + v_lists > 0 then
    perform private.sales_log(v_company, 'import', v_batch, v_file, 'customer_import',
      jsonb_build_object('file', v_file, 'created', v_created, 'updated', v_updated, 'skipped', v_skipped,
                         'incomplete', v_incomplete, 'dropped', v_dropped, 'lists_created', v_lists));
  end if;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
    'skipped', v_skipped, 'incomplete', v_incomplete, 'dropped', v_dropped);
end $$;

-- ---------------------------------------------------------------- import batch removal
create or replace function public.app_sales_remove_customer_batch(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_customers_import', 'edit'); v_removed integer; v_kept integer;
  v_file text; g record;
begin
  select file_name into v_file from public.sales_import_batches
   where id = p_id and company_id = v_company and kind = 'customers';
  if not found then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;
  perform private.sales_customer_lock(v_company);
  v_removed := 0;
  for g in
    delete from public.sales_customers c
     where c.company_id = v_company and c.import_batch_id = p_id and c.updated_by is null
       and not exists (select 1 from public.sales_rfps r where r.buyer_id = c.id or r.client_id = c.id)
       and not exists (select 1 from public.sales_name_aliases a where a.kind = 'customer' and a.target_id = c.id)
     returning c.id, c.name
  loop
    v_removed := v_removed + 1;
    perform private.sales_log(v_company, 'customer', g.id, g.name, 'removed_by_import_undo',
                              jsonb_build_object('batch_id', p_id, 'file', v_file));
  end loop;
  select count(*)::integer into v_kept from public.sales_customers where import_batch_id = p_id;
  if v_kept = 0 then
    delete from public.sales_import_batches where id = p_id;
  end if;
  perform private.sales_log(v_company, 'import', p_id, v_file, 'batch_removed',
    jsonb_build_object('kind', 'customers', 'file', v_file, 'removed', v_removed, 'kept', v_kept));
  return jsonb_build_object('removed', v_removed, 'kept', v_kept);
end $$;

create or replace function public.app_sales_remove_batch(p_batch uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_deleted integer; v_kept integer;
  v_created timestamptz; v_kind text; v_file text; v_gone integer := 0; g record;
begin
  select created_at, kind, file_name into v_created, v_kind, v_file from public.sales_import_batches
   where id = p_batch and company_id = v_company and kind <> 'customers';
  if not found then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;
  perform private.sales_customer_lock(v_company);
  with gone as (
    delete from public.sales_rfps
     where company_id = v_company and import_batches = array[p_batch] and not edited_after_import returning 1)
  select count(*) into v_deleted from gone;
  -- Written by other batches too: this one steps out; the "first" batch moves to the last that remains.
  with stepped as (
    update public.sales_rfps set
      import_batches = array_remove(import_batches, p_batch),
      import_batch_id = case when import_batch_id = p_batch
        then (array_remove(import_batches, p_batch))[cardinality(array_remove(import_batches, p_batch))]
        else import_batch_id end
     where company_id = v_company and p_batch = any (import_batches) and cardinality(import_batches) > 1
     returning 1)
  select count(*) into v_kept from stepped;
  -- Edited rows that only this batch wrote stay on it, so the batch stays listed.
  select v_kept + count(*) into v_kept from public.sales_rfps
   where company_id = v_company and p_batch = any (import_batches);
  -- Customers the import made and nothing uses now (not ones added by hand since).
  for g in
    delete from public.sales_customers c
     where c.company_id = v_company and c.created_at >= v_created
       -- FR-98: never a registered customer (hand-made, edited, or from a customer import).
       and c.import_batch_id is null and c.updated_by is null and c.ceo_name is null
       and not exists (select 1 from public.sales_customer_contacts k where k.customer_id = c.id)
       and not exists (select 1 from public.sales_rfps r where r.buyer_id = c.id or r.client_id = c.id)
       and not exists (select 1 from public.sales_name_aliases a where a.kind = 'customer' and a.target_id = c.id)
     returning c.id, c.name
  loop
    v_gone := v_gone + 1;
    perform private.sales_log(v_company, 'customer', g.id, g.name, 'removed_by_import_undo',
                              jsonb_build_object('batch_id', p_batch, 'file', v_file));
  end loop;
  if not exists (select 1 from public.sales_rfps where company_id = v_company
                  and (p_batch = any (import_batches) or import_batch_id = p_batch)) then
    delete from public.sales_import_batches where id = p_batch;
  end if;
  perform private.sales_log(v_company, 'import', p_batch, v_file, 'batch_removed',
    jsonb_build_object('kind', v_kind, 'file', v_file, 'removed', v_deleted, 'kept', v_kept,
                       'customers_removed', v_gone));
  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept);
end $$;

-- ---------------------------------------------------------------- titles: Settings writer, lists
create function public.app_sales_save_title(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_id uuid; v_fa text; v_en text;
  v_key text; v_other uuid; v_row public.sales_contact_titles; v_before jsonb := '{}'::jsonb; v_after jsonb;
  v_changes jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  v_id := private.sales_uuid(p->>'id');
  if nullif(p->>'id', '') is not null and v_id is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  v_fa := private.sales_clean(p->>'name_fa'); v_en := private.sales_clean(p->>'name_en');
  v_key := private.sales_name_key(v_fa);
  if v_fa is null or v_key = '' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  perform private.sales_customer_lock(v_company);
  select id into v_other from public.sales_contact_titles
   where company_id = v_company and name_key = v_key and id is distinct from v_id;
  if v_other is not null then
    raise exception 'sales: duplicate name' using errcode = '23505',
      hint = (select jsonb_build_object('id', id, 'name', name_fa, 'name_en', name_en)::text
                from public.sales_contact_titles where id = v_other);
  end if;
  if v_id is not null then
    select to_jsonb(x) - array['company_id', 'id', 'name_key', 'created_by', 'created_at'] into v_before
      from public.sales_contact_titles x where x.id = v_id and x.company_id = v_company for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  begin
    if v_id is null then
      insert into public.sales_contact_titles (company_id, name_fa, name_key, name_en, active, position, created_by)
        values (v_company, v_fa, v_key, v_en, coalesce((p->>'active')::boolean, true),
                coalesce(private.sales_num(p->>'position')::integer,
                         (select coalesce(max(position), 0) + 1 from public.sales_contact_titles
                           where company_id = v_company)), auth.uid())
        returning * into v_row;
    else
      -- An absent name_en keeps the stored one (reorder / hide send only the Farsi name).
      update public.sales_contact_titles set name_fa = v_fa, name_key = v_key,
          name_en = case when p ? 'name_en' then v_en else name_en end,
          active = coalesce((p->>'active')::boolean, active),
          position = coalesce(private.sales_num(p->>'position')::integer, position)
       where id = v_id and company_id = v_company returning * into v_row;
    end if;
  exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'sales: invalid input' using errcode = '22023';
  when unique_violation then
    raise exception 'sales: duplicate name' using errcode = '23505';
  end;
  v_after := to_jsonb(v_row) - array['company_id', 'id', 'name_key', 'created_by', 'created_at'];
  v_changes := private.sales_diff(v_before, v_after);
  if v_id is null or v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'settings', v_row.id, v_row.name_fa, 'title',
      jsonb_build_object('op', private.sales_list_op(v_id is null, v_before, v_after), 'name', v_row.name_fa,
                         'name_en', v_row.name_en, 'changes', v_changes));
  end if;
  return jsonb_build_object('id', v_row.id, 'name_fa', v_row.name_fa, 'name_en', v_row.name_en,
                            'active', v_row.active, 'position', v_row.position);
end $$;

create or replace function public.app_sales_customer_lists() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company(); v_all boolean := private.sales_can('sales_settings');
begin
  return jsonb_build_object(
    'provinces', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name_fa', name_fa, 'name_en', name_en)
                    order by position), '[]'::jsonb) from public.iran_provinces),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'province_code', province_code,
                 'name_fa', name_fa, 'name_en', name_en, 'active', active) order by province_code, name_fa), '[]'::jsonb)
                 from public.sales_cities where company_id = v_company and (active or v_all)),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name_fa', name_fa, 'name_en', name_en,
                     'active', active, 'position', position) order by position, name_fa), '[]'::jsonb)
                     from public.sales_contractor_categories where company_id = v_company and (active or v_all)),
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name_fa', name_fa, 'name_en', name_en,
                 'active', active, 'position', position) order by position, name_fa), '[]'::jsonb)
                 from public.sales_contact_titles where company_id = v_company and (active or v_all)));
end $$;

-- ---------------------------------------------------------------- customer history reader
-- The customer's rows plus, recursively, those of every customer merged into it (chains A→B→C),
-- newest first, at most 500. Private values only for sales_customers holders.
create function public.app_sales_customer_history(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company(); v_private boolean := private.sales_can('sales_customers', 'edit');
begin
  return (
    with recursive ids(id) as (
      select p_id
      union
      select private.sales_uuid(a.body->>'from_id')
        from public.sales_audit a join ids on a.entity_id = ids.id
       where a.company_id = v_company and a.entity = 'customer' and a.action = 'merged_from'
         and private.sales_uuid(a.body->>'from_id') is not null)
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'actor_id', a.actor_id,
             'actor_name', pr.full_name, 'entity', a.entity, 'entity_id', a.entity_id, 'entity_label', a.entity_label,
             'action', a.action, 'body', private.sales_strip_private(a.body, v_private))
           order by a.at desc, a.id desc), '[]'::jsonb)
      from (select * from public.sales_audit
             where company_id = v_company and entity = 'customer' and entity_id in (select id from ids)
             order by at desc, id desc limit 500) a
      left join public.profiles pr on pr.id = a.actor_id);
end $$;

-- ---------------------------------------------------------------- sales_ensure: titles for new companies
create or replace function private.sales_ensure(p_company uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_bid uuid; v_contract uuid; v_pos integer;
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
      (p_company, v_bid, 9, 'بایگانی (بدون نتیجه)', 'Archived (no result)', 'archived', null, 'archived'),
      (p_company, v_bid, 10, 'لغوشده', 'Cancelled', 'cancelled', null, 'cancelled');
  end if;
  -- Companies seeded before FR-94 section 16 get the Archived stage right after No bid.
  if not exists (select 1 from public.sales_stages where flow_id = v_bid and (code = 'archived' or kind = 'archived')) then
    select position + 1 into v_pos from public.sales_stages where flow_id = v_bid and code = 'no_bid';
    v_pos := coalesce(v_pos, (select coalesce(max(position), 0) + 1 from public.sales_stages where flow_id = v_bid));
    update public.sales_stages set position = position + 1 where flow_id = v_bid and position >= v_pos;
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, action, code)
      values (p_company, v_bid, v_pos, 'بایگانی (بدون نتیجه)', 'Archived (no result)', 'archived', null, 'archived');
  end if;
  if not exists (select 1 from public.sales_stages where flow_id = v_contract) then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, code) values
      (p_company, v_contract, 1, 'جدید', 'New', 'open', 'new'),
      (p_company, v_contract, 2, 'جاری', 'Current', 'open', 'current'),
      (p_company, v_contract, 3, 'متوقف', 'Hold', 'open', 'hold'),
      (p_company, v_contract, 4, 'پایان‌یافته', 'Finish', 'done', 'finish'),
      (p_company, v_contract, 5, 'لغوشده', 'Cancel', 'cancelled', 'cancel');
  end if;
  -- The contract flow also gets an Archived stage (admin archive, 2026-11-23): last, closed.
  if not exists (select 1 from public.sales_stages where flow_id = v_contract and (code = 'archived' or kind = 'archived')) then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, action, code)
      select p_company, v_contract, coalesce(max(position), 0) + 1, 'بایگانی', 'Archived', 'archived', null, 'archived'
        from public.sales_stages where flow_id = v_contract;
  end if;
  -- The company's currency list (FR-94 CEO feedback): today's five, managed in Settings afterwards.
  insert into public.sales_currencies (company_id, code, name_fa, name_en, symbol, decimals, position) values
    (p_company, 'IRR', 'ریال', 'Rial', null, 0, 1),
    (p_company, 'EUR', 'یورو', 'Euro', '€', 2, 2),
    (p_company, 'USD', 'دلار', 'US dollar', '$', 2, 3),
    (p_company, 'AED', 'درهم', 'UAE dirham', null, 2, 4),
    (p_company, 'CNY', 'یوان', 'Chinese yuan', null, 2, 5)
    on conflict do nothing;
  -- FR-98: contractor categories + county-seat cities, only while the company has neither.
  if not exists (select 1 from public.sales_contractor_categories where company_id = p_company)
     and not exists (select 1 from public.sales_cities where company_id = p_company) then
    perform private.sales_seed_customer_lists(p_company);
  end if;
  -- FR-99: key-person titles, only while the company has none.
  perform private.sales_seed_contact_titles(p_company);
end $_$;

-- ---------------------------------------------------------------- old helper, backfill, recompute
drop function private.sales_customer_set_contacts(uuid, uuid, jsonb);

update public.sales_customers c set created_by = b.created_by
  from public.sales_import_batches b
 where b.id = c.import_batch_id and c.created_by is null and b.created_by is not null;
-- The BEFORE trigger recomputes `missing` with the new rules (phones, grade_or_activity).
update public.sales_customers set missing = missing;

-- ---------------------------------------------------------------- grants
revoke all on function private.sales_seed_contact_titles(uuid) from public, anon, authenticated;
revoke all on function private.sales_customer_phone_count(uuid) from public, anon, authenticated;
revoke all on function private.sales_phones_missing_trg() from public, anon, authenticated;
revoke all on function private.sales_customer_set_people(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.sales_customer_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.sales_people_diff(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.sales_customer_log_diff(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.app_sales_save_title(jsonb) from public, anon;
grant execute on function public.app_sales_save_title(jsonb) to authenticated;
revoke all on function public.app_sales_customer_history(uuid) from public, anon;
grant execute on function public.app_sales_customer_history(uuid) to authenticated;
