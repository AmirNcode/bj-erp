# Mac-Side Release Pipeline — Implementation Plan (v2, hardened)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. **Tasks 1 and 5 run against the CLIENT'S LIVE SERVER holding real employee
> data. Do not batch-execute. Stop at every review gate.**

**Goal:** After a one-time setup, every release is **exactly one command on Amir's Mac** —
`./deploy/release.sh` — plus typing the server's sudo password once. Everything else (tests,
amd64 build + verification, shipping, backup, migrations, cutover, health check, data-integrity
check, rollback, off-machine backup copy) happens automatically.

**Architecture:** Two scripts, both version-controlled. `deploy/release.sh` runs on the Mac
(gates → cross-build → verify → ship → trigger). `deploy/update.sh` is re-shipped with every
release and runs on the server (lock → preflight → verified backup → row snapshot → load →
migrate → cutover → health check → row verification → rollback on failure). The server needs no
internet, no git, no build toolchain — the same offline-first property as the original installer,
which is what makes this robust on an Iranian network.

**Tech Stack:** Bash, Docker (cross-build to `linux/amd64`), SSH key auth + connection
multiplexing, `rsync --partial` (resumable), Docker Compose v2, Postgres 15 (`pg_dump -Fc`).

## Why not build on the server

Rejected — see [`2026-07-25-deploy-automation.md`](2026-07-25-deploy-automation.md) (superseded):
a server-side build needs `github.com`, `registry.npmjs.org`, **and** `registry-1.docker.io`
reachable at deploy time; Docker Hub is commonly blocked from Iran, and a blocked registry
mid-deploy strands a live HR system. On the Mac-side pipeline, every network dependency sits on
the developer's side, where a failure costs nothing. Trade-off: ~300 MB gzipped upload per
release, mitigated by resumable `rsync`.

## The database safety contract

The primary requirement, enforced by four independent mechanisms:

1. **Nothing in the pipeline can reach the volume.** The only Docker commands used against the
   stack are `docker load` and `docker compose up -d app` (recreates ONE container; the `db`
   container is never stopped). The destructive verbs — `down -v`, `volume rm`, bare `down` —
   appear nowhere in either script, and Task 3 Step 2 greps the finished source to prove it.
2. **All SQL is fed via stdin**, not bind mounts. `docker-compose.yml` mounts `./sql/seed.sql`
   as a *single-file* bind mount; replacing that file gives it a new inode and the mount keeps
   serving the OLD content — a silent staleness trap. `update.sh` therefore pipes every
   migration and the seed into `psql` over stdin and never depends on the mounts. (For
   `install.sh` re-runs, which DO use the mount, `release.sh` ships `seed.sql` with
   `rsync --inplace` to preserve the inode.)
3. **A verified backup precedes every run.** `pg_dump -Fc`, proven restorable with
   `pg_restore -l`. Empty or invalid → the deploy aborts before anything changes. A copy of the
   dump is pulled back to the Mac after every release, so a dead VM no longer takes the backups
   with it.
4. **Row counts are asserted, not assumed.** `update.sh` snapshots the count of every data table
   before and after and **fails loudly, with the restore command printed, if any count
   decreased**. Config tables may grow (seed adds a missing leave type); nothing may shrink.

Also by design: `.env` secrets are never regenerated (only the `APP_VERSION` line is rewritten —
regenerating `JWT_SECRET` would log every user out), and `bootstrap_admin.sql` never re-runs (the
admin password is never reset). Migrations are **forward-only**: an image rollback does not undo
them; the pre-deploy dump is the true rollback for schema.

## Global Constraints

- **Never** `docker compose down -v`, `docker volume rm`, or bare `docker compose down`.
- **Migrations must stay idempotent** — `update.sh` replays all of them every run, like
  `install.sh`. A migration that cannot safely re-run breaks deploys.
- **amd64 only.** The Mac is arm64; every build sets `DOCKER_DEFAULT_PLATFORM=linux/amd64` and
  the image's architecture is verified before shipping.
- **Versions match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`** (valid Docker tag; safe in `sed` and
  filenames). `release.sh` enforces this.
- **Deploy in a quiet window.** The row-count check compares before/after; an admin deleting an
  employee mid-deploy would read as data loss. Off-hours deploys avoid the false positive (and
  the ~30–60 s downtime is invisible).
- **Never run `npm run cleanup:e2e` against this server** — `app_cleanup_e2e_users()` deletes
  accounts matching test patterns (incl. personnel numbers starting `999`).
- **Commits:** Amir approves every commit explicitly.

## Server Facts (verified 2026-07-25)

| Thing | Value |
|---|---|
| SSH | `behsazan@5.201.190.184`, port `2222`, password auth today (Task 0 adds a key) — reachable only over the company L2TP VPN |
| App URL / `APP_HOST` | `https://10.10.10.50` |
| Installer dir | `/home/behsazan/bj-erp-installer` |
| Compose project | `bj-erp`; DB volume `bj-erp_db-data` |
| DB superuser | `supabase_admin` (NOT `postgres`); needs `PGPASSWORD` even on the local socket |
| `.env` | root-owned, mode 600 → compose commands need `sudo` |
| Repo | `github.com/AmirNcode/bj-erp`, `main` @ `a411dc2`, tree clean |

## File Structure

| Path | Lives on | Responsibility |
|---|---|---|
| `~/.ssh/config` (`Host bj` block) | Mac | Key auth + multiplexing → zero SSH password prompts |
| `deploy/release.sh` | Mac (repo) | Gates → build → verify arch → ship → trigger → fetch backup copy |
| `deploy/update.sh` | server (re-shipped each release) | Lock → preflight → backup → snapshot → load → migrate → cutover → verify → rollback |
| `backups/` (gitignored) | Mac | Off-machine copies of every pre-deploy dump |
| `<installer>/backups/` | server | Pre-deploy dumps, newest 14 kept |
| `<installer>/update.log` | server | Append-only deploy audit trail |

---

## Task 0: One-time Mac setup — SSH key, alias, multiplexing

**Files:**
- Create: `~/.ssh/bj_deploy`, `~/.ssh/bj_deploy.pub`; append to `~/.ssh/config`

**Interfaces:**
- Produces: `ssh bj` / `rsync … bj:…` working without passwords. Everything in `release.sh`
  addresses the server as `bj`. Without this, every rsync/ssh would prompt for the password
  (~5 prompts per release) and the `BatchMode` preflight would always fail.

- [ ] **Step 1: Generate a dedicated key**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/bj_deploy -N '' -C 'bj-erp release pipeline (Amir MacBook)'
```

- [ ] **Step 2: Install it on the server (prompts for the password one last time)**

```bash
ssh-copy-id -i ~/.ssh/bj_deploy.pub -p 2222 behsazan@5.201.190.184
```

- [ ] **Step 3: Add the host alias with connection multiplexing**

```bash
cat >> ~/.ssh/config <<'EOF'

Host bj
  HostName 5.201.190.184
  Port 2222
  User behsazan
  IdentityFile ~/.ssh/bj_deploy
  IdentitiesOnly yes
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h-%p
  ControlPersist 10m
EOF
chmod 600 ~/.ssh/config
```

Multiplexing means the several rsync/ssh calls in a release reuse ONE authenticated connection.

- [ ] **Step 4: Verify (VPN connected)**

```bash
ssh -o BatchMode=yes bj 'echo KEY AUTH OK && hostname'
```

Expected: `KEY AUTH OK` and `behsazan-virtual-machine`, with no password prompt.

---

## Task 1: Prove the backup command actually works

**Files:** none (verification); the finding is embedded in Task 2 and documented in Task 6

**Interfaces:**
- Produces: the exact, *verified* `pg_dump` invocation for `update.sh`. The whole safety contract
  rests on backups being real, so this is settled before anything is automated.

**Why:** `deploy/RUNBOOK.md` documents `pg_dump -U postgres`, but `install.sh` shows the image's
superuser is `supabase_admin` with password auth required even on the local socket. An unverified
backup command is worse than none — it fails silently and leaves a 0-byte file.

- [ ] **Step 1: Try the RUNBOOK's documented form**

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose exec -T db pg_dump -U postgres -d postgres -Fc > /tmp/t1.dump; echo exit=\$?; ls -lh /tmp/t1.dump"
```

- [ ] **Step 2: Try the `supabase_admin` form**

```bash
ssh -t bj "cd bj-erp-installer && sudo bash -c 'set -a; . ./.env; set +a; docker compose exec -T -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" db pg_dump -U supabase_admin -d postgres -Fc' > /tmp/t2.dump; echo exit=\$?; ls -lh /tmp/t2.dump"
```

- [ ] **Step 3: Prove the winning dump is a restorable archive, not just non-empty**

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose exec -T db pg_restore -l < /tmp/t2.dump | grep -E 'TABLE DATA (public )?(profiles|leave_requests)' | head"
```

Expected: lines naming `profiles` and `leave_requests`. If Step 1's dump also passes, prefer that
form (fewer moving parts); otherwise `supabase_admin` is what Task 2 embeds.

- [ ] **Step 4: Clean up**

```bash
ssh bj "rm -f /tmp/t1.dump /tmp/t2.dump"
```

> **REVIEW GATE — do not write `update.sh` until the backup form is known-good.**

---

## Task 2: `deploy/update.sh` — lock, preflight, backup, snapshot, load

**Files:**
- Create: `deploy/update.sh`

**Interfaces:**
- Consumes: `$1` = version; `./.env` (`APP_HOST`, `POSTGRES_PASSWORD`, `APP_VERSION`);
  `./bj-erp-app-<version>.tar.gz`; `./migrations/*.sql`; `./sql/seed.sql` — all placed by
  `release.sh`.
- Produces: shell state for Task 3 — `VERSION`, `PREVIOUS_VERSION`, `BACKUP_FILE`, `ROWS_BEFORE`,
  functions `say`/`warn`/`fail`/`pgexec`/`snapshot`. Exits non-zero without touching the running
  app if any precondition fails.

- [ ] **Step 1: Write the first half**

```bash
cat > deploy/update.sh <<'EOF'
#!/usr/bin/env bash
# =============================================================================
# deploy/update.sh — apply a shipped release to this server. Runs ON THE SERVER;
# shipped and invoked by deploy/release.sh from the developer's machine.
#
#   sudo ./update.sh <version>
#
# DATABASE SAFETY: only `docker load` and `docker compose up -d app` are ever
# used. The db container is never stopped; `docker compose down` and the volume
# are never touched. A verified backup is taken first, all SQL is fed via stdin
# (bind-mount staleness safe), and row counts are asserted afterwards — any
# decrease fails the deploy with the restore command printed.
#
# Migrations are forward-only: an image rollback does NOT undo them. Restore the
# pre-deploy dump for that.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:?usage: sudo ./update.sh <version>}"
IMAGE_TGZ="bj-erp-app-${VERSION}.tar.gz"
BACKUP_DIR=./backups
LOG_FILE=./update.log
HEALTH_RETRIES=45          # x2s = 90s; first boot of a new image runs the
                           # placeholder find+sed over /app and can take ~30s+
KEEP_IMAGES=3
KEEP_BACKUPS=14
DATA_TABLES="profiles user_roles leave_requests leave_ledger holidays departments leave_types companies"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2
         echo "$(date -u +%FT%TZ) FAILED ${VERSION}: $*" >> "$LOG_FILE"; exit 1; }

# ── 0. one update at a time ──────────────────────────────────────────────────
exec 9>/tmp/bj-erp-update.lock
flock -n 9 || fail "another update is already running"

# ── 1. preflight ─────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || fail "run with sudo (needs the root-owned .env and docker)"
[ -f .env ]          || fail ".env not found — is this the installer directory?"
[ -f "$IMAGE_TGZ" ]  || fail "$IMAGE_TGZ not found — did release.sh finish shipping?"

avail_gb=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
[ "${avail_gb:-0}" -ge 5 ] || fail "less than 5 GB free disk — clean up before deploying"

set -a; . ./.env; set +a
PREVIOUS_VERSION="${APP_VERSION:-latest}"

docker compose exec -T db pg_isready -U supabase_admin -h localhost >/dev/null 2>&1 \
  || fail "database container is not running/healthy — fix that before deploying"

say "Updating ${PREVIOUS_VERSION} -> ${VERSION}"

pgexec() {
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}

# Row counts for every table that holds real data; compared before/after.
snapshot() {
  local t n
  for t in $DATA_TABLES; do
    n=$(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
          psql -tAc "select count(*) from public.$t" -U supabase_admin -d postgres 2>/dev/null \
        | tr -d '[:space:]')
    echo "${t}:${n:-ERR}"
  done
}

# ── 2. backup (verified) ─────────────────────────────────────────────────────
say "Backing up the database…"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/pre-${VERSION}-$(date +%F-%H%M%S).dump"
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  pg_dump -U supabase_admin -d postgres -Fc > "$BACKUP_FILE" || fail "pg_dump failed"
[ -s "$BACKUP_FILE" ] || fail "backup is empty — refusing to deploy"
docker compose exec -T db pg_restore -l < "$BACKUP_FILE" >/dev/null 2>&1 \
  || fail "backup is not a valid archive — refusing to deploy"
say "Backup OK: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── 3. row snapshot BEFORE ───────────────────────────────────────────────────
say "Recording row counts…"
ROWS_BEFORE=$(mktemp); snapshot > "$ROWS_BEFORE"
grep -q ':ERR$' "$ROWS_BEFORE" && fail "could not read row counts — is the database healthy?"
sed 's/^/  /' "$ROWS_BEFORE"

# ── 4. load the new image ────────────────────────────────────────────────────
say "Loading the app image…"
gunzip -c "$IMAGE_TGZ" | docker load || fail "docker load failed"
arch=$(docker image inspect "bj-erp-app:${VERSION}" --format '{{.Architecture}}' 2>/dev/null || echo missing)
[ "$arch" = "amd64" ] || fail "image bj-erp-app:${VERSION} is '${arch}', this server needs amd64"
EOF
chmod +x deploy/update.sh
```

**If Task 1 found `-U postgres` is the working form**, change the `pg_dump`, `pg_isready`,
`pgexec`, and `snapshot` user accordingly before continuing.

- [ ] **Step 2: Syntax-check**

```bash
bash -n deploy/update.sh && echo "syntax OK"
```

Expected: `syntax OK`.

---

## Task 3: `deploy/update.sh` — migrations, cutover, verification, rollback

**Files:**
- Modify: `deploy/update.sh` (append)

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces: the app running on `bj-erp-app:${VERSION}`, or the previous version restored. Appends
  one line to `./update.log`. Exit 0 only when the app is healthy **and** no table lost rows.

- [ ] **Step 1: Append the second half**

```bash
cat >> deploy/update.sh <<'EOF'

# ── 5. migrations — idempotent replay, fed via STDIN (never the bind mounts:
#      ./sql/seed.sql is a single-file mount and rsync gives it a new inode,
#      so the mounted path can silently serve stale content) ──────────────────
say "Applying migrations…"
for f in migrations/*.sql; do
  base=$(basename "$f")
  pgexec < "$f" >/dev/null \
    || fail "migration ${base} failed — app NOT restarted, still on ${PREVIOUS_VERSION}. Restore: ${BACKUP_FILE}"
done
pgexec < sql/seed.sql >/dev/null \
  || fail "seed.sql failed — app NOT restarted. Restore: ${BACKUP_FILE}"

# ── 6. cutover — recreates ONLY the app container ────────────────────────────
say "Switching the app container to ${VERSION}…"
sed -i "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" .env
docker compose up -d app || fail "compose up failed"

# ── 7. health check ──────────────────────────────────────────────────────────
say "Health-checking https://${APP_HOST}/ (up to $((HEALTH_RETRIES * 2))s)…"
HEALTHY=0
for _ in $(seq 1 "$HEALTH_RETRIES"); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://${APP_HOST}/" || true)
  auth=$(curl -sk --max-time 5 "https://${APP_HOST}/auth/v1/health" || true)
  if [ "$code" = "200" ] && printf '%s' "$auth" | grep -q GoTrue; then HEALTHY=1; break; fi
  sleep 2
done

if [ "$HEALTHY" != 1 ]; then
  warn "UNHEALTHY — rolling back to ${PREVIOUS_VERSION}"
  sed -i "s/^APP_VERSION=.*/APP_VERSION=${PREVIOUS_VERSION}/" .env
  docker compose up -d app || true
  echo "$(date -u +%FT%TZ) ROLLBACK ${VERSION} -> ${PREVIOUS_VERSION} backup=${BACKUP_FILE}" >> "$LOG_FILE"
  cat <<WARNEOF

!! Rolled the IMAGE back. Any migrations applied above are NOT undone.
!! If the previous image is incompatible with the new schema, restore the dump:
!!   sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres \\
!!        --clean --if-exists < ${BACKUP_FILE}
WARNEOF
  fail "deploy failed; rolled back to ${PREVIOUS_VERSION}"
fi

# ── 8. prove no data was lost ────────────────────────────────────────────────
say "Verifying data integrity…"
ROWS_AFTER=$(mktemp); snapshot > "$ROWS_AFTER"
LOST=0
while IFS=: read -r t before; do
  after=$(grep "^${t}:" "$ROWS_AFTER" | cut -d: -f2)
  if [ "${after:-ERR}" = "ERR" ]; then
    warn "  !! ${t}: unreadable after deploy"; LOST=1
  elif [ "$after" -lt "$before" ]; then
    warn "  !! ${t}: ${before} -> ${after}  ROWS LOST"; LOST=1
  else
    echo "  ok ${t}: ${before} -> ${after}"
  fi
done < "$ROWS_BEFORE"
rm -f "$ROWS_BEFORE" "$ROWS_AFTER"

if [ "$LOST" != 0 ]; then
  cat <<LOSTEOF

!! DATA LOSS DETECTED. The app is running ${VERSION}, but rows are missing.
!! Restore immediately:
!!   sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres \\
!!        --clean --if-exists < ${BACKUP_FILE}
LOSTEOF
  fail "row counts decreased — restore ${BACKUP_FILE}"
fi

# ── 9. tidy up: shipped tgz, old images, old backups ─────────────────────────
rm -f "$IMAGE_TGZ"
docker images 'bj-erp-app' --format '{{.Tag}}\t{{.CreatedAt}}' \
  | sort -k2 -r | tail -n +$((KEEP_IMAGES + 1)) | cut -f1 \
  | while read -r old; do
      [ "$old" = "$VERSION" ] && continue
      [ "$old" = "latest" ]   && continue
      docker rmi "bj-erp-app:$old" >/dev/null 2>&1 && echo "  removed image bj-erp-app:$old" || true
    done
ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) \
  | xargs -r rm -f --

echo "$(date -u +%FT%TZ) OK ${VERSION} backup=${BACKUP_FILE}" >> "$LOG_FILE"
cat <<DONEEOF

=============================================================
 Deployed ${VERSION}
   App:      https://${APP_HOST}
   Backup:   ${BACKUP_FILE}
   Data:     verified — no table lost rows
   Rollback: sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=${PREVIOUS_VERSION}/' .env && \\
             sudo docker compose up -d app
=============================================================
DONEEOF
EOF
```

- [ ] **Step 2: Verify the destructive commands appear nowhere**

```bash
grep -nE 'compose down|volume rm|down -v' deploy/update.sh && echo "FORBIDDEN COMMAND PRESENT — FIX IT" || echo "clean: no destructive commands"
```

Expected: `clean: no destructive commands`.

- [ ] **Step 3: Syntax-check the finished script**

```bash
bash -n deploy/update.sh && echo "syntax OK"
```

Expected: `syntax OK`.

---

## Task 4: `deploy/release.sh` — the Mac-side one-command pipeline

**Files:**
- Create: `deploy/release.sh`
- Modify: `.gitignore` (add `backups/`)

**Interfaces:**
- Consumes: optional `$1` = version (default `YYYYMMDD-HHMMSS`); env overrides `BJ_SSH_DEST`
  (default `bj`), `BJ_REMOTE_DIR`; `deploy/update.sh`; the `Host bj` alias from Task 0.
- Produces: `dist/bj-erp-app-<version>.tar.gz` locally, a deployed + verified server, and a copy
  of the pre-deploy dump in `./backups/` on the Mac. Exit 0 only if `update.sh` succeeded.

- [ ] **Step 1: Write the script**

```bash
cat > deploy/release.sh <<'EOF'
#!/usr/bin/env bash
# =============================================================================
# deploy/release.sh — build on this Mac, ship it, deploy it. One command.
#
#   ./deploy/release.sh                 # version = timestamp
#   ./deploy/release.sh 2026-08-14     # explicit version
#   SKIP_TESTS=1 ./deploy/release.sh   # skip lint/unit (hotfix only)
#
# Requires: company VPN connected; the `bj` SSH alias (see the release plan,
# Task 0). The client's server is amd64 and this Mac is arm64 — the image is
# cross-built and its architecture VERIFIED before shipping.
# The only password typed is the server's sudo password, once.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(date +%Y%m%d-%H%M%S)}"
SSH_DEST="${BJ_SSH_DEST:-bj}"
REMOTE_DIR="${BJ_REMOTE_DIR:-/home/behsazan/bj-erp-installer}"
TGZ="dist/bj-erp-app-${VERSION}.tar.gz"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. preflight ─────────────────────────────────────────────────────────────
say "Preflight"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
  || fail "version '$VERSION' — use only letters, digits, dot, dash, underscore"
docker info >/dev/null 2>&1 || fail "Docker is not running — start Docker Desktop"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_DEST" true 2>/dev/null \
  || fail "cannot reach '$SSH_DEST' — company VPN connected? SSH key installed (plan Task 0)?"
if [ -n "$(git status --porcelain)" ]; then
  warn "WARNING: uncommitted/untracked changes — shipping the working tree, not a clean commit."
  printf 'Continue? [y/N] '; read -r a; [ "$a" = y ] || exit 1
fi
echo "  version: $VERSION"
echo "  commit:  $(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo ' +dirty')"

# ── 2. gates ─────────────────────────────────────────────────────────────────
if [ "${SKIP_TESTS:-0}" != 1 ]; then
  say "Gates: lint + unit tests"
  npm run lint
  npm run test:unit
else
  warn "SKIP_TESTS=1 — gates skipped."
fi

# ── 3. build for the server's architecture ───────────────────────────────────
say "Building bj-erp-app:${VERSION} for linux/amd64 (emulated — slow)"
DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  docker build -f deploy/Dockerfile -t "bj-erp-app:${VERSION}" . || fail "build failed"
arch=$(docker image inspect "bj-erp-app:${VERSION}" --format '{{.Architecture}}')
[ "$arch" = "amd64" ] || fail "built '${arch}', server needs amd64 — nothing was shipped"
echo "  architecture verified: amd64"

# ── 4. package ───────────────────────────────────────────────────────────────
say "Saving and compressing"
mkdir -p dist
docker save "bj-erp-app:${VERSION}" | gzip -1 > "$TGZ"
echo "  $TGZ ($(du -h "$TGZ" | cut -f1))"

# ── 5. ship (key auth + multiplexed; --partial resumes dropped transfers) ────
say "Shipping to $SSH_DEST"
rsync -aP --partial "$TGZ"                              "$SSH_DEST:$REMOTE_DIR/"
rsync -a  --partial deploy/update.sh                    "$SSH_DEST:$REMOTE_DIR/update.sh"
rsync -a  --partial supabase/migrations/*.sql           "$SSH_DEST:$REMOTE_DIR/migrations/"
# --inplace: ./sql/seed.sql is a single-FILE bind mount in docker-compose.yml;
# a new inode would leave the mounted path serving stale content on install.sh
# re-runs. In-place write preserves the inode.
rsync -a  --partial --inplace supabase/seed.sql         "$SSH_DEST:$REMOTE_DIR/sql/seed.sql"

# ── 6. deploy (the ONE password prompt: the server's sudo) ───────────────────
say "Deploying on the server"
ssh -t "$SSH_DEST" "chmod +x '$REMOTE_DIR/update.sh' && sudo '$REMOTE_DIR/update.sh' '$VERSION'" \
  || fail "remote update failed — see output above; the server rolled itself back"

# ── 7. pull the pre-deploy dump back — off-machine backup copy ───────────────
say "Fetching the backup copy"
mkdir -p backups
rsync -a "$SSH_DEST:$REMOTE_DIR/backups/pre-${VERSION}-*.dump" backups/ \
  || warn "could not fetch the backup copy (deploy itself succeeded)"

say "Released ${VERSION}"
EOF
chmod +x deploy/release.sh
grep -qx 'backups/' .gitignore || echo 'backups/' >> .gitignore
```

- [ ] **Step 2: Syntax-check**

```bash
bash -n deploy/release.sh && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 3: Verify the preflight fails fast and honestly with the VPN off**

With the VPN **disconnected**:

```bash
./deploy/release.sh 2>&1 | head -5
```

Expected: `ERROR: cannot reach 'bj' — company VPN connected? SSH key installed (plan Task 0)?`
— *before* any build starts. The alternative is discovering it after a 15-minute emulated build.

---

## Task 5: End-to-end acceptance — data survival and rollback drill

**Files:** none (verification)

**Interfaces:**
- Consumes: both scripts, Task 0's alias.
- Produces: proof the pipeline preserves every row and recovers from a broken release. **This is
  the acceptance test for the whole plan.**

**Run with the VPN connected, in a quiet window.** The first release ships the *same* code that
is already running, so any behaviour change means the pipeline is wrong, not the app.

- [ ] **Step 1: Record the pre-release state**

```bash
ssh -t bj "cd bj-erp-installer && sudo bash -c 'set -a; . ./.env; set +a
  for t in profiles user_roles leave_requests leave_ledger holidays departments leave_types; do
    printf \"%-16s \" \$t
    docker compose exec -T -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" db psql -tAc \"select count(*) from public.\$t\" -U supabase_admin -d postgres
  done'" | tee /tmp/pre-release-rows.txt
ssh -t bj "sudo docker volume inspect bj-erp_db-data --format '{{.CreatedAt}}'"
```

Record the volume timestamp — it must be identical afterwards.

- [ ] **Step 2: Run the real release**

```bash
cd /Users/amir/Workspace/bj && ./deploy/release.sh test-2026-07-26
```

Expected: gates pass → `architecture verified: amd64` → upload → on the server: backup OK, row
counts printed, migrations replayed, cutover, health OK, `ok <table>: N -> N` for every table →
summary box → backup copy lands in `./backups/` on the Mac. Exit 0.

- [ ] **Step 3: Verify data intact, volume original, backup copy local**

```bash
ssh -t bj "cd bj-erp-installer && sudo bash -c 'set -a; . ./.env; set +a
  for t in profiles user_roles leave_requests leave_ledger holidays departments leave_types; do
    printf \"%-16s \" \$t
    docker compose exec -T -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" db psql -tAc \"select count(*) from public.\$t\" -U supabase_admin -d postgres
  done'" > /tmp/post-release-rows.txt
diff /tmp/pre-release-rows.txt /tmp/post-release-rows.txt && echo "DATA INTACT"
ssh -t bj "sudo docker volume inspect bj-erp_db-data --format '{{.CreatedAt}}'"
ls -lh backups/pre-test-2026-07-26-*.dump
```

Expected: `DATA INTACT`; identical volume timestamp; a local dump file of plausible size.

- [ ] **Step 4: Verify logins survive (proves secrets untouched)**

On the phone over the VPN: `https://10.10.10.50`, log in as `admin` with the same password.
Expected: success.

- [ ] **Step 5: Rollback drill — a broken release must recover automatically**

Build the broken image **from the local image already on the server** — no registry, no Docker
Hub, honouring the offline-first premise. Its entrypoint exits immediately, so the health check
must fail and `update.sh` must roll back:

```bash
ssh -t bj "cd bj-erp-installer \
  && printf 'FROM bj-erp-app:test-2026-07-26\nENTRYPOINT [\"/bin/false\"]\n' | sudo docker build -t bj-erp-app:broken-drill - \
  && sudo docker save bj-erp-app:broken-drill | gzip -1 > bj-erp-app-broken-drill.tar.gz \
  && sudo ./update.sh broken-drill; echo exit=\$?"
```

Expected: backup → load → migrations → cutover → ~90 s of failed health checks →
`rolling back to test-2026-07-26` → the migrations-not-undone warning → non-zero exit.

- [ ] **Step 6: Confirm service restored itself**

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50/ && grep APP_VERSION bj-erp-installer/.env"
```

Expected: `app: 200` and `APP_VERSION=test-2026-07-26`.

- [ ] **Step 7: Clean up the drill**

```bash
ssh -t bj "cd bj-erp-installer && sudo docker rmi bj-erp-app:broken-drill && sudo rm -f bj-erp-app-broken-drill.tar.gz backups/pre-broken-drill-*.dump"
```

> **REVIEW GATE — the pipeline is only trustworthy once Steps 3, 4, and 6 all pass.**

---

## Task 6: Documentation

**Files:**
- Modify: `deploy/RUNBOOK.md` — replace the manual update procedure with the pipeline; fix the
  backup command per Task 1's finding
- Modify: `docs/CHANGELOG.md`, `docs/TASKS.md`

- [ ] **Step 1: Rewrite the RUNBOOK's update section**

Cover: one-time Task 0 setup; `./deploy/release.sh [version]` with the VPN connected; what runs
automatically and in what order; rollback via the printed `APP_VERSION` command; backups in
`<installer>/backups/` (newest 14) + a copy on the Mac in `./backups/`; the audit trail
`<installer>/update.log`; the forward-only-migration warning; deploy in a quiet window.

- [ ] **Step 2: Fix the backup command if Task 1 disproved it**

Update the English *Backups* section and the Farsi summary; add: verify a dump with
`pg_restore -l` before trusting it.

- [ ] **Step 3: Add the Farsi operator summary**

One paragraph in `## خلاصه فارسی`: updates ship with one command from the developer's machine;
the database is backed up and verified automatically first; a failed update rolls back on its
own; employee data is checked row-by-row after every update.

- [ ] **Step 4: Verify docs match reality**

```bash
cd /Users/amir/Workspace/bj && grep -n 'release.sh\|update.sh' deploy/RUNBOOK.md | head
```

Expected: the new procedure present; no stale text.

---

## Appendix A — Failure decision table

| Symptom | State | Action |
|---|---|---|
| Preflight: unreachable | Nothing built or sent | Connect the VPN; check `ssh bj` |
| Preflight: bad version string | Nothing done | Rename the version |
| Gates fail (lint/unit) | Nothing built | Fix the code |
| Build fails / not amd64 | Nothing shipped | Fix locally; server untouched |
| Upload interrupted | Partial file on server | Re-run — `rsync --partial` resumes |
| "another update is already running" | Untouched | Wait; check `update.log` |
| Low disk on server | Untouched | Clean old images/backups, re-run |
| Backup empty/invalid | Aborted before any change | Investigate the DB first |
| Migration fails | App still on old version | Fix the migration; restore the dump if schema half-moved |
| Health check fails | **Image auto-rolled-back** | `sudo docker compose logs app`; restore dump if migrations ran |
| Row counts decreased | New version running | **Restore the dump immediately** (command printed) |
| Healthy but behaves wrong | New version running | Flip `APP_VERSION` back (command in summary box) |

## Appendix B — Day to day

```bash
# Mac, VPN connected
./deploy/release.sh 2026-08-14
```

Gates → build (~5–15 min emulated) → ~300 MB upload → type the sudo password once → server backs
up, migrates, swaps, health-checks, verifies rows → dump copy lands on the Mac. **~30–60 s of app
downtime** (new-image first boot includes the placeholder substitution pass). Deploy off-hours.

## Appendix C — Recommended practices as this grows to 200 users

Not part of this plan's tasks; adopt as cadence grows:

1. **Rehearse releases on the local stack first.** The Mac's installer stack
   (`dist/bj-erp-installer/`) is a faithful staging environment — deploy there and run
   `npm run test:e2e` against it before releasing anything risky to the client.
2. **Daily off-server backups.** The pipeline copies a dump per *release*; a cron on the server
   (daily `pg_dump` + retention) plus a periodic pull to the Mac covers data loss between
   releases. The RUNBOOK's backup section is the basis.
3. **Tag what you ship.** `git tag -a v2026-08-14 && git push origin v2026-08-14` after each
   release makes "what exactly is on the server" answerable forever. The dirty-tree warning in
   `release.sh` nudges toward clean-commit releases.
4. **Keep sudo's password prompt.** A `NOPASSWD` sudoers entry for `update.sh` would remove the
   last prompt, but the script is writable by the SSH user — key compromise would then equal
   silent root. One typed password per release is the right trade.
5. **When modules multiply (finance, procurement), revisit zero-downtime** (blue-green app
   containers behind Caddy). At ~60 s off-hours downtime, not worth the complexity yet.

## Open Questions

1. **Does `pg_dump -U postgres` work as the RUNBOOK claims?** Task 1 settles it; backups are the
   only rollback for migrations.
2. **Upload time on Amir's connection?** ~300 MB gzipped per release. If painful, next step is
   shipping layer diffs — deferred until measured.
