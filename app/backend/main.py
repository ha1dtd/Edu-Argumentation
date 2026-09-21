"""FastAPI application for the edu-study stack on :8792.

Phase 02 of the edu-replatform program: the new stack stood up EMPTY. One API route
(/api/health) plus the built SPA. None of the legacy app's 15 routes are ported yet —
that is Phases 3-4, and gates/gate-routes.mjs burns the list down.

⛔ SINGLE WORKER. THREE independent causes, all of which must be removed before a second
   worker is ever correct (decision D-C1). A reader who sees only cause (a) will "fix" it
   and then wonder why counts still diverge:
     (a) save_settings mutates os.environ live               edu_server.py:1153-1154
     (b) FOUR in-process rate-limit deques keyed on client IP
         REQUEST_HISTORY 20/3600s · ASK_HISTORY 60/600s · EXERCISE_HISTORY 30/600s
         · RUN_HISTORY 120/60s
     (c) THREE in-process caches   _MODULE_CACHE L314 · _BOOK_CACHE L59
                                   · _BOOK_DF / _BOOK_CHAPTERS L60-61
   Moving settings out of the environment buys ZERO concurrency, because (b) and (c)
   survive it untouched.

⛔ AI/PROVIDER HANDLERS MUST BE PLAIN ``def``, NEVER ``async def`` (plan C3). They block on
   urlopen with a 120 s timeout. Under ``async def`` that blocks the whole event loop and
   the service stops answering everything, including health. Under plain ``def`` FastAPI
   runs them in a threadpool, which is the behaviour we want. Phase 2 has no such handler;
   the rule is recorded here before the first one is written.

⛔ /book/ AND /assets/<moduleId>/ ARE CUSTOM FileResponse ROUTES, NEVER StaticFiles
   (plan C4, landed in Phase 03 slice D). StaticFiles serves anything beneath its root,
   which would drop the ASSET_FILE allowlist — import-report.json (233 KB of import
   internals) sits beside module.json and must stay non-servable. FileResponse also streams
   instead of reading a 5.4 MB asset into RAM.
   ⚠ CORRECTED 21-09-26 (measured): import-report.json is NOT "in every library package".
   It exists under openintro-statistics-2019-1045f2f5 and is ABSENT under geron-homl3, so
   only the openintro module is a real gate for it.

⛔ PHASE 03 IS READ-ONLY. There is no POST/PUT/PATCH/DELETE route in this file and no code
   path here opens a file for writing. The exit gate asserts progress.json's sha256 is
   unchanged across a full browse — before and after IN THE SAME RUN, never against a frozen
   literal, because the user studies live on :8767 and that service writes the same file.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Query, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import content
import store
from settings import provider_config, store_paths

PHASE = "phase-03-read-only-parity"

# The deployed tree is:
#   /srv/foxai/edu-study/backend/main.py   <- this file
#   /srv/foxai/edu-study/web/index.html    <- Vite build output, shipped prebuilt
#   /srv/foxai/edu-study/web/assets/*.js
#
# Resolved from __file__ rather than from an environment variable ON PURPOSE: the unit
# pins exactly seven EDU_* variables and exit gate G8 asserts that count, so an eighth
# would fail the gate. There is nothing to configure here — the layout is fixed by the
# deploy script.
WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
SPA_INDEX = WEB_ROOT / "index.html"
SPA_ASSETS = WEB_ROOT / "assets"

app = FastAPI(
    title="FoxAI Edu Study",
    version="0.1.0",
    description="Phase 03: the five READ routes plus guarded file serving. No write route exists.",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# ---------------------------------------------------------------------------
# API routes. Registered FIRST — see the mount-order note at the bottom.
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> Response:
    """Echo the seven RESOLVED store paths, and nothing else.

    ⛔ SEVEN, NEVER NINE. :8767's live process environment holds nine EDU_* variables, but
    only seven are paths — the other two are EDU_QUIZ_API_KEY (the 9router key) and
    EDU_RUNNER_KEY (the .68:8790 runner key), both LIVE SECRETS arriving via
    EnvironmentFile=. :8792 has no authentication and ufw rule #1 blanket-allows the whole
    LAN, so echoing nine would publish both keys to every host on 192.168.100.0/24.

    Status alone is not evidence: Phase 01 measured a wrong library root returning 200 with
    an empty list. The gate asserts CONTENT — key-set EQUALITY against the expected seven,
    which admits no extra key under any name.
    """
    return JSONResponse(
        {
            "status": "ok",
            "service": "foxai-edu-study",
            "phase": PHASE,
            "paths": store_paths(),
        }
    )


# ---------------------------------------------------------------------------
# Phase 03 slice D — the FIVE READ routes of the frozen 15-route contract.
# The remaining ten are POST and belong to Phase 04. Nothing here writes.
# ---------------------------------------------------------------------------
@app.get("/api/general")
def api_general() -> Response:
    """The three general settings. Defaults when the file is absent or corrupt."""
    return JSONResponse(store.read_general_settings())


@app.get("/api/modules")
def api_modules() -> Response:
    """The library list: legacy data/*.json books first, then packaged library/<id>/ books."""
    return JSONResponse({"books": content.list_modules()})


@app.get("/api/progress")
def api_progress(module: str = Query(default="")) -> Response:
    """Read one module's completed blocks. An unknown/invalid module falls back to the
    legacy key, exactly as edu_server.py:module_key does — never a 400, so a stale
    bookmark degrades to the default book instead of breaking the page."""
    return JSONResponse(store.read_progress(store.module_key(module)))


@app.get("/api/provider")
def api_provider() -> Response:
    """Provider READINESS — never the credential.

    ⛔ This route returns BOOLEANS and a model name, never a key. On :8792 there is no
    credential at all (the unit carries no EnvironmentFile=, gate R-SEP3/R-SEP4), so
    provider_config() is None by construction and this reports not-ready. That is correct
    for Phase 03: the read stack has no reason to reach a provider.
    """
    config = provider_config()
    general = store.read_general_settings()
    return JSONResponse({
        "ready": config is not None,
        "model": None,
        "token_required": bool(general["require_access_token"]) and config is not None,
        "admin_required": False,
    })


@app.get("/api/settings")
def api_settings() -> Response:
    """The settings page payload.

    ⛔ THE API KEY IS NEVER RETURNED, not even partially — only whether one is set. That is
    the legacy contract (edu_server.py:1016) and it is the property that actually matters on
    an unauthenticated LAN service. :8792 holds no credential, so every _set flag is False.

    ⚠ The legacy route gates on admin_ok(), which is OPEN unless EDU_ADMIN_TOKEN is set.
    :8792 must not carry that token (R-SEP4), so replicating the gate here would either be
    permanently open or require a credential this stack is forbidden to hold. The payload
    carries no secret, so the route is open and says so.
    """
    return JSONResponse({
        "api_url": "",
        "model": "",
        "json_mode": True,
        "api_key_set": False,
        "access_token_set": False,
        "ready": provider_config() is not None,
        "general": store.read_general_settings(),
        "admin_required": False,
    })


# ---------------------------------------------------------------------------
# Guarded file serving. ⛔ REGISTERED BEFORE THE StaticFiles MOUNT — see the note below.
# ---------------------------------------------------------------------------
_NOT_FOUND_BOOK = JSONResponse({"error": "No such book file."}, status_code=404)
_NOT_FOUND_ASSET = JSONResponse({"error": "No such asset."}, status_code=404)

# A refusal and a genuine not-found return the SAME flat body on purpose. Distinguishing them
# tells an unauthenticated caller which paths exist, which is the information disclosure this
# whole guard exists to prevent.


@app.get("/book/{rest:path}")
def book_file(rest: str) -> Response:
    """/book/<moduleId>/module.json and /book/<moduleId>/assets/<fig-N-N.png>. Nothing else.

    ⚠ ``rest:path`` receives the URL-DECODED path, so %2e%2e%2f arrives here as ``..`` and is
    rejected by MODULE_ID / the two-name allowlist. A raw ``../`` (curl --path-as-is) arrives
    intact and is rejected the same way. Neither is normalised away before this function.
    """
    try:
        target, ctype = content.resolve_book_file([p for p in rest.split("/") if p != ""])
    except content.NotAFile:
        return _NOT_FOUND_BOOK
    return FileResponse(target, media_type=ctype, headers={"Cache-Control": "public, max-age=3600"})


@app.get("/assets/{module_id}/{name}")
def asset_file(module_id: str, name: str) -> Response:
    """/assets/<moduleId>/<fig-10-3.png>. TWO segments — Vite's own one-segment build assets
    fall through to the StaticFiles mount below, which is why the order is load-bearing."""
    try:
        target = content.resolve_asset_file(module_id, name)
    except content.NotAFile:
        return _NOT_FOUND_ASSET
    return FileResponse(target, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


# ---------------------------------------------------------------------------
# SPA serving (plan C2a).
# ---------------------------------------------------------------------------
@app.get("/")
# Annotated ``-> Response`` rather than ``-> FileResponse | JSONResponse``: FastAPI builds a
# Pydantic response model from the return annotation, and a union of two Response classes is
# not a valid field type — the app raised FastAPIError at import and never started. Measured
# locally before deploy, which is the whole reason the app is run rather than just compiled.
def spa_index() -> Response:
    """Serve the built SPA shell.

    Without this route a backend-only deploy passes every other exit gate and the phase's
    own headline — "if the new stack cannot serve hello reliably, nothing later is worth
    porting" — is unproven by construction. Exit gate G17 asserts this returns a document
    containing the React root div.
    """
    if not SPA_INDEX.is_file():
        return JSONResponse(
            {"error": "SPA bundle is not deployed", "expected": str(SPA_INDEX)},
            status_code=503,
        )
    return FileResponse(SPA_INDEX, media_type="text/html")


# ⛔ MOUNT ORDER IS LOAD-BEARING (execute instruction E17 / concern C12).
#
# The SPA's hashed bundles are served from the prefix "/assets" — Vite's default, kept
# deliberately and NAMED here rather than left for Phase 3 to rediscover. That prefix is
# SHARED with the guarded per-module route Phase 3 adds at /assets/<moduleId>/<file>.
#
# They stay separate because Starlette matches in REGISTRATION ORDER: the API routes and
# (from Phase 3) the two guarded file routes are registered BEFORE this mount, so the
# 2-segment guarded route claims module assets, 1-segment build assets fall through to the
# mount, and a guarded 403 does NOT fall through to the mount. Registering the mount first
# would shadow every guarded route and silently remove the ASSET_FILE allowlist.
#
# ⛔ StaticFiles is mounted over /srv/foxai/edu-study/web/ ONLY — a directory that contains
# nothing but Vite build output. NEVER over the web root, NEVER over ~/foxai-data/, and
# NEVER over the book or asset stores, where import-report.json sits beside module.json.
if SPA_ASSETS.is_dir():
    app.mount("/assets", StaticFiles(directory=SPA_ASSETS), name="spa-assets")
