"""Serve Edu-Argumentation and generate quizzes without exposing provider keys."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import secrets
import time
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs
from urllib.request import Request, urlopen

MAX_REQUEST_BYTES = 8_192
MAX_QUESTIONS = 10
# A fresh quiz is written by the model from several random book sections, a few
# questions per section, with the sections requested in parallel. Free models on
# a router with fallback take 15-40 s per call, so the size is capped.
MIN_FRESH_QUESTIONS = 5
MAX_FRESH_QUESTIONS = 30
QUESTIONS_PER_SECTION = 5
FRESH_PARALLEL_CALLS = 4
SPARE_SECTIONS = 2
PROVIDER_TIMEOUT_SECONDS = 120
RATE_LIMIT_REQUESTS = 20
RATE_LIMIT_SECONDS = 3_600
REQUEST_HISTORY: dict[str, deque[float]] = defaultdict(deque)

# Code runner proxy (17-09-26). Lesson code cells run in Jupyter kernels on dn2;
# the page only ever talks to this server. Runs have their own rate bucket so
# they never use up the AI quiz generation quota, and they need no provider.
RUN_ROUTES = ("/api/run", "/api/run/stop", "/api/run/reset-kernel")

# --- Ask the book: a tutor grounded in the lesson, then the book -------------
# The learner reads here instead of beside the paper book, so "I don't get this"
# has to be answerable in place. Sources are ranked lesson -> book -> the model's
# own knowledge, and the answer says which one it used so the reader can tell a
# quoted fact from a recalled one.
BOOK_ROOT = Path(os.getenv("EDU_BOOK_ROOT", "/home/ubuntu/foxai-data/edu-argumentation/books"))
BOOK_FILES = {"geron-homl3": "homl3.pages.json"}
ASK_MAX_QUESTION = 600
ASK_HISTORY_TURNS = 6
ASK_BOOK_PAGES = 3
ASK_EXCERPT_CHARS = 1_100
ASK_RATE_LIMIT_REQUESTS = 60
ASK_RATE_LIMIT_SECONDS = 600
ASK_HISTORY: dict[str, deque] = defaultdict(deque)
_BOOK_CACHE: dict[str, tuple[float, list[str]]] = {}
_BOOK_DF: dict[str, tuple[int, dict[str, int]]] = {}
_BOOK_CHAPTERS: dict[str, list[tuple[int, int, int]]] = {}
ASK_SAME_CHAPTER_BOOST = 2.5
ASK_NEAR_CHAPTER_BOOST = 1.4
ASK_COMMON_TERM_SHARE = 0.12
ASK_STOPWORDS = frozenset("""a an the and or but if then than that this these those is are was were be been being
do does did of in on at to for from by with as it its he she they we you i what why how when which who whom can
could should would may might will just not no nor so such about into over under again further once here there all
any both each few more most other some only own same too very s t don now me my mine your yours
explain explains simply simple mean means meaning tell show shows understand difference between work works
working use used using need needs want get got make makes made thing things way ways lot really actually""".split())

RUN_UPSTREAM = {"/api/run": "/run", "/api/run/stop": "/interrupt", "/api/run/reset-kernel": "/restart"}
RUN_MAX_REQUEST_BYTES = 256 * 1024
RUN_TIMEOUT_SECONDS = 90
RUN_RATE_LIMIT_REQUESTS = 120
RUN_RATE_LIMIT_SECONDS = 60
RUN_HISTORY: dict[str, deque[float]] = defaultdict(deque)
RUN_MODULES = {"geron-homl3"}
RUN_SESSION = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
RUN_CELL_ID = re.compile(r"^[a-z0-9_-]{1,32}$")

# The provider env file and the general-settings file BOTH live outside
# /srv/foxai/edu-argumentation. That tree is deployed with `rsync --delete`, so
# anything stored inside it is destroyed on the next deploy and the service comes
# back up healthy and empty. Keep stores out of the deployed tree.
ENV_PATH = Path(os.getenv("EDU_ENV_PATH", "/home/ubuntu/foxai-data/edu-argumentation/provider.env"))
SETTINGS_PATH = Path(os.getenv("EDU_SETTINGS_PATH", "/home/ubuntu/foxai-data/edu-argumentation/settings.json"))
# Study progress lives out here for the same reason, plus one more: it is the
# only thing in this app the reader cannot recreate. A browser store would die
# with a cache clear and would not follow them to a phone.
PROGRESS_PATH = Path(os.getenv("EDU_PROGRESS_PATH", "/home/ubuntu/foxai-data/edu-argumentation/progress.json"))
# A book's own figures and equation pictures, written by the importer, one folder per
# module. Outside the deployed tree for the same reason as every store above, and
# never committed: they are the publisher's images.
ASSET_ROOT = Path(os.getenv("EDU_ASSET_ROOT", "/home/ubuntu/foxai-data/edu-argumentation/assets"))
ASSET_FILE = re.compile(r"^(fig|eq)-\d{1,3}-\d{1,3}\.png$")

GENERAL_DEFAULTS: dict[str, Any] = {
    "ai_question_count": 5,
    "fresh_quiz_size": 20,
    "require_access_token": False,
}
ENV_FIELDS = ("EDU_QUIZ_API_URL", "EDU_QUIZ_API_KEY", "EDU_QUIZ_MODEL", "EDU_QUIZ_ACCESS_TOKEN", "EDU_QUIZ_JSON_MODE")


def valid_api_url(url: str) -> bool:
    return url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")


def read_general_settings() -> dict[str, Any]:
    values = dict(GENERAL_DEFAULTS)
    try:
        stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return values
    if isinstance(stored, dict):
        for key in GENERAL_DEFAULTS:
            if key in stored:
                values[key] = stored[key]
    return values


BLOCK_ID = re.compile(r"^ch\d{2}-b\d{2}$")


# Progress is kept PER MODULE. Block ids are positional ("ch01-b03"), so every
# book has a ch01-b03; keyed by block id alone, a second book's first lesson would
# share the Géron module's tick. The key is an explicit moduleId, never the title:
# the Géron title changes from "Chapters 1-9" to "1-19" when chapters are merged in,
# and a title-derived key would orphan every completion at that moment.
MODULE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
# The store was a flat {"completed": {...}} until 16-09-26, when the bundled Géron
# module was the only module anyone had studied. That flat map is read as its.
LEGACY_MODULE_ID = "geron-homl3"


def _read_store() -> dict[str, Any]:
    try:
        stored = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 2, "modules": {}}
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
    """{"module": id, "completed": {"ch01-b03": {"at", "score", "total", "source"}}}"""
    entry = _read_store()["modules"].get(module) or {}
    completed = entry.get("completed") if isinstance(entry, dict) else None
    if not isinstance(completed, dict):
        completed = {}
    # Drop anything that is not a well-formed block id, so a corrupt or
    # hand-edited file cannot make the reader's percentages nonsense.
    return {"module": module, "completed": {k: v for k, v in completed.items() if isinstance(k, str) and BLOCK_ID.match(k)}}


def _write_store(store: dict[str, Any]) -> None:
    write_atomic(PROGRESS_PATH, json.dumps(store, indent=2, sort_keys=True) + "\n")


def mark_block_complete(module: str, block: str, score: int, total: int, source: str) -> dict[str, Any]:
    """Record a 100% result. Completion is one-way: a later worse retake keeps it."""
    store = _read_store()
    entry = store["modules"].setdefault(module, {})
    completed = entry.setdefault("completed", {})
    completed[block] = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "score": score,
        "total": total,
        "source": source,
    }
    _write_store(store)
    return read_progress(module)


def reset_progress(module: str) -> dict[str, Any]:
    """Clears ONE module. Resetting one book must never wipe another's progress."""
    store = _read_store()
    store["modules"].pop(module, None)
    _write_store(store)
    return read_progress(module)


def write_atomic(path: Path, text: str) -> None:
    """Write via a temp file in the same directory, then rename.

    A half-written provider env file would leave the service unable to reach the
    provider with no clear cause, so the replace must be atomic.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(text, encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def write_env_file(values: dict[str, str]) -> None:
    lines = [
        "# Edu-Argumentation provider credentials.",
        "# Written by the in-app Settings page. Mode 600. Never commit this file.",
    ]
    lines.extend(f"{field}={values.get(field, '')}" for field in ENV_FIELDS)
    admin = os.getenv("EDU_ADMIN_TOKEN", "")
    if admin:
        lines.append(f"EDU_ADMIN_TOKEN={admin}")
    # The code runner's lines share this file. Settings rewrites the whole file,
    # so without this a Save would silently disconnect the runner.
    for field in ("EDU_RUNNER_URL", "EDU_RUNNER_KEY"):
        value = os.getenv(field, "")
        if value:
            lines.append(f"{field}={value}")
    write_atomic(ENV_PATH, "\n".join(lines) + "\n")


def current_env_values() -> dict[str, str]:
    return {field: os.getenv(field, "") for field in ENV_FIELDS}



@dataclass(frozen=True)
class ProviderConfig:
    api_url: str
    api_key: str
    model: str
    access_token: str
    json_mode: bool

    @classmethod
    def from_environment(cls) -> "ProviderConfig | None":
        values = {
            "api_url": os.getenv("EDU_QUIZ_API_URL", "").strip(),
            "api_key": os.getenv("EDU_QUIZ_API_KEY", "").strip(),
            "model": os.getenv("EDU_QUIZ_MODEL", "").strip(),
            # Optional: an empty token means the box does not gate generation.
            # That is a deliberate choice for a LAN/VPN-only study host; the
            # require_access_token general setting decides whether it is enforced.
            "access_token": os.getenv("EDU_QUIZ_ACCESS_TOKEN", "").strip(),
        }
        if not all(values[field] for field in ("api_url", "api_key", "model")):
            return None
        # An operator who copies the template and fills in only some fields would
        # otherwise leave literal "replace-with-..." text here. That is non-empty,
        # so the check above passes and /api/provider reports ready while every
        # generation fails at the provider. Treat a placeholder as unconfigured.
        if any(value.startswith("replace-with-") for value in values.values()):
            return None
        if not valid_api_url(values["api_url"]):
            return None
        return cls(**values, json_mode=os.getenv("EDU_QUIZ_JSON_MODE", "true").lower() != "false")


def read_json(handler: SimpleHTTPRequestHandler, limit: int = MAX_REQUEST_BYTES) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > limit:
        raise ValueError(f"Request body must be a JSON object smaller than {limit // 1024} KB.")
    payload = json.loads(handler.rfile.read(length))
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")
    return payload


def strip_code_fence(text: str) -> str:
    value = text.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[1] if "\n" in value else ""
        if value.endswith("```"):
            value = value[:-3]
    return value.strip()


DEFAULT_MODULE = "geron_hands_on_ml_ch01_ch09.json"
MODULE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*\.json")
_MODULE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def module_path(root: Path, name: str | None = None) -> Path:
    """A book is a JSON module in data/. Test fixtures and anything outside data/ are not books."""
    name = name or DEFAULT_MODULE
    data_dir = (root / "data").resolve()
    path = (data_dir / name).resolve()
    if not MODULE_NAME.fullmatch(name) or name.startswith("test_") or path.parent != data_dir or not path.is_file():
        raise ValueError("Unknown book.")
    return path


def load_module(root: Path, name: str | None = None) -> dict[str, Any]:
    path = module_path(root, name)
    mtime = path.stat().st_mtime
    cached = _MODULE_CACHE.get(str(path))
    if cached and cached[0] == mtime:
        return cached[1]
    data = json.loads(path.read_text(encoding="utf-8"))
    _MODULE_CACHE[str(path)] = (mtime, data)
    return data


def module_id_for(data: dict[str, Any]) -> str:
    """Same rule as moduleIdFor() in app.js, so the home page reads the right progress."""
    tutorial = data.get("tutorialData") if isinstance(data.get("tutorialData"), dict) else {}
    explicit = str(data.get("moduleId") or tutorial.get("moduleId") or "").strip().lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", explicit):
        return explicit
    title = unicodedata.normalize("NFKD", str(tutorial.get("title") or "module").lower())
    slug = re.sub(r"[^a-z0-9]+", "-", title).strip("-")[:56]
    return f"t-{slug}" if re.match(r"[a-z0-9]", slug) and len(slug) >= 2 else "module"


def list_modules(root: Path) -> list[dict[str, Any]]:
    books = []
    for path in sorted((root / "data").glob("*.json")):
        try:
            data = load_module(root, path.name)
        except (ValueError, OSError, json.JSONDecodeError):
            continue
        tutorial = data.get("tutorialData")
        sections = tutorial.get("sections") if isinstance(tutorial, dict) else None
        if not isinstance(sections, list) or not isinstance(data.get("quizData"), list):
            continue
        books.append({
            "file": path.name,
            "moduleId": module_id_for(data),
            "title": str(tutorial.get("title") or path.stem),
            "chapters": len(sections),
            "lessons": sum(len(section.get("items") or []) for section in sections if isinstance(section, dict)),
            "questions": len(data["quizData"]),
            "default": path.name == DEFAULT_MODULE,
        })
    return books


def all_theory_blocks(root: Path, name: str | None = None) -> list[tuple[int, int]]:
    """Every (chapter, block) pair, 1-based, that a fresh quiz may draw from."""
    sections = load_module(root, name)["tutorialData"]["sections"]
    return [(chapter, block) for chapter, section in enumerate(sections, 1) for block in range(1, len(section["items"]) + 1)]


def source_for_block(root: Path, chapter_number: int, block_number: int, name: str | None = None) -> tuple[str, str]:
    module = load_module(root, name)
    chapter = module["tutorialData"]["sections"][chapter_number - 1]
    item = chapter["items"][block_number - 1]
    if isinstance(item, str):
        # Older modules store a block as one plain string.
        return chapter["title"], item
    parts: list[str] = []
    for content in item.get("blocks", []):
        if content.get("content"):
            parts.append(content["content"])
        for entry in content.get("items", []):
            # Callout items are strings; "Go deeper" items are {term, text}.
            if isinstance(entry, str):
                parts.append(entry)
            elif isinstance(entry, dict) and entry.get("text"):
                parts.append(f"{entry.get('term', '')} — {entry['text']}")
        # Interactive code cells replaced a code card; keep their code in the
        # quiz source so the lesson does not lose it for AI question generation.
        for cell in content.get("cells", []) if content.get("type") == "code_cells" else []:
            if isinstance(cell, dict) and cell.get("source"):
                parts.append(f"```python\n{cell['source']}\n```")
    source = "\n\n".join(parts)
    if not source:
        raise ValueError("That theory block has no source text for AI generation.")
    return chapter["title"], f"{item.get('term', 'Theory block')}\n\n{source}"


def response_content(raw: bytes, content_type: str) -> str:
    """Return the assistant text from a Chat Completions response.

    Requests are sent with `stream: true`, so the normal case is a server-sent
    event stream whose delta chunks are joined here. A provider that ignores the
    flag and answers with one JSON body is accepted too.
    """
    text = raw.decode("utf-8", errors="replace")
    if "text/event-stream" in content_type or text.lstrip().startswith("data:"):
        parts: list[str] = []
        for line in text.splitlines():
            line = line.strip()
            if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                continue
            try:
                chunk = json.loads(line[5:])
                parts.append(chunk["choices"][0].get("delta", {}).get("content") or "")
            except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                continue
        return "".join(parts)
    return json.loads(text)["choices"][0]["message"]["content"]


def parse_quiz_json(content: str) -> Any:
    value = strip_code_fence(content)
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        # Free models sometimes wrap the object in a sentence. Take the outermost
        # braces rather than failing a call that did produce the quiz.
        start, end = value.find("{"), value.rfind("}")
        if start < 0 or end <= start:
            raise
        return json.loads(value[start:end + 1])


def valid_question(question: Any) -> bool:
    if not isinstance(question, dict):
        return False
    options, explanations, correct = question.get("options"), question.get("explanations"), question.get("correct")
    return (
        isinstance(question.get("question"), str) and bool(question["question"].strip())
        and isinstance(options, list) and len(options) == 4 and all(isinstance(value, str) and value.strip() for value in options)
        and isinstance(explanations, list) and len(explanations) == 4 and all(isinstance(value, str) for value in explanations)
        and isinstance(correct, int) and not isinstance(correct, bool) and correct in range(4)
    )


def provider_questions(config: ProviderConfig, chapter_title: str, source: str, count: int, exact: bool = True) -> list[dict[str, Any]]:
    """Ask the model for `count` questions on one theory block.

    exact=True (the per-block quiz) rejects the whole answer on any defect.
    exact=False (a fresh quiz, many calls) keeps the valid questions and drops the
    rest, so one malformed item does not throw away a whole paid call.
    """
    instruction = (
        f"Create exactly {count} multiple-choice study questions using only the supplied theory. "
        "Do not invent facts or refer to material outside it. Return a JSON object with a questions array. "
        "Every question needs question (string), options (exactly four strings), correct (zero-based index), "
        "and explanations (exactly four short strings; explain why each option is right or wrong)."
    )
    body: dict[str, Any] = {
        "model": config.model,
        "messages": [{"role": "system", "content": instruction}, {"role": "user", "content": f"Chapter: {chapter_title}\n\nTheory block:\n{source}"}],
        "temperature": 0.3,
        # Streamed on purpose. Measured 15-09-26 through 9router's `edu-arg` combo:
        # a non-streamed request returned HTTP 200 with `"content": ""` (the router
        # translates to the provider's responses API and loses the text), while the
        # same request streamed returned the full quiz. response_content() joins
        # the chunks, and still accepts a plain JSON body from providers that
        # ignore the flag.
        "stream": True,
    }
    if config.json_mode:
        body["response_format"] = {"type": "json_object"}
    request = Request(config.api_url, data=json.dumps(body).encode("utf-8"), headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=PROVIDER_TIMEOUT_SECONDS) as response:
            content = response_content(response.read(), response.headers.get("Content-Type", ""))
    except HTTPError as error:
        raise ValueError(f"Provider request failed ({error.code}).") from error
    except (URLError, TimeoutError, OSError) as error:
        raise ValueError("Provider could not be reached.") from error
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Provider returned an invalid quiz response.") from error
    try:
        parsed = parse_quiz_json(content)
    except json.JSONDecodeError as error:
        raise ValueError("Provider returned an invalid quiz response.") from error
    questions = parsed.get("questions") if isinstance(parsed, dict) else None
    if not isinstance(questions, list):
        raise ValueError("Provider returned an invalid quiz response.")
    if exact:
        if len(questions) != count:
            raise ValueError("Provider did not return the requested number of questions.")
        if not all(valid_question(question) for question in questions):
            raise ValueError("Provider returned a question with an invalid schema.")
    kept = [question for question in questions if valid_question(question)][:count]
    if not kept:
        raise ValueError("Provider returned no usable questions.")
    return [shuffled_question(q) for q in kept]


def shuffled_question(question: dict[str, Any]) -> dict[str, Any]:
    """Shuffle the four options, carrying each explanation and the answer with them.

    Models put the right answer first far more often than chance: a live 20-question
    run on 15-09-26 had it at option A 13 times. Unshuffled, a learner can score well
    by always picking A.
    """
    order = list(range(4))
    secrets.SystemRandom().shuffle(order)
    return {
        "question": question["question"].strip(),
        "options": [question["options"][index].strip() for index in order],
        "correct": order.index(question["correct"]),
        "explanations": [question["explanations"][index].strip() for index in order],
    }


def fresh_questions(config: ProviderConfig, root: Path, count: int,
                    blocks: set[tuple[int, int]] | None = None, name: str | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    """Write a new quiz with the model from randomly chosen book sections.

    Sections are drawn without replacement; a couple of spares are held back so a
    section whose call fails is replaced instead of shrinking the quiz. Returns the
    questions (shuffled) and the error messages of any calls that failed.
    """
    pool = all_theory_blocks(root, name)
    if blocks:
        # The learner ticked chapters and blocks on the quiz setup screen (17-09-26).
        pool = [target for target in pool if target in blocks]
    rng = secrets.SystemRandom()
    needed = -(-count // QUESTIONS_PER_SECTION)
    picks = rng.sample(pool, min(len(pool), needed + SPARE_SECTIONS))
    plan = [(picks[index], min(QUESTIONS_PER_SECTION, count - index * QUESTIONS_PER_SECTION)) for index in range(min(needed, len(picks)))]
    spares = picks[len(plan):]

    def one(target: tuple[int, int], size: int) -> list[dict[str, Any]]:
        chapter_title, source = source_for_block(root, *target, name)
        return provider_questions(config, chapter_title, source, size, exact=False)

    questions: list[dict[str, Any]] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=FRESH_PARALLEL_CALLS) as pool_executor:
        pending = [(size, pool_executor.submit(one, target, size)) for target, size in plan]
        while pending:
            retry: list[tuple[int, Any]] = []
            for size, future in pending:
                try:
                    questions.extend(future.result())
                except (ValueError, IndexError, KeyError, OSError, json.JSONDecodeError) as error:
                    errors.append(str(error))
                    if spares:
                        retry.append((size, pool_executor.submit(one, spares.pop(), size)))
            pending = retry
    rng.shuffle(questions)
    return questions[:count], errors



def book_pages(module_id: str) -> list[str]:
    """The book's page text, cached by mtime. Empty list when a module has no book."""
    name = BOOK_FILES.get(module_id)
    if not name:
        return []
    path = BOOK_ROOT / name
    try:
        stamp = path.stat().st_mtime
    except OSError:
        return []
    cached = _BOOK_CACHE.get(module_id)
    if cached and cached[0] == stamp:
        return cached[1]
    try:
        pages = json.loads(path.read_text(encoding="utf-8")).get("pages") or []
    except (OSError, json.JSONDecodeError, AttributeError):
        return []
    pages = [str(p or "") for p in pages]
    _BOOK_CACHE[module_id] = (stamp, pages)
    return pages


def book_document_frequency(module_id: str) -> dict[str, int]:
    """How many pages each word appears on, cached per book."""
    cached = _BOOK_DF.get(module_id)
    pages = book_pages(module_id)
    if cached and cached[0] == len(pages):
        return cached[1]
    df: dict[str, int] = defaultdict(int)
    for text in pages:
        for word in set(re.findall(r"[a-z0-9]+", text.lower())):
            df[word] += 1
    _BOOK_DF[module_id] = (len(pages), df)
    return df


def book_chapters(module_id: str) -> list[tuple[int, int, int]]:
    """(chapter number, first page, last page) from the book's own outline.

    Used to keep the search inside the body -- the index and the table of contents
    are dense with rare words and otherwise win every query -- and to prefer the
    chapter the learner is actually reading.
    """
    cached = _BOOK_CHAPTERS.get(module_id)
    if cached is not None:
        return cached
    name = BOOK_FILES.get(module_id)
    rows: list[tuple[int, int, int]] = []
    if name:
        try:
            outline = json.loads((BOOK_ROOT / name).read_text(encoding="utf-8")).get("outline") or []
        except (OSError, json.JSONDecodeError, AttributeError):
            outline = []
        starts: list[tuple[int, int]] = []
        tail = len(book_pages(module_id))
        for entry in outline:
            if not isinstance(entry, dict):
                continue
            found = re.match(r"^\s*(\d{1,2})\.\s", str(entry.get("title") or ""))
            page = entry.get("page")
            if found and isinstance(page, int):
                starts.append((int(found.group(1)), page))
            elif isinstance(page, int) and starts and re.match(r"^\s*(Appendix|Index)\b", str(entry.get("title") or ""), re.I):
                tail = min(tail, page)
        starts.sort()
        for i, (number, start) in enumerate(starts):
            end = starts[i + 1][1] - 1 if i + 1 < len(starts) else tail - 1
            rows.append((number, start, end))
    _BOOK_CHAPTERS[module_id] = rows
    return rows


def book_search(module_id: str, query: str, limit: int = ASK_BOOK_PAGES, chapter: int | None = None) -> list[dict[str, Any]]:
    """Keyword search over the book, weighted by how rare each word is.

    Deliberately not embeddings: the book is ~1.8 MB, the lesson already pins the
    topic, and a vector store would add a dependency and a build step for recall
    this does not need.

    Plain term-frequency was measured returning pages 877/554/256 for "why is the
    error squared" -- the filler words carried the match. Weighting each term by
    1/document-frequency makes a word that appears on 40 pages outrank one that
    appears on 600, which is what puts the right chapter first.
    """
    pages = book_pages(module_id)
    terms = {w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 2 and w not in ASK_STOPWORDS}
    if not pages or not terms:
        return []
    chapters = book_chapters(module_id)
    body = (chapters[0][1], chapters[-1][2]) if chapters else (0, len(pages) - 1)
    here = next(((a, b) for n, a, b in chapters if n == chapter), None)
    df = book_document_frequency(module_id)
    total = len(pages)
    weights = {t: math.log(1 + total / (1 + df.get(t, 0))) for t in terms}
    # A term on more than this share of pages says nothing about which page to pick.
    common = {t for t in terms if df.get(t, 0) > total * ASK_COMMON_TERM_SHARE}
    useful = {t for t in terms if t not in common} or terms
    scored: list[tuple[float, int, int]] = []
    for index, text in enumerate(pages):
        if not body[0] <= index <= body[1]:
            continue                       # front matter, appendices and the index
        low = text.lower()
        score = sum(low.count(term) * weights[term] for term in useful if term in low)
        if not score:
            continue
        if here and here[0] <= index <= here[1]:
            score *= ASK_SAME_CHAPTER_BOOST          # what they are reading now
        elif here and here[0] - 40 <= index <= here[1] + 40:
            score *= ASK_NEAR_CHAPTER_BOOST
        scored.append((round(score, 4), len({t for t in useful if t in low}), index))
    scored.sort(reverse=True)
    out: list[dict[str, Any]] = []
    for _score, _distinct, index in scored[:limit]:
        text = pages[index]
        low = text.lower()
        first = min((low.find(t) for t in useful if t in low), default=0)
        start = max(0, first - ASK_EXCERPT_CHARS // 3)
        out.append({"page": index, "text": " ".join(text[start:start + ASK_EXCERPT_CHARS].split())})
    return out


ASK_SYSTEM = (
    "You are the learner's tutor inside a study app. They are a junior data engineer: strong on SQL, "
    "tables, Spark and ETL, new to machine learning, and weak on Python, pandas and NumPy.\n\n"
    "HOW TO TALK. Like a person explaining to a colleague at a desk, not like a textbook. Short "
    "sentences. One idea at a time. Answer the actual question in the first sentence, then explain. "
    "Gloss every piece of jargon the first time you use it. Use an analogy from their world - a table, "
    "a SELECT, a GROUP BY, a full refresh versus an incremental load - whenever it is genuinely "
    "accurate, and skip it when it is not. Plain words over precise-sounding ones. No preamble, no "
    "'great question', no bullet-point dumps, no emoji. If they ask something short, answer short.\n\n"
    "WHERE ANSWERS COME FROM, in this order:\n"
    "1. THE LESSON they are reading. Use it first - it is on their screen.\n"
    "2. THE BOOK EXCERPTS supplied. Use these when the lesson does not cover it. It is fine to reach "
    "ahead of where they are; say so plainly when you do.\n"
    "3. YOUR OWN KNOWLEDGE, when neither covers it. Say that is what you are doing.\n\n"
    "FIRST LINE OF YOUR REPLY must be exactly one of:\n"
    "SOURCE: lesson\n"
    "SOURCE: book p.<page number>\n"
    "SOURCE: general\n"
    "Then a blank line, then the answer. Never invent a page number, a paper, an author or a URL. "
    "If you are unsure, say you are unsure - that is more useful to them than a confident guess."
)
SOURCE_LINE = re.compile(r"^\s*SOURCE:\s*(lesson|book|general)\b[^\n]*", re.I)


def ask_tutor(config: "ProviderConfig", chapter_title: str, lesson_term: str, lesson: str,
              question: str, history: list[dict[str, str]], excerpts: list[dict[str, Any]]) -> dict[str, Any]:
    context = [f"THE LESSON THEY ARE READING\nChapter: {chapter_title}\nLesson: {lesson_term}\n\n{lesson}"]
    if excerpts:
        joined = "\n\n".join(f"[book page {e['page']}]\n{e['text']}" for e in excerpts)
        context.append("BOOK EXCERPTS THAT MAY BE RELEVANT\n\n" + joined)
    messages: list[dict[str, str]] = [{"role": "system", "content": ASK_SYSTEM},
                                      {"role": "system", "content": "\n\n".join(context)}]
    messages.extend(history[-ASK_HISTORY_TURNS:])
    messages.append({"role": "user", "content": question})
    body = {"model": config.model, "messages": messages, "temperature": 0.4, "stream": True}
    request = Request(config.api_url, data=json.dumps(body).encode("utf-8"),
                      headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
                      method="POST")
    try:
        with urlopen(request, timeout=PROVIDER_TIMEOUT_SECONDS) as response:
            content = response_content(response.read(), response.headers.get("Content-Type", ""))
    except HTTPError as error:
        raise ValueError(f"Provider request failed ({error.code}).") from error
    except (URLError, TimeoutError, OSError) as error:
        raise ValueError("Provider could not be reached.") from error
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Provider returned an invalid response.") from error
    content = (content or "").strip()
    if not content:
        raise ValueError("The model returned an empty answer.")
    source, page = "general", None
    match = SOURCE_LINE.match(content)
    if match:
        source = match.group(1).lower()
        found = re.search(r"p\.?\s*(\d{1,4})", match.group(0))
        page = int(found.group(1)) if found else None
        content = content[match.end():].lstrip("\n").strip()
    return {"answer": content, "source": source, "page": page,
            "pages": [e["page"] for e in excerpts]}


class EduHandler(SimpleHTTPRequestHandler):
    server_version = "EduArgumentation/1.0"

    @property
    def root(self) -> Path:
        return Path(self.directory).resolve()

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        return not origin or origin.split("//", 1)[-1].rstrip("/") == self.headers.get("Host", "")

    def admin_ok(self) -> bool:
        """Settings are open unless an operator deliberately sets a lock.

        This host is single-user and reachable only over the LAN/VPN, so a
        password on the settings form is friction without a matching threat: the
        same people can already use the page. The API key is still never readable
        through this API -- it can be replaced, never retrieved -- which is the
        property that actually matters. Set EDU_ADMIN_TOKEN to turn the gate on.
        """
        expected = os.getenv("EDU_ADMIN_TOKEN", "").strip()
        if not expected:
            return True
        return secrets.compare_digest(self.headers.get("X-Edu-Admin-Token", ""), expected)

    def settings_payload(self) -> dict[str, Any]:
        values = current_env_values()
        # The API key is NEVER returned, not even partially. The page only needs
        # to know whether one is set.
        return {
            "api_url": values["EDU_QUIZ_API_URL"],
            "model": values["EDU_QUIZ_MODEL"],
            "json_mode": values["EDU_QUIZ_JSON_MODE"].lower() != "false",
            "api_key_set": bool(values["EDU_QUIZ_API_KEY"]),
            "access_token_set": bool(values["EDU_QUIZ_ACCESS_TOKEN"]),
            "ready": ProviderConfig.from_environment() is not None,
            "general": read_general_settings(),
            "admin_required": bool(os.getenv("EDU_ADMIN_TOKEN", "").strip()),
        }

    def send_asset(self, route: str) -> bool:
        """GET /assets/<moduleId>/<fig-10-3.png>. Both parts are pattern-checked and the
        resolved path must stay inside ASSET_ROOT, so no request can read outside it."""
        parts = route.split("/")
        if len(parts) != 4 or parts[1] != "assets":
            return False
        module, name = parts[2], parts[3]
        if not MODULE_ID.match(module) or not ASSET_FILE.match(name):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "No such asset."})
            return True
        path = (ASSET_ROOT / module / name).resolve()
        if path.parent != (ASSET_ROOT / module).resolve() or not path.is_file():
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "No such asset."})
            return True
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        # Crops are content-addressed by label and re-extraction rewrites them in
        # place; a short cache keeps a fix visible without a hard refresh.
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_GET(self) -> None:
        route = self.path.split("?", 1)[0]
        if route.startswith("/assets/") and self.send_asset(route):
            return
        if route == "/api/provider":
            config = ProviderConfig.from_environment()
            general = read_general_settings()
            self.send_json(HTTPStatus.OK, {
                "ready": config is not None,
                "model": config.model if config else None,
                "token_required": bool(general["require_access_token"] and config and config.access_token),
                "admin_required": bool(os.getenv("EDU_ADMIN_TOKEN", "").strip()),
            })
            return
        if route == "/api/general":
            self.send_json(HTTPStatus.OK, read_general_settings())
            return
        if route == "/api/modules":
            self.send_json(HTTPStatus.OK, {"books": list_modules(self.root)})
            return
        if route == "/api/progress":
            query = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
            self.send_json(HTTPStatus.OK, read_progress(module_key((query.get("module") or [""])[0])))
            return
        if route == "/api/settings":
            if not self.admin_ok():
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "A valid admin token is required."})
                return
            self.send_json(HTTPStatus.OK, self.settings_payload())
            return
        super().do_GET()

    def save_settings(self) -> None:
        payload = read_json(self)
        values = current_env_values()
        general = read_general_settings()

        if "api_url" in payload:
            url = str(payload["api_url"]).strip()
            if url and not valid_api_url(url):
                raise ValueError("The endpoint must be https://, or http:// on localhost.")
            values["EDU_QUIZ_API_URL"] = url
        if "model" in payload:
            values["EDU_QUIZ_MODEL"] = str(payload["model"]).strip()
        if "json_mode" in payload:
            values["EDU_QUIZ_JSON_MODE"] = "true" if payload["json_mode"] else "false"
        # An omitted api_key keeps the stored one; an explicit empty string clears
        # it. Without that distinction, saving any other field would wipe the key.
        if "api_key" in payload:
            values["EDU_QUIZ_API_KEY"] = str(payload["api_key"]).strip()
        if "access_token" in payload:
            values["EDU_QUIZ_ACCESS_TOKEN"] = str(payload["access_token"]).strip()

        for key, caster, low, high in (("ai_question_count", int, 3, MAX_QUESTIONS), ("fresh_quiz_size", int, MIN_FRESH_QUESTIONS, MAX_FRESH_QUESTIONS)):
            if key in payload:
                number = caster(payload[key])
                if not low <= number <= high:
                    raise ValueError(f"{key.replace('_', ' ')} must be between {low} and {high}.")
                general[key] = number
        if "require_access_token" in payload:
            general["require_access_token"] = bool(payload["require_access_token"])

        write_env_file(values)
        write_atomic(SETTINGS_PATH, json.dumps(general, indent=2) + "\n")
        # Apply to the live process too, so the operator does not have to restart
        # the service for the change to take effect.
        for field, value in values.items():
            os.environ[field] = value
        self.send_json(HTTPStatus.OK, self.settings_payload())

    def save_progress(self) -> None:
        """Record a completed block, or reset everything.

        A block counts as complete only on a perfect score, which is what the
        reader asked for: 100% or it does not count. The server re-checks that
        rather than trusting a `complete: true` flag from the page, so a stray
        client cannot mark a block it did not pass.
        """
        payload = read_json(self)
        module = module_key(payload.get("module"))
        if payload.get("reset") is True:
            self.send_json(HTTPStatus.OK, reset_progress(module))
            return

        block = str(payload.get("block", "")).strip()
        if not BLOCK_ID.match(block):
            raise ValueError("block must look like ch01-b07.")
        try:
            score = int(payload.get("score"))
            total = int(payload.get("total"))
        except (TypeError, ValueError):
            raise ValueError("score and total must be whole numbers.")
        if total <= 0 or score < 0 or score > total:
            raise ValueError("score must be between 0 and total, and total must be positive.")
        source = str(payload.get("source", "written")).strip()[:16] or "written"

        if score != total:
            # Not an error -- an honest "not yet". Return the unchanged store so
            # the page can repaint from one shape either way.
            self.send_json(HTTPStatus.OK, {**read_progress(module), "marked": False})
            return
        self.send_json(HTTPStatus.OK, {**mark_block_complete(module, block, score, total, source), "marked": True})

    def proxy_run(self, route: str) -> None:
        """Validate, rate-limit and forward a code-runner call to dn2."""
        now = time.monotonic()
        history = RUN_HISTORY[self.client_address[0]]
        while history and history[0] <= now - RUN_RATE_LIMIT_SECONDS:
            history.popleft()
        if len(history) >= RUN_RATE_LIMIT_REQUESTS:
            self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many runs. Wait a minute."})
            return
        history.append(now)
        try:
            payload = read_json(self, RUN_MAX_REQUEST_BYTES)
            body: dict[str, Any] = {
                "module": str(payload.get("module", "")),
                "lesson": str(payload.get("lesson", "")),
                "session": str(payload.get("session", "")),
            }
            if body["module"] not in RUN_MODULES or not BLOCK_ID.match(body["lesson"]) or not RUN_SESSION.match(body["session"]):
                raise ValueError("module, lesson or session is invalid.")
            if route == "/api/run":
                cells = payload.get("cells")
                if not isinstance(cells, list) or not 1 <= len(cells) <= 50:
                    raise ValueError("cells must be a non-empty list.")
                body["cells"] = []
                for cell in cells:
                    if not isinstance(cell, dict) or not RUN_CELL_ID.match(str(cell.get("id", ""))) or not isinstance(cell.get("source"), str):
                        raise ValueError("a cell is invalid.")
                    body["cells"].append({"id": cell["id"], "source": cell["source"]})
                body["target"] = str(payload.get("target", ""))
                if body["target"] not in {cell["id"] for cell in body["cells"]}:
                    raise ValueError("target must be one of the cells.")
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        base, key = os.getenv("EDU_RUNNER_URL", "").strip().rstrip("/"), os.getenv("EDU_RUNNER_KEY", "").strip()
        if not base.startswith("http://") or not key:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"error": "Runner unavailable"})
            return
        request = Request(base + RUN_UPSTREAM[route], data=json.dumps(body).encode("utf-8"), method="POST",
                          headers={"Content-Type": "application/json", "X-Edu-Runner-Key": key})
        try:
            with urlopen(request, timeout=RUN_TIMEOUT_SECONDS) as response:
                result = json.loads(response.read())
        except HTTPError as error:
            # Runner input errors and busy/full answers pass through; auth or
            # anything else is a broken link between the two hosts.
            try:
                detail = json.loads(error.read()).get("error", "")
            except (ValueError, OSError):
                detail = ""
            if error.code in (400, 409, 503):
                self.send_json(HTTPStatus(error.code), {"error": detail or "Runner refused the request."})
            else:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": "Runner unavailable"})
            return
        except (URLError, TimeoutError, OSError, ValueError):
            self.send_json(HTTPStatus.BAD_GATEWAY, {"error": "Runner unavailable"})
            return
        if route != "/api/run":
            result = {"ok": True}
        self.send_json(HTTPStatus.OK, result)

    def do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route not in ("/api/quiz", "/api/quiz/fresh", "/api/ask", "/api/settings", "/api/progress") + RUN_ROUTES:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown API route."})
            return
        if not self.same_origin():
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "Cross-origin requests are not allowed."})
            return

        if route in RUN_ROUTES:
            self.proxy_run(route)
            return

        if route == "/api/progress":
            try:
                self.save_progress()
            except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        if route == "/api/settings":
            if not self.admin_ok():
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "A valid admin token is required."})
                return
            try:
                self.save_settings()
            except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        config = ProviderConfig.from_environment()
        if config is None:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "The AI quiz provider is not configured."})
            return
        general = read_general_settings()
        if general["require_access_token"] and config.access_token:
            if not secrets.compare_digest(self.headers.get("X-Edu-Quiz-Token", ""), config.access_token):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "A valid generation access token is required."})
                return
        if route == "/api/ask":
            # Its own budget: asking a follow-up is a normal part of reading, so it
            # must not burn the hourly quiz allowance.
            moment = time.monotonic()
            asked = ASK_HISTORY[self.client_address[0]]
            while asked and asked[0] <= moment - ASK_RATE_LIMIT_SECONDS:
                asked.popleft()
            if len(asked) >= ASK_RATE_LIMIT_REQUESTS:
                self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many questions just now. Try again shortly."})
                return
            try:
                payload = read_json(self)
                book = str(payload.get("module") or DEFAULT_MODULE)
                chapter, block = int(payload.get("chapter")), int(payload.get("block"))
                question = str(payload.get("question") or "").strip()
                if not question:
                    raise ValueError("Ask a question first.")
                if len(question) > ASK_MAX_QUESTION:
                    raise ValueError(f"Keep the question under {ASK_MAX_QUESTION} characters.")
                if chapter < 1 or block < 1:
                    raise ValueError("Chapter or lesson is invalid.")
                turns: list[dict[str, str]] = []
                for entry in (payload.get("history") or [])[-ASK_HISTORY_TURNS:]:
                    role = str((entry or {}).get("role") or "")
                    text = str((entry or {}).get("content") or "").strip()
                    if role in ("user", "assistant") and text:
                        turns.append({"role": role, "content": text[:2_000]})
                chapter_title, lesson = source_for_block(self.root, chapter, block, book)
                module = load_module(self.root, book)
                term = module["tutorialData"]["sections"][chapter - 1]["items"][block - 1].get("term", "")
                excerpts = book_search(module_id_for(module), f"{question} {term}", chapter=chapter)
            except (ValueError, TypeError, IndexError, KeyError, AttributeError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            asked.append(moment)
            try:
                reply = ask_tutor(config, chapter_title, term, lesson, question, turns, excerpts)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                return
            self.send_json(HTTPStatus.OK, reply)
            return

        now = time.monotonic()
        history = REQUEST_HISTORY[self.client_address[0]]
        while history and history[0] <= now - RATE_LIMIT_SECONDS:
            history.popleft()
        if len(history) >= RATE_LIMIT_REQUESTS:
            self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Generation limit reached. Try again later."})
            return
        if route == "/api/quiz/fresh":
            try:
                payload = read_json(self)
                book = str(payload.get("module") or DEFAULT_MODULE)
                module_path(self.root, book)
                count = int(payload.get("count", general["fresh_quiz_size"]))
                if not MIN_FRESH_QUESTIONS <= count <= MAX_FRESH_QUESTIONS:
                    raise ValueError(f"A fresh quiz must have between {MIN_FRESH_QUESTIONS} and {MAX_FRESH_QUESTIONS} questions.")
                blocks = None
                if payload.get("blocks") is not None:
                    raw = payload["blocks"]
                    valid = set(all_theory_blocks(self.root, book))
                    if not isinstance(raw, list) or not raw or len(raw) > len(valid):
                        raise ValueError("Blocks must be a non-empty list.")
                    blocks = {(int(pair[0]), int(pair[1])) for pair in raw}
                    if not blocks <= valid:
                        raise ValueError("A selected block does not exist.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            # One fresh quiz is one learner action, so it takes one rate-limit slot
            # even though it fans out into several provider calls.
            history.append(now)
            questions, errors = fresh_questions(config, self.root, count, blocks, book)
            if not questions:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": errors[0] if errors else "The model returned no questions."})
                return
            self.send_json(HTTPStatus.OK, {"questions": questions, "requested": count, "failed_calls": len(errors)})
            return

        try:
            payload = read_json(self)
            book = str(payload.get("module") or DEFAULT_MODULE)
            chapter, block = int(payload.get("chapter")), int(payload.get("block"))
            count = int(payload.get("count", general["ai_question_count"]))
            if chapter < 1 or block < 1 or not 3 <= count <= MAX_QUESTIONS:
                raise ValueError("Chapter, block, or question count is invalid.")
            chapter_title, source = source_for_block(self.root, chapter, block, book)
            questions = provider_questions(config, chapter_title, source, count)
        except (ValueError, IndexError, KeyError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        history.append(now)
        self.send_json(HTTPStatus.OK, {"questions": questions})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", default=8767, type=int)
    parser.add_argument("--directory", default=Path(__file__).parent)
    args = parser.parse_args()
    handler = lambda *values, **kwargs: EduHandler(*values, directory=str(args.directory), **kwargs)
    ThreadingHTTPServer((args.bind, args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
