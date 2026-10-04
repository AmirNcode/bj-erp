# Interactive deployment assistant — implementation and recovery plan

**Design:** `docs/specs/2026-08-06-interactive-deployment-assistant-design.md`
**Entry point:** `deploy/bj-deploy`
**Status:** implemented and locally/static verified; first live client run pending operator review

This file is both an implementation checklist and a cold-start handoff. A new agent should read
`CLAUDE.md`, `docs/AGENT-LOG.md`, the design above, this plan, then the deployment files listed in
section 2. No conversation history is required.

## 1. Constraints that must not be rediscovered or changed casually

- Local machine: MacBook Pro M2 Pro, Docker daemon ARM64. All five local images must be native
  ARM64 and use the local overlay.
- Production: Linux AMD64. Mac builds offline artifacts and sends them to
  `behsazan@5.201.190.184:2222`; server cannot be assumed to reach GitHub/Docker registries.
- Mac reaches SSH without VPN. App `https://10.10.10.50:3500` is reachable only from the client LAN
  or the user's phone VPN, so automated production health checks run on the server.
- Existing worktree contains substantial unrelated uncommitted feature work. Preserve it. This plan
  changes deployment files, the health route, deployment tests, and deployment docs only.
- Never contact or modify the client server while implementing/testing this feature unless the user
  separately authorizes a live test.
- Do not auto-upgrade pinned self-host services. Supabase has announced major self-host changes;
  those require a separate migration plan.

## 2. Existing building blocks

- `deploy/install.sh`: offline install, secret generation, migrations, seed, first admin, CA export.
- `deploy/update.sh`: verified backup, AMD64 app load, migrations, cutover, rollback, row counts.
- `deploy/package.sh`: complete offline AMD64 installer bundle.
- `deploy/release.sh`: routine AMD64 app build/rsync/remote update/backup fetch.
- `deploy/setup-release.sh`: SSH key and alias setup.
- `deploy/prepare-local-arm64.sh` + `deploy/docker-compose.local-arm64.yml`: dedicated native local
  images and overlay. These files are currently untracked work from the prior approved session and
  must be integrated, not discarded.
- `deploy/docker-compose.yml`, `deploy/caddy/Caddyfile`, `deploy/sql/*`: production-shaped stack.

Known defects to address before wrapping:

1. `update.sh` expects HTTP 200 from `/`, but Next normally returns a locale redirect (307).
2. Wiping DB while retaining `.env` makes `install.sh` skip the first-admin password path.
3. Install/update replay all migrations with no immutable applied-migration record.
4. Production packaging uses canonical service tags, which can contaminate local image selection.
5. Existing release/setup docs incorrectly say the Mac VPN is required.

## 3. Implementation phases

### Phase A — contracts and shared primitives

- [x] Add `/api/health` route and test its body/cache contract.
- [x] Add client AMD64 Compose overlay with dedicated service image tags.
- [x] Add `deploy/lib/common.sh`: output, platform, hashing, validation, confirmation, Compose-file
      selection, manifest helpers. Keep it Bash 3.2-compatible where sourced on Mac.
- [x] Add `deploy/lib/migrations.sh`: create private ledger, compare/apply/record migrations, emit
      source migration manifest, compare app-only safety.
- [x] Add `deploy/lib/health.sh`: internal stack/App/Auth checks; never depend on root returning 200.
- [x] Harden `install.sh` and `update.sh` to use target overlays, ledger, health helper, explicit
      reset/admin inputs, and stable manifests.
- [x] Change `package.sh` to save dedicated AMD64 tags plus the overlay and new worker/helpers.

Verification:

```bash
bash -n deploy/*.sh deploy/lib/*.sh
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local-arm64.yml config
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.client-amd64.yml config
npm run test:unit -- tests/unit/health-route.test.ts
```

### Phase B — local controller

- [x] Implement `deploy/bj-deploy` parsing for interactive mode and non-interactive subcommands.
- [x] Implement `doctor local`, `status local`, `logs local`, `restart local`, `app local`,
      `update local`, `reset-db local`, and `factory-reset local`.
- [x] Always print target, data effect, Compose files, architecture, URL, and source state.
- [x] Local access question selects localhost or detected LAN IPv4 and rewrites only validated
      APP_HOST/APP_PORT/APP_ORIGIN values; app is force-recreated when origin changes.
- [x] Local dirty source is allowed only after warning; destructive actions require typed phrase.
- [x] Local reset backs up/validates before removing exact labeled volumes. Database reset preserves
      Caddy volumes; factory reset removes them.

### Phase C — production controller and resumable worker

- [x] Add `deploy/remote-job.sh` with prepare/start/status/logs and idempotent run IDs.
- [x] Use protected job input for hidden admin password on resets; delete it after use.
- [x] Add client doctor: direct SSH, `uname -m`, Docker/Compose/sudo/rsync/flock/curl/disk checks,
      remote directory, existing stack and server-side health.
- [x] Production update: clean `main` gate, tests, AMD64 build verification, artifact+manifest hashes,
      resumable transfer, detached start, reconnecting monitor, verified backup fetch.
- [x] Production full install/reset: build full offline AMD64 bundle, verify transfer, remote backup,
      fetch+verify backup, typed confirmation, exact project/volume validation, detached install,
      server-side verification, CA fetch.
- [x] `resume <run-id>`, `status client [run-id]`, and `logs client [run-id]` work without rebuilding or
      retransferring completed artifacts.
- [x] Print the production URL only after automated server-side checks pass; remind user that phone
      browser testing requires client VPN until DNS/subdomain is ready.

### Phase D — tests and documentation

- [x] Add a shell fixture harness for validation, hashes/manifests, migration ledger behavior, remote
      run idempotence, and health contract. Docker/SSH end-to-end stays for an authorized live trial.
- [x] Cover invalid identifiers, ARM/AMD mismatch, changed migration history, atomic env edits,
      app-only migration refusal, target label mismatch, backup verification failure, typed reset
      phrase, dropped-monitor/resume behavior, and idempotent job start.
- [x] Run ShellCheck if installed (not installed here); run `bash -n`, both Compose renders, tests, lint,
      TypeScript, unit tests, and production build in proportion to changed app code.
- [x] Write `docs/DEPLOY-ASSISTANT.md`: first setup, menu, command reference, each action's data effect,
      local phone access, production flow, resume, logs, backup/restore, certificates, troubleshooting.
- [x] Update `deploy/RUNBOOK.md`, `docs/DEPLOY-GUIDE.md`, `docs/DEPLOY.md`, `docs/MEMORY.md`,
      `docs/TASKS.md`, `docs/CHANGELOG.md`, and append `docs/AGENT-LOG.md`.

## 4. Remote state-machine details

Remote directories (all below the fixed installer directory):

```text
.bj-deploy/
  lock
  installed-manifest.env
  installed-migrations.sha256
  runs/<run-id>/
    artifact.sha256
    manifest.env
    input.env              # root 600, reset only, deleted after consumption
    job.log
    pid
    status                 # PREPARED | RUNNING | SUCCEEDED | FAILED:<code>
    backup.path
    backup.sha256
```

Status writes use a temporary sibling followed by `mv`, so readers never see partial content.
`start` takes the global mutation lock inside the detached process and refuses duplicate execution.
The Mac stores the run ID before upload and prints the exact resume command before remote start.

## 5. Reset sequence

The order is safety-critical:

1. Resolve/print target and exact volumes.
2. Confirm stack and DB healthy enough to dump.
3. Create and validate server backup.
4. Copy backup + checksum to Mac; validate checksum locally.
5. Collect hidden new admin password and prepare new secrets.
6. Require run-specific typed destructive phrase.
7. Stop project containers.
8. Remove only labeled `bj-erp_db-data` (`reset-db`), or DB + two Caddy volumes
   (`factory-reset`).
9. Write new secrets while preserving APP_HOST/APP_PORT for database reset.
10. Start DB/Auth, apply migrations through ledger, seed, create admin, start stack.
11. Verify DB/App/Auth/image architecture and save installed manifest.
12. Fetch CA (always for factory reset; harmlessly refresh for database reset) and final evidence.

Do not invert steps 4 and 7. An on-server backup alone is insufficient before wiping the server.

## 6. Minimum recovery instructions for an interrupted implementation

If this work is left incomplete:

1. Run `git status --short`; do not discard unrelated uncommitted feature files.
2. Read the latest `docs/AGENT-LOG.md` entry for exactly which deployment files were touched and
   which commands ran outside the repo.
3. Run `bash -n` on every changed shell file before executing any of them.
4. Use fixture tests/dry-run only. Do not point commands at `5.201.190.184` without fresh user
   authorization.
5. Never test destructive behavior against the existing local Docker project unless the user
   explicitly authorizes wiping it; use a unique fixture project and temporary directories.
6. The first usable milestone is read-only doctor/status plus local app rebuild. Do not expose reset
   menu items until backup, exact-volume validation, typed confirmation, and tests all pass.

## 7. Definition of done

The implementation is complete only when every checked operation matches the design, all acceptance
tests pass, docs can guide a first-time operator without this chat, no secret is logged, no live
client action occurred during development, and the final `AGENT-LOG` entry records any limitation or
unverified production behavior plainly.
