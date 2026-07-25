# Tag-Gated Deploy Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking. **Every task in Phases A–C runs commands on the CLIENT'S LIVE SERVER
> holding real employee data. Do not batch-execute. Stop at every review gate.**

**Goal:** Replace the manual "build on Mac → `scp` a ~400 MB tar → `docker load`" update ritual
with one command on the server — `sudo /opt/bj-erp/deploy.sh` — that pulls a **git tag** from
GitHub, builds the app image, applies new migrations, swaps the container, health-checks it, and
rolls back automatically on failure, without ever touching the database volume.

**Architecture:** The server sits on a LAN behind NAT (only TCP 2222 is reachable inbound), so
deploys are **pull-based**: the server clones the repo and builds its own image. Releases are
gated on a `deploy-*` git tag rather than every push to `main`, so shipping stays a deliberate
act on a live HR system. Container registries are deliberately avoided (frequently unreachable
from Iran — the reason this package ships tar files at all). Rollback is a tag flip of
`APP_VERSION` in `.env` plus `docker compose up -d app`.

**Tech Stack:** Bash, Docker Compose v2, git (SSH deploy key), Postgres 15 (`pg_dump -Fc`),
optional `systemd` timer. No new application dependencies.

## Global Constraints

- **The database is sacred.** No step may run `docker compose down -v` or `docker volume rm`.
  Data lives in the named volume `bj-erp_db-data` and must survive every deploy.
- **Migrations are forward-only.** An image rollback does NOT undo a migration. Any deploy that
  applies migrations must take a `pg_dump` first, and that is the only true rollback path.
- **Migrations must stay idempotent** — `deploy.sh` replays *all* of them every run, exactly as
  `install.sh` does. A new migration that is not safe to re-run breaks deploys.
- **amd64 only.** The server is x86_64. Builds on the server are natively amd64; any fallback
  build on Amir's arm64 Mac must set `DOCKER_DEFAULT_PLATFORM=linux/amd64`.
- **Never regenerate secrets.** `.env` holds `JWT_SECRET`/`ANON_KEY`; regenerating them
  invalidates every login. `deploy.sh` only ever rewrites the `APP_VERSION` line.
- **No `service_role` in the app.** Unchanged by this work; privileged SQL stays in guarded
  `SECURITY DEFINER` RPCs.
- **`.env` is root-owned mode 600** — `deploy.sh` and all `docker compose` calls run under `sudo`.
- **Never run `npm run cleanup:e2e` against this server** — `app_cleanup_e2e_users()` deletes
  accounts whose codes match test patterns (incl. personnel numbers starting `999`).
- **Commits:** Amir approves every commit explicitly. Prepare clean diffs; do not commit unasked.

## Server Facts (verified 2026-07-25)

| Thing | Value |
|---|---|
| SSH | `behsazan@5.201.190.184 -p 2222` (`scp` needs capital `-P`) |
| App URL / `APP_HOST` | `https://10.10.10.50` (LAN-only by design) |
| Installer dir | `/home/behsazan/bj-erp-installer` |
| Compose project | `bj-erp` (set via `name:` in `docker-compose.yml`) |
| DB volume | `bj-erp_db-data` |
| DB superuser | `supabase_admin` (NOT `postgres`); needs `PGPASSWORD` even on the local socket |
| Repo | `https://github.com/AmirNcode/bj-erp.git` — **no tags yet, no CI** |
| Remote access | company L2TP VPN; WireGuard abandoned (IT's UDP forward never worked) |

## File Structure

| Path | Location | Responsibility |
|---|---|---|
| `/opt/bj-erp/repo/` | server | Read-only clone of the repo; the build source |
| `/opt/bj-erp/deploy.sh` | server | The whole deploy: resolve tag → backup → build → migrate → cutover → verify → rollback |
| `/opt/bj-erp/backups/` | server | `pg_dump -Fc` files taken before every deploy |
| `/var/log/bj-erp-deploy.log` | server | Append-only deploy audit trail |
| `/etc/systemd/system/bj-erp-deploy.{service,timer}` | server | *Optional* Phase C: poll GitHub for new tags |
| `deploy/RUNBOOK.md` | repo | Operator docs — updated in Phase D |

`deploy.sh` is intentionally **one file**: it is read and audited by whoever is on call, and
splitting a ~150-line ops script across helpers costs more than it saves.

---

## Phase 0 — Gates (do these first; they can invalidate the whole approach)

### Task 0.1: Verify the server can be a build host

**Files:** none (verification only)

**Interfaces:**
- Produces: a go/no-go decision. **Fail here → abandon Phases A–C and implement Appendix B
  (Mac-side build) instead.** Everything downstream assumes all four checks pass.

- [ ] **Step 1: Check GitHub reachability, RAM, disk, and CPU on the server**

```bash
echo "== github =="; curl -sI --max-time 10 https://github.com | head -1
echo "== git ==";    git --version 2>/dev/null || echo "git MISSING"
echo "== ram ==";    free -h | awk '/Mem:/{print "total="$2" available="$7}'
echo "== disk ==";   df -h / | awk 'NR==2{print "free="$4}'
echo "== cpu ==";    nproc
```

Expected for Plan A to proceed:
- github → `HTTP/2 200`
- ram → `available` **≥ 2.5 G** (a Next.js production build peaks around 2 GB; the stack itself
  needs ~1 GB. The documented server floor is 4 GB total)
- disk → **≥ 8 G** free (each app image is ~1 GB; we keep 3)
- cpu → ≥ 2

- [ ] **Step 2: If `git` is missing, install it**

```bash
sudo apt update && sudo apt install -y git
```

- [ ] **Step 3: If RAM is below 2.5 G available, add swap so the build cannot OOM the live app**

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Expected: `Swap:` row now shows `4.0Gi`.

- [ ] **Step 4: Record the decision**

Write the four values into the PR/handoff notes. If GitHub is unreachable → **stop, go to
Appendix B**. A blocked registry does not matter (we never pull images), but a blocked
`github.com` kills pull-based deploys outright.

> **REVIEW GATE — do not continue without Amir's explicit go.**

---

### Task 0.2: Make the repository the source of truth

**Files:**
- Modify: all 61 currently-uncommitted paths (see `git status`)
- Create: git tag `deploy-2026-07-25`

**Interfaces:**
- Produces: a pushed `main` whose tree equals what is **already running** on the server, plus the
  first `deploy-*` tag for Task B6 to deploy.

**Why this blocks everything:** the running image was built from Amir's *uncommitted* working
tree. `main` is at `78a324a`, which predates the entire employee-onboarding feature set (CSV
import, generated codes, manager-scoped create, departments). A git-based deploy today would
**silently downgrade the client's live app**.

- [ ] **Step 1: Confirm the gap is real before touching anything**

```bash
cd /Users/amir/Workspace/bj
git status --porcelain | wc -l          # expect 61
git log --oneline -1                    # expect 78a324a
ls supabase/migrations/20260713120001_employee_onboarding.sql   # exists locally…
git ls-files --error-unmatch supabase/migrations/20260713120001_employee_onboarding.sql 2>&1 | tail -1
```

Expected last line: `did not match any file(s) known to git` — i.e. the migration the live
database has already run is **not in git**.

- [ ] **Step 2: Run the full gate suite before committing**

```bash
cd /Users/amir/Workspace/bj && npm run lint && npm run test:unit && npm run build
```

Expected: lint clean, **unit 130/130**, build succeeds.

- [ ] **Step 3: Commit in reviewable chunks (Amir approves each)**

Suggested split, matching how the work actually landed:

```bash
git add supabase/migrations/20260713120001_employee_onboarding.sql lib/departments lib/employees lib/csv lib/actions/departments.ts
git commit -m "feat(hr): employee codes, departments, and bulk-import data layer"
```

```bash
git add "app/[locale]/(app)/manage" components/CredentialsDownload.tsx "app/[locale]/(app)/profile"
git commit -m "feat(hr): onboarding UI — manager create, CSV import, credential export, logout confirm"
```

```bash
git add deploy .dockerignore next.config.ts proxy.ts lib/supabase docs
git commit -m "feat(deploy): self-host installer package and updated handoff docs"
```

```bash
git add tests messages package-lock.json scripts supabase/seed.sql lib/errors
git commit -m "test(e2e): migrate suite to generated employee codes"
```

Then whatever `git status --porcelain` still lists, reviewed individually.

- [ ] **Step 4: Push and tag the release that matches production**

```bash
git push origin main
git tag -a deploy-2026-07-25 -m "First tagged release — matches the image running on 10.10.10.50"
git push origin deploy-2026-07-25
```

- [ ] **Step 5: Verify the tag is visible from GitHub's side**

```bash
git ls-remote --tags origin | grep deploy-2026-07-25
```

Expected: one line with the tag's SHA.

> **REVIEW GATE — Amir approves every commit. Do not proceed until `main` + tag are pushed.**

---

## Phase A — Give the server the source

### Task A1: Clone the repo on the server

**Files:**
- Create (server): `/opt/bj-erp/repo/`, `/opt/bj-erp/backups/`, `/root/.ssh/bj-erp-deploy{,.pub}`,
  `/root/.ssh/config` entry

**Interfaces:**
- Consumes: the pushed `main` + `deploy-2026-07-25` tag from Task 0.2.
- Produces: `/opt/bj-erp/repo` — a clone that `deploy.sh` can `git fetch --tags` in, as root.

- [ ] **Step 1: Create the directories**

```bash
sudo mkdir -p /opt/bj-erp/repo /opt/bj-erp/backups && sudo chmod 700 /opt/bj-erp
```

- [ ] **Step 2: Determine whether the repo is public or private**

```bash
curl -so /dev/null -w '%{http_code}\n' https://api.github.com/repos/AmirNcode/bj-erp
```

`200` → public, use Step 3a. `404` → private, use Step 3b.

- [ ] **Step 3a (public repo): clone over HTTPS**

```bash
sudo git clone https://github.com/AmirNcode/bj-erp.git /opt/bj-erp/repo
```

- [ ] **Step 3b (private repo): create a read-only deploy key and clone over SSH**

```bash
sudo ssh-keygen -t ed25519 -f /root/.ssh/bj-erp-deploy -N '' -C 'bj-erp deploy key (client server)'
sudo cat /root/.ssh/bj-erp-deploy.pub
```

Amir adds that public key at **github.com/AmirNcode/bj-erp → Settings → Deploy keys → Add deploy
key**, with **"Allow write access" left UNCHECKED** (read-only: the server must never be able to
push). Then:

```bash
sudo tee -a /root/.ssh/config >/dev/null <<'EOF'

Host github-bj-erp
  HostName github.com
  User git
  IdentityFile /root/.ssh/bj-erp-deploy
  IdentitiesOnly yes
EOF
sudo chmod 600 /root/.ssh/config
sudo git clone git@github-bj-erp:AmirNcode/bj-erp.git /opt/bj-erp/repo
```

- [ ] **Step 4: Verify the clone and that tags arrived**

```bash
sudo git -C /opt/bj-erp/repo fetch --tags --prune
sudo git -C /opt/bj-erp/repo tag
sudo git -C /opt/bj-erp/repo log --oneline -1 origin/main
```

Expected: `deploy-2026-07-25` listed; the `origin/main` SHA matches what Task 0.2 pushed.

---

## Phase B — The deploy script

### Task B1: Prove the backup command actually works

**Files:** none (verification); fixes land in `deploy/RUNBOOK.md` in Phase D

**Interfaces:**
- Produces: the exact, *verified* `pg_dump` invocation that Task B2 embeds. Everything else in
  this plan leans on backups being real, so this is verified before anything is automated.

**Why this task exists:** `deploy/RUNBOOK.md` currently documents
`docker compose exec -T db pg_dump -U postgres …`, but `install.sh` shows the image's superuser
is **`supabase_admin`** and that password auth is required even on the local socket. The
documented command is suspect and must be proven before it is trusted.

- [ ] **Step 1: Try the RUNBOOK's documented command**

```bash
cd /home/behsazan/bj-erp-installer && sudo docker compose exec -T db pg_dump -U postgres -d postgres -Fc > /tmp/test-runbook.dump; echo "exit=$?"; ls -lh /tmp/test-runbook.dump
```

- [ ] **Step 2: Try the `supabase_admin` form**

```bash
cd /home/behsazan/bj-erp-installer
sudo bash -c 'set -a; . ./.env; set +a; docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db pg_dump -U supabase_admin -d postgres -Fc' > /tmp/test-admin.dump
echo "exit=$?"; ls -lh /tmp/test-admin.dump
```

- [ ] **Step 3: Verify whichever dump succeeded is a real, restorable archive**

```bash
sudo docker compose -f /home/behsazan/bj-erp-installer/docker-compose.yml exec -T db pg_restore -l < /tmp/test-admin.dump | head -20
```

Expected: a table-of-contents listing including `public profiles` and `public leave_requests`.
A dump that is 0 bytes or fails `pg_restore -l` is **not a backup**.

- [ ] **Step 4: Record the winner and clean up**

```bash
rm -f /tmp/test-runbook.dump /tmp/test-admin.dump
```

Note which form worked; Task B2 uses exactly that. If the RUNBOOK's form failed, Phase D fixes
the RUNBOOK (a backup command that silently produces an empty file is worse than none).

---

### Task B2: `deploy.sh` — tag resolution, backup, build

**Files:**
- Create (server): `/opt/bj-erp/deploy.sh`

**Interfaces:**
- Consumes: `/opt/bj-erp/repo` (Task A1); `$INSTALLER_DIR/.env` for `APP_HOST`,
  `POSTGRES_PASSWORD`, `APP_VERSION`; the verified `pg_dump` form (Task B1).
- Produces: `bj-erp-app:<tag>` in the local Docker image store, a dump in
  `/opt/bj-erp/backups/`, and the shell variables `TAG` / `PREVIOUS_VERSION` used by Tasks B3–B4.
  Exits non-zero on any failure, leaving the running app untouched.

- [ ] **Step 1: Write the script skeleton through the build stage**

```bash
sudo tee /opt/bj-erp/deploy.sh >/dev/null <<'DEPLOYEOF'
#!/usr/bin/env bash
# =============================================================================
# /opt/bj-erp/deploy.sh — deploy a tagged release of bj-erp to this server.
#
#   sudo /opt/bj-erp/deploy.sh                    # newest deploy-* tag
#   sudo /opt/bj-erp/deploy.sh deploy-2026-07-26  # a specific tag
#   sudo /opt/bj-erp/deploy.sh --dry-run          # resolve + report, change nothing
#
# Pulls the tag from GitHub, backs up the database, builds the app image,
# applies any new migrations, swaps the app container, health-checks it, and
# rolls the image back automatically if the health check fails.
#
# The database volume is NEVER touched. Migrations are forward-only: an image
# rollback does NOT undo them — restore the pre-deploy dump for that.
# =============================================================================
set -euo pipefail

REPO_DIR=/opt/bj-erp/repo
INSTALLER_DIR=/home/behsazan/bj-erp-installer
BACKUP_DIR=/opt/bj-erp/backups
LOG_FILE=/var/log/bj-erp-deploy.log
HEALTH_RETRIES=30
KEEP_IMAGES=3

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && { DRY_RUN=1; shift; }
REQUESTED_TAG="${1:-}"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2
         echo "$(date -u +%FT%TZ) FAILED ${TAG:-?}: $*" >> "$LOG_FILE"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run with sudo (needs the root-owned .env and docker)"
[ -f "$INSTALLER_DIR/.env" ] || fail "$INSTALLER_DIR/.env not found"

# APP_HOST, POSTGRES_PASSWORD, APP_VERSION
set -a; . "$INSTALLER_DIR/.env"; set +a
PREVIOUS_VERSION="${APP_VERSION:-latest}"

# ── resolve the target tag ───────────────────────────────────────────────────
say "Fetching tags from GitHub…"
git -C "$REPO_DIR" fetch --tags --prune --quiet || fail "git fetch failed — can the server reach GitHub?"

if [ -n "$REQUESTED_TAG" ]; then
  TAG="$REQUESTED_TAG"
else
  TAG=$(git -C "$REPO_DIR" tag -l 'deploy-*' --sort=-creatordate | head -1)
fi
[ -n "$TAG" ] || fail "no deploy-* tag found"
git -C "$REPO_DIR" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "tag '$TAG' does not exist"

TAG_SHA=$(git -C "$REPO_DIR" rev-parse --short "refs/tags/$TAG")
say "Target: $TAG ($TAG_SHA) — currently running: $PREVIOUS_VERSION"

if [ "$DRY_RUN" = 1 ]; then
  echo "dry run — nothing changed."
  git -C "$REPO_DIR" log --oneline -5 "refs/tags/$TAG"
  exit 0
fi

# ── backup BEFORE anything mutates ───────────────────────────────────────────
say "Backing up the database…"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/pre-${TAG}-$(date +%F-%H%M%S).dump"
cd "$INSTALLER_DIR"
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  pg_dump -U supabase_admin -d postgres -Fc > "$BACKUP_FILE" || fail "pg_dump failed"
[ -s "$BACKUP_FILE" ] || fail "backup is empty — refusing to deploy"
docker compose exec -T db pg_restore -l < "$BACKUP_FILE" >/dev/null 2>&1 || fail "backup is not a valid archive"
say "Backup OK: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── build ────────────────────────────────────────────────────────────────────
say "Checking out $TAG and building the app image…"
git -C "$REPO_DIR" checkout --quiet --detach "refs/tags/$TAG"
docker build -f "$REPO_DIR/deploy/Dockerfile" -t "bj-erp-app:${TAG}" "$REPO_DIR" \
  || fail "docker build failed — nothing was changed, the old app is still running"
DEPLOYEOF
sudo chmod 700 /opt/bj-erp/deploy.sh
```

**Note on Task B1's outcome:** if Step 2 of B1 showed `-U postgres` works and `supabase_admin`
does not, change the two `pg_dump`/`pg_restore` lines above accordingly before continuing.

- [ ] **Step 2: Test tag resolution without side effects**

```bash
sudo /opt/bj-erp/deploy.sh --dry-run
```

Expected: `Target: deploy-2026-07-25 (<sha>) — currently running: latest`, then the last 5
commits, then `dry run — nothing changed.` Nothing built, no backup written.

- [ ] **Step 3: Verify a bad tag is rejected cleanly**

```bash
sudo /opt/bj-erp/deploy.sh --dry-run deploy-does-not-exist; echo "exit=$?"
```

Expected: `ERROR: tag 'deploy-does-not-exist' does not exist`, `exit=1`.

---

### Task B3: Migration sync and application

**Files:**
- Modify (server): `/opt/bj-erp/deploy.sh` — append the migration stage

**Interfaces:**
- Consumes: `$TAG` checked out in `$REPO_DIR`; the live DB via `docker compose exec db`.
- Produces: `$INSTALLER_DIR/migrations/` synced with the tag's `supabase/migrations/`, all
  migrations + `seed.sql` applied. Sets `NEW_MIGRATIONS` (count) for the summary in Task B4.

**Why replay everything:** `install.sh` already replays all migrations on every run and they are
written to be idempotent. Replaying is what keeps a partially-applied history self-healing;
tracking "which ones ran" would add state that can drift from reality.

- [ ] **Step 1: Append the migration stage**

```bash
sudo tee -a /opt/bj-erp/deploy.sh >/dev/null <<'DEPLOYEOF'

# ── migrations ───────────────────────────────────────────────────────────────
# psql inside the db container as the image's superuser. The migrations dir is
# bind-mounted read-only at /bj/migrations, so files copied in appear live.
pgexec() {
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}

say "Syncing migration files…"
NEW_MIGRATIONS=0
for f in "$REPO_DIR"/supabase/migrations/*.sql; do
  base=$(basename "$f")
  if [ ! -f "$INSTALLER_DIR/migrations/$base" ]; then
    cp "$f" "$INSTALLER_DIR/migrations/$base"
    echo "  + new: $base"
    NEW_MIGRATIONS=$((NEW_MIGRATIONS + 1))
  elif ! cmp -s "$f" "$INSTALLER_DIR/migrations/$base"; then
    cp "$f" "$INSTALLER_DIR/migrations/$base"
    echo "  ~ changed: $base"
    NEW_MIGRATIONS=$((NEW_MIGRATIONS + 1))
  fi
done
cp "$REPO_DIR/supabase/seed.sql" "$INSTALLER_DIR/sql/seed.sql"
[ "$NEW_MIGRATIONS" -eq 0 ] && echo "  (no migration changes)"

say "Applying migrations (idempotent replay)…"
for f in "$INSTALLER_DIR"/migrations/*.sql; do
  base=$(basename "$f")
  pgexec -f "/bj/migrations/$base" >/dev/null \
    || fail "migration $base failed — app NOT restarted; restore with: $BACKUP_FILE"
done

say "Applying baseline configuration…"
pgexec -f /bj/seed.sql >/dev/null || fail "seed.sql failed — restore with: $BACKUP_FILE"
DEPLOYEOF
```

- [ ] **Step 2: Verify the migration replay is genuinely a no-op on the live DB**

Count the rows that matter, replay every migration by hand, count again:

```bash
cd /home/behsazan/bj-erp-installer
sudo bash -c 'set -a; . ./.env; set +a
  for t in profiles leave_requests leave_ledger holidays departments; do
    printf "%-16s " "$t"
    docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -tAc "select count(*) from public.$t" -U supabase_admin -d postgres
  done' | tee /tmp/rows-before.txt
```

```bash
cd /home/behsazan/bj-erp-installer
sudo bash -c 'set -a; . ./.env; set +a
  for f in migrations/*.sql; do
    docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f "/bj/migrations/$(basename $f)" >/dev/null || echo "FAILED: $f"
  done; echo "replay done"'
```

```bash
cd /home/behsazan/bj-erp-installer
sudo bash -c 'set -a; . ./.env; set +a
  for t in profiles leave_requests leave_ledger holidays departments; do
    printf "%-16s " "$t"
    docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -tAc "select count(*) from public.$t" -U supabase_admin -d postgres
  done' | tee /tmp/rows-after.txt
diff /tmp/rows-before.txt /tmp/rows-after.txt && echo "IDENTICAL — replay is non-destructive"
```

Expected: `replay done` with no `FAILED:` lines, and `IDENTICAL`. **A difference here is a
release blocker** — it means a migration is not idempotent and must be fixed before automation
is trusted.

---

### Task B4: Cutover, health check, automatic rollback

**Files:**
- Modify (server): `/opt/bj-erp/deploy.sh` — append the cutover stage

**Interfaces:**
- Consumes: `bj-erp-app:${TAG}` (B2), migrations applied (B3), `$PREVIOUS_VERSION`,
  `$BACKUP_FILE`, `$NEW_MIGRATIONS`.
- Produces: the running app on the new tag, or the previous tag restored. Appends one line to
  `$LOG_FILE`. Exit 0 = healthy on the new tag; exit 1 = rolled back or needs manual recovery.

- [ ] **Step 1: Append the cutover, health check, rollback, and prune**

```bash
sudo tee -a /opt/bj-erp/deploy.sh >/dev/null <<'DEPLOYEOF'

# ── cutover ──────────────────────────────────────────────────────────────────
say "Switching the app container to $TAG…"
sed -i "s/^APP_VERSION=.*/APP_VERSION=${TAG}/" "$INSTALLER_DIR/.env"
docker compose up -d app || fail "compose up failed for $TAG"

# ── health check ─────────────────────────────────────────────────────────────
say "Health-checking https://${APP_HOST}/ …"
HEALTHY=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://${APP_HOST}/" || true)
  auth=$(curl -sk --max-time 5 "https://${APP_HOST}/auth/v1/health" || true)
  if [ "$code" = "200" ] && printf '%s' "$auth" | grep -q GoTrue; then HEALTHY=1; break; fi
  sleep 2
done

if [ "$HEALTHY" != 1 ]; then
  say "UNHEALTHY after $((HEALTH_RETRIES * 2))s — rolling back to ${PREVIOUS_VERSION}"
  sed -i "s/^APP_VERSION=.*/APP_VERSION=${PREVIOUS_VERSION}/" "$INSTALLER_DIR/.env"
  docker compose up -d app || true
  echo "$(date -u +%FT%TZ) ROLLBACK ${TAG} -> ${PREVIOUS_VERSION} (backup: ${BACKUP_FILE})" >> "$LOG_FILE"
  if [ "$NEW_MIGRATIONS" -gt 0 ]; then
    cat <<WARN

!! ${NEW_MIGRATIONS} migration(s) were applied and are NOT undone by this rollback.
!! If the old image is incompatible with the new schema, restore the backup:
!!   cd ${INSTALLER_DIR}
!!   sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres --clean --if-exists < ${BACKUP_FILE}
WARN
  fi
  fail "deploy failed; rolled back to ${PREVIOUS_VERSION}"
fi

# ── prune old images (keep the newest KEEP_IMAGES, never the running one) ────
say "Pruning old app images (keeping ${KEEP_IMAGES})…"
docker images 'bj-erp-app' --format '{{.Tag}}\t{{.CreatedAt}}' \
  | sort -k2 -r | tail -n +$((KEEP_IMAGES + 1)) | cut -f1 \
  | while read -r old; do
      [ "$old" = "$TAG" ] && continue
      [ "$old" = "latest" ] && continue
      docker rmi "bj-erp-app:$old" >/dev/null 2>&1 && echo "  removed bj-erp-app:$old" || true
    done

echo "$(date -u +%FT%TZ) OK ${TAG} (${TAG_SHA}) migrations=${NEW_MIGRATIONS} backup=${BACKUP_FILE}" >> "$LOG_FILE"

cat <<EOF

=============================================================
 Deployed ${TAG} (${TAG_SHA})
   App:        https://${APP_HOST}
   Migrations: ${NEW_MIGRATIONS} applied
   Backup:     ${BACKUP_FILE}
   Rollback:   sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=${PREVIOUS_VERSION}/' ${INSTALLER_DIR}/.env && \\
               cd ${INSTALLER_DIR} && sudo docker compose up -d app
=============================================================
EOF
DEPLOYEOF
```

- [ ] **Step 2: Syntax-check the finished script before it ever runs for real**

```bash
sudo bash -n /opt/bj-erp/deploy.sh && echo "syntax OK"
```

Expected: `syntax OK`.

---

### Task B5: End-to-end deploy with a data-survival test

**Files:** none (verification)

**Interfaces:**
- Consumes: the complete `deploy.sh`, tag `deploy-2026-07-25`.
- Produces: proof that a real deploy preserves every row and keeps the app serving. **This is the
  acceptance test for the entire plan.**

**Why `deploy-2026-07-25` is the ideal first deploy:** it is the tag whose tree already matches
the running image, so a correct deploy is functionally a no-op — any behaviour change means the
pipeline is wrong, not the app.

- [ ] **Step 1: Record the full pre-deploy state**

```bash
cd /home/behsazan/bj-erp-installer
sudo bash -c 'set -a; . ./.env; set +a
  for t in profiles user_roles leave_requests leave_ledger holidays departments leave_types; do
    printf "%-16s " "$t"
    docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -tAc "select count(*) from public.$t" -U supabase_admin -d postgres
  done' | tee /tmp/pre-deploy-rows.txt
```

- [ ] **Step 2: Run the real deploy**

```bash
sudo /opt/bj-erp/deploy.sh deploy-2026-07-25
```

Expected: backup OK → build → `(no migration changes)` → cutover → health OK → the summary box.
Exit code 0.

- [ ] **Step 3: Verify not a single row moved**

```bash
cd /home/behsazan/bj-erp-installer
sudo bash -c 'set -a; . ./.env; set +a
  for t in profiles user_roles leave_requests leave_ledger holidays departments leave_types; do
    printf "%-16s " "$t"
    docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -tAc "select count(*) from public.$t" -U supabase_admin -d postgres
  done' > /tmp/post-deploy-rows.txt
diff /tmp/pre-deploy-rows.txt /tmp/post-deploy-rows.txt && echo "DATA INTACT"
```

Expected: `DATA INTACT`. Anything else is a **stop-everything** failure.

- [ ] **Step 4: Verify the volume was never recreated**

```bash
sudo docker volume inspect bj-erp_db-data --format '{{.CreatedAt}}'
```

Expected: the **original install date (2026-07-25 install time)**, not now. A fresh timestamp
means the volume was destroyed and recreated.

- [ ] **Step 5: Verify the app still works from a browser, and that login survives**

On the phone (company VPN on): open `https://10.10.10.50`, log in as `admin`. Expected: login
succeeds with the **same password as before** — proving `JWT_SECRET`/`ANON_KEY` were not
regenerated.

- [ ] **Step 6: Verify automatic rollback actually fires**

Deliberately break a deploy and confirm the script recovers:

```bash
sudo docker tag hello-world:latest bj-erp-app:deploy-broken-test 2>/dev/null || sudo docker pull hello-world && sudo docker tag hello-world:latest bj-erp-app:deploy-broken-test
cd /home/behsazan/bj-erp-installer
sudo cp .env /tmp/env.backup
sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=deploy-broken-test/' .env
sudo docker compose up -d app
sleep 5
curl -sk -o /dev/null -w 'broken app returns: %{http_code}\n' --max-time 5 https://10.10.10.50/
```

Expected: a non-200 (the container exits immediately). Now restore:

```bash
cd /home/behsazan/bj-erp-installer && sudo cp /tmp/env.backup .env && sudo docker compose up -d app
sleep 5 && curl -sk -o /dev/null -w 'recovered: %{http_code}\n' --max-time 5 https://10.10.10.50/
```

Expected: `recovered: 200`. This proves the rollback mechanism (`APP_VERSION` flip +
`compose up -d app`) that `deploy.sh` relies on genuinely restores service.

```bash
sudo docker rmi bj-erp-app:deploy-broken-test && rm -f /tmp/env.backup
```

> **REVIEW GATE — the pipeline is only trustworthy once Steps 3, 4, and 6 all pass.**

---

## Phase C — Optional: hands-off polling

### Task C1: `systemd` timer that deploys new tags automatically

**Files:**
- Create (server): `/etc/systemd/system/bj-erp-deploy.service`,
  `/etc/systemd/system/bj-erp-deploy.timer`

**Interfaces:**
- Consumes: `/opt/bj-erp/deploy.sh` (idempotent — redeploying the current tag is harmless but
  wasteful, so the unit skips when the newest tag already matches `APP_VERSION`).
- Produces: automatic deployment within ~10 minutes of pushing a `deploy-*` tag.

**Only build this once Phase B has run clean for a few manual releases.** Amir chose tag-gated
deploys precisely so that shipping stays deliberate; this task removes the last human step, so it
is genuinely optional.

- [ ] **Step 1: Create the service unit**

```bash
sudo tee /etc/systemd/system/bj-erp-deploy.service >/dev/null <<'EOF'
[Unit]
Description=Deploy the newest bj-erp deploy-* tag if it differs from the running one
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'set -e; \
  git -C /opt/bj-erp/repo fetch --tags --prune --quiet; \
  newest=$(git -C /opt/bj-erp/repo tag -l "deploy-*" --sort=-creatordate | head -1); \
  current=$(grep "^APP_VERSION=" /home/behsazan/bj-erp-installer/.env | cut -d= -f2); \
  if [ -n "$newest" ] && [ "$newest" != "$current" ]; then \
    echo "deploying $newest (current: $current)"; /opt/bj-erp/deploy.sh "$newest"; \
  else echo "up to date ($current)"; fi'
EOF
```

- [ ] **Step 2: Create the timer**

```bash
sudo tee /etc/systemd/system/bj-erp-deploy.timer >/dev/null <<'EOF'
[Unit]
Description=Check for new bj-erp release tags every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
Unit=bj-erp-deploy.service

[Install]
WantedBy=timers.target
EOF
```

- [ ] **Step 3: Test the unit once by hand before enabling the timer**

```bash
sudo systemctl daemon-reload && sudo systemctl start bj-erp-deploy.service
sudo journalctl -u bj-erp-deploy.service -n 20 --no-pager
```

Expected: `up to date (deploy-2026-07-25)` — no deploy, because the newest tag is already running.

- [ ] **Step 4: Enable the timer**

```bash
sudo systemctl enable --now bj-erp-deploy.timer && sudo systemctl list-timers bj-erp-deploy.timer --no-pager
```

Expected: a row showing the next run time.

---

## Phase D — Documentation

### Task D1: Fold the pipeline into the RUNBOOK

**Files:**
- Modify: `deploy/RUNBOOK.md` — replace the "Later: automating deploys (design, not yet built)"
  section with the built procedure; correct the backup command per Task B1's finding
- Modify: `docs/CHANGELOG.md` — add the deploy-automation entry
- Modify: `docs/TASKS.md` — mark deploy automation done

- [ ] **Step 1: Rewrite the RUNBOOK's automation section**

Replace the design sketch with: how to cut a release (`git tag -a deploy-YYYY-MM-DD -m … &&
git push origin <tag>`), how to deploy (`sudo /opt/bj-erp/deploy.sh`), how to roll back (the
`APP_VERSION` flip printed in the summary box), where backups and logs live
(`/opt/bj-erp/backups/`, `/var/log/bj-erp-deploy.log`), and the forward-only-migration warning.

- [ ] **Step 2: Fix the backup command if Task B1 disproved it**

If `-U postgres` failed, update both the *Backups* section and its Farsi summary to the
`supabase_admin` + `PGPASSWORD` form, and add: verify a dump with `pg_restore -l` before
trusting it.

- [ ] **Step 3: Add the Farsi operator summary**

One paragraph in `## خلاصه فارسی`: releases are deployed with one command, the database is backed
up automatically first, and a failed deploy rolls back on its own.

- [ ] **Step 4: Verify docs match reality**

```bash
cd /Users/amir/Workspace/bj && grep -n "deploy.sh" deploy/RUNBOOK.md | head
```

Expected: the new procedure is present and no "not yet built" text remains.

---

## Appendix A — Rollback decision table

| Symptom | Action |
|---|---|
| Deploy failed at build | Nothing changed; fix the code, re-tag |
| Deploy failed at migrations | App never restarted; restore `$BACKUP_FILE`, fix the migration |
| Health check failed, **no** migrations in this release | Automatic image rollback already restored service |
| Health check failed, migrations **were** applied | Image rolled back but schema moved forward — restore `$BACKUP_FILE` if the old image is incompatible |
| App healthy but behaving wrong | Flip `APP_VERSION` to the previous tag, `docker compose up -d app` |
| Database corrupted / data lost | `pg_restore --clean --if-exists < /opt/bj-erp/backups/<dump>` |

## Appendix B — Fallback if the server cannot build (Task 0.1 failed)

If GitHub is unreachable from the server, or RAM cannot support a build, keep building on the Mac
and automate only the shipping. Create `deploy/push-update.sh` **in the repo** (so it is version
controlled and runs from Amir's machine):

```bash
#!/usr/bin/env bash
# deploy/push-update.sh — build on this Mac, ship the image, restart the server's app.
#   ./deploy/push-update.sh deploy-2026-07-26
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:?usage: push-update.sh <tag>}"
SSH_HOST=behsazan@5.201.190.184
SSH_PORT=2222
REMOTE_DIR=/home/behsazan/bj-erp-installer

echo "==> Building ${TAG} for linux/amd64…"
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker build -f deploy/Dockerfile -t "bj-erp-app:${TAG}" .
[ "$(docker image inspect "bj-erp-app:${TAG}" --format '{{.Architecture}}')" = "amd64" ] \
  || { echo "ERROR: image is not amd64"; exit 1; }

echo "==> Saving and shipping…"
docker save "bj-erp-app:${TAG}" -o "dist/bj-erp-app-${TAG}.tar"
scp -P "$SSH_PORT" "dist/bj-erp-app-${TAG}.tar" "$SSH_HOST:${REMOTE_DIR}/"
scp -P "$SSH_PORT" supabase/migrations/*.sql "$SSH_HOST:${REMOTE_DIR}/migrations/"

echo "==> Loading and restarting on the server…"
ssh -p "$SSH_PORT" "$SSH_HOST" "cd ${REMOTE_DIR} \
  && sudo docker load -i bj-erp-app-${TAG}.tar \
  && sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=${TAG}/' .env \
  && sudo ./install.sh </dev/null \
  && rm -f bj-erp-app-${TAG}.tar"

echo "==> Health check…"
ssh -p "$SSH_PORT" "$SSH_HOST" "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50/"
```

Trade-offs versus Plan A: a ~1 GB upload per release (slow on a home connection), no automatic
rollback, and `install.sh` reloads the bundled service images each run. It is strictly a fallback.
Note it re-runs `install.sh`, which is safe on an existing install (secrets reused, admin skipped)
but requires `</dev/null` so it never blocks on a prompt.

## Open Questions

1. **Is `AmirNcode/bj-erp` public or private?** Task A1 Step 2 answers it and branches. Private is
   expected (it is client work) → read-only deploy key.
2. **Can the 4 GB server really build Next.js while serving?** Task 0.1 measures it; Step 3 adds
   swap as mitigation. If builds destabilise the live app, move to Appendix B.
3. **Does `pg_dump -U postgres` work as the RUNBOOK claims?** Task B1 settles it. Backups are the
   only real rollback for migrations, so this is not optional.
4. **Release cadence?** If releases become frequent, revisit Phase C. Until then one command is
   less machinery to trust.
