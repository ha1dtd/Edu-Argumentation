"""Store-path and provider resolution for the edu-study service.

⛔ THIS MODULE IS THE ONE ACCESSOR (plan C1a / decision D-C1).

Every provider/settings read goes through a function defined here. The legacy app calls
``ProviderConfig.from_environment()`` from inside individual handlers, which is why moving
settings out of the environment later means touching every call site. Phase 4 swaps the
SOURCE of these values (env -> SQLite); it must not have to find the readers.

⛔ NO CREDENTIALS IN PHASE 2. The unit for :8792 pins exactly seven EDU_* PATH variables
and carries no ``EnvironmentFile=``. An empty Phase-2 app makes no provider calls and
proxies no runner, so ``EDU_QUIZ_API_KEY`` / ``EDU_RUNNER_KEY`` / ``EDU_ADMIN_TOKEN`` are
absent by construction rather than by discipline. :8792 is UNAUTHENTICATED and ufw rule #1
blanket-allows the whole LAN 192.168.100.0/24, so anything this process can read is
readable by every host on that LAN the moment it reaches a response body.
"""

from __future__ import annotations

import os
from pathlib import Path

# The seven store paths, with the defaults measured from the live :8767 service on
# 2026-09-21. Two are set explicitly by :8767's unit (EDU_ENV_PATH, EDU_SETTINGS_PATH);
# the other five are unset there and fall through to the code defaults in
# aws-quiz-app/edu_server.py at L50 / L116 / L120 / L125 / L368.
#
# ⚠ EDU_LIBRARY_META_PATH is its OWN entry, never derived. edu_server.py L368 defaults it
# to ``PROGRESS_PATH.parent / "library-meta.json"``, so deriving it means moving the
# progress store silently moves the library-metadata store too. Exit gate G9 exists
# precisely to break that derivation.
_DEFAULT_ROOT = "/home/ubuntu/foxai-data/edu-argumentation"

STORE_PATH_DEFAULTS: dict[str, str] = {
    "EDU_ENV_PATH": f"{_DEFAULT_ROOT}/provider.env",
    "EDU_SETTINGS_PATH": f"{_DEFAULT_ROOT}/settings.json",
    "EDU_BOOK_ROOT": f"{_DEFAULT_ROOT}/books",
    "EDU_PROGRESS_PATH": f"{_DEFAULT_ROOT}/progress.json",
    "EDU_ASSET_ROOT": f"{_DEFAULT_ROOT}/assets",
    "EDU_LIBRARY_ROOT": f"{_DEFAULT_ROOT}/library",
    "EDU_LIBRARY_META_PATH": f"{_DEFAULT_ROOT}/library-meta.json",
}


def store_paths() -> dict[str, str]:
    """Resolve the seven store paths. THE ONLY reader of these variables.

    Returns exactly seven entries — never more. The health endpoint echoes this mapping
    verbatim, and exit gate G1 asserts the key set is EQUAL to the expected seven, so an
    eighth entry of any kind fails the gate rather than leaking quietly.
    """
    return {name: os.getenv(name, default) for name, default in STORE_PATH_DEFAULTS.items()}


def store_path(name: str) -> Path:
    """Resolve one store path as a Path. Raises on an unknown name rather than guessing."""
    if name not in STORE_PATH_DEFAULTS:
        raise KeyError(f"{name} is not one of the seven edu-study store paths")
    return Path(store_paths()[name])


def provider_config() -> None:
    """The single seam for provider credentials. Phase 2 has none, by design.

    This exists now, unused and returning None, so that Phase 4 has ONE place to fill in
    rather than a scatter of per-handler reads to find. Do not inline an environment read
    into a handler because "it is only one call" — that is exactly how the legacy app got
    to the state this program is unwinding.
    """
    return None
