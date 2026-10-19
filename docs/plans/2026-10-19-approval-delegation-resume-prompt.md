Continue the approval-delegation implementation in /Users/amir/Workspace/bj.

> **Superseded in part (2026-10-19, owner):** the CEO timer, worker, scheduled job, worker-health card
> and adjustable review window were removed. The CEO delegate's own requests now get the CEO step
> approved at submission. Current behavior: spec amendment in
> `docs/specs/2026-10-17-ceo-delegate-approval-design.md`, `docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`.
> The migrations were squashed into `20261018011333_approval_delegation.sql`.

Read CLAUDE.md, then docs/plans/2026-10-19-approval-delegation-handoff.md. Treat it as the current operational handoff; use the earlier 2026-10-18 handoff only for detailed policy/source context. Resume without broad rediscovery or reopening settled policy decisions.

Preserve all uncommitted work on codex/approval-delegation. Both 20261018011333_approval_delegation.sql and 20261018231551_approval_delegation_lock_rechecks.sql are applied to the isolated test database and frozen. Any SQL correction requires a new forward migration.

Finish the worker-card lint fix, diagnose the Farsi redirect loop using the handoff's concrete evidence, run the corrected six additional concurrency scenarios, complete browser validation (all four forms, exact-step decisions, mobile RTL and English/Farsi print), and perform final checks/documentation. Do not repeat already-passing checks unless changes or evidence justify it. Do not claim completion while required validation remains.

Use at most two concurrent subagents, no nested delegation, and explicitly configure model and effort where supported. Lead retains database operations, shared test runs, schema regeneration and the session journal.

Use only bj-delegation-db and its synthetic API/app stack. Do not touch the shared real-roster database or production. Keep the isolated cron inactive except during explicit local scheduler validation and return it inactive afterward. Credential/session hardening remains explicitly deferred; retain the recorded risk without adding a new activation gate.

Do not commit, push, deploy or activate the production worker without further instruction.
