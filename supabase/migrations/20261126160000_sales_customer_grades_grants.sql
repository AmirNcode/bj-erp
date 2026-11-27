-- PR #36 review: 20261126150000 left its two private helpers with the default EXECUTE for PUBLIC.
-- Every other FR-98 helper revokes it (20261126100200 "grants"); sales_customer_set_grades is
-- SECURITY DEFINER with no permission check of its own, so only the app_sales_* functions may call it.
revoke all on function private.sales_customer_set_grades(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.sales_customer_grades_trg() from public, anon, authenticated;
