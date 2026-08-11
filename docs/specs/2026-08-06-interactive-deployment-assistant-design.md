# Interactive deployment assistant — design record

**Date:** 2026-08-06
**Status:** approved for implementation
**Primary operator:** Amir, from an Apple-Silicon Mac
**Production target:** `behsazan@5.201.190.184:2222`, app at `https://10.10.10.50:3500`

## 1. Problem

The existing deployment pieces are individually useful, but an operator still has to select,
copy, edit, and sequence many commands. That is slow and makes it easy to use the AMD64 production
images on the ARM64 Mac, forget a database migration, test the private production URL from the wrong
network, or remove the wrong Docker volume.

The project needs one guided command that can safely operate the local Docker stack and can package,
transfer, execute, monitor, and resume production work through SSH. It must still expose
non-interactive commands so each operation is testable and automatable.

## 2. Goals

- One entry point: `./deploy/bj-deploy`.
- An interactive menu for ordinary use and explicit subcommands for automation/recovery.
- Native ARM64 local images and verified AMD64 production artifacts, with different image tags and
  mandatory target-specific Compose overlays.
- Clear separation between restart, app-only redeploy, safe update, database reset, and factory
  reset.
- Verified database backup before any database-changing production operation; a destructive reset
  additionally requires a verified copy on the Mac and a typed confirmation phrase.
- Resumable production operations: a dropped SSH session must not terminate a server-side deploy,
  and the Mac command must be able to reconnect, report status, and continue downloading evidence.
- Migration files are immutable and recorded by filename plus SHA-256; already-applied migrations
  are skipped and changed historical files stop the deploy.
- Machine-readable release state, redacted logs, and enough documentation for a new agent to rebuild
  or diagnose the system with no conversation history.

## 3. Non-goals

- The assistant does not configure the client's VPN, firewall, router, DNS, or final subdomain.
- It does not upgrade Postgres, GoTrue, PostgREST, Caddy, or switch Supabase's gateway. Those pinned
  infrastructure versions require a separate reviewed migration project.
- It does not make a database restore automatic after forward schema migrations. An image rollback
  is safe to automate; a database restore is an explicit recovery action because it discards later
  writes.
- It does not store the SSH password, sudo password, admin password, JWT secret, database password,
  or service-role key in command arguments or logs.

## 4. Fixed topology and defaults

| Setting | Local Mac | Client server |
|---|---|---|
| CPU | detected ARM64 | remotely verified AMD64 |
| Compose project | `bj-erp` | `bj-erp` |
| Compose files | base + `docker-compose.local-arm64.yml` | base + `docker-compose.client-amd64.yml` |
| App image | `bj-erp-app:local-arm64` | `bj-erp-app:<release>` |
| Public address | `https://localhost:3500` or Mac LAN IP | `https://10.10.10.50:3500` |
| SSH | not applicable | `behsazan@5.201.190.184`, port `2222`, alias `bj` allowed |
| Install directory | `deploy/` | `/home/behsazan/bj-erp-installer` |

The Mac does **not** need the client's VPN for deployment. It reaches the public SSH endpoint
directly. The Mac cannot be expected to reach `10.10.10.50`, so production HTTP/Auth health checks
run on the server. The phone VPN is only for the operator's final browser check.

Configuration may override defaults through environment variables documented in
`docs/DEPLOY-ASSISTANT.md`, but every resolved value is printed before execution.

## 5. Operations and data effect

| Operation | App container | Database | Secrets | Caddy CA | Production backup |
|---|---|---|---|---|---|
| `doctor` | read only | read only | read only | read only | no |
| `status` / `logs` | read only | read only | read only | read only | no |
| `restart` | restart existing | unchanged | unchanged | unchanged | no |
| `app` | rebuild/recreate app only | unchanged | unchanged | unchanged | no |
| `update` | new image | pending migrations + seed | unchanged | unchanged | verified + copied to Mac |
| `reset-db` | recreated | erased/rebuilt | regenerated | preserved | verified + copied to Mac |
| `factory-reset` | recreated | erased/rebuilt | regenerated | erased/rebuilt | verified + copied to Mac |

`app` is refused when the source migration manifest differs from the installed manifest. The user
must choose `update` so the database contract changes with the app.

## 6. Safety boundaries

### 6.1 Target and architecture

Local commands always use the base Compose file plus the ARM64 overlay. Production commands always
use the base file plus the AMD64 overlay. Each image architecture is inspected before use. An
architecture mismatch is a hard failure, not a warning.

Production packaging may pull AMD64 manifests under canonical source tags on the Mac, but it saves
and deploys only dedicated `*-client-amd64` service tags. The local stack never references those
tags, so packaging cannot silently switch local services back to emulation.

### 6.2 Git source

Production release commands default to branch `main`, require no uncommitted/untracked files, and
record the full commit SHA in the manifest. `--allow-dirty` exists only as an explicit emergency
override and stamps the release `dirty`; the interactive menu does not offer it.

Local commands may use a dirty tree after a warning because their purpose is testing current work.

### 6.3 Destructive confirmation

`reset-db` and `factory-reset` print the target, exact Compose project, exact volumes, retained or
destroyed items, and backup destination. Execution requires typing a run-specific phrase. `--yes`
does not bypass this production confirmation.

The remote reset script validates that every selected volume has Compose labels for project
`bj-erp`; it never removes a glob, unresolved variable, directory tree, or unnamed target.

### 6.4 Backup

Before production `update`, `reset-db`, or `factory-reset`:

1. `pg_dump -Fc` creates a timestamped custom archive on the server.
2. `pg_restore -l` proves the archive can be read.
3. Key business-table row counts are recorded.
4. The backup and its SHA-256 file are copied to the Mac with resumable `rsync`.
5. The Mac verifies the checksum and non-zero size.
6. A destructive reset cannot begin until steps 1–5 finish.

Backups contain employee records and password hashes. Directories are mode `700`, files are mode
`600`, and paths are ignored by Git.

### 6.5 Secrets

Passwords are requested only from a terminal with hidden input. Production reset inputs are written
to a root-owned mode-`600` job input file, consumed by the detached process, and deleted as soon as
the new `.env` exists. Secret values are never echoed. Logs may show variable names, paths, hashes,
versions, and public URLs only.

## 7. Migration contract

The private deployment schema `bj_deploy` contains:

```sql
schema_migrations(
  filename text primary key,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now(),
  release_version text not null
)
```

No application role can use this schema. The deployment script runs as `supabase_admin`.

For each sorted `migrations/*.sql` file:

- absent filename: apply it with `ON_ERROR_STOP` and insert its ledger row in the same transaction;
- matching filename/checksum: skip it;
- matching filename/different checksum: abort because migration history was edited.

Implementation correction (2026-08-11): legacy installations without the ledger are bootstrapped
deliberately rather than replaying historical SQL. The known final function sentinel proves the
original 38-migration baseline; each of the three August migrations is adopted only after a complete
catalog fingerprint proves its schema, function bodies/security, grants, and obsolete-overload
removal. Unknown or partial histories stop for manual reconciliation. Fresh installations apply all
files normally. PostgreSQL's single-transaction mode now makes each migration and ledger insertion
atomic, so interruption rolls back both and resume starts at the same filename.

The deployment manifest also stores the sorted migration filename/checksum set. `app` compares that
set with the installed manifest and refuses if it changed. The server independently verifies an
immutable, run-scoped migration directory before any app/update/reset mutation, so concurrent
staging cannot replace a detached job's SQL inputs.

## 8. Health contract

The app exposes unauthenticated `GET /api/health`, outside locale/session middleware. Success is
HTTP 200 with a small JSON body containing `status: ok`; it performs no database write and returns
`Cache-Control: no-store`.

A successful stack check requires:

- Compose reports the database healthy and all required services running;
- the gateway can reach `/api/health` and receives the expected body;
- `/auth/v1/health` reports GoTrue healthy;
- the running app image architecture matches the target.

The check runs from inside the server/gateway network, avoiding false failures caused by private
addresses or the internal Caddy CA. A normal `/` locale redirect such as HTTP 307 is not treated as
application failure.

## 9. Resumable production protocol

Each production operation gets an ID such as `20260806T153012Z-a1b2c3`. The Mac creates a local
release directory and a matching remote staging directory. Artifacts include SHA-256 checksums and a
manifest. Transfer uses `rsync --partial --append-verify` where supported.

The remote controller has four phases:

1. `prepare`: validate artifacts/checksums/target, acquire operator input, and create job metadata.
2. `start`: launch the operation detached with `nohup`; write PID and `RUNNING` status atomically.
3. `status` / `logs`: reconnect-safe read-only commands.
4. completion: atomically write `SUCCEEDED` or `FAILED:<code>`, retain the log, and delete temporary
   secret input.

If SSH drops after `start`, the remote process continues. Running `bj-deploy resume <run-id>` polls
status, streams unseen log content, and fetches backup/evidence on success. Starting a second
mutating production job is rejected by `flock`; read-only status and logs remain available.

The controller is designed so relaunching `start` for an already-running/succeeded ID does not run
the operation twice.

## 10. Failure and recovery behavior

| Failure | Required behavior |
|---|---|
| Docker/SSH unavailable | stop before build or mutation |
| transfer interrupted | rerun/resume same run ID |
| artifact checksum mismatch | delete/replace staged artifact; never execute |
| invalid image architecture | stop before cutover |
| backup invalid or Mac copy unverified | stop before database change/reset |
| migration failure | leave old app running; report backup path |
| new app unhealthy | restore previous image version; migrations remain forward-only |
| SSH drops during remote job | job continues; `resume` reconnects |
| Mac process exits | run ID printed early; `resume` reconstructs monitoring |
| reset install fails after wipe | keep backup and failure log; rerun same prepared install or restore |

## 11. Observability and state

Local transient state lives under ignored `.bj-deploy/`. Production state lives under
`/home/behsazan/bj-erp-installer/.bj-deploy/`. Each run has `manifest.env`, `status`, `pid`, and
`job.log`. The installed release has `installed-manifest.env` and
`installed-migrations.sha256`.

All timestamps are UTC. Logs use stable phase names and end with a single success/failure line.
Commands support `--dry-run`; destructive dry-runs resolve and print targets but do not request
passwords, build images, transfer artifacts, or mutate Docker/DB state.

## 12. Compatibility

- Mac controller: the Bash shipped by macOS (3.2), BSD utilities, Docker Desktop, OpenSSH, rsync,
  git, openssl, and shasum.
- Server worker: Bash, GNU coreutils, Docker Engine with Compose v2, OpenSSH server, rsync, sudo,
  flock, curl, openssl, and sha256sum.
- No GitHub or container-registry access is required on the client server.
- Ordinary releases retain the currently pinned Supabase/Postgres 15 stack. Postgres 17 or other
  upstream infrastructure transitions are explicitly outside this assistant.

## 13. Acceptance criteria

- `bj-deploy doctor local` proves all selected local images are ARM64.
- `bj-deploy doctor client` proves direct SSH, remote AMD64, prerequisites, directory, and server-side
  app health without requiring the Mac to reach the private app IP.
- Local restart/app/update/reset paths use only the ARM64 overlay and give accurate data-impact text.
- Production update packages AMD64, transfers resumably, performs a verified off-machine backup,
  applies only pending immutable migrations, cuts over, and reports health.
- Production reset cannot delete data without a verified Mac backup and exact typed confirmation.
- Disconnecting monitoring does not kill the remote job; `resume` recovers it.
- Shell syntax/static checks and fixture-based tests cover prompts, guards, manifests, migration
  comparisons, architecture mismatches, target validation, status transitions, and dry-run behavior.
- Operator and recovery documentation contains no dependency on this conversation.
