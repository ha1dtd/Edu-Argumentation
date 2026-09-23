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

case "$SMOKE_DIR$OUT_DIR$REACT_DIR${R_WRITE_DIR:-/var/tmp/edu-write-harness}" in /tmp/*|*/dev/shm/*) echo "REFUSING: tmpfs path (RAM). Use /var/tmp." >&2; exit 2;; esac
mkdir -p "$OUT_DIR"

# --- the cleanup this suite's ancestor did not have -------------------------
# Resolves BY PORT, never from a pidfile, and only ever kills a uvicorn/python we started.
kill_on_port () {
  local port="$1" p
  for p in $(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
    if ps -o args= -p "$p" 2>/dev/null | grep -qE 'uvicorn|edu_server\.py'; then kill "$p" 2>/dev/null || true; fi
  done
}
# ⚑ Phase 04: the WRITE harness — a second uvicorn with its own stores and the stub upstream.
WPORT="${R_WRITE_PORT:-8796}"          # ⛔ THIS SCRIPT'S write-harness port
SPORT="${R_STUB_PORT:-8797}"           # ⛔ the stub provider + runner (gates/stubs/stub-upstream.py)
WDIR="${R_WRITE_DIR:-/var/tmp/edu-write-harness}"
export R_WRITE_BASE="http://127.0.0.1:${WPORT}"
export R_WRITE_STORES="$WDIR/stores"
export R_STUB_LOG="$WDIR/stub.log"
kill_stub () {
  local p
  for p in $(ss -ltnpH "sport = :$SPORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
    if ps -o args= -p "$p" 2>/dev/null | grep -q 'stub-upstream\.py'; then kill "$p" 2>/dev/null || true; fi
  done
}
# ⚑ PHASE 06a — THE GATE DATABASE. Every page and API route now needs a session (ruling R25), and
#   progress/accounts/wrong answers live in PostgreSQL. The harness therefore talks to an ISOLATED
#   database, `edu_study_gate` (own role, on nn:5432), through an SSH tunnel — the workstation has no
#   PostgreSQL server. ⛔ NEVER `edu_study`: the env file is checked for the gate name before use.
GATE_DB_ENV="${R_GATE_DB_ENV:-$HOME/.config/foxai/edu-study-gate-db.env}"
TUNNEL_STARTED=0
GATE_DB_PORT=""
kill_tunnel () {
  [ "$TUNNEL_STARTED" = 1 ] || return 0
  local p
  for p in $(ss -ltnpH "sport = :$GATE_DB_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
    if ps -o args= -p "$p" 2>/dev/null | grep -q '^ssh .*-L'; then kill "$p" 2>/dev/null || true; fi
  done
}
cleanup () { kill_on_port "$PORT"; kill_on_port "$WPORT"; kill_on_port "${R_LEGACY_ROUTE_PORT:-8798}"; kill_stub; kill_tunnel; declare -F revoke_remote >/dev/null && revoke_remote; }
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

# --- the gate database (Phase 06a) --------------------------------------------
[ -f "$GATE_DB_ENV" ] || { echo "REFUSING: no gate DB env at $GATE_DB_ENV (see the Phase 06a report for how it is made)"; exit 2; }
grep -qx 'EDU_DB_NAME=edu_study_gate' "$GATE_DB_ENV" || { echo "REFUSING: $GATE_DB_ENV does not point at edu_study_gate"; exit 2; }
GATE_DB_PORT="$(grep '^EDU_DB_PORT=' "$GATE_DB_ENV" | cut -d= -f2)"
if ! ss -ltnH "sport = :$GATE_DB_PORT" 2>/dev/null | grep -q .; then
  ssh -f -N -o ExitOnForwardFailure=yes -L "127.0.0.1:${GATE_DB_PORT}:127.0.0.1:5432" nn \
    || { echo "REFUSING: could not open the SSH tunnel to nn:5432 on :$GATE_DB_PORT"; exit 2; }
  TUNNEL_STARTED=1
fi
gate_db () { ( cd "$STAGE/backend" && EDU_DB_ENV_PATH="$GATE_DB_ENV" "$PYBIN" "$@" ); }
echo "== gate database: migrate, wipe, two throwaway accounts, one session =="
gate_db -m admin migrate --no-backup || { echo "GATE DB MIGRATE FAILED"; exit 2; }
gate_db -c "import db; db.execute('TRUNCATE accounts, sessions, progress, attempts, wrong_answers RESTART IDENTITY CASCADE')" || exit 2
export R_GATE_OWNER=gate-owner R_GATE_READER=gate-reader
R_GATE_OWNER_PW="$("$PYBIN" -c 'import secrets;print(secrets.token_urlsafe(18))')"
R_GATE_READER_PW="$("$PYBIN" -c 'import secrets;print(secrets.token_urlsafe(18))')"
export R_GATE_OWNER_PW R_GATE_READER_PW
printf '%s\n' "$R_GATE_OWNER_PW" | gate_db -m admin create-user --username "$R_GATE_OWNER" --display-name "Gate Owner" --owner >/dev/null || exit 2
printf '%s\n' "$R_GATE_READER_PW" | gate_db -m admin create-user --username "$R_GATE_READER" --display-name "Gate Reader" >/dev/null || exit 2
R_SESSION="$(gate_db -m admin mint-session --username "$R_GATE_OWNER" --ttl 7200)"
[ -n "$R_SESSION" ] || { echo "COULD NOT MINT A GATE SESSION"; exit 2; }
export R_SESSION
export R_GATE_DB_ENV="$GATE_DB_ENV" R_STAGE_BACKEND="$STAGE/backend" R_PYBIN="$PYBIN"
echo "   gate DB ready: accounts $R_GATE_OWNER (owner) + $R_GATE_READER; session minted (not printed)"

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
  EDU_DB_ENV_PATH="$GATE_DB_ENV" \
  nohup "$PYBIN" -m uvicorn main:app --host 127.0.0.1 --port "$PORT" \
    > "$OUT_DIR/harness-$PORT.log" 2>&1 & )
for _ in $(seq 1 40); do curl -sf -o /dev/null "$R_BASE/api/health" && break; sleep 0.25; done
curl -sf -o /dev/null "$R_BASE/api/health" || { echo "LOCAL PREVIEW DID NOT COME UP on $R_BASE"; tail -20 "$OUT_DIR/harness-$PORT.log"; exit 2; }
# ⛔ /api/health 200 is NOT enough. It answered 200 for months while GET / returned 503 and
#    the SPA was never served. The browser gates need the DOCUMENT.
# ⚑ Phase 06a: GET / needs a session. Checked BOTH ways: signed out it must redirect to sign-in,
#   signed in it must be the document.
SPA_CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: edu_session=$R_SESSION" "$R_BASE/")
[ "$SPA_CODE" = "200" ] || { echo "SPA DOCUMENT NOT SERVED: GET $R_BASE/ (signed in) -> $SPA_CODE"; curl -s "$R_BASE/" | head -3; exit 2; }
ANON_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$R_BASE/")
[ "$ANON_CODE" = "302" ] || { echo "SIGN-IN NOT ENFORCED: GET $R_BASE/ (signed out) -> $ANON_CODE"; exit 2; }
echo "   SPA document: GET / -> 200 signed in, 302 signed out"
echo "   preview up: $R_BASE (pid $(ss -ltnpH "sport = :$PORT" | grep -oP 'pid=\K[0-9]+' | head -1))"

PW="$GATES_DIR/node_modules/.bin/playwright"   # never npx
[ -x "$PW" ] || echo "   note: $PW absent — browser-backed R- gates will refuse; curl gates still run"

# --- the write harness (Phase 04) ------------------------------------------------
# ⛔ FRESH STORES EVERY RUN, under /var/tmp, never the user's. The credentials below are FAKE
#    and point at the loopback stub: no provider budget is spent, no real kernel runs.
#    progress.json is seeded in the LEGACY byte format (indent=2, sorted keys, newline) because
#    W-FORMAT asserts a probe write + reset restores the exact bytes.
start_write_harness () {
  kill_on_port "$WPORT"; kill_stub; sleep 1
  rm -rf "$WDIR"; mkdir -p "$WDIR/stores" "$WDIR/app/backend" "$WDIR/app/web"
  rsync -a --exclude '__pycache__' --exclude '*.pyc' "$BACKEND_DIR"/ "$WDIR/app/backend/"
  rsync -a "$FRONTEND_DIST"/ "$WDIR/app/web/"
  cat > "$WDIR/stores/provider.env" <<ENV
# Edu-Argumentation provider credentials.
# Written by the in-app Settings page. Mode 600. Never commit this file.
EDU_QUIZ_API_URL=http://127.0.0.1:${SPORT}/v1/chat/completions
EDU_QUIZ_API_KEY=fake-key-SECRETVALUE-for-gates
EDU_QUIZ_MODEL=edu-tutor
EDU_QUIZ_ACCESS_TOKEN=
EDU_QUIZ_JSON_MODE=true
EDU_RUNNER_URL=http://127.0.0.1:${SPORT}
EDU_RUNNER_KEY=fake-runner-RUNNERSECRET-for-gates
ENV
  printf '{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n' > "$WDIR/stores/settings.json"
  "$PYBIN" -c 'import json,sys; open(sys.argv[1],"w").write(json.dumps({"modules":{},"version":2},indent=2,sort_keys=True)+"\n")' "$WDIR/stores/progress.json"
  ( STUB_LOG="$WDIR/stub.log" STUB_PORT="$SPORT" nohup python3 "$GATES_DIR/stubs/stub-upstream.py" > "$OUT_DIR/stub-$SPORT.log" 2>&1 & )
  ( cd "$WDIR/app/backend" && \
    EDU_LIBRARY_ROOT="$SMOKE_DIR/lib" EDU_ASSET_ROOT="$SMOKE_DIR/assets" \
    EDU_PROGRESS_PATH="$WDIR/stores/progress.json" EDU_SETTINGS_PATH="$WDIR/stores/settings.json" \
    EDU_LIBRARY_META_PATH="$WDIR/stores/library-meta.json" EDU_BOOK_ROOT="$WDIR/stores/books" \
    EDU_ENV_PATH="$WDIR/stores/provider.env" EDU_DB_ENV_PATH="$GATE_DB_ENV" \
    nohup "$PYBIN" -m uvicorn main:app --host 127.0.0.1 --port "$WPORT" > "$OUT_DIR/harness-$WPORT.log" 2>&1 & )
  # ⚑ Phase 06a: "fresh stores" now includes the gate DB's progress/attempts/wrong answers (the
  #   accounts and the minted session survive, so the suites stay signed in).
  gate_db -c "import db; db.execute('TRUNCATE progress, attempts, wrong_answers RESTART IDENTITY')" || return 1
  for _ in $(seq 1 40); do curl -sf -o /dev/null "$R_WRITE_BASE/api/health" && break; sleep 0.25; done
  curl -sf -o /dev/null "$R_WRITE_BASE/api/health" || { echo "WRITE HARNESS DID NOT COME UP on $R_WRITE_BASE"; tail -20 "$OUT_DIR/harness-$WPORT.log"; return 1; }
  echo "   write harness up: $R_WRITE_BASE (stub :$SPORT, stores $WDIR/stores)"
}

RC=0
declare -A COUNT EXITC

run_suite () {   # $1 = suite file, $2 = transcript basename, $3 = expected result-line count
  local f="$1" tag="$2" want="$3" t="$OUT_DIR/$2.txt" c e
  echo "== $f =="
  # ⚑ Phase 06a: every suite runs signed in through lib/auth-preload.mjs (R_SESSION), except a suite
  #   that is ABOUT sign-in (R_NO_PRELOAD=1 for that call).
  if [ "${R_NO_PRELOAD:-0}" = 1 ]; then
    ( cd "$GATES_DIR" && node "$f" ) > "$t" 2>&1; e=$?
  else
    ( cd "$GATES_DIR" && node --import ./lib/auth-preload.mjs "$f" ) > "$t" 2>&1; e=$?
  fi
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
# ⚑ PHASE 06a — gate-r-theme / gate-r-modal / gate-r6-placement used to browse the LIVE :8792
#   (GATE_BASE unset -> R_REMOTE). Since ruling R25 the live service needs a sign-in, and the only
#   live accounts are REAL PEOPLE's: a suite clicking through the UI as one of them could write into
#   their progress or wrong-answer record. They now browse the local harness instead. What they
#   measure does not change, because R-C0 (gate-r-contract) asserts the harness serves the
#   BYTE-IDENTICAL document the deploy put on :8792.
export GATE_BASE="${GATE_BASE:-$R_BASE}"
# gate-r6-placement is the exception: it measures the LIVE corpus, so it keeps reading R_REMOTE,
# signed in with a 30-minute machine session (purpose='gate') minted on nn and revoked at exit.
# lib/auth-preload.mjs BLOCKS every non-GET to that origin, so it cannot write as the owner.
R_REMOTE_SESSION="$(ssh nn "cd /srv/foxai/edu-study/backend && test -f admin.py && /home/ubuntu/edu-study-venv/bin/python -m admin mint-session --ttl 1800" 2>/dev/null || true)"
export R_REMOTE_SESSION
revoke_remote () { [ -n "${R_REMOTE_SESSION:-}" ] && printf '%s\n' "$R_REMOTE_SESSION" | ssh nn "cd /srv/foxai/edu-study/backend && /home/ubuntu/edu-study-venv/bin/python -m admin revoke-session" >/dev/null 2>&1; R_REMOTE_SESSION=""; }
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
  if [ -f "$GATES_DIR/$f" ]; then
    if [ "$f" = gate-r6-placement.mjs ]; then GATE_BASE="$R_REMOTE" run_suite "$f" "$tag" "$want"; else run_suite "$f" "$tag" "$want"; fi
    RTOTAL=$(( RTOTAL + ${COUNT[$tag]} ))
  fi
done

# ⚑ PHASE 06a — sign-in, owner-only admin, per-account progress, wrong answers, path routing.
#   Run WITHOUT the auth preload: this suite is about being signed out and signing in. It ends with
#   the login rate-limit check, which locks 127.0.0.1 out of /api/auth/login on :$PORT for 5 min —
#   harmless, because every other suite uses the minted session, never the login form.
#   ⛔ Its row in gate-r-self.mjs's RS-COUNT table moves WITH this line, always.
# ⚑ 23-09-26 (user) — STYLE PARITY: the Account + sign-in pages and the top bar's LOG OUT measured
#   with getComputedStyle against the home page's own elements, in both colour schemes.
#   ⛔ R_NO_PRELOAD=1 because it CLICKS LOG OUT — under the preload it would sign out R_SESSION, the
#      session every other suite uses. It signs in through the form as gate-reader instead.
#   ⛔ BEFORE gate-r-auth: that suite ends by rate-limiting 127.0.0.1's sign-ins for 5 minutes.
#   ⛔ Its row in gate-r-self.mjs's RS-COUNT table moves WITH this line, always.
R_NO_PRELOAD=1 run_suite gate-r-style.mjs rstyle "${R_STYLE_COUNT:-14}"; RTOTAL=$(( RTOTAL + ${COUNT[rstyle]} ))
R_NO_PRELOAD=1 run_suite gate-r-auth.mjs rauth "${R_AUTH_COUNT:-22}"; RTOTAL=$(( RTOTAL + ${COUNT[rauth]} ))

# ⚑ PHASE 04 — the two write suites. Each gets a FRESH write harness: the four rate buckets are
#   per-PROCESS, so the UI suite's AI calls would otherwise eat the slots gate-r-write counts.
#   ⛔ Their rows in gate-r-self.mjs's RS-COUNT table move WITH these lines, always.
echo "== write harness (for gate-r-writeui.mjs) =="
if start_write_harness; then
  run_suite gate-r-writeui.mjs rwriteui "${R_WRITEUI_COUNT:-10}"; RTOTAL=$(( RTOTAL + ${COUNT[rwriteui]} ))
  # gate-r-parity.mjs compares against the LIVE :8767 (read-only, non-GET aborted). It runs on the
  # write harness because that one has a provider "ready", like :8767 — the AI buttons' state is
  # part of what is compared.
  R_BASE="$R_WRITE_BASE" run_suite gate-r-parity.mjs rparity "${R_PARITY_COUNT:-9}"; RTOTAL=$(( RTOTAL + ${COUNT[rparity]} ))
else RC=1; fi
echo "== write harness, fresh process (for gate-r-write.mjs) =="
if start_write_harness; then
  run_suite gate-r-write.mjs rwrite "${R_WRITE_COUNT:-15}"; RTOTAL=$(( RTOTAL + ${COUNT[rwrite]} ))
else RC=1; fi
# ⚑ 23-09-26 — 9router combo PER ACCOUNT and PER JOB (user ruling). A THIRD fresh write harness, so
#   the quiz/ask buckets are untouched by the suites above. It also runs the LEGACY edu_server.py on
#   :${R_LEGACY_ROUTE_PORT:-8798} (its own /var/tmp stores, same stub) for the :8767 tutor-model rule.
#   ⛔ Its row in gate-r-self.mjs's RS-COUNT table moves WITH this line, always.
echo "== write harness, fresh process (for gate-r-route.mjs) =="
if start_write_harness; then
  R_STUB_PORT="$SPORT" run_suite gate-r-route.mjs rroute "${R_ROUTE_COUNT:-10}"; RTOTAL=$(( RTOTAL + ${COUNT[rroute]} ))
else RC=1; fi
kill_on_port "$WPORT"; kill_stub

# gate-r-self.mjs parses the transcripts above, so it MUST run last.
if [ -f "$GATES_DIR/gate-r-self.mjs" ]; then
  # 11 -> 14 on 22-09-26 (item A/D/E supplement): the RS-COUNT table gained rows for
  # gate-r-theme.mjs, gate-r-modal.mjs and gate-r6-placement.mjs. It was 11 after EVL
  # fix 004 added the gate-r-journey.mjs row.
  # 14 -> 17 on 23-09-26 (Phase 04): rows for gate-r-writeui / gate-r-parity / gate-r-write.
  # 17 -> 18 on 23-09-26 (Phase 06a): the gate-r-auth.mjs row.
  # 18 -> 19 on 23-09-26 (model routing per account): the gate-r-route.mjs row.
  # 19 -> 20 on 23-09-26 (style parity): the gate-r-style.mjs row.
  run_suite gate-r-self.mjs rself "${R_SELF_COUNT:-20}"; RTOTAL=$(( RTOTAL + ${COUNT[rself]} ))
fi

echo
echo "===================== R- SUMMARY ====================="
echo " R- vector     : $RTOTAL"
echo " transcripts   : $OUT_DIR/{rsep,rread,rcontract,rdom,rro,rtrap,rjourney,rtheme,rmodal,rr6,rstyle,rauth,rwriteui,rparity,rwrite,rroute,rself}.txt"
echo " local preview : $R_BASE    remote: $R_REMOTE"
[ "$RC" -eq 0 ] && echo " RESULT        : ALL GREEN" || echo " RESULT        : FAILED"
echo "======================================================"

# E10: prove the cleanup actually happened. Asserted BEFORE exit, so a leaked server is a
# RED RUN rather than something the next run silently inherits.
cleanup; sleep 1
LEFT=$(ss -ltnH "( sport = :$PORT or sport = :$WPORT or sport = :$SPORT )" 2>/dev/null | wc -l)
if [ "$LEFT" -ne 0 ]; then
  echo " <-- FAIL: a server is STILL listening on :$PORT after cleanup"; RC=1
else
  echo " cleanup verified: nothing listening on :$PORT"
fi
exit $RC
