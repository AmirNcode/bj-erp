#!/usr/bin/env bash
# =============================================================================
# deploy/release.sh — build on this Mac, ship it, deploy it. One command.
#
#   ./deploy/release.sh                  # version = timestamp
#   ./deploy/release.sh 2026-08-14       # explicit version
#   SKIP_TESTS=1 ./deploy/release.sh     # skip lint/unit gates (hotfix only)
#
# Requires: the company VPN connected, and the one-time setup in
# deploy/setup-release.sh (SSH key + the `bj` host alias). See
# docs/DEPLOY-GUIDE.md.
#
# The client's server is amd64 and this Mac is arm64, so the image is
# cross-built and its architecture is VERIFIED before anything is shipped — an
# arm64 image fails on the server with "exec format error".
#
# The only password you type is the server's sudo password, once.
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

# ── 1. preflight — fail fast, before the slow build ──────────────────────────
say "Preflight"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
  || fail "invalid version '${VERSION}' — letters, digits, dot, dash, underscore only"
[ -f deploy/update.sh ] || fail "deploy/update.sh is missing"
docker info >/dev/null 2>&1 || fail "Docker is not running — start Docker Desktop"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_DEST" true 2>/dev/null \
  || fail "cannot reach '${SSH_DEST}' — is the company VPN connected? Ran deploy/setup-release.sh?"

if [ -n "$(git status --porcelain)" ]; then
  warn "WARNING: uncommitted or untracked changes — you are shipping the working tree,"
  warn "         not a clean commit. What is on the server will not match any commit."
  printf 'Continue anyway? [y/N] '
  read -r reply
  [ "$reply" = y ] || [ "$reply" = Y ] || exit 1
fi

echo "  version: ${VERSION}"
echo "  commit:  $(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo ' +dirty')"
echo "  target:  ${SSH_DEST}:${REMOTE_DIR}"

# ── 2. gates ─────────────────────────────────────────────────────────────────
if [ "${SKIP_TESTS:-0}" != 1 ]; then
  say "Gates: lint + unit tests"
  npm run lint     || fail "lint failed — nothing was built or shipped"
  npm run test:unit || fail "unit tests failed — nothing was built or shipped"
else
  warn "SKIP_TESTS=1 — lint and unit tests skipped."
fi

# ── 3. build for the server's architecture ───────────────────────────────────
say "Building bj-erp-app:${VERSION} for linux/amd64 (emulated — this is the slow part)"
DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  docker build -f deploy/Dockerfile -t "bj-erp-app:${VERSION}" . || fail "docker build failed"

arch=$(docker image inspect "bj-erp-app:${VERSION}" --format '{{.Architecture}}')
[ "$arch" = "amd64" ] \
  || fail "built '${arch}' but the server needs amd64 — nothing was shipped"
echo "  architecture verified: amd64"

# ── 4. package ───────────────────────────────────────────────────────────────
say "Saving and compressing the image"
mkdir -p dist
docker save "bj-erp-app:${VERSION}" | gzip -1 > "$TGZ"
echo "  ${TGZ} ($(du -h "$TGZ" | cut -f1))"

# ── 5. ship — key auth + multiplexed; --partial resumes a dropped transfer ───
say "Shipping to ${SSH_DEST}"
rsync -aP --partial "$TGZ"                    "${SSH_DEST}:${REMOTE_DIR}/"
rsync -a  --partial deploy/update.sh          "${SSH_DEST}:${REMOTE_DIR}/update.sh"
rsync -a  --partial supabase/migrations/*.sql "${SSH_DEST}:${REMOTE_DIR}/migrations/"
# --inplace: ./sql/seed.sql is a single-FILE bind mount in docker-compose.yml.
# A new inode would leave the container's mounted path serving stale content on
# install.sh re-runs; writing in place preserves the inode.
rsync -a  --partial --inplace supabase/seed.sql "${SSH_DEST}:${REMOTE_DIR}/sql/seed.sql"

# ── 6. deploy — the one password prompt (the server's sudo) ──────────────────
say "Deploying on the server"
ssh -t "$SSH_DEST" "chmod +x '${REMOTE_DIR}/update.sh' && sudo '${REMOTE_DIR}/update.sh' '${VERSION}'" \
  || fail "the remote update failed — see the output above. The server rolled itself back."

# ── 7. copy the pre-deploy dump off the server ───────────────────────────────
say "Fetching the backup copy"
mkdir -p backups
rsync -a "${SSH_DEST}:${REMOTE_DIR}/backups/pre-${VERSION}-*.dump" backups/ \
  && echo "  saved to backups/" \
  || warn "could not fetch the backup copy — the deploy itself succeeded"

say "Released ${VERSION}"
