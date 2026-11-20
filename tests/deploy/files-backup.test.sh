#!/usr/bin/env bash
# backup-files.sh in a throwaway alpine container (host rsync flavour does not matter).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CASE_DIR=$(mktemp -d)
trap 'rm -rf "$CASE_DIR"' EXIT
cat > "$CASE_DIR/inner.sh" <<'INNER'
set -eu
S=/work/src M=/work/mirror D=/work/deleted
BK="bash /scripts/backup-files.sh $S $M $D"
mkdir -p $S/c/r $S/tmp
echo one > $S/c/r/f1; echo two > $S/c/r/f2; echo x > $S/tmp/x
$BK
[ "$(cat $M/c/r/f1)" = one ] || { echo "FAIL: f1 not mirrored"; exit 1; }
[ ! -e $M/tmp/x ] || { echo "FAIL: tmp mirrored"; exit 1; }
echo "ok - new files reach the mirror, tmp/ excluded"
rm $S/c/r/f1
mkdir -p $D/old31 $D/old29
touch -d "@$(( $(date +%s) - 31*86400 ))" $D/old31
touch -d "@$(( $(date +%s) - 29*86400 ))" $D/old29
$BK
[ ! -e $M/c/r/f1 ] || { echo "FAIL: f1 still in mirror"; exit 1; }
[ "$(cat $D/$(date -u +%Y-%m-%d)/c/r/f1)" = one ] || { echo "FAIL: f1 not kept in deleted/"; exit 1; }
[ -e $M/c/r/f2 ] || { echo "FAIL: f2 lost"; exit 1; }
echo "ok - removed file moves to deleted/<date>/"
[ ! -e $D/old31 ] || { echo "FAIL: 31-day dir kept"; exit 1; }
[ -e $D/old29 ] || { echo "FAIL: 29-day dir pruned"; exit 1; }
echo "ok - deleted/ pruned at 30 days"
INNER
docker run --rm -v "$ROOT/deploy/liara:/scripts:ro" -v "$CASE_DIR:/t:ro" alpine:3.20 \
  sh -c 'apk add --no-cache rsync bash >/dev/null && mkdir -p /work && bash /t/inner.sh'
