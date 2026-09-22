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
export R_DIST="${R_DIST:-$FRONTEND_DIST}"
export R_PROGRESS_PATH="${R_PROGRESS_PATH:-$REACT_DIR/stores/progress.json}"
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

# ⛔⛔ THE STAGE MIRRORS THE DEPLOYED LAYOUT, AND THAT IS NOT COSMETIC.
#    main.py:63 resolves the SPA as `Path(__file__).parent.parent / "web"` — i.e. web/ must be
#    a SIBLING of backend/. deploy-study.sh:130 creates exactly that (`<dir>/backend` +
#    `<dir>/web`). There is NO env override and there must not be one: the :8792 unit pins
#    SEVEN EDU_* variables and Phase-02 exit gate G8 asserts that count, so an eighth is a
#    gate failure, not a convenience.
#    ⚠ UNTIL 22-09-26 THIS SCRIPT SYNCED ONLY web/ AND RAN uvicorn FROM THE REPO, so
#      GET / returned **503 {"error":"SPA bundle is not deployed"}** for the whole suite's
#      life. Nothing caught it because every R- gate was curl-only. The browser-backed gates
#      added in E2 (gate-r-contract / gate-r-dom / gate-r-ro) would have measured an empty
#      page and read GREEN on a dead server.
# NO --delete at the STAGE root — same fence as run-gates.sh.
STAGE="$REACT_DIR/app"
echo "== react harness re-sync (backend + frontend, deployed layout): -> $STAGE =="
mkdir -p "$STAGE/backend" "$STAGE/web" "$REACT_DIR/stores"
rsync -a --exclude '__pycache__' --exclude '*.pyc' "$BACKEND_DIR"/ "$STAGE"/backend/
rsync -a "$FRONTEND_DIST"/index.html "$STAGE"/web/
rsync -a --delete "$FRONTEND_DIST"/assets/ "$STAGE"/web/assets/
[ -f "$REACT_DIR/stores/settings.json" ] || printf '{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n' > "$REACT_DIR/stores/settings.json"
# ⛔ The suite's OWN progress store, never the user's. Phase 03 is read-only, but pointing a
# gate run at ~/foxai-data/ would put a live study file one bug away from a write.
[ -f "$REACT_DIR/stores/progress.json" ] || echo '{"version":2,"modules":{}}' > "$REACT_DIR/stores/progress.json"

# --- local preview ----------------------------------------------------------
echo "== starting the LOCAL :$PORT preview (uvicorn, HTTP/1.1) =="
kill_on_port "$PORT"; sleep 1
[ -x "$PYBIN" ] || { echo "MISSING $PYBIN — create it: python3 -m venv /var/tmp/edu-study-testvenv && /var/tmp/edu-study-testvenv/bin/pip install -r $BACKEND_DIR/requirements.txt"; exit 2; }
( cd "$STAGE/backend" && \
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
# ⛔ /api/health 200 is NOT enough. It answered 200 for months while GET / returned 503 and
#    the SPA was never served. The browser gates need the DOCUMENT.
SPA_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$R_BASE/")
[ "$SPA_CODE" = "200" ] || { echo "SPA DOCUMENT NOT SERVED: GET $R_BASE/ -> $SPA_CODE"; curl -s "$R_BASE/" | head -3; exit 2; }
echo "   SPA document: GET / -> 200"
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
#
# ⚑ gate-r-journey.mjs ADDED 22-09-26 (EVL fix 004). It is the first gate in this suite that
#   runs a WHOLE USER JOURNEY rather than sampling a surface. D-10 — the quiz having no
#   ending at all — passed 54 green gates because NOT ONE of them finished a quiz, which is
#   the same blind spot that hid D-1 (no gate scrolled) and D-8 (no gate clicked nav twice).
#   ⛔ Its row in gate-r-self.mjs's RS-COUNT table moves WITH this line, always.
#
# ⚑ rjourney 4 -> 6 on 22-09-26 (EVL fix 005): R-J5 (an unanswered option card carries NO
#   explanation text in the DOM — D-11, the answer leaking before the learner answers) and
#   R-J6 (EVERY option resolves, with its label, colour and opacity-50 — D-12). Both were
#   found BY EYE in a screenshot while 59 gates were green, and R-B1 — the gate that measures
#   this exact element — is structurally blind to the first because its band is the PADDING.
#
# ⛑ THREE SUITES ADDED 22-09-26 (item A / D / E supplement). Each closes a row that was
#   NAMED BY THE EXIT GATE AND HAD NO COMMAND, which is the same hole as G-EVL-4:
#   · gate-r-theme.mjs   — ITEM A. The Tailwind CDN is gone and the BUILD carries the theme.
#       Measured before it: the built CSS held 0 of 10 theme class strings and no utility at
#       all, while the app looked right because a public CDN compiled them in the browser.
#       ⛔ R-THEME6 reads the REQUEST LOG, not the document: a grep cannot see a script
#         injected at runtime.
#   · gate-r-modal.mjs   — ITEM E. The quiz-setup picker has an obvious way out, AND the two
#       fences that a later "make the nav reachable" change must not break (D-8's
#       #primary-nav, B6/B6b's #action-container containment).
#   · gate-r6-placement.mjs — ITEM D. Ruling R6's FOUR-CONDITION placement test. The Exit
#       Gate had named this command since the phase began and IT DID NOT EXIST, so the row was
#       unverified while reading as gated. ⛔ The ruling's FIRST wording is void — it reported
#       checked=326 failures=0 GREEN on the UNFIXED file.
#   ⛔ Their rows in gate-r-self.mjs's RS-COUNT table move WITH these lines, always.
RTOTAL=0
for spec in \
  "gate-r-sep.mjs:rsep:${R_SEP_COUNT:-6}" \
  "gate-r-read.mjs:rread:${R_READ_COUNT:-12}" \
  "gate-r-contract.mjs:rcontract:${R_CONTRACT_COUNT:-7}" \
  "gate-r-dom.mjs:rdom:${R_DOM_COUNT:-8}" \
  "gate-r-ro.mjs:rro:${R_RO_COUNT:-3}" \
  "gate-r-trap.mjs:rtrap:${R_TRAP_COUNT:-8}" \
  "gate-r-journey.mjs:rjourney:${R_JOURNEY_COUNT:-6}" \
  "gate-r-theme.mjs:rtheme:${R_THEME_COUNT:-6}" \
  "gate-r-modal.mjs:rmodal:${R_MODAL_COUNT:-5}" \
  "gate-r6-placement.mjs:rr6:${R_R6_COUNT:-3}" \
  ; do
  f="${spec%%:*}"; rest="${spec#*:}"; tag="${rest%%:*}"; want="${rest#*:}"
  if [ -f "$GATES_DIR/$f" ]; then run_suite "$f" "$tag" "$want"; RTOTAL=$(( RTOTAL + ${COUNT[$tag]} )); fi
done

# gate-r-self.mjs parses the transcripts above, so it MUST run last.
if [ -f "$GATES_DIR/gate-r-self.mjs" ]; then
  # 11 -> 14 on 22-09-26 (item A/D/E supplement): the RS-COUNT table gained rows for
  # gate-r-theme.mjs, gate-r-modal.mjs and gate-r6-placement.mjs. It was 11 after EVL
  # fix 004 added the gate-r-journey.mjs row.
  run_suite gate-r-self.mjs rself "${R_SELF_COUNT:-14}"; RTOTAL=$(( RTOTAL + ${COUNT[rself]} ))
fi

echo
echo "===================== R- SUMMARY ====================="
echo " R- vector     : $RTOTAL"
echo " transcripts   : $OUT_DIR/{rsep,rread,rcontract,rdom,rro,rtrap,rjourney,rtheme,rmodal,rr6,rself}.txt"
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
