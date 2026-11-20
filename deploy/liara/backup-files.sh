#!/usr/bin/env bash
# Mirror the Sales files volume: backup-files.sh <src_dir> <mirror_dir> <deleted_root>
#
# One incremental rsync mirror (files are write-once by id, so each run copies only new ones).
# A file that vanished from <src_dir> is moved, not dropped, into <deleted_root>/<UTC date>/ and
# pruned after 30 days. <src_dir>/tmp (in-flight uploads) is never mirrored.
set -euo pipefail
umask 077
[ "$#" -eq 3 ] || { echo "usage: $0 <src_dir> <mirror_dir> <deleted_root>" >&2; exit 2; }
SRC="$1" MIRROR="$2" DELETED="$3"
KEEP_DAYS=30
command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync is not installed (apt install rsync)" >&2; exit 1; }
[ -d "$SRC" ] || { echo "ERROR: source directory missing: $SRC" >&2; exit 1; }
mkdir -p "$MIRROR" "$DELETED"
STAMP="$(date -u +%Y-%m-%d)"
rsync -a --delete --exclude '/tmp/' --backup --backup-dir="$DELETED/$STAMP" "$SRC/" "$MIRROR/"
# Prune day folders older than KEEP_DAYS (name is a date; mtime is when it was last written).
find "$DELETED" -mindepth 1 -maxdepth 1 -type d -mtime +"$((KEEP_DAYS - 1))" -exec rm -rf {} +
