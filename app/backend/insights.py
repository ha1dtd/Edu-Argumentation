"""Account insights — Account page redesign A + B + C (23-11-26, plan account-redesign_23-11-26).

Two read-only views, both for the SIGNED-IN account only (router: addons/account_insights.py):

  overview(account_id, now)        account-wide: today / this week / streak, the book he studied last, and one
                                   summary per book (cards due, stages, currently wrong, 7-day accuracy, time).
  insights(account_id, module, spec, now)
                                   one book: weak topics, what is improving, a 16-week activity heatmap, a
                                   12-week trend, time per topic and per session, the review schedule and the
                                   Hard / Good / Easy history.

Everything that decides a number is a PURE function over plain rows (so gates/gate-insights-backend.py can
test it without a database); the two SQL readers at the bottom only fetch rows and call them.

Definitions (the page prints the same words):
  · a day is the learners' day, UTC+7 (store.STUDY_DAY_TZ);
  · "answered" / accuracy count every logged answer EXCEPT run_kind "retry" (a retry re-asks what was just
    shown wrong — store.MASTERY_RUN_KINDS applies the same rule);
  · "currently wrong" = distinct questions whose LATEST logged answer was wrong (it drops when he gets the
    question right later; the old "wrong answers recorded" counter only ever grew);
  · a topic is a chapter title without its "Chapter 7:" / "Practice 3:" prefix, so Chapter 8 "Databases" and
    Practice 7 "Databases" are ONE topic; a book with an exam block uses its domains;
  · weak = at least 5 answers, ranked by accuracy (lowest first), then by questions currently wrong;
  · trend of a topic = accuracy of its newest 10 answers vs the answers before them (needs >= 10 + >= 5):
    +10 points or more "improving", -10 or less "slipping", else "steady";
  · time = ms a question was on screen before it was answered (tab-hidden time excluded, 5 min cap per
    question). Only answers logged since migration 008 carry it; the reply says how many do.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import store

TZ = store.STUDY_DAY_TZ
OFFSET_HOURS = int(TZ.utcoffset(None).total_seconds() // 3600)         # 7 — used by the SQL day buckets

MIN_ANSWERS = store.MASTERY_MIN_ANSWERS        # 5: fewer answers -> "not enough yet", never ranked
TREND_RECENT, TREND_EARLIER_MIN, TREND_STEP = 10, 5, 10
TOPIC_WINDOW = 300                              # newest answers per topic that count
HEATMAP_WEEKS = 16
TREND_WEEKS = 12
SESSIONS_SHOWN = 15
WEAK_SHOWN, IMPROVING_SHOWN, TIME_TOPICS_SHOWN = 8, 5, 12
FETCH_DAYS, FETCH_ROWS = 400, 30000
COUNTED_KINDS = ("quiz", "practice", "review", "exam")      # everything but "retry"
STAGES = ("new", "learning", "young", "mature")
AI_TOPIC = "AI-written questions"


# --------------------------------------------------------------------------- dates
def local_date(moment: datetime) -> date:
    return moment.astimezone(TZ).date()


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())          # Monday


def _iso(day: date) -> str:
    return day.isoformat()


def _pct(right: int, total: int) -> int | None:
    return round(100 * right / total) if total else None


# --------------------------------------------------------------------------- streak
def streak_from_days(days: Iterable[date], today: date) -> dict[str, Any]:
    """{current, longest, activeDays30, lastActive}. `current` runs back from today, or from yesterday when
    today has no activity yet (the day is not over), so a streak never reads 0 at 08:00 because he has not
    started. A gap of one whole day ends it."""
    have = set(days)
    if not have:
        return {"current": 0, "longest": 0, "activeDays30": 0, "lastActive": None}
    cursor = today if today in have else today - timedelta(days=1)
    current = 0
    while cursor in have:
        current += 1
        cursor -= timedelta(days=1)
    longest = run = 0
    previous: date | None = None
    for day in sorted(have):
        run = run + 1 if previous is not None and (day - previous).days == 1 else 1
        longest = max(longest, run)
        previous = day
    window = today - timedelta(days=29)
    return {"current": current, "longest": longest, "activeDays30": sum(1 for d in have if window <= d <= today),
            "lastActive": _iso(max(have))}


# --------------------------------------------------------------------------- areas, groups, topics
_PREFIX = re.compile(r"^(Chapter|Practice)\s+\d+\s*[:.\-–]\s*", re.I)
_PRACTICE = re.compile(r"^Practice\s+\d+", re.I)
_CHAPTER = re.compile(r"^Chapter\s+\d+", re.I)


def topic_of(name: str) -> str:
    """"Chapter 8: Databases" / "Practice 7: Databases" -> "Databases"."""
    stripped = _PREFIX.sub("", name or "").strip()
    return stripped or (name or "").strip()


def area_groups(spec: dict[str, Any]) -> dict[str, str]:
    """area id -> "chapters" | "practice" | "other". A domain book: every domain is "chapters" (the UI says
    "domain"). A chapter book: "Practice N:" -> practice; "Chapter N:" -> chapters; any other title -> other
    (e.g. "Flagged community questions") unless NO title says "Chapter N", then it is a chapter."""
    areas = spec["areas"]
    if spec["kind"] == "domain":
        return {a["id"]: "chapters" for a in areas}
    has_prefix = any(_CHAPTER.match(a["name"]) for a in areas)
    out = {}
    for a in areas:
        if _PRACTICE.match(a["name"]):
            out[a["id"]] = "practice"
        elif _CHAPTER.match(a["name"]) or not has_prefix:
            out[a["id"]] = "chapters"
        else:
            out[a["id"]] = "other"
    return out


def build_topics(spec: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    """({topic key: {name, areas[], groups[]}}, {area id: topic key}). Areas with the same topic title merge;
    the topic name is the first area's title without its prefix (book order)."""
    groups = area_groups(spec)
    topics: dict[str, dict[str, Any]] = {}
    area_topic: dict[str, str] = {}
    for a in spec["areas"]:
        name = topic_of(a["name"]) if spec["kind"] == "chapter" else a["name"]
        key = re.sub(r"\s+", " ", name.lower())
        topic = topics.setdefault(key, {"name": name, "areas": [], "groups": [], "chapters": []})
        topic["areas"].append(a["id"])
        topic["chapters"] += list(a.get("chapters") or [])
        if groups[a["id"]] not in topic["groups"]:
            topic["groups"].append(groups[a["id"]])
        area_topic[a["id"]] = key
    return topics, area_topic


def topic_key_of_answer(row: dict[str, Any], spec: dict[str, Any], area_topic: dict[str, str]) -> str | None:
    """The topic one answer / card counts under; "ai" for an AI-written question with no chapter; None when it
    fits nothing (kept out of every topic row)."""
    area = store.area_of(row.get("chapter"), row.get("domain"), spec)
    if area is not None:
        return area_topic.get(area)
    return "ai" if str(row.get("key") or "").startswith("ai-") else None


# --------------------------------------------------------------------------- pure builders
def currently_wrong(answers_newest_first: list[dict[str, Any]]) -> dict[str, bool]:
    """{question key: its latest answer was wrong}, over every run kind."""
    latest: dict[str, bool] = {}
    for r in answers_newest_first:
        k = r.get("key")
        if k and k not in latest:
            latest[k] = not r["correct"]
    return latest


def topic_trend(newest_first: list[dict[str, Any]]) -> dict[str, Any]:
    """Accuracy of the newest TREND_RECENT answers vs the ones before. -> {recent, earlier, delta, label}."""
    if len(newest_first) < TREND_RECENT + TREND_EARLIER_MIN:
        return {"recent": None, "earlier": None, "delta": None, "label": "not enough yet"}
    recent, earlier = newest_first[:TREND_RECENT], newest_first[TREND_RECENT:]
    rp = _pct(sum(1 for r in recent if r["correct"]), len(recent))
    ep = _pct(sum(1 for r in earlier if r["correct"]), len(earlier))
    delta = rp - ep
    label = "improving" if delta >= TREND_STEP else "slipping" if delta <= -TREND_STEP else "steady"
    return {"recent": rp, "earlier": ep, "delta": delta, "label": label}


def build_topic_rows(spec: dict[str, Any], answers: list[dict[str, Any]], cards: list[dict[str, Any]],
                     now: datetime) -> dict[str, Any]:
    """Per-topic numbers from answers (newest first) and review cards. -> {rows[], weak[], improving[],
    slipping[], notStarted[], unassigned}. Rows follow the book's order; AI-written questions are one extra row."""
    topics, area_topic = build_topics(spec)
    wrong_now = currently_wrong(answers)
    per: dict[str, list[dict[str, Any]]] = defaultdict(list)
    keys_by_topic: dict[str, set[str]] = defaultdict(set)
    unassigned = 0
    for r in answers:
        tk = topic_key_of_answer(r, spec, area_topic)
        if tk is None:
            unassigned += 1
            continue
        if r.get("key"):
            keys_by_topic[tk].add(r["key"])
        if r["run_kind"] in COUNTED_KINDS and len(per[tk]) < TOPIC_WINDOW:
            per[tk].append(r)
    card_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"cards": 0, "lapses": 0, "leeches": 0, "due": 0})
    for c in cards:
        tk = topic_key_of_answer({"chapter": c.get("chapter"), "domain": None, "key": c["key"]}, spec, area_topic)
        if tk is None:
            continue
        cs = card_stats[tk]
        cs["cards"] += 1
        cs["lapses"] += int(c["lapses"])
        cs["leeches"] += 1 if c["lapses"] >= store.LEECH_LAPSES else 0
        cs["due"] += 1 if c["due_at"] <= now else 0

    ordered = list(topics.items()) + [("ai", {"name": AI_TOPIC, "areas": [], "groups": ["ai"], "chapters": []})]
    rows = []
    for tk, topic in ordered:
        mine = per.get(tk, [])
        right = sum(1 for r in mine if r["correct"])
        trend = topic_trend(mine)
        cs = card_stats.get(tk, {"cards": 0, "lapses": 0, "leeches": 0, "due": 0})
        wrong_n = sum(1 for k in keys_by_topic.get(tk, ()) if wrong_now.get(k))
        if tk == "ai" and not mine and not cs["cards"]:
            continue
        rows.append({"id": tk, "name": topic["name"], "groups": topic["groups"], "chapters": topic["chapters"],
                     "answered": len(mine), "right": right, "accuracy": _pct(right, len(mine)),
                     "enough": len(mine) >= MIN_ANSWERS, "currentlyWrong": wrong_n, "cards": cs["cards"],
                     "lapses": cs["lapses"], "leeches": cs["leeches"], "due": cs["due"],
                     "lastAt": mine[0]["at"].isoformat(timespec="seconds") if mine else None, "trend": trend})
    ranked = [r for r in rows if r["enough"] and r["id"] != "ai"]
    weak = sorted(ranked, key=lambda r: (r["accuracy"], -r["currentlyWrong"], -r["lapses"]))[:WEAK_SHOWN]
    improving = sorted((r for r in ranked if r["trend"]["label"] == "improving"),
                       key=lambda r: -r["trend"]["delta"])[:IMPROVING_SHOWN]
    slipping = sorted((r for r in ranked if r["trend"]["label"] == "slipping"),
                      key=lambda r: r["trend"]["delta"])[:IMPROVING_SHOWN]
    # "not started": a topic that exists as a CHAPTER (not only as a practice set) with no answer and no card yet.
    not_started = [r["name"] for r in rows if r["id"] != "ai" and "chapters" in r["groups"] and r["answered"] == 0
                   and r["cards"] == 0]
    return {"rows": rows, "weak": weak, "improving": improving, "slipping": slipping, "notStarted": not_started,
            "unassigned": unassigned}


def heatmap(days: dict[date, dict[str, int]], today: date, weeks: int = HEATMAP_WEEKS) -> dict[str, Any]:
    """Day cells from the Monday `weeks`-1 weeks ago through today. {from, days[{d, n, ms}], max}."""
    start = week_start(today) - timedelta(weeks=weeks - 1)
    cells, peak, cursor = [], 0, start
    while cursor <= today:
        d = days.get(cursor, {})
        n = int(d.get("n", 0))
        peak = max(peak, n)
        cells.append({"d": _iso(cursor), "n": n, "ms": int(d.get("ms", 0))})
        cursor += timedelta(days=1)
    return {"from": _iso(start), "days": cells, "max": peak}


def weekly_trend(answers: list[dict[str, Any]], grades: list[dict[str, Any]], today: date,
                 weeks: int = TREND_WEEKS) -> list[dict[str, Any]]:
    """One bucket per week (Monday start), oldest first, ending with the current week."""
    first = week_start(today) - timedelta(weeks=weeks - 1)
    buckets = {first + timedelta(weeks=i): {"start": _iso(first + timedelta(weeks=i)), "answered": 0, "right": 0,
                                            "reviews": 0, "reviewRight": 0, "ms": 0,
                                            "grades": {g: 0 for g in store.SRS_GRADES}} for i in range(weeks)}
    for r in answers:
        if r["run_kind"] not in COUNTED_KINDS:
            continue
        b = buckets.get(week_start(local_date(r["at"])))
        if b is None:
            continue
        b["answered"] += 1
        b["right"] += 1 if r["correct"] else 0
        b["ms"] += int(r.get("duration_ms") or 0)
        if r["run_kind"] == "review":
            b["reviews"] += 1
            b["reviewRight"] += 1 if r["correct"] else 0
    for g in grades:
        b = buckets.get(week_start(local_date(g["at"])))
        if b is not None and g["grade"] in b["grades"]:
            b["grades"][g["grade"]] += 1
    out = []
    for b in buckets.values():
        out.append({"start": b["start"], "answered": b["answered"], "accuracy": _pct(b["right"], b["answered"]),
                    "reviews": b["reviews"], "recall": _pct(b["reviewRight"], b["reviews"]), "ms": b["ms"],
                    "grades": b["grades"]})
    return out


def time_summary(spec: dict[str, Any], answers: list[dict[str, Any]]) -> dict[str, Any]:
    """Time per topic and per session from answers newest first. Only answers with a duration count."""
    topics, area_topic = build_topics(spec)
    names = {k: v["name"] for k, v in topics.items()}
    names["ai"] = AI_TOPIC
    per_topic: dict[str, dict[str, int]] = defaultdict(lambda: {"ms": 0, "tracked": 0, "answered": 0})
    tracked = 0
    first_tracked: datetime | None = None
    sessions: dict[str, dict[str, Any]] = {}
    for r in answers:
        ms = r.get("duration_ms")
        tk = topic_key_of_answer(r, spec, area_topic)
        if tk is not None:
            per_topic[tk]["answered"] += 1
            if ms is not None:
                per_topic[tk]["ms"] += int(ms)
                per_topic[tk]["tracked"] += 1
        if ms is not None:
            tracked += 1
            if first_tracked is None or r["at"] < first_tracked:
                first_tracked = r["at"]
        rid = r.get("run_id")
        if rid:
            s = sessions.setdefault(rid, {"runId": rid, "kind": r["run_kind"], "first": r["at"], "last": r["at"],
                                          "answered": 0, "right": 0, "ms": 0, "tracked": 0})
            s["answered"] += 1
            s["right"] += 1 if r["correct"] else 0
            s["first"], s["last"] = min(s["first"], r["at"]), max(s["last"], r["at"])
            if ms is not None:
                s["ms"] += int(ms)
                s["tracked"] += 1
    by_topic = [{"id": tk, "name": names.get(tk, tk), "ms": v["ms"], "tracked": v["tracked"], "answered": v["answered"],
                 "avgMs": round(v["ms"] / v["tracked"]) if v["tracked"] else None}
                for tk, v in per_topic.items() if v["tracked"]]
    by_topic.sort(key=lambda r: -r["ms"])
    listed = sorted(sessions.values(), key=lambda s: s["first"], reverse=True)
    timed = [s for s in listed if s["tracked"]]
    total_ms = sum(v["ms"] for v in per_topic.values())
    return {
        "totalMs": total_ms, "trackedAnswers": tracked, "untrackedAnswers": len(answers) - tracked,
        "since": first_tracked.isoformat(timespec="seconds") if first_tracked else None,
        "avgQuestionMs": round(total_ms / tracked) if tracked else None,
        "byTopic": by_topic[:TIME_TOPICS_SHOWN],
        "sessionsTotal": len(listed), "avgSessionMs": round(sum(s["ms"] for s in timed) / len(timed)) if timed else None,
        "sessions": [{"runId": s["runId"], "kind": s["kind"], "at": s["first"].isoformat(timespec="seconds"),
                      "answered": s["answered"], "right": s["right"], "ms": s["ms"] if s["tracked"] else None,
                      "wallMs": int((s["last"] - s["first"]).total_seconds() * 1000)} for s in listed[:SESSIONS_SHOWN]],
    }


def card_stage(card: dict[str, Any]) -> str:
    """new = never graded; learning = interval under 4 days; young = 4 to 13 days; mature = at the 14-day cap."""
    if card.get("last_reviewed_at") is None:
        return "new"
    interval = float(card["interval_days"])
    return "learning" if interval < 4 else "young" if interval < store.SRS_MAX_DAYS else "mature"


def srs_summary(cards: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    day0 = store.study_day_start(now)
    stages = {s: 0 for s in STAGES}
    next7 = [{"day": _iso((day0 + timedelta(days=i)).date()), "count": 0} for i in range(1, 8)]
    due_now = due_today = leeches = 0
    for c in cards:
        stages[card_stage(c)] += 1
        due_now += 1 if c["due_at"] <= now else 0
        due_today += 1 if c["due_at"] < day0 + timedelta(days=1) else 0
        leeches += 1 if c["lapses"] >= store.LEECH_LAPSES else 0
        for i in range(1, 8):
            if day0 + timedelta(days=i) <= c["due_at"] < day0 + timedelta(days=i + 1):
                next7[i - 1]["count"] += 1
    return {"total": len(cards), "dueNow": due_now, "dueToday": due_today, "leeches": leeches, "stages": stages,
            "next7": next7}


def grade_summary(grades: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {g: 0 for g in store.SRS_GRADES}
    for g in grades:
        if g["grade"] in counts:
            counts[g["grade"]] += 1
    first = min((g["at"] for g in grades), default=None)
    return {**counts, "total": sum(counts.values()), "since": first.isoformat(timespec="seconds") if first else None}


def calibration(answers: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """How often he was right when he said sure / unsure / guess (review answers that carry a tap)."""
    out = {c: {"n": 0, "right": 0} for c in store.CONFIDENCES}
    for r in answers:
        c = r.get("confidence")
        if c in out:
            out[c]["n"] += 1
            out[c]["right"] += 1 if r["correct"] else 0
    return out


def build_insights(module: str, spec: dict[str, Any], answers: list[dict[str, Any]], cards: list[dict[str, Any]],
                   grades: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    """The whole /api/account/insights reply from plain rows (answers newest first)."""
    today = local_date(now)
    topic = build_topic_rows(spec, answers, cards, now)
    by_day: dict[date, dict[str, int]] = defaultdict(lambda: {"n": 0, "ms": 0})
    for r in answers:
        d = by_day[local_date(r["at"])]
        d["n"] += 1
        d["ms"] += int(r.get("duration_ms") or 0)
    cutoff = now - timedelta(days=store.RETENTION_DAYS)
    recent_reviews = [r for r in answers if r["run_kind"] == "review" and r["at"] >= cutoff]
    return {
        "module": module, "areaKind": spec["kind"], "now": now.isoformat(timespec="seconds"),
        "topics": topic["rows"], "weak": topic["weak"], "improving": topic["improving"], "slipping": topic["slipping"],
        "notStarted": topic["notStarted"], "unassigned": topic["unassigned"], "minAnswers": MIN_ANSWERS,
        "heatmap": heatmap(by_day, today), "weeks": weekly_trend(answers, grades, today),
        "time": time_summary(spec, answers), "srs": srs_summary(cards, now), "grades": grade_summary(grades),
        "retention30": _pct(sum(1 for r in recent_reviews if r["correct"]), len(recent_reviews)),
        "reviews30": len(recent_reviews), "calibration": calibration(answers),
        "currentlyWrong": sum(1 for wrong in currently_wrong(answers).values() if wrong),
        "answeredTotal": len(answers),
    }


def build_overview(now: datetime, day_rows: list[dict[str, Any]], other_days: Iterable[date],
                   books: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """The whole /api/account/overview reply. `day_rows` = [{module, day, n, right, ms}] (counted kinds, one row
    per module x day); `other_days` = dates with lessons / grades (they keep a streak alive); `books` =
    {module: {lastAt, lessons, currentlyWrong, aiAnswered, cards: [...], }} already merged by the SQL reader."""
    today = local_date(now)
    wk = week_start(today)
    by_day: dict[date, dict[str, int]] = defaultdict(lambda: {"n": 0, "right": 0, "ms": 0})
    by_module: dict[str, dict[str, int]] = defaultdict(lambda: {"n7": 0, "r7": 0, "ms7": 0})
    for r in day_rows:
        d = by_day[r["day"]]
        d["n"] += r["n"]; d["right"] += r["right"]; d["ms"] += r["ms"]
        if today - timedelta(days=6) <= r["day"] <= today:
            m = by_module[r["module"]]
            m["n7"] += r["n"]; m["r7"] += r["right"]; m["ms7"] += r["ms"]
    week = {"n": 0, "right": 0, "ms": 0, "days": 0}
    for day, d in by_day.items():
        if wk <= day <= today:
            week["n"] += d["n"]; week["right"] += d["right"]; week["ms"] += d["ms"]
            week["days"] += 1 if d["n"] else 0
    prev = {"n": 0, "right": 0}
    for day, d in by_day.items():
        if wk - timedelta(days=7) <= day < wk:
            prev["n"] += d["n"]; prev["right"] += d["right"]
    t = by_day.get(today, {"n": 0, "right": 0, "ms": 0})
    streak = streak_from_days([d for d, v in by_day.items() if v["n"]] + list(other_days), today)
    out_books = []
    for module, b in books.items():
        m = by_module.get(module, {"n7": 0, "r7": 0, "ms7": 0})
        out_books.append({
            "module": module, "lastAt": b["lastAt"], "lessons": b["lessons"], "currentlyWrong": b["currentlyWrong"],
            "aiAnswered": b["aiAnswered"], "answered7": m["n7"], "accuracy7": _pct(m["r7"], m["n7"]),
            "ms7": m["ms7"], "srs": srs_summary(b["cards"], now),
        })
    out_books.sort(key=lambda r: r["lastAt"] or "", reverse=True)
    return {
        "now": now.isoformat(timespec="seconds"), "today": {"date": _iso(today), "answered": t["n"],
                                                             "accuracy": _pct(t["right"], t["n"]), "ms": t["ms"]},
        "week": {"start": _iso(wk), "answered": week["n"], "accuracy": _pct(week["right"], week["n"]),
                 "activeDays": week["days"], "ms": week["ms"], "prevAnswered": prev["n"],
                 "prevAccuracy": _pct(prev["right"], prev["n"])},
        "streak": streak, "lastBook": out_books[0]["module"] if out_books and out_books[0]["lastAt"] else None,
        "books": out_books,
        "totals": {"dueNow": sum(b["srs"]["dueNow"] for b in out_books),
                   "currentlyWrong": sum(b["currentlyWrong"] for b in out_books),
                   "cards": sum(b["srs"]["total"] for b in out_books)},
    }


# --------------------------------------------------------------------------- SQL readers
def _answers(conn: Any, account_id: int, module: str, now: datetime) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, question_key, chapter, domain, run_kind, run_id, correct, confidence, duration_ms, answered_at"
        " FROM answer_log WHERE account_id = %s AND module_id = %s AND answered_at >= %s ORDER BY id DESC LIMIT %s",
        (account_id, module, now - timedelta(days=FETCH_DAYS), FETCH_ROWS)).fetchall()
    return [{"id": r["id"], "key": r["question_key"], "chapter": r["chapter"], "domain": r["domain"],
             "run_kind": r["run_kind"], "run_id": r["run_id"], "correct": r["correct"], "confidence": r["confidence"],
             "duration_ms": r["duration_ms"], "at": r["answered_at"]} for r in rows]


def _cards(conn: Any, account_id: int, module: str | None = None) -> list[dict[str, Any]]:
    sql = ("SELECT module_id, question_key, lapses, reps, interval_days, due_at, last_reviewed_at FROM review_cards"
           " WHERE account_id = %s" + (" AND module_id = %s" if module is not None else ""))
    rows = conn.execute(sql, (account_id, module) if module is not None else (account_id,)).fetchall()
    out = []
    for r in rows:
        found = store.CHAPTER_OF_KEY.match(r["question_key"])
        out.append({"module": r["module_id"], "key": r["question_key"], "chapter": int(found.group(1)) if found else None,
                    "lapses": r["lapses"], "reps": r["reps"], "interval_days": r["interval_days"], "due_at": r["due_at"],
                    "last_reviewed_at": r["last_reviewed_at"]})
    return out


def insights(account_id: int, module: str, spec: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    import db

    now = now or datetime.now(timezone.utc)
    with db.connect() as conn:
        answers = _answers(conn, account_id, module, now)
        cards = _cards(conn, account_id, module)
        grades = [{"grade": r["grade"], "at": r["reviewed_at"]} for r in conn.execute(
            "SELECT grade, reviewed_at FROM review_log WHERE account_id = %s AND module_id = %s AND reviewed_at >= %s"
            " ORDER BY reviewed_at DESC LIMIT %s", (account_id, module, now - timedelta(days=FETCH_DAYS), FETCH_ROWS)).fetchall()]
    return build_insights(module, spec, answers, cards, grades, now)


def overview(account_id: int, now: datetime | None = None) -> dict[str, Any]:
    import db

    now = now or datetime.now(timezone.utc)
    off = f"interval '{OFFSET_HOURS} hours'"
    since = now - timedelta(days=FETCH_DAYS)
    with db.connect() as conn:
        day_rows = [{"module": r["module_id"], "day": r["d"], "n": int(r["n"]), "right": int(r["ok"]), "ms": int(r["ms"])}
                    for r in conn.execute(
            f"SELECT module_id, (answered_at AT TIME ZONE 'UTC' + {off})::date AS d, count(*) AS n,"
            " count(*) FILTER (WHERE correct) AS ok, COALESCE(sum(duration_ms), 0) AS ms FROM answer_log"
            " WHERE account_id = %s AND run_kind = ANY(%s) AND answered_at >= %s GROUP BY 1, 2",
            (account_id, list(COUNTED_KINDS), since)).fetchall()]
        other_days: set[date] = set()
        for table, column in (("attempts", "created_at"), ("review_log", "reviewed_at"), ("answer_log", "answered_at")):
            for r in conn.execute(
                    f"SELECT DISTINCT ({column} AT TIME ZONE 'UTC' + {off})::date AS d FROM {table}"
                    f" WHERE account_id = %s AND {column} >= %s", (account_id, since)).fetchall():
                other_days.add(r["d"])
        last = {r["module_id"]: r["at"] for r in conn.execute(
            "SELECT module_id, max(at) AS at FROM (SELECT module_id, max(answered_at) AS at FROM answer_log WHERE account_id = %s GROUP BY 1"
            " UNION ALL SELECT module_id, max(reviewed_at) FROM review_log WHERE account_id = %s GROUP BY 1"
            " UNION ALL SELECT module_id, max(completed_at) FROM progress WHERE account_id = %s GROUP BY 1) t GROUP BY module_id",
            (account_id, account_id, account_id)).fetchall()}
        lessons = {r["module_id"]: int(r["n"]) for r in conn.execute(
            "SELECT module_id, count(*) AS n FROM progress WHERE account_id = %s GROUP BY 1", (account_id,)).fetchall()}
        wrong = {r["module_id"]: int(r["n"]) for r in conn.execute(
            "SELECT module_id, count(*) FILTER (WHERE NOT correct) AS n FROM (SELECT DISTINCT ON (module_id, question_key)"
            " module_id, correct FROM answer_log WHERE account_id = %s ORDER BY module_id, question_key, id DESC) t GROUP BY 1",
            (account_id,)).fetchall()}
        ai = {r["module_id"]: int(r["n"]) for r in conn.execute(
            "SELECT module_id, count(*) AS n FROM answer_log WHERE account_id = %s AND question_key LIKE 'ai-%%' GROUP BY 1",
            (account_id,)).fetchall()}
        cards = _cards(conn, account_id)
    by_module_cards: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in cards:
        by_module_cards[c["module"]].append(c)
    modules = set(last) | set(lessons) | set(by_module_cards) | {m["module"] for m in day_rows}
    books = {m: {"lastAt": last[m].isoformat(timespec="seconds") if last.get(m) else None, "lessons": lessons.get(m, 0),
                 "currentlyWrong": wrong.get(m, 0), "aiAnswered": ai.get(m, 0), "cards": by_module_cards.get(m, [])}
             for m in modules}
    return build_overview(now, day_rows, other_days, books)
