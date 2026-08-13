# BJ ERP deployment assistant

This is the operator guide for deploying and testing BJ ERP without copying a long sequence of
terminal commands. The assistant asks what you want to do, explains what data it will affect, and
performs the build, backup, transfer, server command, and verification in the right order.

Run it from the repository on Amir's Mac:

```bash
./deploy/bj-deploy
```

## Actions and data effects

| Action | Plain-English meaning | Database effect |
|---|---|---|
| Doctor | Check the computer, architecture, connection, and stack | none |
| Status | Show what is running | none |
| Logs | Show recent service messages | none |
| Restart | Restart existing containers without rebuilding | none |
| App only | Build and replace only the web app | none; refused if SQL changed |
| Safe update | Back up, apply only new SQL, deploy, and verify | preserved and migrated |
| Fresh database | Back up, erase test data, make new secrets/admin, reinstall | erased; HTTPS CA kept |
| Factory reset | Same, and create a new HTTPS certificate authority | erased; HTTPS CA replaced |

If unsure between App only and Safe update, choose Safe update.

## One-time Mac setup

Requirements: Docker Desktop, Git, OpenSSH, rsync, openssl, shasum, Node/npm, and enough disk space
for an offline AMD64 bundle. Production source must be a clean, committed `main` branch.

Production uses several SSH connections so transfer and monitoring can reconnect. Install the
dedicated SSH key once:

```bash
./deploy/setup-release.sh
```

It connects to `behsazan@5.201.190.184` on port `2222`. Enter the server login password once to
install the key. The password is not stored.

The Mac does **not** need the client's VPN. It reaches public SSH directly. The phone needs the VPN
to open `https://10.10.10.50:3500` until IT creates the production subdomain.

Verify both targets:

```bash
./deploy/bj-deploy doctor local
./deploy/bj-deploy doctor client
```

Client doctor may ask for the server sudo password; its checks are read-only.

## Interactive and direct use

Start the menu with `./deploy/bj-deploy`, choose Local Mac or Client server, then choose the action.
Direct equivalents are:

```bash
./deploy/bj-deploy doctor local
./deploy/bj-deploy status local
./deploy/bj-deploy logs local
./deploy/bj-deploy restart local
./deploy/bj-deploy app local
./deploy/bj-deploy update local
./deploy/bj-deploy reset-db local
./deploy/bj-deploy factory-reset local

./deploy/bj-deploy doctor client
./deploy/bj-deploy status client
./deploy/bj-deploy logs client
./deploy/bj-deploy restart client
./deploy/bj-deploy app client
./deploy/bj-deploy update client
./deploy/bj-deploy reset-db client
./deploy/bj-deploy factory-reset client
```

Preview without a build, transfer, secret prompt, or Docker/database mutation:

```bash
./deploy/bj-deploy --dry-run reset-db client
```

Production app/update/reset commands require clean committed `main`, so the server always maps to a
real commit. Local builds may include uncommitted work after a warning.

## Destructive confirmation

A reset prints a unique phrase, for example:

```text
WIPE CLIENT DATABASE 20260806T153012Z-a1b2c3
```

Nothing is erased unless the full phrase is typed exactly. `Ctrl-C` before that leaves the database
unchanged. The new `admin` password is read with hidden input; it is not placed in command arguments
or logs.

## Local Mac

On a fresh/reset install, choose one access mode:

- **This Mac only:** `https://localhost:3500`
- **This Mac and phone:** `https://<Mac-LAN-IP>:3500`, such as
  `https://192.168.2.48:3500`

For phone testing, both devices must be on the same Wi-Fi, macOS must allow incoming Docker
connections, the phone must trust `deploy/bj-root-ca.crt`, and the phone VPN should be off so it does
not route local Wi-Fi traffic away.

Every local command uses both `deploy/docker-compose.yml` and
`deploy/docker-compose.local-arm64.yml`. It verifies the Docker daemon and all five images are ARM64.
Production artifacts use different tags and cannot silently replace these local images.

Existing local installs predate the migration manifest. Run **Safe update** once: it creates a
verified backup, adopts the known schema baseline, records checksums, applies missing migrations,
and writes the manifest. App only is available afterward when SQL has not changed.

## Client safe update

The assistant:

1. checks clean `main`, SSH, and at least 5 GiB free on the server;
2. runs lint/unit tests;
3. builds and verifies an AMD64 app image on the Mac;
4. checksums and transfers artifacts with partial-file retention;
5. starts a detached job on the server;
6. creates and validates a PostgreSQL custom-format backup;
7. verifies the run-scoped migration manifest, then applies only pending immutable migrations;
8. recreates only the app container;
9. checks the database, `/api/health`, Auth, and image architecture from the server;
10. downloads and checksum-verifies the backup on the Mac.

A Safe Update cannot report success without non-empty backup path/checksum metadata. Any worker
command failure becomes `FAILED:<exit-code>` and installed-state manifests are written only after
the complete action succeeds.

If an update reaches the server with a verified app archive but then ends `FAILED:<code>`, fix and
commit the controller issue first. When the artifact, migration manifest, and seed are still exactly
the failed run's inputs, this starts a **new** guarded update without rebuilding or uploading the
large archive again:

```bash
./deploy/bj-deploy retry-uploaded FAILED_RUN_ID
```

The command requires clean `main`, the local and server SHA-256 to agree, the old remote run to be
terminal `FAILED`, and at least 5 GiB free. It stages current controller scripts and a new immutable
run directory, takes another verified backup, then runs the normal migration, cutover, architecture,
health, row-count, and backup-download checks. It refuses changed SQL/seed or a missing artifact;
use a normal Safe Update then.

The app stays at `https://10.10.10.50:3500`. Use the phone VPN for the final browser test.

App only skips the DB backup/migrations. It runs only when source migration filenames/checksums
exactly match the server manifest. No manifest or any difference means Safe update is required.

## Client fresh database and factory reset

The assistant builds a complete offline AMD64 installer; the server does not need GitHub or Docker
Hub. Before removing a volume it creates a backup, proves `pg_restore` can read it, downloads it to
the Mac, verifies SHA-256 there, and asks for the unique phrase.

Fresh database removes only `bj-erp_db-data`. Factory reset also removes `bj-erp_caddy-data` and
`bj-erp_caddy-config`. Every existing volume must carry the exact Compose project label `bj-erp` or
deletion is refused.

Fresh database keeps the Caddy CA, so trusted phones normally continue to trust HTTPS. Factory reset
creates a new CA; install/trust the newly downloaded certificate on every phone.

## Dropped SSH or closed terminal

Every production operation prints a run ID early. The server job runs detached, so losing SSH/Wi-Fi
or closing Terminal does not kill it. Reconnect with:

```bash
./deploy/bj-deploy resume 20260806T153012Z-a1b2c3
```

Inspect a run without changing it:

```bash
./deploy/bj-deploy status client 20260806T153012Z-a1b2c3
./deploy/bj-deploy logs client 20260806T153012Z-a1b2c3
```

If a reset stopped at `BACKUP_READY`, resume downloads/verifies the backup, asks for the reset phrase
and admin password, then continues the same run. The same run ID cannot execute twice. A global
server lock rejects overlapping mutating jobs.

## Backups and private state

Mac backup copies:

```text
backups/deploy-assistant/local/<run-id>/
backups/deploy-assistant/client/<run-id>/
```

Mac run metadata is under ignored `.bj-deploy/`; server state is under
`/home/behsazan/bj-erp-installer/.bj-deploy/`.

Backups contain employee records and password hashes. Files are mode `600`, directories mode `700`,
and both roots are Git-ignored. Move them only to approved encrypted storage.

## Migration contract

Private table `bj_deploy.schema_migrations` records every filename and SHA-256. A recorded filename
whose contents changed stops deployment. A new migration and its ledger record commit in one
PostgreSQL transaction, so a dropped process cannot leave applied SQL unrecorded. Each detached run
uses its own checksummed migration directory and seed file; later staging cannot change its inputs.
The run directory exists on the server host, while `psql` runs inside the database container, so the
runner feeds each verified file and its ledger insert through one `psql -f -` standard-input stream;
it never passes the host path into the container or puts psql-variable placeholders in a separate
`-c` command. Never edit a shipped migration; add another one.

The original client bundle installed migrations 1–38 through
`20260731120001_post_review_fixes.sql` with no ledger. The assistant verifies that known final schema
sentinel, records the baseline once, and adopts each of the three known August migrations only when
a complete catalog fingerprint proves its columns, constraints, function signatures/bodies,
security settings, grants, and obsolete-overload removal. An unknown older/partial schema is refused
instead of guessed.

Ordinary operations never auto-upgrade the pinned Postgres 15, GoTrue, PostgREST, or Caddy versions.

## Health behavior

The root URL normally redirects to a locale and can return HTTP 307; that is not a failure. Health
uses `/api/health` (HTTP 200 and `status: ok`) plus independent Auth/database checks. Client checks
run on the server because the Mac cannot reach private address `10.10.10.50`.

## Defaults and overrides

Defaults:

```text
BJ_SERVER_HOST=5.201.190.184
BJ_SERVER_PORT=2222
BJ_SERVER_USER=behsazan
BJ_REMOTE_DIR=/home/behsazan/bj-erp-installer
```

An authorized alternate can be passed for one command, for example:

```bash
BJ_SERVER_HOST=203.0.113.20 ./deploy/bj-deploy doctor client
```

`BJ_SKIP_TESTS=1` skips production lint/unit gates only for an explicitly reviewed emergency. It
never bypasses architecture, checksum, backup, migration, confirmation, or health checks.

## Troubleshooting

**“Passwordless SSH is required.”** Run `./deploy/setup-release.sh` once.

**App only says migrations changed.** Choose Safe update; the refusal protects the database/app
contract.

**A run stays `RUNNING` after disconnect.** Use `resume <run-id>`, not a new deployment.

**A run is `FAILED:<number>`.** Use `./deploy/bj-deploy logs client <run-id>`. The final phase says
whether artifact, backup, migration, app health, or architecture failed. An unhealthy new image is
rolled back; forward SQL is not automatically reversed.

Do not resume a terminal `FAILED:<number>` run. Correct the cause and start a new Safe Update, or use
`retry-uploaded <failed-run-id>` when its unchanged checksum-verified artifact is still present.
Both paths create a new immutable run ID. A disk-space failure occurs before backup, migrations,
image loading, or app cutover.

**Restore is needed.** Restore is intentionally not a menu item because it discards later writes.
Identify the exact backup/run, have another administrator review it, then follow the recovery section
of `deploy/RUNBOOK.md`. Never improvise `down --volumes` for a logical restore.

Verify the assistant code:

```bash
npm run test:deploy
bash -n deploy/bj-deploy deploy/remote-job.sh deploy/install.sh deploy/update.sh deploy/package.sh deploy/lib/*.sh
docker compose --project-name bj-erp --project-directory deploy \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local-arm64.yml config --quiet
docker compose --project-name bj-erp --project-directory deploy \
  -f deploy/docker-compose.yml -f deploy/docker-compose.client-amd64.yml config --quiet
```

Cold-start design and implementation handoff:

- `docs/specs/2026-08-06-interactive-deployment-assistant-design.md`
- `docs/plans/2026-08-06-interactive-deployment-assistant.md`
