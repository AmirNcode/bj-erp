#!/usr/bin/env bash
# Offsite copy of the Liara VM's daily database dumps, pulled to this Mac.
#
#   bash deploy/liara/pull-backups-to-mac.sh             pull now
#   bash deploy/liara/pull-backups-to-mac.sh install     daily launchd job (09:00 and at login)
#   bash deploy/liara/pull-backups-to-mac.sh status      job state, newest copies, log tail
#   bash deploy/liara/pull-backups-to-mac.sh uninstall   remove the job (keeps the copies)
#
# Copies only dumps it does not have yet, verifies each against the VM's sha256,
# and keeps them KEEP_DAYS days (never fewer than the newest 14). It also warns, by
# macOS notification, when the newest dump is older than 36 hours (the VM timer or
# this job stopped) or the VM disk is over 85% full.
#
# The dumps hold personnel data and password hashes. Keep the folder on an encrypted
# disk (FileVault) and out of synced folders (iCloud Drive, Dropbox). Restoring one:
# docs/DEPLOY-LIARA.md, "Backups, credentials and operations".
set -Eeuo pipefail
umask 077

HOST="${BJ_BACKUP_HOST:-liara-bj-vm}" # ~/.ssh/config alias, key without passphrase
REMOTE_DIR=/var/backups/bj-erp
DEST="${BJ_BACKUP_DIR:-$HOME/Backups/bj-erp}"
KEEP_DAYS="${BJ_BACKUP_KEEP_DAYS:-90}"
KEEP_MIN=14
STALE_HOURS=36
DISK_WARN_PERCENT=85

LABEL=app.bjeng.backup-pull
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALLED="$HOME/Library/Application Support/bj-erp/pull-backups-to-mac.sh"
LOG="$DEST/pull.log"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15
  -o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-bj-backup-%C" -o ControlPersist=30)

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG" >&2; }
notify() {
  # Fixed messages only: they are pasted into AppleScript.
  osascript -e "display notification \"$1\" with title \"bj-erp backup\"" >/dev/null 2>&1 || true
}
remote() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }

pull() {
  mkdir -p "$DEST"
  chmod 700 "$DEST"
  trap 'log "FAILED at line $LINENO"; notify "Pulling the database backup failed. See pull.log."' ERR

  local names name expected actual copied=0
  names="$(remote "cd $REMOTE_DIR && ls -1 daily-*.dump")"
  for name in $names; do
    [[ $name =~ ^daily-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || continue
    [ -f "$DEST/$name" ] && continue
    expected="$(remote "cat $REMOTE_DIR/$name.sha256" | awk '{print $1}')"
    scp -q -p "${SSH_OPTS[@]}" "$HOST:$REMOTE_DIR/$name" "$DEST/$name.partial"
    actual="$(shasum -a 256 "$DEST/$name.partial" | awk '{print $1}')"
    if [ "$actual" != "$expected" ]; then
      rm -f "$DEST/$name.partial"
      log "checksum mismatch for $name"
      false
    fi
    mv "$DEST/$name.partial" "$DEST/$name"
    printf '%s  %s\n' "$expected" "$name" > "$DEST/$name.sha256"
    copied=$((copied + 1))
  done

  # Retention: drop copies older than KEEP_DAYS, but never the newest KEEP_MIN, so
  # a long run of failed pulls cannot age every copy away.
  local dumps=() i
  while IFS= read -r name; do dumps+=("$name"); done \
    < <(cd "$DEST" && ls -1 daily-*.dump 2>/dev/null | sort -r)
  for ((i = KEEP_MIN; i < ${#dumps[@]}; i++)); do
    if [ -n "$(find "$DEST/${dumps[$i]}" -mtime +"$KEEP_DAYS")" ]; then
      rm -f "$DEST/${dumps[$i]}" "$DEST/${dumps[$i]}.sha256"
      log "pruned ${dumps[$i]}"
    fi
  done

  local newest stamp age_hours disk
  newest="${dumps[0]:-}"
  if [ -z "$newest" ]; then
    log "no dumps on this Mac"
    notify "No database backups have been copied to this Mac."
  else
    stamp="${newest#daily-}"
    stamp="${stamp%.dump}"
    age_hours=$(( ($(date -u +%s) - $(date -j -u -f '%Y%m%dT%H%M%SZ' "$stamp" +%s)) / 3600 ))
    if [ "$age_hours" -gt "$STALE_HOURS" ]; then
      log "newest dump $newest is ${age_hours}h old"
      notify "The newest database backup is over $STALE_HOURS hours old."
    fi
  fi

  disk="$(remote "df -P $REMOTE_DIR | awk 'NR==2 {print \$5}'" | tr -d '%')"
  if [ "$disk" -ge "$DISK_WARN_PERCENT" ]; then
    log "VM disk ${disk}% full"
    notify "The server disk is over $DISK_WARN_PERCENT% full."
  fi

  log "ok: copied $copied, newest ${newest:-none}, VM disk ${disk}%"
  date '+%Y-%m-%d %H:%M:%S' > "$DEST/last-success"
}

install_agent() {
  mkdir -p "$(dirname "$INSTALLED")" "$(dirname "$PLIST")" "$DEST"
  chmod 700 "$DEST"
  cp "${BASH_SOURCE[0]}" "$INSTALLED"
  chmod 700 "$INSTALLED"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$INSTALLED</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>BJ_BACKUP_HOST</key><string>$HOST</string>
    <key>BJ_BACKUP_DIR</key><string>$DEST</string>
    <key>BJ_BACKUP_KEEP_DAYS</key><string>$KEEP_DAYS</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DEST/launchd.log</string>
  <key>StandardErrorPath</key><string>$DEST/launchd.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed $LABEL: daily at 09:00 and at login, copies in $DEST"
}

uninstall_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$INSTALLED"
  echo "removed $LABEL; copies kept in $DEST"
}

status() {
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E '^\s*(state|last exit code|runs)' \
    || echo "$LABEL is not installed"
  echo "last success: $(cat "$DEST/last-success" 2>/dev/null || echo never)"
  (cd "$DEST" 2>/dev/null && ls -1 daily-*.dump 2>/dev/null | sort -r | head -3) || true
  tail -5 "$LOG" 2>/dev/null || true
}

case "${1:-pull}" in
  pull) pull ;;
  install) install_agent ;;
  uninstall) uninstall_agent ;;
  status) status ;;
  *) echo "usage: $0 [pull|install|uninstall|status]" >&2; exit 2 ;;
esac
