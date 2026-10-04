# Implementation plan: approval signatures and Persian-only calendar

1. Generate a timestamped migration and add nullable historical approval-signature columns, shape
   constraints, signed approval RPC parameters, explicit grants, calendar preference normalization,
   and a PostgREST cache notification.
2. Extend generated Supabase types and server actions so approval requires validated signature data
   and explicit authorization, while rejection remains unchanged.
3. Reuse the pointer signature field in both approval dialogs and expose private approver signatures
   lazily to authorized viewers.
4. Remove the profile calendar selector and calendar-preference writes; make all pickers and date
   formatters Persian-only while preserving English/Farsi locale digits and direction.
5. Update all call sites, translations, requirements/data/security docs, and migration/redeploy notes.
6. Add unit coverage for signed approval enforcement and Persian-only configuration; update all e2e
   approval helpers to draw and authorize before confirming.
7. Apply the new migration to the backed-up local Docker database, reload PostgREST, rebuild/recreate
   only the app container, then verify SQL, unit/lint/build, desktop/mobile approval interactions, and
   the English admin approval date rendering.
