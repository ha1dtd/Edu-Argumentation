"""Account insights add-on API — Account page redesign A + B + C (23-11-26). Read-only: two GET routes.

  GET /api/account/overview
      -> {now, today{date, answered, accuracy, ms}, week{start, answered, accuracy, activeDays, ms, prevAnswered,
          prevAccuracy}, streak{current, longest, activeDays30, lastActive}, lastBook|null,
          books[{module, lastAt, lessons, currentlyWrong, aiAnswered, answered7, accuracy7, ms7, srs{...}}],
          totals{dueNow, currentlyWrong, cards}}
  GET /api/account/insights?module=
      -> {module, areaKind, topics[], weak[], improving[], slipping[], notStarted[], heatmap{from, days[], max},
          weeks[], time{...}, srs{...}, grades{...}, retention30, calibration{...}, currentlyWrong, ...}

What every number means is written at the top of insights.py (the page prints the same words).

⛔ Signed-in: the session middleware refuses every non-public route before it reaches here; the account is
   ALWAYS the session's (core._account), never a query parameter.
⛔ GET only -> no core._gate / rate bucket (the history add-on does the same).
⛔ `import main as core` and core.X at CALL time (the qna/rooms add-on rule).
"""
from __future__ import annotations

from http import HTTPStatus

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

import ai
import db
import insights
import main as core
import store

router = APIRouter()


def _error(error: Exception) -> Response:
    if isinstance(error, db.StoreUnavailable):
        return core._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    return core._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


@router.get("/api/account/overview")
def account_overview(request: Request) -> Response:
    try:
        return core._json(HTTPStatus.OK, insights.overview(core._account(request).id))
    except (db.StoreUnavailable, ValueError, TypeError) as error:
        return _error(error)


@router.get("/api/account/insights")
def account_insights(request: Request, module: str = Query(default="")) -> Response:
    try:
        key = store.module_key(module)
        spec = store.area_spec(ai.load_module(None, key))
        return core._json(HTTPStatus.OK, insights.insights(core._account(request).id, key, spec))
    except (db.StoreUnavailable, ValueError, TypeError) as error:
        return _error(error)
