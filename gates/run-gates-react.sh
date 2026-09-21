#!/usr/bin/env bash
# =============================================================================
# run-gates-react.sh — the R- gate suite for the NEW React/FastAPI stack.
#
# edu-replatform Phase 03, checklist E0b. SECOND frozen vector, ADDITIVE (Decision 7).
#
# ⛔ THIS SCRIPT NEVER TOUCHES run-gates.sh's 49. The legacy gate.mjs/gate-q.mjs/gate-a.mjs
#    keep running against :8791 and the frozen aws-quiz-app/** at 49 FOREVER. New gates go in
#    new R--prefixed files and are asserted SEPARATELY — the pattern run-gates.sh's own header
#    already states, and the pattern gate-b456.mjs / gate-self.mjs already follow.
#
# PORTS — READ THIS BEFORE CHANGING ANYTHING (execute instruction E10)
#   8795  <- THIS SCRIPT'S LOCAL PREVIEW. Declared here, owned here, killed here.
#   8791     run-gates.sh's legacy smoke harness.      DO NOT TOUCH.
#   8793     a stray legacy harness (pid 440643).      DO NOT TOUCH.
#   18792/3  scratch uvicorns from a PVL probe.        DO NOT TOUCH.
#   8792     the REMOTE service on 192.168.100.66.     Used for curls ONLY, never started here.
#
#   ⚠ run-gates.sh's start-of-run cleanup is PORT-SCOPED: it kills any edu_server.py on ITS
#     port. Two runners sharing a port therefore kill each other's servers mid-suite. That is
#     why this script pins its OWN port, and why it CLEANS UP AFTER ITSELF rather than relying
#     on the next run to do it.
#
#   ⚠ run-gates.sh LEAKS ITS HARNESS ON EXIT — measured 21-09-26. It exits 0 with the server
#     still listening, and because the leaked child keeps the pipe open, a caller that pipes
#     its output (`| tail`) never sees EOF and appears to hang for as long as the server lives.
#     The trap below is the fix. It is not optional.
#
#   ⚠ DO NOT TRUST A HARNESS PIDFILE. run-gates.sh writes `$!` from inside a subshell and
#     recorded the SCRIPT's own pid (483129), not python3's (483130) — measured 21-09-26. A
#     trap built on that pidfile would kill the runner instead of the server. This script
#     resolves the pid BY PORT with `ss`, every time.
#
# RULES INHERITED VERBATIM FROM run-gates.sh (do not "simplify" these away):
#   * ./node_modules/.bin/playwright, NEVER npx — npx fetches from the registry when the
#     package is absent, which breaks the offline story on the customer-facing machine.
#   * /var/tmp only. NEVER /tmp or /dev/shm: they are tmpfs (RAM) on the work PC.
#   * The counting regex is '^(PASS|FAIL)  ' with TWO trailing spaces. The one-space form also
#     matches the 'FAILED: ...' summary line and over-counts a red run.
#   * No `rsync --delete` at the $SMOKE_DIR ROOT. lib/ is ~101 MB, exists only here and on nn,
#     and CANNOT be regenerated. A naive --delete took the legacy suite from 49 result lines
#     to 0 on 21-09-26.
#   * The lib/ guard refuses to start without the real books — the gates measure REAL
#     equations from the real modules; a stub will not do.
#   * gate-r-self.mjs runs LAST: it parses the transcripts the runs above produced.
# =============================================================================
set -uo pipefail

GATES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$GATES_DIR/.." && pwd)"
BACKEND_DIR="$REPO_DIR/app/backend"
FRONTEND_DIST="$REPO_DIR/app/frontend/dist"

SMOKE_DIR="${R_SMOKE_DIR:-/var/tmp/edu-smoke}"          # shared: lib/ lives here
REACT_DIR="${R_REACT_DIR:-/var/tmp/edu-react-smoke}"    # this suite's own web root
OUT_DIR="${R_OUT_DIR:-/var/tmp/p3-react}"
PORT="${R_PORT:-8795}"                                   # ⛔ THIS SCRIPT'S OWN PORT — see above
export R_BASE="${R_BASE:-http://127.0.0.1:${PORT}}"
export R_REMOTE="${R_REMOTE:-http://192.168.100.66:8792}"
export R_LIB_ROOT="$SMOKE_DIR/lib"
export R_MODULE="${R_MODULE:-geron-homl3}"
export R_REPORT_MODULE="${R_REPORT_MODULE:-demo-book}"
PYBIN="${R_PYBIN:-/var/tmp/edu-study-testvenv/bin/python3}"

case "$SMOKE_DIR$OUT_DIR$REACT_DIR" in /tmp/*|*/dev/shm/*) echo "REFUSING: tmpfs path (RAM). Use /var/tmp." >&2; exit 2;; esac
mkdir -p "$OUT_DIR"

# --- the cleanup this suite's ancestor did not have -------------------------
# Resolves BY PORT, never from a pidfile, and only ever kills a uvicorn/python we started.
kill_on_port () {
  local port="$1" p
  for p in $(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
    if ps -o args= -p "$p" 2>/dev/null | grep -qE 'uvicorn|edu_server\.py'; then kill "$p" 2>/dev/null || true; fi
  done
}
cleanup () { kill_on_port "$PORT"; }
trap cleanup EXIT INT TERM

# --- harness state ----------------------------------------------------------
if [ ! -f "$SMOKE_DIR/lib/$R_MODULE/module.json" ]; then
  cat >&2 <<MSG
REFUSING TO RUN: the book library is missing at \$SMOKE_DIR/lib/.
  The gates measure REAL content from the real modules; a stub will not do.
  Restore it (read-only, no service is touched):
    rsync -a nn:'~/foxai-data/edu-argumentation/library/geron-homl3/'                  $SMOKE_DIR/lib/geron-homl3/
    rsync -a nn:'~/foxai-data/edu-argumentation/library/openintro-statistics-2019-1045f2f5/' $SMOKE_DIR/lib/demo-book/
MSG
  exit 2
fi

if [ ! -f "$FRONTEND_DIST/index.html" ]; then
  echo "REFUSING TO RUN: no React build at $FRONTEND_DIST/index.html (Step A has not landed)." >&2
  echo "  Build it on THIS workstation and ship the artifact. NEVER build on nn: swap there has" >&2
  echo "  been measured at 0-12 MB free and an OOM takes a JVM with it." >&2
  exit 2
fi

# Frontend only, and NO --delete at the REACT_DIR root — same fence as run-gates.sh.
echo "== react harness re-sync (frontend only): $FRONTEND_DIST -> $REACT_DIR/web =="
mkdir -p "$REACT_DIR/web" "$REACT_DIR/stores"
rsync -a "$FRONTEND_DIST"/index.html "$REACT_DIR"/web/
rsync -a --delete "$FRONTEND_DIST"/assets/ "$REACT_DIR"/web/assets/
[ -f "$REACT_DIR/stores/settings.json" ] || printf '{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n' > "$REACT_DIR/stores/settings.json"
# ⛔ The suite's OWN progress store, never the user's. Phase 03 is read-only, but pointing a
# gate run at ~/foxai-data/ would put a live study file one bug away from a write.
[ -f "$REACT_DIR/stores/progress.json" ] || echo '{"version":2,"modules":{}}' > "$REACT_DIR/stores/progress.json"

# --- local preview ----------------------------------------------------------
echo "== starting the LOCAL :$PORT preview (uvicorn, HTTP/1.1) =="
kill_on_port "$PORT"; sleep 1
[ -x "$PYBIN" ] || { echo "MISSING $PYBIN — create it: python3 -m venv /var/tmp/edu-study-testvenv && /var/tmp/edu-study-testvenv/bin/pip install -r $BACKEND_DIR/requirements.txt"; exit 2; }
( cd "$BACKEND_DIR" && \
  EDU_LIBRARY_ROOT="$SMOKE_DIR/lib" \
  EDU_ASSET_ROOT="$SMOKE_DIR/assets" \
  EDU_PROGRESS_PATH="$REACT_DIR/stores/progress.json" \
  EDU_SETTINGS_PATH="$REACT_DIR/stores/settings.json" \
  EDU_LIBRARY_META_PATH="$REACT_DIR/stores/library-meta.json" \
  EDU_BOOK_ROOT="$REACT_DIR/stores/books" \
  EDU_ENV_PATH="$REACT_DIR/stores/provider.env" \
  nohup "$PYBIN" -m uvicorn main:app --host 127.0.0.1 --port "$PORT" \
    > "$OUT_DIR/harness-$PORT.log" 2>&1 & )
for _ in $(seq 1 40); do curl -sf -o /dev/null "$R_BASE/api/health" && break; sleep 0.25; done
curl -sf -o /dev/null "$R_BASE/api/health" || { echo "LOCAL PREVIEW DID NOT COME UP on $R_BASE"; tail -20 "$OUT_DIR/harness-$PORT.log"; exit 2; }
echo "   preview up: $R_BASE (pid $(ss -ltnpH "sport = :$PORT" | grep -oP 'pid=\K[0-9]+' | head -1))"

PW="$GATES_DIR/node_modules/.bin/playwright"   # never npx
[ -x "$PW" ] || echo "   note: $PW absent — browser-backed R- gates will refuse; curl gates still run"

RC=0
declare -A COUNT EXITC

run_suite () {   # $1 = suite file, $2 = transcript basename, $3 = expected result-line count
  local f="$1" tag="$2" want="$3" t="$OUT_DIR/$2.txt" c e
  echo "== $f =="
  ( cd "$GATES_DIR" && node "$f" ) > "$t" 2>&1; e=$?
  c=$(grep -cE '^(PASS|FAIL)  ' "$t" || true)     # TWO trailing spaces
  COUNT[$tag]=$c; EXITC[$tag]=$e
  if [ "$e" -ne 0 ]; then echo "   EXIT $e  <-- FAIL"; RC=1; else echo "   exit 0"; fi
  if [ "$c" -ne "$want" ]; then echo "   result lines $c, expected $want  <-- FAIL"; RC=1; else echo "   result lines $c/$want"; fi
  grep -E '^FAIL  ' "$t" || true
}

# Registered explicitly with an expected count each — a suite discovered by glob with an
# inferred count is how a shrinking gate file passes unnoticed. Step E2 adds its files here.
RTOTAL=0
for spec in \
  "gate-r-sep.mjs:rsep:${R_SEP_COUNT:-6}" \
  "gate-r-read.mjs:rread:${R_READ_COUNT:-12}" \
  ; do
  f="${spec%%:*}"; rest="${spec#*:}"; tag="${rest%%:*}"; want="${rest#*:}"
  if [ -f "$GATES_DIR/$f" ]; then run_suite "$f" "$tag" "$want"; RTOTAL=$(( RTOTAL + ${COUNT[$tag]} )); fi
done

# gate-r-self.mjs parses the transcripts above, so it MUST run last.
if [ -f "$GATES_DIR/gate-r-self.mjs" ]; then
  run_suite gate-r-self.mjs rself "${R_SELF_COUNT:-6}"; RTOTAL=$(( RTOTAL + ${COUNT[rself]} ))
fi

echo
echo "===================== R- SUMMARY ====================="
echo " R- vector     : $RTOTAL"
echo " transcripts   : $OUT_DIR/{rsep,rread,rself}.txt"
echo " local preview : $R_BASE    remote: $R_REMOTE"
[ "$RC" -eq 0 ] && echo " RESULT        : ALL GREEN" || echo " RESULT        : FAILED"
echo "======================================================"

# E10: prove the cleanup actually happened. Asserted BEFORE exit, so a leaked server is a
# RED RUN rather than something the next run silently inherits.
cleanup; sleep 1
LEFT=$(ss -ltnH "sport = :$PORT" 2>/dev/null | wc -l)
if [ "$LEFT" -ne 0 ]; then
  echo " <-- FAIL: a server is STILL listening on :$PORT after cleanup"; RC=1
else
  echo " cleanup verified: nothing listening on :$PORT"
fi
exit $RC
