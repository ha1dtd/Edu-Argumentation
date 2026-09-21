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

⛔ /book/ AND /assets/<moduleId>/ WILL BE CUSTOM FileResponse ROUTES, NEVER StaticFiles
   (plan C4). StaticFiles serves anything beneath its root, which would drop the
   ASSET_FILE allowlist — import-report.json (233 KB) sits beside module.json in every
   library package and must stay non-servable. FileResponse also streams instead of
   reading a 5.4 MB asset into RAM.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from settings import store_paths

PHASE = "phase-02-new-stack-empty"

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
    description="Phase 02 skeleton: /api/health plus the built SPA. No ported routes yet.",
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
