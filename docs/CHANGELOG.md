# CHANGELOG

Format: [Keep a Changelog](https://keepachangelog.com/). This project will adopt semantic
versioning once the app is scaffolded. Until then, entries track documentation and design.

## [Unreleased]

### Added
- Project documentation scaffold: `CLAUDE.md` (agent onboarding) and `docs/` —
  `PLAN.md`, `REQUIREMENTS.md`, `DATA_MODEL.md`, `PERMISSIONS.md`, `TASKS.md`, this changelog.
- Approved v1 design spec: `docs/specs/2026-06-23-hr-timeoff-design.md` (HR / Time-Off).
- Phase 0–2 implementation plan (TDD, file-level): `docs/plans/2026-06-23-hr-timeoff-v1.md`.
- Recorded key decisions: fresh build on Next.js + Supabase reusing Frappe HR's leave data model;
  admin-issued username/password auth; Farsi-default RTL + English; full Supabase with self-host
  for production; direct-manager approval with admin override; statutory leave types + balance
  ledger; full/half-day (hourly reserved); configurable Friday weekend + seeded Iranian holidays.

### Next
- Detailed implementation plan, then Phase 0 scaffolding.
