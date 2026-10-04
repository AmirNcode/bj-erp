# AGENTS.md

Agent (and human) onboarding for this project lives in **[CLAUDE.md](CLAUDE.md)** — the single,
maintained source of truth for how the codebase is organized, the decisions already made, and how
to resume work without re-asking.

**Start there.** Always read the newest entries of `docs/AGENT-LOG.md` (what the last agents did)
and `docs/TASKS.md` (open work). Read the domain docs CLAUDE.md lists only when the task touches
them; current SQL definitions are in `supabase/schema.sql`. Do not read or search `docs/archive/`
(retired history) unless the user asks.

Every session appends an entry to `docs/AGENT-LOG.md` before finishing — see CLAUDE.md.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
