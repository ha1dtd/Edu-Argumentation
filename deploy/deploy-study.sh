#!/usr/bin/env bash
# =============================================================================
# deploy-study.sh — the ONLY sanctioned way to deploy the edu-study app (:8792)
#
# Written for edu-replatform Phase 02. It is a SEPARATE script from deploy.sh
# (which owns :8767) and deploy.sh is NEVER edited by this phase. Three reasons,
# all binding:
#   1. It would fight Phase 01's own gates. deploy.sh ships a gate asserting a
#      default run installs no unit, and another asserting the script invokes no
#      bundler. Phase 02 must install a new unit and ship prebuilt frontend
#      artifacts. Making both gates flag-conditional creates a gate with an
#      escape hatch, which is not a gate.
#   2. The house pattern is per-edge scripts: platform/console/deploy/ ships
#      deploy-dev.sh / deploy-prod.sh / deploy-ehc.sh. There is no --edge flag
#      anywhere in this repository.
#   3. Unit reinstall is a live hazard. doc-importer's deploy re-installs its
#      unit on EVERY run; that is how a stale path variable nearly moved book
#      imports onto the expensive provider combo (2026-09-21).
#
# ORDERING IS LOAD-BEARING. Do not reorder:
#   1 preflight (RAM/swap)   2 artifact policy   3 SNAPSHOT   4 transfer
#   5 sha256 verify          6 content gate      7 restart
#   8 NRestarts x2           9 health
# The snapshot comes BEFORE the transfer on purpose: both sibling scripts in
# this repo transfer first and gate afterwards, so a failed verify leaves new
# files on disk with the old process running -- a silent split state. Here a
# failed verify AUTO-INVOKES the rollback.
#
# SCOPE FENCES:
#   - NEVER writes the user's data directory. That directory is a SIBLING of the
#     deploy tree; the transfer's source AND destination are both the tree, so
#     --delete structurally cannot reach it.
#   - NEVER runs a bundler, compiler or package manager for the frontend on the
#     target host. Artifacts are produced on the workstation and shipped. That
#     host is at swap 4053/4095; an out-of-memory event there takes a JVM
#     (Trino / Polaris / Airflow) with it. This is asserted externally by an
#     exit gate that greps THIS FILE for such verbs and expects none.
#   - --install-unit is OPT-IN, defaults OFF, and in Phase 02 is used EXACTLY
#     ONCE. It is a NEW flag on THIS script; deploy.sh's flag of the same name
#     deliberately hard-fails and is not reused.
#   - All local scratch lives under /var/tmp. NEVER /tmp or /dev/shm on the
#     workstation: there they are tmpfs, i.e. RAM, on a 15 GiB box.
# =============================================================================
set -euo pipefail

HOST="${EDU_STUDY_HOST:-nn}"
REMOTE_DIR="${EDU_STUDY_REMOTE_DIR:-/srv/foxai/edu-study}"
SERVICE="${EDU_STUDY_SERVICE:-foxai-edu-study}"
PORT="${EDU_STUDY_PORT:-8792}"
HEALTH_URL="${EDU_STUDY_HEALTH_URL:-http://192.168.100.66:${PORT}/api/health}"
VENV="${EDU_STUDY_VENV:-/home/ubuntu/edu-study-venv}"
UNIT_PATH="/etc/systemd/system/${SERVICE}.service"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# deploy/ is a SIBLING of app/, so --delete can never reach this script.
APP_DIR="${EDU_STUDY_APP_DIR:-${SCRIPT_DIR}/../app}"
LOCAL_BACKEND="${APP_DIR}/backend"
LOCAL_WEB="${APP_DIR}/frontend/dist"
SCRATCH="${EDU_STUDY_SCRATCH:-/var/tmp/p2-study-deploy}"
RETAIN=5

# Floors for STARTING A SERVICE. They are not a licence to compile anything.
MIN_AVAIL_MB="${EDU_STUDY_MIN_AVAIL_MB:-700}"

log()  { printf '[deploy-study] %s\n' "$*"; }
fail() { printf '[deploy-study] FAIL: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
usage: deploy-study.sh [--install-unit] [--rollback [SNAPSHOT]] [--list-snapshots]

  (no flags)          deploy: snapshot -> transfer -> sha256 -> content gate ->
                      restart -> stability -> health
  --install-unit      also create the venv, install python deps and write the
                      systemd unit. OPT-IN. Used exactly once, in Phase 02.
  --rollback [SNAP]   restore the newest snapshot BY NAME (or the named one),
                      restart, then re-run stability + content + health. The same
                      code path the auto-rollback uses, so the two cannot differ.
  --list-snapshots    show retained snapshots on the target host
USAGE
}

# ---------------------------------------------------------------------------
# Step 1 — preflight
# ---------------------------------------------------------------------------
preflight() {
  log "preflight against ${HOST}"
  ssh "$HOST" 'true' || fail "cannot reach ${HOST}"
  local avail
  avail="$(ssh "$HOST" "free -m | awk '/^Mem:/{print \$7}'")"
  [[ -n "$avail" ]] || fail "could not read available memory on ${HOST}"
  log "available memory on ${HOST}: ${avail} MB (floor ${MIN_AVAIL_MB} MB)"
  (( avail >= MIN_AVAIL_MB )) || fail "available memory ${avail} MB is below the ${MIN_AVAIL_MB} MB floor"
}

# ---------------------------------------------------------------------------
# Step 2 — artifact policy
# ---------------------------------------------------------------------------
# THIS SCRIPT SHIPS PREBUILT FRONTEND ARTIFACTS ONLY. It asserts they already
# exist; it does not and must not produce them here.
artifact_policy() {
  [[ -d "$LOCAL_BACKEND" ]] || fail "backend tree not found: $LOCAL_BACKEND"
  [[ -d "$LOCAL_WEB" ]]     || fail "frontend artifacts not found: $LOCAL_WEB (produce them on the workstation first)"
  [[ -f "$LOCAL_WEB/index.html" ]] || fail "no index.html in $LOCAL_WEB"
  ls "$LOCAL_WEB"/assets/*.js >/dev/null 2>&1 \
    || fail "no hashed asset bundle in $LOCAL_WEB/assets"
  log "artifact policy: prebuilt only; nothing is produced on ${HOST}"
}

# ---------------------------------------------------------------------------
# Step 3 — snapshot BEFORE any transfer
# ---------------------------------------------------------------------------
snapshot() {
  SNAP_TS="$(date -u +%Y%m%dT%H%M%SZ)"
  SNAP_DIR="${REMOTE_DIR}.snapshots/${SNAP_TS}"
  if ssh "$HOST" "test -d '$REMOTE_DIR'"; then
    ssh "$HOST" "mkdir -p '$(dirname "$SNAP_DIR")' && cp -a '$REMOTE_DIR' '$SNAP_DIR'"
    log "snapshot taken: ${SNAP_DIR}"
  else
    log "no existing tree at ${REMOTE_DIR} — first deploy, nothing to snapshot"
    SNAP_DIR=""
  fi
  prune_snapshots
}

# ---------------------------------------------------------------------------
# Retention prune — ORDERED BY NAME, NEVER BY MTIME (defect D-13, 2026-09-22)
# ---------------------------------------------------------------------------
# snapshot() copies with `cp -a`, which PRESERVES THE SOURCE DIRECTORY'S MTIME.
# Every snapshot therefore inherits ONE identical mtime -- measured on this host
# as `2026-09-21 08:35:38.308862641` on all five retained snapshots, to the
# nanosecond. `ls -1dt` sorts by mtime, so with the times tied it carries NO
# ordering information and falls back to arbitrary filesystem order. The prune
# consequently deleted an ARBITRARY snapshot, and it had already destroyed two
# published rollback targets (20260922T050832Z and 20260922T052610Z -- the
# latter being the snapshot the SAME deploy run had just taken for itself).
#
# The snapshot id is ISO-8601 basic format (YYYYMMDDTHHMMSSZ), fixed width and
# zero padded, so LEXICOGRAPHIC order IS chronological order. Sort by name.
# ⛔ Never reintroduce `ls -t`, `ls -1dt`, `sort -t`, `find -printf '%T@'` or any
#    other mtime-derived ordering here: `cp -a` guarantees the times are tied.
#
# RETAIN=5 is unchanged and is still correct. The old prune kept the right
# NUMBER of snapshots and chose the WRONG ONES; the count was never the defect.
prune_snapshots() {
  ssh "$HOST" "ls -1d '${REMOTE_DIR}.snapshots'/* 2>/dev/null | LC_ALL=C sort | head -n -${RETAIN} | while read -r d; do echo '[deploy-study] pruning '\"\$d\"; rm -rf \"\$d\"; done; true" || true
}

# Newest retained snapshot, BY NAME. Single source of truth for --rollback with
# no argument and for --list-snapshots, so the two can never disagree.
newest_snapshot() {
  ssh "$HOST" "ls -1d '${REMOTE_DIR}.snapshots'/* 2>/dev/null | LC_ALL=C sort | tail -1"
}

# ---------------------------------------------------------------------------
# Step 4 — transfer
# ---------------------------------------------------------------------------
# Source and destination are both the deploy tree, so --delete cannot reach the
# sibling data directory. That separation is the reason; the sha256 is the proof.
transfer() {
  ssh "$HOST" "mkdir -p '${REMOTE_DIR}/backend' '${REMOTE_DIR}/web'"
  rsync -az --delete --exclude '__pycache__' --exclude '*.pyc' \
    "${LOCAL_BACKEND}/" "${HOST}:${REMOTE_DIR}/backend/"
  rsync -az --delete "${LOCAL_WEB}/" "${HOST}:${REMOTE_DIR}/web/"
  log "transferred backend/ and web/"
}

# ---------------------------------------------------------------------------
# Step 5 — sha256 verify, local vs remote
# ---------------------------------------------------------------------------
local_manifest() {
  ( cd "$LOCAL_BACKEND" && find . -type f ! -name '*.pyc' ! -path './__pycache__/*' -exec sha256sum {} + | sed 's|\./|backend/|' )
  ( cd "$LOCAL_WEB"     && find . -type f -exec sha256sum {} + | sed 's|\./|web/|' )
}

verify_sha() {
  mkdir -p "$SCRATCH"
  local_manifest | LC_ALL=C sort -k2 > "${SCRATCH}/local.sha"
  ssh "$HOST" "cd '${REMOTE_DIR}' && find backend web -type f ! -name '*.pyc' ! -path 'backend/__pycache__/*' -exec sha256sum {} +" \
    | LC_ALL=C sort -k2 > "${SCRATCH}/remote.sha"
  if diff -u "${SCRATCH}/local.sha" "${SCRATCH}/remote.sha" > "${SCRATCH}/sha.diff"; then
    log "sha256 gate PASS ($(wc -l < "${SCRATCH}/local.sha") files identical)"
  else
    cat "${SCRATCH}/sha.diff" >&2
    log "sha256 gate FAILED — auto-invoking rollback"
    do_rollback "${SNAP_DIR:-}"
    fail "sha256 mismatch; rolled back"
  fi
}

# ---------------------------------------------------------------------------
# Step 6 — content gate  (STRENGTHENED 2026-09-22, defect D-14)
# ---------------------------------------------------------------------------
# ⛔ WHAT THIS REPLACED, AND WHY. Until 2026-09-22 this gate was EXISTENCE-ONLY:
# four `test -f` / `ls` checks. It CANNOT distinguish "the file is there" from
# "the file is right", and that was MEASURED, not theorised -- during the D-13
# fault-injection drill it returned PASS on an `index.html` with a `CORRUPT`
# line appended past `</html>`, while `:8792` served that corrupted document and
# systemd reported `active`. An existence check on a corrupted file is a gate
# that reports green on exactly the failure it exists to catch.
#
# THE STANDARD IT NOW MEETS is deploy.sh's (:8767), which asserts a MEASURED
# baseline rather than presence. That script and this one stay SEPARATE (see the
# file header); this borrows the DESIGN, not the code:
#   · a canonical form derived from the artifact, compared, not eyeballed
#   · each RED path names its own failure mode instead of one generic message
#   · one comparison function used by the live gate so drills exercise the REAL one
#
# ⛔ NO HARDCODED BUNDLE HASH, AND NONE MAY EVER BE ADDED. The hashed bundle name
# changes on EVERY build, so a literal would need editing each deploy or would rot
# into a stale-literal gate -- the class that has already bitten this program five
# times (`total === 21`, `-eq 49`, the B1 `=== 41` temptation, F-1's mtime, A-G17's
# fixture). The expected asset list is DERIVED FROM THE SERVED index.html itself,
# so it is correct for whatever build is deployed, including an older one restored
# by --rollback. That derivation is also why this same function is valid on BOTH
# the deploy-verify path and the rollback path: it makes no reference to the
# workstation's current build.
#
# ⛔ ASSERT WHAT IS SERVED OVER HTTP, not only what sits on disk. The D-13
# corruption was visible in the served page; a disk-only gate is one layer short.
# ⛔ ALWAYS `curl -o <file>` then `cmp`. NEVER `curl | sha256sum`: that pipeline
# reports a phantom 1-byte difference on this workstation.
BASE_URL="${EDU_STUDY_BASE_URL:-http://192.168.100.66:${PORT}}"

# Fetch a URL to a file; echo the HTTP status code (000 on transport failure).
fetch_to() {
  curl -s --max-time 20 -o "$2" -w '%{http_code}' "$1" || printf '000'
}

# Every `/assets/...` reference the document actually makes, sorted and deduped.
# This IS the expected-asset list -- read out of the artifact, never written down.
index_asset_refs() {
  grep -oE '/assets/[A-Za-z0-9][A-Za-z0-9._-]*' "$1" | LC_ALL=C sort -u
}

# Structural assertions on an index.html. Each expectation is read from the
# document's own shape, so there is nothing here to go stale.
#   · non-empty                      -> catches a zero-length write
#   · last non-blank line is </html> -> catches BOTH truncation (the tail is gone)
#                                       and append-corruption (something follows it),
#                                       which is the exact D-13 drill fault
#   · <div id="root"></div>          -> catches a truncated head/body or a wrong doc;
#                                       without the mount point React renders nothing
#   · >=1 .js and >=1 .css ref       -> catches a build that emitted no bundle
index_structure_check() {
  local f="$1" label="$2" last refs
  [[ -s "$f" ]] || { echo "content gate RED: ${label} index.html is EMPTY (0 bytes)" >&2; return 1; }
  last="$(grep -v '^[[:space:]]*$' "$f" | tail -1 | tr -d '\r')"
  if [[ "$last" != "</html>" ]]; then
    echo "content gate RED: ${label} index.html does not end at </html> -- truncated or corrupted." >&2
    echo "  last non-blank line: ${last}" >&2
    return 1
  fi
  grep -q '<div id="root"></div>' "$f" \
    || { echo "content gate RED: ${label} index.html has no <div id=\"root\"></div> mount point" >&2; return 1; }
  refs="$(index_asset_refs "$f")"
  printf '%s\n' "$refs" | grep -q '\.js$' \
    || { echo "content gate RED: ${label} index.html references no /assets/*.js bundle" >&2; return 1; }
  printf '%s\n' "$refs" | grep -q '\.css$' \
    || { echo "content gate RED: ${label} index.html references no /assets/*.css stylesheet" >&2; return 1; }
  return 0
}

# --- THE LIBRARY ASSERTION (item B, 2026-09-22) -------------------------------
# ⛔⛔ WHY THIS EXISTS. Measured 22-09-26: `grep -c 'api/modules' deploy-study.sh` = 0.
#    Everything above this line asserts that the APP is served; NOTHING asserted that the
#    BOOKS are. Those are different failures and only one of them is visible to a status
#    check. A deploy that points EDU_LIBRARY_ROOT at a wrong or empty directory passes
#    EVERY other gate in this file -- index.html whole, bundle byte-matched, systemd
#    active, /api/health 200 -- and the learner opens the app to ZERO BOOKS. deploy.sh
#    (:8767) has caught that class since it was written; Phase 06 RETIRES deploy.sh and
#    replaces :8767's runtime with this stack, so without this function the cutover would
#    LOSE a check the app the user reads daily has today.
#
# ⛔ THE DESIGN IS BORROWED FROM deploy.sh, THE CODE IS NOT (the file header requires the
#    two scripts stay separate). Same three properties, restated so they are not lost:
#      · a CANONICAL form derived from the payload -- "<count> <sorted moduleId list>"
#      · a SORTED LIST, never a set: a set lets a lost book pass silently when another
#        book legitimately duplicates a moduleId
#      · ONE comparison function used by the live gate, so a fault drill exercises the
#        REAL comparison and not a copy of it
#
# ⛔ THIS BASELINE IS MEASURED, THEN FROZEN. It is not assumed, and it is not derived from
#    the workstation. Measured on live :8792 at 2026-09-22:
#        2 ['geron-homl3', 'openintro-statistics-2019-1045f2f5']
#    ⚠ It is a LITERAL, and this program has been bitten by stale literals six times
#      (`total === 21`, `-eq 49`, the B1 `=== 41` temptation, F-1's mtime, A-G17's
#      fixture, R-B15b's pinned hash). This one is deliberate and is NOT that class: the
#      library is the thing being asserted, so deriving the expectation from the library
#      would make the gate assert nothing at all. The difference is that a stale literal
#      describes a MEASUREMENT THAT MOVES ON ITS OWN; a book list only changes when
#      someone imports a book, which is exactly the event this gate must not let pass
#      silently. Override for a legitimate change with EDU_STUDY_EXPECT_MODULES rather
#      than editing this line in a hurry.
EDU_STUDY_EXPECT_MODULES="${EDU_STUDY_EXPECT_MODULES:-2 ['geron-homl3', 'openintro-statistics-2019-1045f2f5']}"

# Parse a /api/modules payload on stdin into the canonical "<count> <sorted list>" form.
# Exits non-zero on malformed JSON or a missing `books` key -- a 200 that is not the
# expected shape is a failure, never an empty list.
parse_modules() {
  python3 -c "import sys,json
d=json.load(sys.stdin)
b=d['books']
print(len(b), sorted(x['moduleId'] for x in b))"
}

# Compare a canonical form against the frozen expectation. Each RED path names its own
# failure mode; a single generic message would make the drill unreadable.
compare_modules() {
  local got="$1"
  if [[ -z "$got" ]]; then
    echo "library gate RED: /api/modules returned nothing parseable (transport error, or not the {books:[...]} shape)" >&2
    return 1
  fi
  if [[ "$got" == 0\ * ]]; then
    echo "library gate RED: 0 books -- wrong or empty library root." >&2
    echo "  This is the 'healthy and empty' failure every other gate in this file passes:" >&2
    echo "  index.html whole, bundle byte-matched, systemd active, /api/health 200, ZERO books." >&2
    return 1
  fi
  if [[ "$got" != "$EDU_STUDY_EXPECT_MODULES" ]]; then
    echo "library gate RED: the module list changed." >&2
    echo "  expected: ${EDU_STUDY_EXPECT_MODULES}" >&2
    echo "  got:      ${got}" >&2
    echo "  If a book was legitimately added or removed, re-measure and update" >&2
    echo "  EDU_STUDY_EXPECT_MODULES -- do not delete this gate." >&2
    return 1
  fi
  return 0
}

# Live gate. Called from content_gate(), so it runs on BOTH the deploy-verify path and
# the rollback path -- a rollback that restores a tree with no books is still a failure.
library_gate() {
  local out
  out="$(curl -s --max-time 20 "${BASE_URL}/api/modules" | parse_modules || true)"
  log "library gate: ${out:-<unparseable>}"
  compare_modules "$out" || fail "library gate failed"
  log "library gate: OK (matches the frozen measured baseline)"
}

content_gate() {
  mkdir -p "$SCRATCH"
  local served="${SCRATCH}/served-index.html"
  local ondisk="${SCRATCH}/disk-index.html"
  local code ref rc n=0

  # --- 1. the document is actually served -------------------------------------
  code="$(fetch_to "${BASE_URL}/" "$served")"
  [[ "$code" == "200" ]] || fail "content gate RED: GET / returned ${code} (expected 200)"

  # --- 2. served == on disk ----------------------------------------------------
  # A mismatch means a stale worker, a cache, or a different tree being served
  # than the one the sha256 gate just verified.
  ssh "$HOST" "cat '${REMOTE_DIR}/web/index.html'" > "$ondisk" \
    || fail "content gate RED: no index.html on ${HOST} at ${REMOTE_DIR}/web/"
  cmp -s "$served" "$ondisk" \
    || fail "content gate RED: the served index.html differs from the one on disk"

  # --- 3. the served document is structurally whole ----------------------------
  index_structure_check "$served" "served" || fail "content gate failed"

  # --- 4. every asset it references exists, serves 200, and matches disk -------
  # ⛔ `ssh -n` IS LOAD-BEARING IN THIS LOOP, not a style choice. Plain `ssh`
  # reads stdin, and stdin here is the asset list being iterated -- so the first
  # `ssh` SWALLOWS THE REMAINING REFERENCES and the loop silently checks exactly
  # one asset then stops. Measured on the first run of this gate: 2 referenced
  # assets, `1 referenced asset(s) verified`. A loop that reports green after
  # checking one of two items is a vacuous gate. Never drop the -n.
  while read -r ref; do
    [[ -n "$ref" ]] || continue
    n=$((n + 1))
    ssh -n "$HOST" "test -f '${REMOTE_DIR}/web${ref}'" \
      || fail "content gate RED: index.html references ${ref} but that file is MISSING on ${HOST}"
    code="$(fetch_to "${BASE_URL}${ref}" "${SCRATCH}/asset.bin")"
    [[ "$code" == "200" ]] \
      || fail "content gate RED: referenced asset ${ref} returned ${code} (expected 200)"
    [[ -s "${SCRATCH}/asset.bin" ]] \
      || fail "content gate RED: referenced asset ${ref} served 0 bytes"
    ssh -n "$HOST" "cat '${REMOTE_DIR}/web${ref}'" > "${SCRATCH}/asset.disk"
    cmp -s "${SCRATCH}/asset.bin" "${SCRATCH}/asset.disk" \
      || fail "content gate RED: served bytes for ${ref} differ from the file on disk"
  done < <(index_asset_refs "$served")
  (( n > 0 )) || fail "content gate RED: no asset references were checked"

  # --- 5. structural fences retained from the original gate --------------------
  ssh "$HOST" "test -f '${REMOTE_DIR}/backend/main.py'" || fail "content gate RED: no backend/main.py on ${HOST}"
  ssh "$HOST" "test ! -e '${REMOTE_DIR}/node_modules'" || fail "content gate RED: a dependency tree is present in the deploy root"

  # --- 6. THE LIBRARY (item B) -------------------------------------------------
  # Steps 1-5 prove the APP is served. This proves the BOOKS are. See library_gate's
  # header: every check above passes on an app serving zero books.
  library_gate

  log "content gate PASS — served index.html whole and identical to disk; ${n} referenced asset(s) verified byte-for-byte; library asserted"
}

# ---------------------------------------------------------------------------
# --install-unit (OPT-IN)
# ---------------------------------------------------------------------------
# The virtualenv lives OUTSIDE ${REMOTE_DIR} on purpose: that tree is transferred
# with --delete, so anything kept inside it is wiped on every deploy and the
# service returns healthy and empty.
install_unit() {
  log "creating ${VENV} if absent and installing pinned python dependencies"
  ssh "$HOST" "test -d '$VENV' || /usr/bin/python3 -m venv '$VENV'"
  rsync -az "${LOCAL_BACKEND}/requirements.txt" "${HOST}:${REMOTE_DIR}/backend/requirements.txt"
  ssh "$HOST" "'$VENV/bin/pip' install --quiet --upgrade pip >/dev/null && '$VENV/bin/pip' install --quiet -r '${REMOTE_DIR}/backend/requirements.txt'"
  ssh "$HOST" "'$VENV/bin/python' -c 'import fastapi,starlette,uvicorn,pydantic;print(\"deps:\",fastapi.__version__,starlette.__version__,pydantic.VERSION)'"

  log "writing ${UNIT_PATH}"
  # StartLimitIntervalSec / StartLimitBurst MUST be in [Unit]. Placed in
  # [Service] systemd IGNORES them, systemd-analyze verify still exits 0, the
  # unit reports active, and the service has NO restart rate limiting at all --
  # which is exactly the crash-restart-loop-that-reports-active failure these
  # directives exist to prevent. Proven on this host 2026-09-21.
  ssh "$HOST" "sudo -n tee '$UNIT_PATH' >/dev/null" <<UNIT
[Unit]
Description=FoxAI Edu Study (replatformed study app, :${PORT})
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=ubuntu
WorkingDirectory=${REMOTE_DIR}
Environment=EDU_ENV_PATH=/home/ubuntu/foxai-data/edu-argumentation/provider.env
Environment=EDU_SETTINGS_PATH=/home/ubuntu/foxai-data/edu-argumentation/settings.json
Environment=EDU_BOOK_ROOT=/home/ubuntu/foxai-data/edu-argumentation/books
Environment=EDU_PROGRESS_PATH=/home/ubuntu/foxai-data/edu-argumentation/progress.json
Environment=EDU_ASSET_ROOT=/home/ubuntu/foxai-data/edu-argumentation/assets
Environment=EDU_LIBRARY_ROOT=/home/ubuntu/foxai-data/edu-argumentation/library
Environment=EDU_LIBRARY_META_PATH=/home/ubuntu/foxai-data/edu-argumentation/library-meta.json
ExecStart=${VENV}/bin/uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1 --app-dir ${REMOTE_DIR}/backend
MemoryHigh=384M
MemoryMax=512M
CPUQuota=200%
TasksMax=256
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
  ssh "$HOST" "sudo -n systemctl daemon-reload && sudo -n systemctl enable '$SERVICE'"
  log "unit installed and enabled"
}

# ---------------------------------------------------------------------------
# Step 7-9 — restart, stability, health
# ---------------------------------------------------------------------------
restart_service() {
  ssh "$HOST" "sudo -n systemctl restart '$SERVICE'"
  sleep 3
  log "restarted ${SERVICE}"
}

stability_gate() {
  local a b
  a="$(ssh "$HOST" "systemctl show -p NRestarts --value '$SERVICE'")"
  sleep 10
  b="$(ssh "$HOST" "systemctl show -p NRestarts --value '$SERVICE'")"
  log "NRestarts: ${a} then ${b}"
  [[ "$a" == "$b" ]] || fail "service restarted between samples (${a} -> ${b}) — crash loop"
  local pid
  pid="$(ssh "$HOST" "systemctl show -p MainPID --value '$SERVICE'")"
  [[ -n "$pid" && "$pid" != "0" ]] || fail "MainPID is 0 — the service is not running"
  log "MainPID ${pid}"
}

health_gate() {
  local code
  code="$(curl -s --max-time 10 -o "${SCRATCH}/health.json" -w '%{http_code}' "$HEALTH_URL" || true)"
  [[ "$code" == "200" ]] || fail "health returned ${code} (expected 200)"
  python3 - "${SCRATCH}/health.json" <<'PY' || fail "health payload gate failed"
import json, sys
want = {"EDU_ENV_PATH","EDU_SETTINGS_PATH","EDU_BOOK_ROOT","EDU_PROGRESS_PATH",
        "EDU_ASSET_ROOT","EDU_LIBRARY_ROOT","EDU_LIBRARY_META_PATH"}
payload = json.load(open(sys.argv[1]))
paths = payload["paths"]
assert set(paths) == want, ("KEY SET MISMATCH", sorted(set(paths) ^ want))
print("health: 7 store paths, key set exact")
PY
  log "health gate PASS"
}

# ---------------------------------------------------------------------------
# rollback
# ---------------------------------------------------------------------------
# ONE function serves BOTH the explicit `--rollback` and the auto-rollback that
# verify_sha() invokes on a sha256 mismatch, so the two CANNOT verify differently.
# Before 2026-09-22 this restored and restarted and stopped there: a sha-mismatch
# recovery put a tree back and brought the service up WITHOUT EVER ASSERTING THE
# LIBRARY WAS INTACT. A rollback that restores the wrong thing and reports success
# is worse than no rollback, because it is trusted.
do_rollback() {
  local snap="${1:-}"
  if [[ -z "$snap" ]]; then
    # BY NAME, never by mtime -- see prune_snapshots (D-13).
    snap="$(newest_snapshot)"
    log "no snapshot id given; newest BY NAME is: ${snap:-<none>}"
  fi
  [[ -n "$snap" ]] || fail "no snapshot available to roll back to"
  ssh "$HOST" "test -d '$snap'" || fail "snapshot not found: $snap"
  ssh "$HOST" "rm -rf '${REMOTE_DIR}.rollback-tmp' && cp -a '$snap' '${REMOTE_DIR}.rollback-tmp' && rm -rf '$REMOTE_DIR' && mv '${REMOTE_DIR}.rollback-tmp' '$REMOTE_DIR'"
  log "rolled back to ${snap}"
  verify_rollback
}

# Post-rollback verification. Identical on both paths by construction.
verify_rollback() {
  mkdir -p "$SCRATCH"
  if ! ssh "$HOST" "systemctl cat '$SERVICE' >/dev/null 2>&1"; then
    log "WARNING: ${SERVICE} is not installed on ${HOST} — the restored tree is UNVERIFIED (no service to gate)"
    return 0
  fi
  ssh "$HOST" "sudo -n systemctl restart '$SERVICE'" || fail "rollback restored the tree but ${SERVICE} would not restart"
  sleep 3
  stability_gate
  content_gate
  health_gate
  log "rollback VERIFIED: stability + content + health all green"
}

# ---------------------------------------------------------------------------
main() {
  local do_install=0 mode="deploy" snap_arg=""
  while (( $# )); do
    case "$1" in
      --install-unit)    do_install=1 ;;
      --rollback)        mode="rollback"; [[ "${2:-}" == --* || -z "${2:-}" ]] || { snap_arg="$2"; shift; } ;;
      --list-snapshots)  mode="list" ;;
      -h|--help)         usage; exit 0 ;;
      *)                 usage; fail "unknown argument: $1" ;;
    esac
    shift
  done

  case "$mode" in
    list)     ssh "$HOST" "ls -1d '${REMOTE_DIR}.snapshots'/* 2>/dev/null | LC_ALL=C sort || true"
              log "newest BY NAME (what --rollback with no argument restores): $(newest_snapshot)"
              exit 0 ;;
    rollback) do_rollback "$snap_arg"; exit 0 ;;
  esac

  mkdir -p "$SCRATCH"
  preflight
  artifact_policy
  snapshot
  transfer
  verify_sha
  content_gate
  (( do_install )) && install_unit
  restart_service
  stability_gate
  health_gate
  log "DEPLOY OK — ${SERVICE} on :${PORT}"
}

main "$@"
