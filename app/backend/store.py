"""READ-ONLY store readers for the edu-study service (:8792).

edu-replatform Phase 03, slice D. ⛔ PHASE 03 IS READ-ONLY. Nothing in this module opens a
file for writing, and the exit gate asserts ``progress.json``'s sha256 is unchanged across a
full browse. The legacy writers (``_write_store`` / ``write_atomic`` / ``set_book_title``)
are deliberately NOT ported here; they land in Phase 04 against SQLite, not against these
JSON files.

Every path comes from ``settings.store_paths()`` — the one accessor (decision D-C1). Do not
read ``os.environ`` here; that is exactly the scatter this program is unwinding.
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any

from settings import store_path

# Ported VERBATIM from aws-quiz-app/edu_server.py. The regexes are SECURITY CONTROLS on the
# file-serving routes, not cosmetics — widening one widens what the unauthenticated :8792 will
# serve to every host on 192.168.100.0/24.
MODULE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")                # edu_server.py:161
ASSET_FILE = re.compile(r"^(fig|eq)-\d{1,3}[-.]\d{1,3}\.png$")      # edu_server.py:126
BLOCK_ID = re.compile(r"^ch\d{2}-b\d{2}$")                          # edu_server.py:153
MODULE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*\.json")       # edu_server.py:313

# ⚠ ASSET_FILE accepts BOTH caption separators on purpose: a book numbers its own figures —
# "Figure 1-1." (O'Reilly/Géron) vs "Figure 1.1:" (OpenIntro). Digits stay REQUIRED on both
# sides, so ".." can never match. Do NOT narrow this back to a hyphen.

DEFAULT_MODULE = "geron-homl3"      # edu_server.py:312
LEGACY_MODULE_ID = "geron-homl3"    # edu_server.py:164
MAX_TITLE = 160

GENERAL_DEFAULTS: dict[str, Any] = {   # edu_server.py:128
    "ai_question_count": 5,
    "fresh_quiz_size": 20,
    "require_access_token": False,
}


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


# --------------------------------------------------------------------------- general
def read_general_settings() -> dict[str, Any]:
    """The three general settings, defaults when the file is absent or corrupt."""
    values = dict(GENERAL_DEFAULTS)
    stored = _read_json(store_path("EDU_SETTINGS_PATH"))
    if isinstance(stored, dict):
        for key in GENERAL_DEFAULTS:
            if key in stored:
                values[key] = stored[key]
    return values


# --------------------------------------------------------------------------- progress
def _read_store() -> dict[str, Any]:
    stored = _read_json(store_path("EDU_PROGRESS_PATH"))
    if not isinstance(stored, dict):
        return {"version": 2, "modules": {}}
    if isinstance(stored.get("modules"), dict):
        return {"version": 2, "modules": stored["modules"]}
    legacy = stored.get("completed")
    return {"version": 2, "modules": {LEGACY_MODULE_ID: {"completed": legacy}} if isinstance(legacy, dict) else {}}


def module_key(value: Any) -> str:
    key = str(value or "").strip().lower()
    return key if MODULE_ID.match(key) else LEGACY_MODULE_ID


def read_progress(module: str = LEGACY_MODULE_ID) -> dict[str, Any]:
    """{"module": id, "completed": {"ch01-b03": {...}}}.

    Block ids are POSITIONAL ("ch01-b03"), so every book has a ch01-b03 — progress is keyed
    per module or a second book's first lesson would share the Géron tick. Malformed keys are
    dropped so a hand-edited file cannot make the reader's percentages nonsense.
    """
    entry = _read_store()["modules"].get(module) or {}
    completed = entry.get("completed") if isinstance(entry, dict) else None
    if not isinstance(completed, dict):
        completed = {}
    return {
        "module": module,
        "completed": {k: v for k, v in completed.items() if isinstance(k, str) and BLOCK_ID.match(k)},
    }


# --------------------------------------------------------------------------- library meta
def read_library_meta() -> dict[str, Any]:
    """Operator-renamed book titles.

    ⚠ D5: ``library-meta.json`` DOES NOT EXIST IN PRODUCTION — it is a test fixture the smoke
    harness creates. No read path may depend on it. Absent file => empty titles, and every
    book keeps the title from its own module.json.
    """
    stored = _read_json(store_path("EDU_LIBRARY_META_PATH"))
    titles = stored.get("titles") if isinstance(stored, dict) else None
    return {"titles": titles if isinstance(titles, dict) else {}}


def clean_title(value: Any) -> str:
    """One line, printable, bounded. Titles render as TEXT, never as HTML."""
    text = " ".join(str(value or "").split())
    return "".join(ch for ch in text if ch.isprintable())[:MAX_TITLE].strip()


# --------------------------------------------------------------------------- book identity
def module_id_for(data: dict[str, Any]) -> str:
    """Same rule as moduleIdFor() in app.js, so the home page reads the right progress."""
    tutorial = data.get("tutorialData") if isinstance(data.get("tutorialData"), dict) else {}
    explicit = str(data.get("moduleId") or tutorial.get("moduleId") or "").strip().lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", explicit):
        return explicit
    title = unicodedata.normalize("NFKD", str(tutorial.get("title") or "module").lower())
    slug = re.sub(r"[^a-z0-9]+", "-", title).strip("-")[:56]
    return f"t-{slug}" if re.match(r"[a-z0-9]", slug) and len(slug) >= 2 else "module"


def last_read_at(module_id: str) -> float:
    """Newest completion in this book as a unix timestamp — the only per-book activity the
    server records. Reading without finishing a block leaves no trace, which is honest."""
    completed = read_progress(module_key(module_id)).get("completed") or {}
    newest = 0.0
    for entry in completed.values():
        stamp = entry.get("at") if isinstance(entry, dict) else None
        if not isinstance(stamp, str):
            continue
        try:
            newest = max(newest, datetime.fromisoformat(stamp).timestamp())
        except ValueError:
            continue
    return newest


def mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0
