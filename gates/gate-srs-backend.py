#!/usr/bin/env python3
"""gate-srs-backend.py — spaced repetition, server half (21-10-26).

No service, no database: imports app/backend/store.py (pure scheduling + validators) and reads the
migration and main.py as text/AST.
  S  srs_next: the schedule after every grade, floors, caps, lapse rules;
  F  review_first_seen: right -> next study day, wrong -> ten minutes with no lapse counted;
  V  review_key / grade validation;
  D  migration 004 is additive (one CREATE TABLE + one CREATE INDEX, both IF NOT EXISTS);
  R  main.py registers exactly the three review routes, and the two POSTs go through the same-origin gate;
  C  (23-11-26) the caps: 100 chapter cards + 20 AI-written cards a day, 60/40 young/older, 14-day maximum gap;
  G  (23-11-26) a resent grade: the press time `at` is validated, and one window SQL is shared by every reader.
Run: python3 gates/gate-srs-backend.py      (exit 1 on any FAIL; no service, no database)
     /var/tmp/pcstudy/gatevenv/bin/python3 gates/gate-srs-backend.py --live
        (23-11-26) adds the window checks on the ISOLATED gate DB `edu_study_gate` (never `edu_study`): SSH tunnel to
        nn:5432, one throwaway account (deleted at the end), 150 chapter + 30 AI due cards seeded, then the REAL SQL:
        100 chapter = 60 young newest-first / 40 older lowest-recall-first, 20 AI = 12 / 8, separate budgets,
        held / heldBlocks / aiHeld sums, the run order interleaves AI cards, a resent grade changes nothing.
"""
import ast, importlib.util, json, re, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "app" / "backend"
sys.path.insert(0, str(BACKEND))
spec = importlib.util.spec_from_file_location("store", BACKEND / "store.py")
store = importlib.util.module_from_spec(spec); spec.loader.exec_module(store)
results = []


def check(cid, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {cid}  {detail}")


NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
nx = store.srs_next
days = lambda s: (s["due_at"] - store.study_day_start(NOW)) / timedelta(days=1)   # 18-11-26: due at the study-day start

s1 = nx(None, "good", NOW)
check("S1 first good = next study day (midnight UTC+7), reps 1, ease unchanged", s1["interval_days"] == 1 and s1["reps"] == 1 and s1["ease"] == 2.5 and abs(days(s1) - 1) < 1e-9 and s1["due_at"].astimezone(store.STUDY_DAY_TZ).hour == 0, str(s1["interval_days"]))
s2 = nx(s1, "good", NOW)
check("S2 second good = 4 days", s2["interval_days"] == 4 and s2["reps"] == 2 and abs(days(s2) - 4) < 1e-9)
s3 = nx(s2, "good", NOW)
check("S3 third good = interval x ease (10)", abs(s3["interval_days"] - 10) < 1e-6, str(s3["interval_days"]))
check("S4 good intervals only grow", s1["interval_days"] < s2["interval_days"] < s3["interval_days"])
a = nx(s3, "again", NOW)
check("S5 again: reps 0, lapse +1, ease -0.2, due in 10 minutes", a["reps"] == 0 and a["lapses"] == 1 and a["ease"] == 2.3 and a["due_at"] == NOW + timedelta(minutes=10), str(a))
e = nx(s2, "easy", NOW)
check("S6 easy: ease +0.15 and longer than good", e["ease"] == 2.65 and e["interval_days"] > nx(s2, "good", NOW)["interval_days"], str(e["interval_days"]))
e0 = nx(None, "easy", NOW)
check("S7 first easy = 4 days", e0["interval_days"] == 4)
h = nx(s3, "hard", NOW)
check("S8 hard: ease -0.15, interval x1.2", h["ease"] == 2.35 and abs(h["interval_days"] - 10 * 1.2) < 1e-6, str(h))
c = None
for _ in range(20):
    c = nx(c, "again", NOW)
check("S9 ease never below 1.3", c["ease"] == 1.3 and c["lapses"] == 20)
c = {"ease": 2.5, "interval_days": 300, "reps": 9, "lapses": 0}
check("S10 interval capped at 14 days (23-11-26; was one year)", nx(c, "easy", NOW)["interval_days"] == 14 and nx(c, "good", NOW)["interval_days"] == 14 and store.SRS_MAX_DAYS == 14, str(nx(c, "easy", NOW)["interval_days"]))
check("S10b a 10-day card at ease 2.5: hard 12, good 14 (25 capped), easy 14 (34 capped)", [nx(s3, g, NOW)["interval_days"] for g in ("hard", "good", "easy")] == [12.0, 14, 14], str([nx(s3, g, NOW)["interval_days"] for g in ("hard", "good", "easy")]))
c7 = {"ease": 2.5, "interval_days": 4, "reps": 2, "lapses": 0}
check("S10c below the cap the ladder is unchanged: 4 d -> 10 d, 1 d -> 4 d", nx(c7, "good", NOW)["interval_days"] == 10 and nx({"ease": 2.5, "interval_days": 1, "reps": 1, "lapses": 0}, "good", NOW)["interval_days"] == 4)
check("S11 due_at is UTC and in the future for non-again grades", all(nx(s1, g, NOW)["due_at"] > NOW for g in ("hard", "good", "easy")))

fr, fw = store.review_first_seen(True, NOW), store.review_first_seen(False, NOW)
check("F1 first answered right: due the next study day", abs(days(fr) - 1) < 1e-9 and fr["reps"] == 1)
check("F2 first answered wrong: due in 10 minutes, no lapse counted, ease reset", fw["due_at"] == NOW + timedelta(minutes=10) and fw["lapses"] == 0 and fw["ease"] == 2.5 and fw["reps"] == 0)

for good in ("ch03-b05-q2", "ch40-b17-q10", "abc"):
    try: store.review_key(good); check(f"V-key ok {good}", True)
    except ValueError: check(f"V-key ok {good}", False)
for bad in ("", "ab", "x" * 65, "ch03 b05", "ch03/b05", None, "a;drop"):
    try: store.review_key(bad); check(f"V-key bad {bad!r}", False, "ACCEPTED")
    except ValueError: check(f"V-key bad {bad!r}", True, "rejected")
for bad in ("", "AGAIN", "ok", "bad"):
    try: nx(None, bad, NOW); check(f"V-grade bad {bad!r}", False, "ACCEPTED")
    except ValueError: check(f"V-grade bad {bad!r}", True, "rejected")

sql = (BACKEND / "migrations" / "004_review_cards.sql").read_text(encoding="utf-8")
code = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
stmts = [x.strip() for x in code.split(";") if x.strip()]
check("D1 one CREATE TABLE IF NOT EXISTS review_cards + one CREATE INDEX IF NOT EXISTS", len(stmts) == 2 and stmts[0].startswith("CREATE TABLE IF NOT EXISTS review_cards") and stmts[1].startswith("CREATE INDEX IF NOT EXISTS"), f"{len(stmts)} statements")
check("D2 nothing destructive and no existing table touched", not re.search(r"\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER|RENAME)\b", re.sub(r"ON DELETE CASCADE", "", code), re.I))
check("D3 FK to accounts with cascade", "REFERENCES accounts (id) ON DELETE CASCADE" in sql)

tree = ast.parse((BACKEND / "main.py").read_text(encoding="utf-8"))
routes = {}
for n in ast.walk(tree):
    if isinstance(n, ast.FunctionDef):
        for d in n.decorator_list:
            if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in ("get", "post") and d.args and isinstance(d.args[0], ast.Constant) and str(d.args[0].value).startswith("/api/review/"):
                routes[(d.func.attr, d.args[0].value)] = ast.get_source_segment((BACKEND / "main.py").read_text(encoding="utf-8"), n)
check("R1 exactly the three review routes", set(routes) == {("post", "/api/review/seen"), ("post", "/api/review/grade"), ("get", "/api/review/due")}, str(sorted(routes)))
check("R2 both POSTs use the same-origin gate", all("_gate(req)" in src for (m, p), src in routes.items() if m == "post"))
# ---------------------------------------------------------------------------------- C / G (23-11-26)
check("C1 chapter cap 100, AI cap 20, young share 0.6", store.REVIEW_PER_DAY == 100 and store.REVIEW_AI_PER_DAY == 20 and store.REVIEW_YOUNG_SHARE == 0.6, f"{store.REVIEW_PER_DAY}/{store.REVIEW_AI_PER_DAY}/{store.REVIEW_YOUNG_SHARE}")
w = store.review_window_sql({"chapter": 100, "ai": 20}); wh = store.review_window_sql({"chapter": 100, "ai": 20}, held=True)
check("C2 the window SQL has TWO parameters (account, module), inlines both budgets, and the held variant is its complement", w.count("%s") == 2 and "pos <= CASE WHEN is_ai THEN 20 ELSE 100 END" in w and "pos > CASE WHEN is_ai THEN 20 ELSE 100 END" in wh and w.count("%s") == wh.count("%s"))
check("C3 young = newest-created first; older = elapsed/interval first; AI is its own partition", "DESC NULLS LAST" in store.REVIEW_RANK_SQL and "created_at" in store.REVIEW_RANK_SQL and "interval_days" in store.REVIEW_RANK_SQL and "PARTITION BY (question_key !~" in store.REVIEW_RANK_SQL and "(reps <= 1)" in store.REVIEW_RANK_SQL and "0.6" in store.REVIEW_RANK_SQL and "0.4" in store.REVIEW_RANK_SQL)
src = (BACKEND / "store.py").read_text(encoding="utf-8")
body = lambda name: src.split(f"def {name}(", 1)[1].split("\ndef ", 1)[0]
check("C4 the badge, the chapter rows and the run read ONE window (review_window_sql)", all("review_window_sql(" in body(n) for n in ("review_due_page", "review_due_by_block", "review_due_in_blocks")) and "REVIEW_RANK_SQL" not in body("review_due_page") + body("review_due_in_blocks"))
check("C5 review_budget returns two budgets", "chapter" in body("review_budget") and '"ai"' in body("review_budget") and "REVIEW_AI_PER_DAY" in body("review_budget"))
NOWU = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)
gm = store.review_grade_moment
at = NOWU - timedelta(minutes=5)
check("G1 a good press time is kept (resend-safe)", gm(at.isoformat().replace("+00:00", "Z"), NOWU) == (at, True))
check("G2 no / bad / naive / too old (8 d) / too far ahead (2 d) press time -> now, not sent", all(gm(v, NOWU) == (NOWU, False) for v in (None, "", "x", "2026-11-23T11:00:00", (NOWU - timedelta(days=8)).isoformat(), (NOWU + timedelta(days=2)).isoformat())))
check("G3 a press time a few seconds ahead (clock skew) is still kept as sent", gm((NOWU + timedelta(seconds=30)).isoformat(), NOWU)[1] is True)
check("G4 /api/review/grade passes `at` to store.review_grade", '.get("at")' in routes[("post", "/api/review/grade")])
check("G5 review_grade skips a grade already applied (duplicate)", "duplicate" in body("review_grade") and "last_reviewed_at" in body("review_grade"))


# ---------------------------------------------------------------------------------- --live (gate DB)
def live() -> None:
    import os, secrets, socket, subprocess, time
    env_path = Path(os.environ.get("SM_GATE_DB_ENV") or Path.home() / ".config/foxai/edu-study-gate-db.env")
    env_text = env_path.read_text(encoding="utf-8")
    if "EDU_DB_NAME=edu_study_gate" not in env_text.splitlines():
        check("L0 gate DB env points at edu_study_gate", False, str(env_path)); return
    db_port = int(re.search(r"^EDU_DB_PORT=(\d+)", env_text, re.M).group(1))
    os.environ["EDU_DB_ENV_PATH"] = str(env_path)
    run_env = {**os.environ}
    open_port = lambda p: socket.socket().connect_ex(("127.0.0.1", p)) == 0
    tunnel = None
    if not open_port(db_port):
        tunnel = subprocess.Popen(["ssh", "-N", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10", "-L", f"127.0.0.1:{db_port}:127.0.0.1:5432", "nnt"])
        for _ in range(40):
            if open_port(db_port): break
            time.sleep(0.25)
    admin = lambda *a, stdin=None: subprocess.run([sys.executable, "-m", "admin", *a], cwd=BACKEND, env=run_env, input=stdin, capture_output=True, text=True)
    user = f"gate-srs-{secrets.token_hex(3)}"
    import db
    try:
        m = admin("migrate", "--no-backup")
        check("L1 gate DB migrated (rerun safe)", m.returncode == 0, (m.stdout + m.stderr).strip().replace("\n", " | ")[:160])
        made = admin("create-user", "--username", user, "--display-name", "Gate SRS", stdin=secrets.token_urlsafe(18) + "\n")
        acct = db.fetch_one("SELECT id FROM accounts WHERE username = %s", (user,))
        check("L2 throwaway account", made.returncode == 0 and acct is not None, (made.stdout + made.stderr).strip()[:100])
        if not acct: return
        aid, mod = int(acct["id"]), "gate-srs-book"
        now = datetime.now(timezone.utc)
        # chapter cards: 90 young (reps 1, created k minutes ago), 60 older (reps 3, interval 10, last reviewed 10 + i/2 days ago)
        # AI cards: 20 young + 10 older. Every card is due (an hour ago). Older: bigger i = more overdue relative to its interval.
        rows = []
        for k in range(90): rows.append((f"ch01-b{k % 7 + 1:02d}-q{k + 1}", 1, 1.0, now - timedelta(minutes=k + 1), now - timedelta(days=3)))
        for i in range(60): rows.append((f"ch02-b{i % 5 + 1:02d}-q{i + 1}", 3, 10.0, now - timedelta(days=30), now - timedelta(days=10 + i / 2)))
        for k in range(20): rows.append((f"ai-y{k:010d}", 1, 1.0, now - timedelta(minutes=k + 1), now - timedelta(days=3)))
        for i in range(10): rows.append((f"ai-o{i:010d}", 3, 10.0, now - timedelta(days=30), now - timedelta(days=10 + i / 2)))
        with db.connect() as conn:
            for key, reps, interval, created, last in rows:
                conn.execute("INSERT INTO review_cards (account_id, module_id, question_key, ease, interval_days, reps, lapses, due_at, last_reviewed_at, created_at)"
                             " VALUES (%s, %s, %s, 2.5, %s, %s, 0, now() - interval '1 hour', %s, %s)", (aid, mod, key, interval, reps, last, created))
        isai = lambda k: k.startswith("ai-")
        bud = store.review_budget(aid, mod)
        check("W1 fresh day: budgets 100 chapter / 20 AI", bud == {"chapter": 100, "ai": 20}, str(bud))
        win = db.fetch_all(f"SELECT question_key, reps, is_ai, ord FROM {store.review_window_sql(bud)} ORDER BY ord, is_ai, question_key", (aid, mod))
        cnt = lambda ai, young: sum(1 for r in win if r["is_ai"] == ai and (r["reps"] <= 1) == young)
        check("W2 chapter window: 100 = 60 young + 40 older", (cnt(False, True), cnt(False, False)) == (60, 40), f"{cnt(False, True)}/{cnt(False, False)}")
        check("W3 AI window: 20 = 12 young + 8 older (own budget, outside the 100)", (cnt(True, True), cnt(True, False)) == (12, 8), f"{cnt(True, True)}/{cnt(True, False)}")
        young_ch = sorted((r["question_key"] for r in win if not r["is_ai"] and r["reps"] <= 1), key=lambda k: int(k.rsplit("q", 1)[1]))
        check("W4 young chapter cards = the 60 NEWEST-created (q1..q60)", young_ch == [f"ch01-b{(n - 1) % 7 + 1:02d}-q{n}" for n in range(1, 61)])
        older_ch = {r["question_key"] for r in win if not r["is_ai"] and r["reps"] > 1}
        check("W5 older chapter cards = the 40 lowest predicted recall (most overdue vs interval: i 20..59)", older_ch == {f"ch02-b{i % 5 + 1:02d}-q{i + 1}" for i in range(20, 60)})
        young_ai = {r["question_key"] for r in win if r["is_ai"] and r["reps"] <= 1}
        check("W6 young AI cards = the 12 newest", young_ai == {f"ai-y{k:010d}" for k in range(12)})
        by = store.review_due_by_block(aid, mod)
        check("W7 dueCount 120 (100 + 20 AI), aiDueCount 20, rows sum 120", by["dueCount"] == 120 and by["aiDueCount"] == 20 and sum(b["due"] for b in by["blocks"]) == 120, str({k: by[k] for k in ("dueCount", "aiDueCount")}))
        check("W8 held 50 chapter + aiHeld 10, caps 100 / 20", (by["held"], by["aiHeld"], by["dailyCap"], by["aiDailyCap"]) == (50, 10, 100, 20), str((by["held"], by["aiHeld"], by["dailyCap"], by["aiDailyCap"])))
        hb = by["heldBlocks"]
        check("W9 heldBlocks sum 60 and the AI ones sit under block 'other'", sum(h["count"] for h in hb) == 60 and any(h["block"] == "other" and h["count"] == 10 for h in hb) and all(h.get("oldestDueAt") for h in hb), str(hb[:3]))
        page = store.review_due_page(aid, mod, 20)
        keys20 = [d["question"] for d in page["due"]]
        check("W10 run order: the first card is a young chapter card and AI cards are spread through the first 20 (2..5 of them)", len(keys20) == 20 and not isai(keys20[0]) and 2 <= sum(isai(k) for k in keys20) <= 5 and page["dueCount"] == 120, f"{sum(isai(k) for k in keys20)} AI in 20, dueCount {page['dueCount']}")
        inb = store.review_due_in_blocks(aid, mod, ["other"], 99)
        allch = store.review_due_in_blocks(aid, mod, [b["block"] for b in by["blocks"] if b["block"] != "other"], 500)
        check("W11 due-in reads the SAME window: 'other' = 20, all chapter blocks = 100", inb["dueCount"] == 20 and len(inb["due"]) == 20 and allch["dueCount"] == 100, f"{inb['dueCount']}/{allch['dueCount']}")
        # grades: 5 AI + 3 chapter cards pressed 'good' today use up ONLY their own budget
        pressed_ai = [r["question_key"] for r in win if r["is_ai"]][:5]; pressed_ch = [r["question_key"] for r in win if not r["is_ai"]][:3]
        t0 = (datetime.now(timezone.utc)).isoformat()
        for k in pressed_ai + pressed_ch: store.review_grade(aid, mod, k, "good", t0)
        bud2 = store.review_budget(aid, mod)
        check("W12 separate budgets: 5 AI + 3 chapter reviewed -> 97 chapter / 15 AI left", bud2 == {"chapter": 97, "ai": 15}, str(bud2))
        by2 = store.review_due_by_block(aid, mod)
        check("W13 after those: dueCount 112 (97 + 15), aiDueCount 15", by2["dueCount"] == 112 and by2["aiDueCount"] == 15, str({k: by2[k] for k in ("dueCount", "aiDueCount")}))
        # resend: same press time again changes nothing; a later press time applies; no press time (old client) applies
        k = pressed_ch[0]
        before = db.fetch_one("SELECT ease, interval_days, reps, due_at, last_reviewed_at FROM review_cards WHERE account_id = %s AND module_id = %s AND question_key = %s", (aid, mod, k))
        again = store.review_grade(aid, mod, k, "easy", t0)
        after = db.fetch_one("SELECT ease, interval_days, reps, due_at, last_reviewed_at FROM review_cards WHERE account_id = %s AND module_id = %s AND question_key = %s", (aid, mod, k))
        check("W14 a RESENT grade (same press time) changes nothing and says duplicate", again.get("duplicate") is True and before == after, str(again))
        later = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
        applied = store.review_grade(aid, mod, k, "good", later)
        check("W15 a later press time applies (reps +1)", applied.get("duplicate") is None and applied["reps"] == before["reps"] + 1, str(applied))
        reps_before = db.fetch_one("SELECT reps FROM review_cards WHERE account_id = %s AND module_id = %s AND question_key = %s", (aid, mod, pressed_ch[1]))["reps"]
        oldc = store.review_grade(aid, mod, pressed_ch[1], "good")
        check("W16 an old client (no press time) still applies (reps +1)", oldc.get("duplicate") is None and oldc["reps"] == reps_before + 1, str(oldc))
        check("W17 interval never above 14 days on the real path", db.fetch_one("SELECT max(interval_days) AS m FROM review_cards WHERE account_id = %s AND module_id = %s", (aid, mod))["m"] <= 14.0 + 1e-6)
        # ---- 23-11-26 AI panel: kind filter on due + stats, and the AI practice pool
        ai_kind = store.review_due_page(aid, mod, 50, "ai")
        bk_kind = store.review_due_page(aid, mod, 50, "book")
        check("P1 due kind=ai: only AI cards, inside the AI budget (15 left), total 30", ai_kind["dueCount"] == 15 and all(isai(d["question"]) for d in ai_kind["due"]) and ai_kind["total"] == 30, f"{ai_kind['dueCount']}/{ai_kind['total']}")
        check("P2 due kind=book: no AI card, inside the chapter budget (97 left), total 150", bk_kind["dueCount"] == 97 and not any(isai(d["question"]) for d in bk_kind["due"]) and bk_kind["total"] == 150, f"{bk_kind['dueCount']}/{bk_kind['total']}")
        al_kind = store.review_due_page(aid, mod, 50)
        check("P3 due with no kind is unchanged (both kinds, 112)", al_kind["dueCount"] == 112 and al_kind["total"] == 180, f"{al_kind['dueCount']}/{al_kind['total']}")
        st_ai, st_bk, st_all = (store.review_stats(aid, mod, k) for k in ("ai", "book", "all"))
        check("P4 stats kind: ai 30 + book 150 = all 180 cards", (st_ai["total"], st_bk["total"], st_all["total"]) == (30, 150, 180), str((st_ai["total"], st_bk["total"], st_all["total"])))
        try:
            store.review_kind("nonsense"); bad = False
        except ValueError:
            bad = True
        check("P5 an unknown kind is refused (ValueError -> 400)", bad)
        with db.connect() as conn:
            for k in range(4):
                conn.execute("UPDATE review_cards SET body = %s::jsonb WHERE account_id = %s AND module_id = %s AND question_key = %s",
                             (json.dumps({"question": f"AI q{k}", "options": ["a", "b", "c"], "correct": 1}), aid, mod, f"ai-y{k:010d}"))
        pool = store.review_ai_cards(aid, mod)
        check("P6 AI pool = every AI card WITH a body (4 of 30), never a chapter card", pool["total"] == 4 and all(isai(c["question"]) and c["body"]["question"].startswith("AI q") for c in pool["cards"]), str(pool["total"]))
    finally:
        d = admin("delete-user", "--username", user, "--yes")
        check("L9 throwaway account and its cards deleted", d.returncode == 0, (d.stdout + d.stderr).strip()[:100])
        if tunnel: tunnel.terminate()


if "--live" in sys.argv:
    live()
sys.exit(0 if all(results) else 1)
