# Implementation plan — daily work errands and PTO overage

1. Add a replay-safe migration that permits day-unit errands, publishes a signed daily-errand RPC,
   records `unpaid_minutes`, removes the insufficient-balance rejection, partially consumes paid
   balances on approval, and partially reverses them on cancellation.
2. Add `/request/daily-errand` with two Persian date fields, location, description, requester
   signature, consent, and a duration preview. Expand the request tabs to four and rename the existing
   errand tab.
3. Change daily/hourly paid-leave previews to show requesting, projected remaining, and conditional
   unpaid amounts using canonical minute helpers and the company day length.
4. Update Supabase types, translations, list labels, requirements, data model, permissions, tests,
   tasks, changelog, and the mandatory agent log.
5. Apply only the new migration to the preserved native-ARM64 local database after a fresh backup;
   verify schema, existing counts, ledger behavior, unit/static/build gates, and authenticated browser
   flows.
