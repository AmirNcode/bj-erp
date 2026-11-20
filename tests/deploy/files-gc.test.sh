#!/usr/bin/env bash
# files-gc.sh with a fake `docker`: the DB answers come from files, the "app container" is a local dir.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/vol/tmp"
cat > "$W/bin/docker" <<'FAKE'
#!/usr/bin/env bash
args="$*"
case "$args" in
  *"sales_files_gc"*) [ -f "$W/gc.fail" ] && exit 1; cat "$W/gc.out" ;;
  *"sales_file_ids"*) [ -f "$W/ids.fail" ] && exit 1; cat "$W/ids.out" ;;
  *" sh -c "*) while [ "$1" != "sh" ]; do shift; done; FILES_DIR="$W/vol" exec "$@" ;;
  *) echo "unexpected docker $args" >&2; exit 9 ;;
esac
FAKE
chmod +x "$W/bin/docker"
export W PATH="$W/bin:$PATH" POSTGRES_PASSWORD=x BJ_COMPOSE_ROOT="$ROOT/deploy" BJ_COMPOSE_OVERLAY="$ROOT/deploy/docker-compose.liara.yml"
C=11111111-1111-1111-1111-111111111111; R=22222222-2222-2222-2222-222222222222
A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa; B=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb; P=cccccccc-cccc-cccc-cccc-cccccccccccc
old() { node -e 'const t=Date.now()/1000-3*86400;require("fs").utimesSync(process.argv[1],t,t)' "$1"; }
seed() {
  rm -rf "$W/vol"; mkdir -p "$W/vol/tmp" "$W/vol/$C/$R"
  for f in $A $B $P; do echo d > "$W/vol/$C/$R/$f"; old "$W/vol/$C/$R/$f"; done
  echo t > "$W/vol/tmp/stale"; old "$W/vol/tmp/stale"; echo t > "$W/vol/tmp/fresh"
  echo d > "$W/vol/$C/$R/dddddddd-dddd-dddd-dddd-dddddddddddd"   # orphan but fresh
  rm -f "$W"/*.fail
  printf '%s/%s/%s\n' $C $R $P > "$W/gc.out"
  printf '%s\n%s\n' $A $B > "$W/ids.out"
}
run() { bash "$ROOT/deploy/lib/files-gc.sh" 2>&1; }
ex() { [ -e "$W/vol/$1" ]; }

seed; run >/dev/null
ex $C/$R/$A && ex $C/$R/$B || { echo "FAIL: known files removed"; exit 1; }
! ex $C/$R/$P || { echo "FAIL: stale pending file kept"; exit 1; }
! ex tmp/stale && ex tmp/fresh || { echo "FAIL: tmp clean-up"; exit 1; }
ex $C/$R/dddddddd-dddd-dddd-dddd-dddddddddddd || { echo "FAIL: fresh file removed"; exit 1; }
echo "ok - stale row bytes and tmp removed, known and fresh files kept"

seed; : > "$W/gc.out"; printf '%s\n' $A $B > "$W/ids.out"; old "$W/vol/$C/$R/$P"
run >/dev/null
! ex $C/$R/$P || { echo "FAIL: orphan kept"; exit 1; }
ex $C/$R/$A || { echo "FAIL: known orphan-swept"; exit 1; }
echo "ok - orphan older than a day removed"

seed; : > "$W/gc.out"; : > "$W/ids.out"
out=$(run); ex $C/$R/$A && ex $C/$R/$B && ex $C/$R/$P || { echo "FAIL: empty id list wiped files"; exit 1; }
echo "$out" | grep -q "no file ids" || { echo "FAIL: no log for empty ids"; exit 1; }
echo "ok - empty id list: nothing deleted"

seed; : > "$W/gc.out"; touch "$W/ids.fail"
run >/dev/null; ex $C/$R/$A && ex $C/$R/$B && ex $C/$R/$P || { echo "FAIL: failed query wiped files"; exit 1; }
echo "ok - failed id query: nothing deleted"
