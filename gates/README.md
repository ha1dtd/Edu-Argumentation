# Edu-Argumentation gate suite

The safety net for the re-platform. These gates are the only thing standing between a
3,662-line frontend rewrite and silent breakage.

**There is no test suite in this repo.** Nothing here is a unit test. Every gate is a
*data-native* check: a browser measurement, a static scan, or a real code path driven with
one stub. Verify tables and measurements, never logs.

---

## ⛔ Why this folder is a SIBLING of `aws-quiz-app/`, never inside it

`aws-quiz-app/` is the **deploy source**. It is shipped with `rsync --delete`. Gates placed
inside it would be published to production *and then deleted on the next deploy*. This
folder sits beside it so neither happens.

---

## Run everything

```bash
cd ml/study/Edu-Argumentation/gates
npm install                              # first time only
./node_modules/.bin/playwright install chromium   # ⛔ NEVER `npx` — npx hits the registry
bash run-gates.sh
```

`run-gates.sh` re-syncs the smoke harness, restarts the `:8791` server, runs every suite,
and asserts both the exit code and the result-line count of each.

### What "green" means

| Suite | Result lines | Status |
|---|---|---|
| `gate.mjs` | **27** | FROZEN |
| `gate-q.mjs` | **12** | FROZEN |
| `gate-a.mjs` | **10** | FROZEN |
| **frozen vector total** | **49** | **must never change** |
| `gate-b456.mjs` | 6 | new in P0, asserted separately |
| `gate-self.mjs` | 6 | new in P0, asserted separately |

> ⛔ **The 49-line vector is frozen.** It is a *no-regression* gate: it proves the suites
> still assert the same things, **not** that those assertions are right. A different vector
> means the hardening changed behaviour — that is a FAILED phase, **not** a new baseline.
> New gates go in **new files**. Never add a `check()` to the three frozen suites.

---

## The `:8791` smoke harness — read this before debugging a red gate

**`:8791` is NOT a static file server.** It is the real `edu_server.py`, run from the repo,
serving static assets out of a *separate* tree at `/var/tmp/edu-smoke`. The consequence:

- a **backend** change needs a **process restart**;
- a **frontend** change needs a **file copy** into `/var/tmp/edu-smoke`.

That split is the stale-code trap: skip the copy and every gate measures old code, and
neither green nor red means anything. Before `run-gates.sh` existed, the only defence was a
human remembering to `cp`.

The exact recipe `run-gates.sh` uses:

```bash
cd ml/study/Edu-Argumentation/aws-quiz-app
EDU_LIBRARY_ROOT=/var/tmp/edu-smoke/lib \
EDU_PROGRESS_PATH=/var/tmp/edu-smoke/progress.json \
EDU_LIBRARY_META_PATH=/var/tmp/edu-smoke/library-meta.json \
python3 edu_server.py --port 8791 --directory /var/tmp/edu-smoke
```

### ⛔ `/var/tmp/edu-smoke` is NOT a copy of the repo

It holds three things the repo does not contain and cannot regenerate:

| Path | What | If it goes missing |
|---|---|---|
| `lib/` | the **book library** (`EDU_LIBRARY_ROOT`), ~102 MB, two real book packages | every gate dies with a `page.goto` *networkidle* timeout — the app retries the now-404 `/book/<id>/module.json` forever |
| `progress.json` | the harness's own study progress | progress resets |
| `library-meta.json` | the book titles the library list renders | titles vanish |

A naive `rsync --delete` from `aws-quiz-app/` **deletes `lib/`**. Measured 21-09-26: that
wipe took the suite from 49 result lines to **0**, with three suites "failing" for a reason
that had nothing to do with the code under test. `run-gates.sh` therefore syncs only the
frontend, and refuses to run at all if the library is missing.

Restore it (read-only; no service is touched):

```bash
rsync -a nn:'~/foxai-data/edu-argumentation/library/geron-homl3/' /var/tmp/edu-smoke/lib/geron-homl3/
rsync -a nn:'~/foxai-data/edu-argumentation/library/openintro-statistics-2019-1045f2f5/' /var/tmp/edu-smoke/lib/demo-book/
```

The **real** Géron module must be present — the A5 gates measure real equations, so a
fixture stub will not do.

⚑ `/var/tmp/`, never `/tmp/` or `/dev/shm`: those are tmpfs (RAM) on the work PC.

---

## The gate-count question, settled (three numbers, three meanings)

This caused a genuine disagreement because three different quantities were all being called
"the number of gates". All three are real:

| Quantity | `gate-q.mjs` | How to measure |
|---|---|---|
| **call sites** | **7** | `grep -cE '\bcheck\(' gate-q.mjs` |
| **result lines** | **12** | `grep -cE '^(PASS\|FAIL)  ' <transcript>` |
| **literal quoted ids** | **4** | `grep -oE "check\('" gate-q.mjs \| wc -l` |

Why 7 call sites emit 12 lines: **three call sites sit inside `for` loops and build their id
from a template literal** — `:50` Q1a (2 widths), `:67` Q1b (2 widths), `:147` Q2d (4
widths). A grep for `check('` cannot see them. So 4 + 2 + 2 + 4 = **12**.

⛔ Do not use `grep -c 'check(' gate-q.mjs` as evidence — it returns 7 and answers neither
question. `gate.mjs`'s own header comment declares **27 a deliberate contract**.

### ⚠ The counting regex needs TWO trailing spaces

`check()` prints `VERDICT␠␠ID␠␠DETAIL`. Count with `^(PASS|FAIL)␠␠`. The one-space form
also matches the `FAILED: ...` summary line and **over-counts a red run** (measured: a red
`gate-a` transcript counts 10 with two spaces, 11 with one).

---

## Portability

No machine-local path and no pinned chromium revision may appear here. The gates resolve
the browser as:

```js
executablePath: process.env.GATE_CHROME || chromium.executablePath()
```

⚠ Pinning the playwright *version* is **not** a portability fix on its own: 1.61.1 pins
chromium revision **1228**, while the gates used to hardcode **1234**. `chromium.executablePath()`
honours `PLAYWRIGHT_BROWSERS_PATH`, which is what makes this work on the Mac's
`~/Library/Caches/ms-playwright` with no env var at all.

`playwright` is pinned **EXACT** (`"1.61.1"`, no caret) and the dependency is **`playwright`,
not `playwright-core`** — `playwright-core` ships no browser downloader, so only the wrapper
provides the `playwright install` CLI. A caret would float the chromium revision and could
silently shift the 49-line vector.

> ⚠ **Offline `playwright install chromium` works here by luck, not design.** It is a no-op
> only because revision 1228 already happens to be cached. **Bump the pin and it needs the
> CDN.** Do not assume the offline story survives a version bump.

---

## `gate-self.mjs` — the suite watching itself

Both defects P0 fixed survived because nothing watched the watchers. It asserts: the three
frozen counts (27/12/10, from **transcripts**), the portability ban-list, that
`A_G18_BASELINE` is set *and the file it names exists*, and that `gate-q.mjs` still contains
`process.exit(1)`.

It parses the transcripts `run-gates.sh` captured — **never the source, never a re-run**.
Static grepping cannot see the template-literal ids above (that is the 7-vs-12 problem), and
a fourth chromium launch would double the cost for no new signal. So it must run **last**.

The ban-list is **scoped, not a blanket** "no absolute paths": it bans the home dir, the Mac
home, `edu-verify` and a pinned chromium revision. `/var/tmp/edu-smoke` and `/var/tmp/p0-*`
are **required** by `run-gates.sh` and are real disk on both machines, so a blanket ban would
false-red on correct code.

---

## `A_G18_BASELINE`

`ag18-before.json` ships **with the suite** and `run-gates.sh` exports it automatically.
Without it `gate-a.mjs` reports 9/10 and any vector diff fails for the wrong reason.

A-G18 **has always failed loudly** without a baseline — the guard is in the source. Only its
message used to lie, saying "comparison leg skipped" while the gate was red. That wording is
now gone.

To regenerate: `A_G18_WRITE=/var/tmp/ag18-new.json node gate-a.mjs`. Write-mode falls through
into the same gated run, so A-G18 still reads red on that pass; re-run with
`A_G18_BASELINE=/var/tmp/ag18-new.json` to go green.

> ⚠ `ag18-before.json` encodes **current-render pixel values** (`svg: 61.9`,
> `radicand: 61.1`). Phase 3 rewrites the frontend, so this baseline must be **re-captured at
> Phase 3**, not carried over.

---

## Every new gate must be fault-proven

A gate that has never been seen failing is not evidence. In one session six gates passed on
broken code: an uppercased label, a shadow-DOM `innerText` that is always empty, a
`display:none` button measured 0×0, a hidden element where `0 >= 0.9*0` is true, an equation
sweep rendered outside its `<figure>`, and an ordering gate that only asserted list length.

Before adding a gate: break the thing deliberately, watch it go red, restore, watch it go
green, and record all four in the phase report. Fault-inject into `/var/tmp/edu-smoke`
(scratch) — **never into `aws-quiz-app/`**.

---

## Files

| File | What |
|---|---|
| `gate.mjs` | 27 results — home page, deselect, rename, reader shell, button set, dialog picker, responsive overflow. FROZEN. |
| `gate-q.mjs` | 12 results — quiz column width, pinned action bar, option layout, overflow at 4 widths. FROZEN. |
| `gate-a.mjs` | 10 results — workstream-A layout/CSS gates incl. A-G18 relayout baseline. FROZEN. |
| `gate-b456.mjs` | 6 results — B4/B5/B6: retry-wrong-only denominator, carried score, full-set read. |
| `gate-self.mjs` | 6 results — the suite's own invariants. Runs LAST. |
| `htmlcheck.py` | static HTML structure check. |
| `ag18-before.json` | the A-G18 render baseline. A first-class suite file. |
| `b15probe.mjs` | **probe, not a gate** — records the pre-existing `#chapter=1&block=8` defect. Cannot fail. |
| `run-gates.sh` | the runner. Re-syncs, restarts, runs, asserts. |
