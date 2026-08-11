# Local redeploy without deleting database data

Use this runbook when the local Docker app has already been installed and you need to test new
frontend, backend, or database-migration changes against the existing local data.

The safe sequence is:

1. Select the Apple-Silicon Compose overlay and confirm every image is ARM64.
2. Record row counts and make a verified database backup.
3. Preserve the current app image, then build the new one.
4. Apply **only the new migration files**, oldest first.
5. Reload PostgREST's schema cache.
6. Recreate **only** the app container.
7. Verify the app, API, schema, and row counts.

Run every command from the repository root. The local stack uses the production-shaped base file
plus `deploy/docker-compose.local-arm64.yml` and is available at `https://localhost:3500`.

The two deployment targets are deliberately separate:

- **Local Apple-Silicon testing:** `linux/arm64`, dedicated `*-local-arm64` image tags, and the
  local ARM64 Compose overlay.
- **Client Linux server:** `linux/amd64`, built and checked only by `deploy/package.sh` or
  `deploy/release.sh`. Never add the local overlay to either production workflow.

> Never run `docker compose down -v`, `docker volume rm bj-erp_db-data`, or
> `docker system prune --volumes` during this workflow. Those commands can delete the named database
> volume. A normal app rebuild or container recreation does not delete that volume.

## One-time native ARM64 setup

Run this once on an Apple-Silicon Mac, or again if Docker image pruning removed a local tag:

```bash
./deploy/prepare-local-arm64.sh
```

Expected outcome: all four pinned services and `bj-erp-app:local-arm64` print `verified ... arm64`.
The script only pulls/builds images and validates Compose. It does not stop containers, apply
migrations, or touch volumes.

Define a helper for every local Compose command in this runbook:

```bash
bj_compose() {
  docker compose \
    -f deploy/docker-compose.yml \
    -f deploy/docker-compose.local-arm64.yml \
    "$@"
}
```

Expected outcome: no output. This helper guarantees local commands select the ARM64-only tags. Do
not replace it with plain `docker compose`; production packaging may have loaded AMD64 images under
the canonical tags on this Mac.

## 1. Choose the migration files for this redeploy

Identify the SQL files added since the version currently running locally. If the last deployed Git
commit is known, replace `<last-deployed-commit>` below with its commit SHA or tag.

```bash
git diff --name-only <last-deployed-commit> HEAD -- supabase/migrations
```

Expected outcome: one line for each new migration, in `supabase/migrations/`. If there is no database
change, the command prints nothing and you may skip steps 6 and 7. Do not select a modified historical
migration: a deployed migration must be followed by a new migration file instead.

Set the variable to the migration that has not yet been applied. For example:

```bash
export BJ_MIGRATION_FILE=supabase/migrations/<new-migration-file>.sql
```

Expected outcome: no terminal output. The current shell now remembers the migration path. For a
different change, replace the placeholder with that change's new migration filename.

## 2. Confirm the existing stack before changing it

```bash
bj_compose ps
```

Expected outcome: `db`, `auth`, `rest`, `app`, and `gateway` are `Up`; `db` is also `healthy`. Stop
here and diagnose the stack if the database is missing, restarting, or unhealthy.

Verify every running image is native ARM64:

```bash
bj_compose images
```

Expected outcome: all five rows show `linux/arm64` (Caddy/PostgREST may show `linux/arm64/v8`). If
any row says `linux/amd64`, run the one-time native ARM64 setup above, complete the count and backup
steps, and then use the one-time conversion immediately below step 4.

Confirm that the chosen migration file exists:

```bash
test -f "$BJ_MIGRATION_FILE" && echo "Migration file found: $BJ_MIGRATION_FILE"
```

Expected outcome: `Migration file found:` followed by the selected path. No output means the path is
wrong; correct it before continuing.

## 3. Record the pre-redeploy data counts

This read-only query counts every table that currently holds business data. Save or copy its output
so it can be compared with step 10.

```bash
bj_compose exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres -c "
    select
      (select count(*) from public.profiles)       as profiles,
      (select count(*) from public.user_roles)     as user_roles,
      (select count(*) from public.leave_requests) as leave_requests,
      (select count(*) from public.leave_ledger)   as leave_ledger,
      (select count(*) from public.holidays)       as holidays,
      (select count(*) from public.departments)    as departments,
      (select count(*) from public.leave_types)    as leave_types,
      (select count(*) from public.companies)      as companies;
  "'
```

Expected outcome: one row containing eight non-negative counts and no `ERROR`. The exact numbers
depend on the local test data.

## 4. Create and validate a database backup

Create a private directory for backups and choose a timestamped filename:

```bash
mkdir -p deploy/backups
chmod 700 deploy/backups
export BJ_BACKUP_FILE="deploy/backups/pre-local-redeploy-$(date +%Y%m%d-%H%M%S).dump"
```

Expected outcome: no terminal output. `deploy/backups/` exists and the shell variable points to a new
backup filename. The repository ignores backup directories because these archives contain employee
data and password hashes.

Create a compressed PostgreSQL custom-format backup:

```bash
bj_compose exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U supabase_admin -d postgres -Fc' \
  > "$BJ_BACKUP_FILE"
```

Expected outcome: no terminal output and a non-empty `.dump` file. The database container continues
running while `pg_dump` creates a consistent backup.

Confirm the file is not empty:

```bash
test -s "$BJ_BACKUP_FILE" && echo "Backup is non-empty: $BJ_BACKUP_FILE"
```

Expected outcome: `Backup is non-empty:` followed by the backup path. No output means the backup
failed; do not continue.

Prove PostgreSQL can read the archive catalog:

```bash
bj_compose exec -T db pg_restore -l \
  < "$BJ_BACKUP_FILE" > /dev/null && echo "Backup archive is valid"
```

Expected outcome: `Backup archive is valid`. An error means the archive is not a usable recovery
point; do not continue.

Restrict access to the backup:

```bash
chmod 600 "$BJ_BACKUP_FILE"
```

Expected outcome: no terminal output. Only the current operating-system user can read or write it.

### One-time conversion from an older emulated local stack

Skip this subsection during normal redeploys. Use it only when step 2 found a running AMD64 image
and the verified backup above has completed.

Record the existing database-volume identity:

```bash
docker volume inspect bj-erp_db-data \
  --format 'volume={{.Name}} created={{.CreatedAt}} mountpoint={{.Mountpoint}}'
```

Expected outcome: exactly one named volume, `bj-erp_db-data`. Save the creation timestamp.

Recreate the containers from the already-verified local tags without pulling anything else:

```bash
bj_compose up -d --force-recreate --pull never
```

Expected outcome: all five containers are recreated and become `Up`; the database becomes
`healthy`. This command does **not** contain `down`, `-v`, or a volume-removal operation.

Prove both the architecture and volume after recreation:

```bash
bj_compose images
docker volume inspect bj-erp_db-data \
  --format 'volume={{.Name}} created={{.CreatedAt}} mountpoint={{.Mountpoint}}'
```

Expected outcome: every image is `linux/arm64`, and the volume name, creation timestamp, and
mountpoint exactly match the values recorded before recreation. Run the step 3 count query again;
all business counts must also match before continuing.

## 5. Preserve the old app image and build the new app

Keep a rollback tag for the app image that is running now:

```bash
docker image inspect bj-erp-app:local-arm64 > /dev/null && \
  docker tag bj-erp-app:local-arm64 bj-erp-app:local-arm64-rollback
```

Expected outcome: no terminal output. `bj-erp-app:local-arm64-rollback` now identifies the previous
local image. The production `bj-erp-app:latest` tag is intentionally not used.

Build the current source into the local image tag:

```bash
docker build --platform linux/arm64 \
  -f deploy/Dockerfile \
  -t bj-erp-app:local-arm64 .
```

Expected outcome: the Docker build completes successfully and ends with an image tagged
`bj-erp-app:local-arm64`. Confirm it before applying a migration:

```bash
docker image inspect bj-erp-app:local-arm64 --format '{{.Architecture}}'
```

Expected outcome: exactly `arm64`. A build or verification failure makes the command exit non-zero;
fix it before applying any migration.

At this point the running app container still uses its old image. Building a tag does not restart a
container.

## 6. Apply only the new database migration

Feed the selected SQL file to `psql` over standard input. This avoids relying on the
`deploy/migrations/` bind mount, which may contain an older copy from the original installation.

```bash
bj_compose exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -U supabase_admin -d postgres' \
  < "$BJ_MIGRATION_FILE"
```

Expected outcome: PostgreSQL operation tags such as `ALTER TABLE`, `CREATE FUNCTION`, `GRANT`, or
`NOTIFY`, followed by a successful exit. Warnings explicitly handled by the migration may appear,
but there must be no `ERROR`. `ON_ERROR_STOP=1` prevents later statements from hiding an earlier
failure.

If the change has multiple new migration files, set `BJ_MIGRATION_FILE` to each file and repeat this
command **one file at a time, oldest timestamp first**. Stop immediately if any file fails.

Do not run every file in `supabase/migrations/` against this populated database. This project has
historical migrations that are safe for a fresh install but are not all safe to replay. The local
incremental workflow intentionally applies only files that have not previously been deployed.

## 7. Reload the PostgREST schema cache

PostgREST must discover new columns and RPC argument lists before the app can call them:

```bash
bj_compose exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -U supabase_admin -d postgres -c "notify pgrst, '\''reload schema'\'';"'
```

Expected outcome: `NOTIFY`. A migration may already send the notification; sending it again is safe.

Confirm the API rebuilt its cache:

```bash
bj_compose logs --since=2m --no-color rest
```

Expected outcome: recent PostgREST lines containing `Received a schema cache reload message` and
`Schema cache loaded`, with no schema-cache error.

## 8. Recreate only the app container

```bash
bj_compose up -d --no-deps --force-recreate --pull never app
```

Expected outcome: only the `app` service is recreated and started. The `db`, `auth`, `rest`, and
`gateway` containers and the `db-data` volume are not recreated.

Check that all services are still up:

```bash
bj_compose ps
```

Expected outcome: all five services are `Up`, the database is `healthy`, and the app has a recent
creation time while the database retains its earlier creation time.

## 9. Check the app and backend

Check the public login page:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:3500/en/login
```

Expected outcome: HTTP `200`.

Check Supabase Auth through the gateway:

```bash
curl -sk https://localhost:3500/auth/v1/health
```

Expected outcome: a small JSON response identifying a healthy GoTrue service.

Review recent application and API logs:

```bash
bj_compose logs --since=5m --no-color app rest
```

Expected outcome: normal startup/request messages and no current `ERROR`, missing-column message, or
`Could not find the function ... in the schema cache` message.

For the requester/approver-signature migrations specifically, verify all four evidence columns:

```bash
bj_compose exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres -c "
    select column_name, data_type, is_nullable
      from information_schema.columns
     where table_schema = '\''public'\''
       and table_name = '\''leave_requests'\''
       and column_name in (
         '\''signature_data'\'',
         '\''signature_consent_at'\'',
         '\''approver_signature_data'\'',
         '\''approver_signature_consent_at'\''
       )
     order by column_name;
  "'
```

Expected outcome: four nullable rows: requester/approver `*_data` (`text`) and requester/approver
`*_consent_at` (`timestamp with time zone`). Existing historical requests and approvals remain valid
because these evidence columns are nullable.

For other migrations, replace this last query with a read-only query that checks the columns,
constraints, or functions that migration was meant to create.

## 10. Prove the existing data is still present

Run the same query from step 3 again:

```bash
bj_compose exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres -c "
    select
      (select count(*) from public.profiles)       as profiles,
      (select count(*) from public.user_roles)     as user_roles,
      (select count(*) from public.leave_requests) as leave_requests,
      (select count(*) from public.leave_ledger)   as leave_ledger,
      (select count(*) from public.holidays)       as holidays,
      (select count(*) from public.departments)    as departments,
      (select count(*) from public.leave_types)    as leave_types,
      (select count(*) from public.companies)      as companies;
  "'
```

Expected outcome: the counts match the values saved in step 3. A migration that intentionally adds
rows may increase a documented count, but none should unexpectedly decrease.

## 11. Complete the browser smoke test

Open `https://localhost:3500`, sign in with a local test account, and exercise the changed feature.
For a request/backend change, verify both the successful path and one validation failure. Then check
the `app`, `rest`, and `db` logs again for unexpected errors.

Expected outcome: the changed workflow completes, its saved result appears in the UI, and the logs
contain no database-schema or RPC-cache error.

## Frontend-only shortcut

When a change has no migration and no backend contract change, still perform the stack check and keep
the rollback image, then run only the build, app recreation, health checks, and browser smoke test.
The database container and volume remain untouched.

## If something fails

- If the backup or image build fails, stop. Nothing has been cut over yet.
- If a migration fails, do not recreate the app. Keep the old app running, preserve the error output
  and backup, and fix the migration with a new forward migration when appropriate.
- If the new app is unhealthy but the migration is backward-compatible, restore the old app image:

  ```bash
  docker tag bj-erp-app:local-arm64-rollback bj-erp-app:local-arm64
  bj_compose up -d --no-deps --force-recreate --pull never app
  ```

  Expected outcome: only the app container is recreated from the saved rollback image. Database
  migrations are forward-only and are not undone by this command.
- A full `pg_restore --clean` changes or removes database objects and can overwrite data created
  after the backup. Do not use it as a routine redeploy step. If an actual restore becomes necessary,
  stop writes, preserve the current failed-state database, and follow the recovery procedure in
  [`deploy/RUNBOOK.md`](../deploy/RUNBOOK.md).
