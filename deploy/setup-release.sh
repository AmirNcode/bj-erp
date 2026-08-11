#!/usr/bin/env bash
# =============================================================================
# deploy/setup-release.sh — ONE-TIME setup on the developer's Mac.
#
#   ./deploy/setup-release.sh
#
# Creates an SSH key for deployments, installs it on the server, and adds a
# `bj` host alias with connection multiplexing so that deploy/release.sh runs
# without a single SSH password prompt.
#
# You will be asked for the SERVER's login password once (by ssh-copy-id) —
# that is the last time. The Mac reaches the public SSH endpoint directly;
# the client VPN is only needed on a phone/browser for the private app URL.
#
# Safe to re-run: existing key and config block are reused, not duplicated.
# =============================================================================
set -euo pipefail

SERVER_HOST="${BJ_SERVER_HOST:-5.201.190.184}"
SERVER_PORT="${BJ_SERVER_PORT:-2222}"
SERVER_USER="${BJ_SERVER_USER:-behsazan}"
KEY=~/.ssh/bj_deploy

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

say "1/4  SSH key"
if [ -f "$KEY" ]; then
  echo "  already exists: ${KEY}"
else
  ssh-keygen -t ed25519 -f "$KEY" -N '' -C 'bj-erp release pipeline'
  echo "  created: ${KEY}"
fi

say "2/4  Host alias 'bj' in ~/.ssh/config"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if grep -qE '^Host bj$' ~/.ssh/config 2>/dev/null; then
  echo "  already present"
else
  cat >> ~/.ssh/config <<EOF

Host bj
  HostName ${SERVER_HOST}
  Port ${SERVER_PORT}
  User ${SERVER_USER}
  IdentityFile ${KEY}
  IdentitiesOnly yes
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h-%p
  ControlPersist 10m
EOF
  chmod 600 ~/.ssh/config
  echo "  added"
fi

say "3/4  Installing the key on the server"
echo "  You will be asked for the SERVER password (${SERVER_USER}@${SERVER_HOST}) — the last time."
if ssh -o BatchMode=yes -o ConnectTimeout=10 bj true 2>/dev/null; then
  echo "  key already works — skipping"
else
  ssh-copy-id -i "${KEY}.pub" -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" \
    || fail "ssh-copy-id failed — verify the public host/port and server password"
fi

say "4/4  Verifying"
ssh -o BatchMode=yes bj 'echo "  connected to $(hostname) as $(whoami)"' \
  || fail "key authentication still not working"

cat <<EOF

=============================================================
 Setup complete. Deploy with:

   ./deploy/release.sh

 Full instructions: docs/DEPLOY-GUIDE.md
=============================================================
EOF
