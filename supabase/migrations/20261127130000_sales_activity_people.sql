-- FR-99 follow-up (owner, 2026-11-27): the Activity page's person filter lists only people who may
-- change something in ERP › Sales — any Sales permission at edit level (read-only holders are left out).
-- The admin passes every permission check, so the admin is listed too.

create function public.app_sales_activity_people() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_activity', 'read');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name, p.id)
      from public.profiles p
     where p.company_id = v_company
       and p.active
       and not private.is_test_account(p.id)
       and private.has_perm(p.id, 'sales', 'read')
       and exists (select 1 from unnest(array['sales', 'sales_prices', 'sales_bonds', 'sales_decide',
                                              'sales_settings', 'project_items', 'sales_customers',
                                              'sales_customers_import']) as k(key)
                    where private.has_perm(p.id, k.key, 'edit'))), '[]'::jsonb);
end $$;

revoke all on function public.app_sales_activity_people() from public, anon;
grant execute on function public.app_sales_activity_people() to authenticated;
