-- FR-54: the finance role signs the last step of a clearance form.
-- Its own file: Postgres refuses a new enum value inside the transaction that adds it,
-- and 20261007150002_clearance_form.sql uses it.
alter type public.app_role add value if not exists 'finance';
