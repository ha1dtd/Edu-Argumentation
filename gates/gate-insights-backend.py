#!/usr/bin/env python3
"""gate-insights-backend.py — Account page redesign A + B + C (23-11-26): the server half.

Leg 1 (python3, no service, no database): the pure rules of backend/insights.py (streak, topics merging chapter +
  practice set, weak ranking with the 5-answer rule, trend labels, currently wrong, retries left out, time per topic
  and per session, card stages), the answer_entry durationMs rule, migration 008 (additive, idempotent, written
  rollback the runner can never pick up), review_grade writes review_log after the duplicate guard, the two routes.
Leg 2 (`--live`; run with a venv that has requirements.txt): the REAL SQL against the ISOLATED gate database
  `edu_study_gate` (never `edu_study`): SSH tunnel to nn:5432 via the Tailscale name `nnt` -> `admin migrate --no-backup` x2
  -> a throwaway account -> answers / grades through store.log_answer / store.review_grade (the same functions the
  routes call) -> insights.overview / insights.insights -> the rollback file applied (review_log and duration_ms gone,
  version 7) -> migrate again (back to 8) -> account deleted (ON DELETE CASCADE).
Run:  python3 gates/gate-insights-backend.py
      /var/tmp/pcstudy/venv/bin/python gates/gate-insights-backend.py --live
Env:  IB_BACKEND (default app/backend; point at a /var/tmp copy to fault-inject), HB_GATE_DB_ENV (default
      ~/.config/foxai/edu-study-gate-db.env). Exit 1 on any FAIL. ⚠ clear __pycache__ of a mutated copy.
"""
import importlib.util, json, os, re, secrets, socket, subprocess, sys, time, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get("IB_BACKEND") or REPO / "app" / "backend").resolve()
sys.path.insert(0, str(BACKEND))
import store, insights  # noqa: E402
results = []


def check(cid, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {cid}  {detail}")


NOW = datetime(2026, 11, 23, 3, 0, tzinfo=timezone.utc)      # 10:00 on 23-11 in UTC+7
TODAY = NOW.astimezone(store.STUDY_DAY_TZ).date()
SECTIONS = ["Chapter 1: Storage", "Chapter 2: Databases", "Chapter 3: Networking", "Practice 1: Databases",
            "Practice 2: Storage", "Flagged community questions"]
BOOK = {"moduleId": "gate-ib", "tutorialData": {"title": "Gate", "sections": [{"title": t, "items": []} for t in SECTIONS]}, "quizData": []}
SPEC = store.area_spec(BOOK)
_n = [0]


def ans(chapter, correct, run_kind="practice", days_ago=0, key=None, run_id=None, ms=None, conf=None, hours=0):
    _n[0] += 1
    return {"id": _n[0], "key": key or (f"ch{chapter:02d}-b01-q{_n[0]}" if chapter else f"ai-{_n[0]:010d}"), "chapter": chapter,
            "domain": None, "run_kind": run_kind, "run_id": run_id, "correct": correct, "confidence": conf, "duration_ms": ms,
            "at": NOW - timedelta(days=days_ago, hours=hours)}


# ---------------------------------------------------------------- S: pure rules
d = lambda n: TODAY - timedelta(days=n)
check("S1 streak: today counts; a gap of one day ends it; longest is kept",
      insights.streak_from_days([d(0), d(1), d(2), d(5), d(6)], TODAY) == {"current": 3, "longest": 3, "activeDays30": 5, "lastActive": TODAY.isoformat()})
check("S2 streak: nothing yet today -> counts from yesterday (08:00 does not read 0); a 2-day gap -> 0",
      insights.streak_from_days([d(1), d(2)], TODAY)["current"] == 2 and insights.streak_from_days([d(2), d(3)], TODAY)["current"] == 0)
groups = insights.area_groups(SPEC)
check("S3 groups: Chapter N -> chapters, Practice N -> practice, anything else -> other",
      [groups[a["id"]] for a in SPEC["areas"]] == ["chapters"] * 3 + ["practice"] * 2 + ["other"], json.dumps(groups))
topics, area_topic = insights.build_topics(SPEC)
check("S4 'Chapter 2: Databases' and 'Practice 1: Databases' are ONE topic with chapters [2, 4]",
      topics["databases"]["chapters"] == [2, 4] and area_topic["ch02"] == area_topic["ch04"] == "databases", json.dumps(topics["databases"]))
rows = ([ans(2, i % 2 == 0, "practice", i % 20) for i in range(20)]                     # databases chapter: 50%
        + [ans(4, False, "practice", 1) for _ in range(4)]                                 # databases practice set: 0/4
        + [ans(1, True, "practice", 3) for _ in range(9)] + [ans(1, False, "practice", 5)]  # storage 9/10
        + [ans(3, False, "practice", 2) for _ in range(3)]                                 # networking 0/3 -> too few
        + [ans(1, False, "retry", 0) for _ in range(6)]                                    # retries must not count
        + [ans(None, False, "quiz", 0) for _ in range(2)])                                 # AI, no chapter
rows.sort(key=lambda r: (r["at"], r["id"]), reverse=True)
cards = [{"key": r["key"], "chapter": r["chapter"], "lapses": 7 if r["chapter"] == 2 and i < 2 else 1, "reps": 2, "interval_days": 5.0,
          "due_at": NOW - timedelta(hours=1), "last_reviewed_at": NOW} for i, r in enumerate([r for r in rows if r["chapter"] == 2][:5])]
res = insights.build_topic_rows(SPEC, rows, cards, NOW)
by = {r["id"]: r for r in res["rows"]}
check("S5 Databases = chapter + practice set together: 24 answers, 10 right (retries left out)", by["databases"]["answered"] == 24 and by["databases"]["right"] == 10, f"{by['databases']['answered']}/{by['databases']['right']}")
check("S6 retries are not counted: Storage 10 answers, 9 right (6 wrong retries ignored)", by["storage"]["answered"] == 10 and by["storage"]["right"] == 9, json.dumps({k: by["storage"][k] for k in ("answered", "right")}))
check("S7 weak = >= 5 answers, lowest accuracy first: Databases (42%) then Storage (90%); Networking (3 answers) never ranked",
      [w["id"] for w in res["weak"]] == ["databases", "storage"] and "networking" not in [w["id"] for w in res["weak"]] and not by["networking"]["enough"], json.dumps([w["id"] for w in res["weak"]]))
check("S8 'not started' lists chapters nobody touched or carded (none here: all 3 started); AI row exists with 2 answers",
      res["notStarted"] == [] and by["ai"]["answered"] == 2, json.dumps(res["notStarted"]))
check("S9 lapses / leeches / due come from the cards: 5 cards, 2 leeches, all 5 due, lapses 7+7+1+1+1 = 17",
      (by["databases"]["cards"], by["databases"]["leeches"], by["databases"]["due"], by["databases"]["lapses"]) == (5, 2, 5, 17), json.dumps({k: by["databases"][k] for k in ("cards", "leeches", "due", "lapses")}))
wrong = insights.currently_wrong([ans(1, True, key="ch01-b01-q1"), ans(1, False, key="ch01-b01-q1"), ans(1, False, key="ch01-b01-q2"), ans(1, True, key="ch01-b01-q2")])
check("S10 currently wrong = the LATEST answer of a question: right-then-wrong -> wrong (list is newest first)", wrong == {"ch01-b01-q1": False, "ch01-b01-q2": True}, json.dumps(wrong))
newest_first = [ans(1, True) for _ in range(10)] + [ans(1, False) for _ in range(10)]
check("S11 trend: newest 10 all right vs earlier all wrong -> improving +100; the reverse -> slipping; 14 answers -> not enough yet",
      insights.topic_trend(newest_first)["label"] == "improving" and insights.topic_trend(newest_first[::-1])["label"] == "slipping"
      and insights.topic_trend(newest_first[:14])["label"] == "not enough yet", json.dumps(insights.topic_trend(newest_first)))
t_rows = [ans(2, True, "review", 0, run_id="r1", ms=10000), ans(2, False, "review", 0, run_id="r1", ms=20000, hours=1), ans(4, True, "practice", 1, run_id="r2", ms=30000),
          ans(1, True, "practice", 1, run_id="r2", ms=None), ans(None, True, "quiz", 2, run_id="r3", ms=5000)]
t_rows.sort(key=lambda r: r["at"], reverse=True)
ts = insights.time_summary(SPEC, t_rows)
check("S12 time: only timed answers count (4 of 5); Databases (chapter + practice) 60 s; AI 5 s; total 65 s; avg 16 s",
      ts["trackedAnswers"] == 4 and ts["untrackedAnswers"] == 1 and ts["totalMs"] == 65000 and ts["byTopic"][0]["id"] == "databases" and ts["byTopic"][0]["ms"] == 60000 and ts["avgQuestionMs"] == 16250, json.dumps(ts["byTopic"]))
sess = {s["runId"]: s for s in ts["sessions"]}
check("S13 sessions: 3 runs, newest first; r1 = 2 answers, 1 right, 30 s; r2 (one untimed answer) counts only the timed 30 s",
      ts["sessionsTotal"] == 3 and ts["sessions"][0]["runId"] == "r1" and sess["r1"]["ms"] == 30000 and sess["r1"]["right"] == 1 and sess["r2"]["ms"] == 30000, json.dumps(ts["sessions"][0]))
c = lambda reviewed, interval, lapses=0, due=NOW + timedelta(days=1): {"key": "ch01-b01-q1", "chapter": 1, "lapses": lapses, "reps": 1, "interval_days": interval, "due_at": due, "last_reviewed_at": reviewed}
check("S14 card stages: never graded = new · < 4 d learning · 4-13 d young · 14 d (the cap) mature",
      [insights.card_stage(x) for x in (c(None, 0), c(NOW, 1), c(NOW, 4), c(NOW, 13.9), c(NOW, 14))] == ["new", "learning", "young", "young", "mature"])
hm = insights.heatmap({TODAY: {"n": 20, "ms": 5}, TODAY - timedelta(days=1): {"n": 1, "ms": 0}}, TODAY)
check("S15 heatmap starts on a Monday 15 weeks back, ends today; counts per day carry through (20 / 1)",
      datetime.fromisoformat(hm["from"]).weekday() == 0 and hm["days"][-1]["d"] == TODAY.isoformat() and hm["max"] == 20 and hm["days"][-1]["n"] == 20 and hm["days"][-2]["n"] == 1 and len(hm["days"]) == 15 * 7 + TODAY.weekday() + 1)
ov = insights.build_overview(NOW, [{"module": "m", "day": TODAY, "n": 4, "right": 3, "ms": 9000}, {"module": "m", "day": TODAY - timedelta(days=8), "n": 10, "right": 5, "ms": 0}],
                              [TODAY - timedelta(days=1)], {"m": {"lastAt": "2026-11-23T01:00:00+00:00", "lessons": 3, "currentlyWrong": 2, "aiAnswered": 1, "cards": cards}})
check("S16 overview: today 4 answers 75%; streak 2 (today + yesterday's lesson); lastBook m; week starts Monday 23-11",
      ov["today"]["answered"] == 4 and ov["today"]["accuracy"] == 75 and ov["streak"]["current"] == 2 and ov["lastBook"] == "m" and ov["week"]["start"] == "2026-11-23" and ov["totals"]["currentlyWrong"] == 2, json.dumps(ov["streak"]))
base = {"question": "ch01-b01-q1", "runKind": "practice", "correct": True, "clientId": str(uuid.uuid4())}
dur = lambda v: store.answer_entry({**base, "durationMs": v})["duration_ms"]
check("S17 durationMs: whole ms kept, rounded; absent / negative / over 1 h / bool / text -> not measured (None)",
      (dur(1500), dur(1499.6), dur(0), dur(None), dur(-1), dur(3_600_001), dur(True), dur("5")) == (1500, 1500, 0, None, None, None, None, None))
mig = (BACKEND / "migrations" / "008_review_log_time.sql").read_text(); down = (BACKEND / "migrations" / "rollback" / "008_review_log_time.down.sql").read_text()
check("S18 migration 008 is additive and idempotent (IF NOT EXISTS everywhere, no DROP / DELETE / UPDATE); the rollback drops both objects and the version row",
      "CREATE TABLE IF NOT EXISTS review_log" in mig and "ADD COLUMN IF NOT EXISTS duration_ms" in mig and "CREATE INDEX IF NOT EXISTS" in mig
      and not re.search(r"^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b", mig, re.M | re.I)
      and "DROP TABLE IF EXISTS review_log" in down and "DROP COLUMN IF EXISTS duration_ms" in down and "DELETE FROM schema_migrations WHERE version = 8" in down)
spec_ = importlib.util.spec_from_file_location("dbmod", BACKEND / "db.py")
check("S19 the runner globs only NNN_name.sql in migrations/ (not recursive): the rollback can never be applied by a deploy",
      all(re.match(r"^(\d{3})_[a-z0-9_]+\.sql$", p.name) for p in (BACKEND / "migrations").glob("*.sql")) and not list((BACKEND / "migrations").glob("*.down.sql")) and re.match(r"^\d{3}_", "008_review_log_time.sql") is not None)
src = (BACKEND / "store.py").read_text()
body = src[src.index("def review_grade("):src.index("def review_due(")]
check("S20 review_grade logs to review_log AFTER the duplicate guard (a resend is not logged twice), with confidence validated",
      body.index('"duplicate": True') < body.index("INSERT INTO review_log") and "ON CONFLICT (account_id, module_id, question_key, reviewed_at) DO NOTHING" in body and "confidence must be one of" in body)
rt = (BACKEND / "addons" / "account_insights.py").read_text()
check("S21 two GET routes, no POST, account from the session; registered in ADDON_ROUTERS",
      re.findall(r'@router\.(get|post)\("([^"]+)"', rt) == [("get", "/api/account/overview"), ("get", "/api/account/insights")] and "core._account(request).id" in rt
      and "account_insights.router" in (BACKEND / "addons" / "__init__.py").read_text())
g = (BACKEND / "main.py").read_text()
check("S22 /api/review/grade passes the confidence on", 'payload.get("at"), payload.get("confidence"))' in g)


# ---------------------------------------------------------------- L: live
def live():
    env_path = Path(os.environ.get("HB_GATE_DB_ENV") or Path.home() / ".config/foxai/edu-study-gate-db.env")
    env_text = env_path.read_text(encoding="utf-8")
    if "EDU_DB_NAME=edu_study_gate" not in env_text.splitlines():
        check("L0 gate DB env points at edu_study_gate", False, str(env_path)); return
    os.environ["EDU_DB_ENV_PATH"] = str(env_path)
    import db
    port = int(re.search(r"^EDU_DB_PORT=(\d+)", env_text, re.M).group(1))
    open_port = lambda p: socket.socket().connect_ex(("127.0.0.1", p)) == 0
    tunnel = None
    if not open_port(port):
        tunnel = subprocess.Popen(["ssh", "-N", "-o", "ConnectTimeout=10", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{port}:127.0.0.1:5432", "nnt"])
        for _ in range(40):
            if open_port(port): break
            time.sleep(0.25)
    run_env = {**os.environ, "EDU_DB_ENV_PATH": str(env_path)}
    admin = lambda *a, stdin=None: subprocess.run([sys.executable, "-m", "admin", *a], cwd=BACKEND, env=run_env, input=stdin, capture_output=True, text=True)
    user = f"gate-ib-{secrets.token_hex(3)}"; other = f"gate-ib-{secrets.token_hex(3)}"
    try:
        m1, m2 = admin("migrate", "--no-backup"), admin("migrate", "--no-backup")
        check("L1 migrate on the gate DB -> schema version 8; a second migrate applies nothing", m1.returncode == 0 and "schema version: 8" in m1.stdout and "nothing (up to date)" in m2.stdout, (m1.stdout + m1.stderr).strip().replace("\n", " | ")[:200])
        for u in (user, other):
            admin("create-user", "--username", u, "--display-name", "Gate IB", stdin=secrets.token_urlsafe(18) + "\n")
        ida, idb = [db.fetch_one("SELECT id FROM accounts WHERE username = %s", (u,))["id"] for u in (user, other)]
        M = "gate-ib"
        t0 = datetime.now(timezone.utc)
        def answer(key, correct, kind, run, ms, conf=None, chapter=None):
            return store.log_answer(ida, M, store.answer_entry({"question": key, "runKind": kind, "correct": correct, "runId": run, "clientId": str(uuid.uuid4()),
                                                              "chosen": 0, "durationMs": ms, "confidence": conf, "chapter": chapter}))
        r1, r2 = f"run-{secrets.token_hex(3)}", f"run-{secrets.token_hex(3)}"
        outs = [answer(f"ch02-b01-q{i}", i > 2, "practice", r1, 20000) for i in range(1, 7)]       # databases chapter: 4/6, timed
        outs += [answer("ch01-b01-q1", False, "review", r2, 10000, "sure"), answer("ch01-b01-q1", True, "review", r2, None, "unsure")]   # q1: latest right
        outs += [answer("ch01-b01-q9", False, "practice", r2, 5000)]                                  # storage q9 currently wrong
        check("L2 answers land through the same function the route calls (9 logged), durationMs stored", outs.count("logged") == 9
              and db.fetch_one("SELECT sum(duration_ms) AS s, count(duration_ms) AS n FROM answer_log WHERE account_id = %s", (ida,)) == {"s": 135000, "n": 8}, str(outs))
        g1 = store.review_grade(ida, M, "ch02-b01-q1", "good", t0.isoformat(), "sure")
        g2 = store.review_grade(ida, M, "ch02-b01-q1", "good", t0.isoformat(), "sure")            # resend of the same press
        g3 = store.review_grade(ida, M, "ch02-b01-q2", "again", None, None)
        log = db.fetch_all("SELECT question_key, grade, confidence, chapter, interval_before, interval_after FROM review_log WHERE account_id = %s ORDER BY id", (ida,))
        check("L3 two grades applied -> two review_log rows (the resent press is NOT logged twice); confidence + chapter + interval before/after kept",
              g2.get("duplicate") is True and len(log) == 2 and log[0]["grade"] == "good" and log[0]["confidence"] == "sure" and log[0]["chapter"] == 2 and log[0]["interval_before"] is None and log[0]["interval_after"] == 1.0
              and log[1]["grade"] == "again" and log[1]["confidence"] is None, json.dumps(log, default=str))
        try:
            store.review_grade(ida, M, "ch02-b01-q3", "good", None, "maybe"); bad = False
        except ValueError:
            bad = True
        check("L4 an unknown confidence is refused (400) and nothing is logged for it", bad and db.fetch_one("SELECT count(*) AS n FROM review_log WHERE account_id = %s", (ida,))["n"] == 2)
        ov = insights.overview(ida)
        b = ov["books"][0] if ov["books"] else {}
        check("L5 overview SQL: today 9 counted answers (practice + review); this module is lastBook; 2 cards; currently wrong 2 (ch01-q9 and ch02-q1,q2 -> latest wrong)",
              ov["today"]["answered"] == 9 and ov["lastBook"] == M and b.get("srs", {}).get("total") == 2 and b.get("currentlyWrong") == 3 and ov["streak"]["current"] >= 1, json.dumps({"today": ov["today"], "b": {k: b.get(k) for k in ("module", "currentlyWrong")}, "cards": b.get("srs", {}).get("total")}))
        spec = store.area_spec({"moduleId": M, "tutorialData": {"sections": [{"title": "Chapter 1: Storage"}, {"title": "Chapter 2: Databases"}]}})
        ins = insights.insights(ida, M, spec)
        by = {r["id"]: r for r in ins["topics"]}
        check("L6 insights SQL: Databases 6 answers 4 right; time 135 s over 8 timed answers + 1 untimed; grades again 1 / good 1; calibration sure 1 / unsure 1; 2 sessions",
              by["databases"]["answered"] == 6 and by["databases"]["right"] == 4 and ins["time"]["totalMs"] == 135000 and ins["time"]["trackedAnswers"] == 8 and ins["time"]["untrackedAnswers"] == 1
              and ins["grades"]["good"] == 1 and ins["grades"]["again"] == 1 and ins["calibration"]["sure"]["n"] == 1 and ins["calibration"]["unsure"]["right"] == 1 and ins["time"]["sessionsTotal"] == 2,
              json.dumps({"db": [by["databases"]["answered"], by["databases"]["right"]], "t": ins["time"]["totalMs"], "g": ins["grades"]}))
        check("L7 another account sees none of it", insights.overview(idb)["books"] == [] and insights.insights(idb, M, spec)["answeredTotal"] == 0)
        down = (BACKEND / "migrations" / "rollback" / "008_review_log_time.down.sql").read_text()
        with db.connect() as conn:
            conn.execute(down)
        gone = db.fetch_one("SELECT (to_regclass('review_log') IS NULL) AS no_table, (SELECT count(*) FROM information_schema.columns WHERE table_name = 'answer_log' AND column_name = 'duration_ms') AS cols")
        check("L8 the written rollback runs: review_log gone, duration_ms gone, version back to 7; answer_log rows kept", gone["no_table"] and gone["cols"] == 0 and db.schema_version() == 7
              and db.fetch_one("SELECT count(*) AS n FROM answer_log WHERE account_id = %s", (ida,))["n"] == 9, str(gone))
        m3 = admin("migrate", "--no-backup")
        check("L9 migrating again restores version 8 (up / down / up works)", m3.returncode == 0 and "schema version: 8" in m3.stdout, m3.stdout.strip().replace("\n", " | "))
    finally:
        for u in (user, other):
            admin("delete-user", "--username", u)
        if tunnel:
            tunnel.terminate()


if "--live" in sys.argv:
    live()
bad = results.count(False)
print(f"\n{len(results) - bad}/{len(results)} passed")
sys.exit(1 if bad else 0)
