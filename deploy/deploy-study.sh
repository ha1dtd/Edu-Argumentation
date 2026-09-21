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
  --rollback [SNAP]   restore the newest snapshot (or the named one) and restart
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
  ssh "$HOST" "ls -1dt '${REMOTE_DIR}.snapshots'/* 2>/dev/null | tail -n +$((RETAIN+1)) | xargs -r rm -rf" || true
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
# Step 6 — content gate
# ---------------------------------------------------------------------------
content_gate() {
  ssh "$HOST" "test -f '${REMOTE_DIR}/web/index.html'" || fail "content gate: no index.html on ${HOST}"
  ssh "$HOST" "ls '${REMOTE_DIR}/web/assets'/*.js >/dev/null 2>&1" || fail "content gate: no hashed asset on ${HOST}"
  ssh "$HOST" "test -f '${REMOTE_DIR}/backend/main.py'" || fail "content gate: no backend/main.py on ${HOST}"
  ssh "$HOST" "test ! -e '${REMOTE_DIR}/node_modules'" || fail "content gate: a dependency tree is present in the deploy root"
  log "content gate PASS"
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
do_rollback() {
  local snap="${1:-}"
  if [[ -z "$snap" ]]; then
    snap="$(ssh "$HOST" "ls -1dt '${REMOTE_DIR}.snapshots'/* 2>/dev/null | head -1")"
  fi
  [[ -n "$snap" ]] || fail "no snapshot available to roll back to"
  ssh "$HOST" "test -d '$snap'" || fail "snapshot not found: $snap"
  ssh "$HOST" "rm -rf '${REMOTE_DIR}.rollback-tmp' && cp -a '$snap' '${REMOTE_DIR}.rollback-tmp' && rm -rf '$REMOTE_DIR' && mv '${REMOTE_DIR}.rollback-tmp' '$REMOTE_DIR'"
  log "rolled back to ${snap}"
  ssh "$HOST" "sudo -n systemctl restart '$SERVICE'" || log "service restart after rollback failed (unit may not be installed yet)"
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
    list)     ssh "$HOST" "ls -1dt '${REMOTE_DIR}.snapshots'/* 2>/dev/null || echo '(none)'"; exit 0 ;;
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
