"""Store readers AND writers for the edu-study service (:8792).

edu-replatform Phase 03 slice D (readers) + Phase 04 (writers) + Phase 06a (per-account PostgreSQL).

⚑⚑ PHASE 06a (23-09-26, ruling R25) SUPERSEDES THE PROGRESS HALF OF D-P4-1 BELOW.
   Progress is now PER ACCOUNT in PostgreSQL (``edu_study`` on nn:5432, see db.py). This
   service NO LONGER WRITES ``progress.json`` — not one byte. ``:8767`` still does, and that file
   stays the user's truth until the cutover; ``read_progress_json()`` below reads it ONLY for the
   idempotent import (admin.py import-progress), which is re-run at cutover.
   ``library-meta.json`` (book titles, shared by everyone) is unchanged and still written here.

⛔ ONE SHARED STORE, NOT A SECOND ONE (decision D-P4-1, 23-09-26). ``progress.json`` and
   ``library-meta.json`` are the SAME files the legacy ``:8767`` reads and writes. The user
   studies live on ``:8767``, so ``:8792`` must read his writes, and the Phase-04 Tier-3 oracle
   requires ``:8767`` to read ``:8792``'s. A SQLite copy beside the JSON would be a second
   source of truth that can disagree with the first; SQLite lands at Phase 06, when ``:8767``
   stops writing and there is exactly one writer left.

⛔ THE WRITE IS LOCKED AND RE-READS INSIDE THE LOCK. ``progress.json`` is read-modify-write:
   two concurrent completions each read v1 and each write v1+x, and the second silently
   erases the first (a lost update, measured as the reason this phase exists). FastAPI runs
   plain ``def`` handlers in a THREADPOOL, so ``:8792``'s own requests race each other. An
   ``fcntl`` exclusive lock on a sibling lock file serialises them, and the read happens
   AFTER the lock is held — a lock around only the write would not help.
   ⚠ It cannot fence ``:8767`` (which does not take the lock and must not be edited). That
     race already existed inside ``:8767`` alone; it ends at Phase 06.

⛔ THE BYTE FORMAT IS THE LEGACY'S, EXACTLY: ``json.dumps(store, indent=2, sort_keys=True)``
   + ``"\n"``, written to ``.<name>.tmp``, chmod 600, ``os.replace``. Gate W-FORMAT proves it:
   a probe write followed by its reset returns the file to its pre-probe sha256.

Every path comes from ``settings.store_paths()`` — the one accessor (decision D-C1). Do not
read ``os.environ`` here; that is exactly the scatter this program is unwinding.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timezone
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


# --------------------------------------------------------------------------- progress (JSON, read-only)
def read_progress_json() -> dict[str, Any]:
    """The legacy ``progress.json`` as ``{"version": 2, "modules": {...}}``. READ-ONLY.

    Only the import (admin.py import-progress) calls this. A legacy top-level ``completed`` map is
    the pre-v2 single-book shape and belongs to the Géron key, exactly as edu_server.py reads it.
    """
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


# --------------------------------------------------------------------------- progress (PostgreSQL, per account)
def _stamp(value: datetime) -> str:
    """The legacy's own timestamp shape: ISO-8601, seconds, UTC offset (``2026-09-23T01:43:12+00:00``)."""
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def read_progress(account_id: int, module: str = LEGACY_MODULE_ID) -> dict[str, Any]:
    """{"module": id, "completed": {"ch01-b03": {"at", "score", "total", "source"}}} for ONE account.

    Same payload shape as the JSON era, so the page did not change. Block ids are POSITIONAL, so
    progress is keyed per module as well as per account.
    """
    import db

    rows = db.fetch_all(
        "SELECT block_id, completed_at, score, total, source FROM progress"
        " WHERE account_id = %s AND module_id = %s ORDER BY block_id",
        (account_id, module),
    )
    return {
        "module": module,
        "completed": {
            r["block_id"]: {"at": _stamp(r["completed_at"]), "score": r["score"], "total": r["total"], "source": r["source"]}
            for r in rows if BLOCK_ID.match(r["block_id"])
        },
    }


def record_attempt(account_id: int, module: str, block: str, score: int, total: int, source: str) -> None:
    """Every finished assessment's score, perfect or not (the Account page's "recent attempts")."""
    import db

    db.execute(
        "INSERT INTO attempts (account_id, module_id, block_id, score, total, source) VALUES (%s, %s, %s, %s, %s, %s)",
        (account_id, module, block, score, total, source),
    )


def mark_block_complete(account_id: int, module: str, block: str, score: int, total: int, source: str) -> dict[str, Any]:
    """Record a 100% result. A later perfect retake refreshes the entry, exactly as the JSON store
    overwrote it; a worse retake never reaches here (the route checks score == total)."""
    import db

    db.execute(
        "INSERT INTO progress (account_id, module_id, block_id, completed_at, score, total, source)"
        " VALUES (%s, %s, %s, now(), %s, %s, %s)"
        " ON CONFLICT (account_id, module_id, block_id) DO UPDATE SET"
        " completed_at = EXCLUDED.completed_at, score = EXCLUDED.score, total = EXCLUDED.total,"
        " source = EXCLUDED.source, imported = FALSE",
        (account_id, module, block, score, total, source),
    )
    return read_progress(account_id, module)


def reset_progress(account_id: int, module: str) -> dict[str, Any]:
    """Clears ONE module for ONE account. Never another book, never another account."""
    import db

    db.execute("DELETE FROM progress WHERE account_id = %s AND module_id = %s", (account_id, module))
    return read_progress(account_id, module)


def import_progress_json(account_id: int) -> dict[str, int]:
    """Copy every progress.json entry into ONE account. IDEMPOTENT: an entry already present is
    left alone (ON CONFLICT DO NOTHING), so a second run inserts 0 and a run after more study on
    :8767 inserts only the new blocks. progress.json itself is never written."""
    import db

    modules = read_progress_json()["modules"]
    seen = inserted = skipped = 0
    with db.connect() as conn:
        for module, entry in sorted(modules.items()):
            completed = entry.get("completed") if isinstance(entry, dict) else None
            if not isinstance(completed, dict):
                continue
            for block, item in sorted(completed.items()):
                seen += 1
                if not (MODULE_ID.match(str(module)) and BLOCK_ID.match(str(block)) and isinstance(item, dict)):
                    skipped += 1
                    continue
                try:
                    at = datetime.fromisoformat(str(item.get("at")))
                    if at.tzinfo is None:
                        at = at.replace(tzinfo=timezone.utc)
                    score, total = int(item.get("score")), int(item.get("total"))
                except (TypeError, ValueError):
                    skipped += 1
                    continue
                if total <= 0 or score < 0:
                    skipped += 1
                    continue
                cur = conn.execute(
                    "INSERT INTO progress (account_id, module_id, block_id, completed_at, score, total, source, imported)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE) ON CONFLICT DO NOTHING",
                    (account_id, module, block, at, score, total, str(item.get("source") or "written")[:16]),
                )
                inserted += cur.rowcount
    return {"entries": seen, "inserted": inserted, "already_present": seen - skipped - inserted, "skipped": skipped}


# --------------------------------------------------------------------------- writers (files)
def write_atomic(path: Path, text: str) -> None:
    """edu_server.py:write_atomic, verbatim: temp file in the same directory, 600, rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(text, encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


@contextmanager
def _locked(path: Path):
    """Exclusive lock on ``<path>.lock`` for the whole read-modify-write.

    A SIBLING lock file, never the data file: ``os.replace`` swaps the data file's inode, so a
    lock held on the old inode would not exclude a writer that opened the new one.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = path.with_name(f".{path.name}.lock")
    with open(lock, "a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def set_book_title(file: str, title: str) -> str:
    """Operator rename — library-meta.json, never module.json (edu_server.py:set_book_title)."""
    path = store_path("EDU_LIBRARY_META_PATH")
    with _locked(path):
        meta = read_library_meta()
        meta["titles"][file] = title
        write_atomic(path, json.dumps(meta, indent=2, sort_keys=True) + "\n")
    return title


def log_ask(entry: dict[str, Any]) -> None:
    """Append one answered question to the ask log. Best-effort and silent (edu_server.py:log_ask).

    ⚑ D-P4-5: ``dirname(EDU_PROGRESS_PATH)/logs/ask.jsonl`` — on nn that IS the file ``:8767``
    appends to, so the defect list keeps writing itself whichever port he reads on. Derived, not
    a new variable, so /api/health stays at exactly seven keys.
    """
    try:
        path = store_path("EDU_PROGRESS_PATH").parent / "logs" / "ask.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


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


def recency_by_module(account_id: int) -> dict[str, float]:
    """{module_id: newest completion as a unix timestamp} for ONE account, in one query — the only
    per-book activity recorded. Reading without finishing a block leaves no trace, which is honest."""
    import db

    rows = db.fetch_all(
        "SELECT module_id, max(completed_at) AS newest FROM progress WHERE account_id = %s GROUP BY module_id",
        (account_id,),
    )
    return {r["module_id"]: r["newest"].timestamp() for r in rows if r["newest"]}


def mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0
