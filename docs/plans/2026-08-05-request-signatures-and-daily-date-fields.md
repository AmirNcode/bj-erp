# Implementation Plan — Separate Daily Dates and Requester Signatures

1. Add pure signature-data validation plus a shared pointer/touch canvas, authorization checkbox, and
   lazy stored-signature viewer.
2. Replace daily range state with start/end state, separate date pickers, ordering constraints, and
   unchanged Gregorian conversion/preview behavior.
3. Add the shared signature fields to daily, hourly, and errand forms and require both signature and
   authorization before calling their server actions.
4. Generate a Supabase migration; add signature/consent columns and attach evidence from all three
   public wrappers in the same transaction as the shared internal request writer.
5. Update generated database types, server-action validation/RPC parameters, request readers, approval
   cards, requester rows, and privileged calendar metadata/viewers.
6. Add English/Farsi copy, DB-error mappings, unit/component coverage, and update the existing browser
   flows for two daily dates and required signatures.
7. Run migration validation where the configured database is reachable, then TypeScript, lint, unit,
   production build, and rendered desktop/mobile browser verification. Record any environmental block.
