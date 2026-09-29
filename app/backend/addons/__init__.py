"""Add-on API routers (study-rooms-qna P1, 29-09-26).

One list literal of `<module>.router` names; gates/gate-routes.mjs counts them. Empty in P1.
Add-on modules use `import main as core` and touch `core.X` at CALL time only (main is
partially initialised when this package is imported).
"""
from fastapi import APIRouter

from addons import qna  # noqa: E402  (P2, 29-09-26)

ADDON_ROUTERS: list[APIRouter] = [qna.router]
