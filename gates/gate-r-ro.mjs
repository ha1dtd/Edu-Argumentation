#!/usr/bin/env node
/**
 * gate-r-ro.mjs — R-suite: PHASE 03 IS READ-ONLY, PROVED THREE WAYS.
 *
 * edu-replatform Phase 03, checklist E1e. Tier 1/2, browser-backed.
 *
 * ⛔ ONE sha256 AROUND ONE BROWSE IS NOT ENOUGH. It proves THAT BROWSE wrote nothing; it
 *    does not prove the build CANNOT write. Hence three independent assertions.
 *
 * ═══ R-RO1 — the built bundle has ZERO non-GET call sites ════════════════════════════
 * ⛔⛔ THE PLAN'S PATTERN SET IS DEFECTIVE AND IS NARROWED HERE, DELIBERATELY.
 *    It ended with the BARE SUBSTRING `api/progress`. But
 *    `GET /api/progress?module=` is a LEGITIMATE, FROZEN, PHASE-02 READ ROUTE
 *    (queries.ts:146 -> client.ts:29 `fetch(path, { signal })`; `getJson` has NO `method`
 *    parameter at all). Measured on the real bundle:
 *        the 12 method: quotings   0
 *        XMLHttpRequest            0
 *        navigator.sendBeacon      0
 *        api/progress              1   <-- RED ON A CORRECT BUILD
 *    Three independent slices reached that measurement. A substring standing in for a
 *    semantic cannot tell "a write exists" from "a read exists" — the same root defect as
 *    C-10, which could not tell "the guard worked" from "there was nothing there".
 *    THE SET IS THEREFORE NARROWED TO WRITE **SHAPES**, and the old entry is kept below as
 *    a REPORTED counter-measurement so nobody re-adds it.
 *
 * ═══ R-RO2 — no non-GET request leaves the page during a full browse ═════════════════
 * ⛔⛔ THIS ASSERTION IS VACUOUS WITHOUT A SEED AND WITHOUT A POSITIVE CONTROL.
 *    (1) SEED — `flushPendingProgress()` fires on DOMContentLoaded (app.js:3670) but
 *        RETURNS AT app.js:1170 on an empty queue, so Playwright measures zero non-GET
 *        whether or not a write path exists. `page.addInitScript` seeds
 *        localStorage['eduPendingProgress'] with one queued body BEFORE the page loads, so
 *        the assertion is exercised against a queue that WOULD flush.
 *    (2) POSITIVE CONTROL — "zero non-GET observed" is also true of a listener that is not
 *        attached, of a page that never loaded, and of a browser that made no requests at
 *        all. So the gate asserts the listener SAW GET traffic, and then fires ONE
 *        deliberate POST from the page and asserts the listener CAUGHT it. Only then does
 *        a zero mean something. ⚠ The control POST is fired AFTER the browse and is counted
 *        separately; it is not part of the measured window.
 *
 * ═══ R-RO3 — the progress store on disk is byte-identical across the browse ══════════
 * ⛔ The suite's OWN store ($EDU_PROGRESS_PATH / R_PROGRESS_PATH), never the user's live
 *    ~/foxai-data/edu-argumentation/progress.json. Phase 03 is read-only, but pointing a
 *    gate run at a live study file puts it one bug away from a write.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// R_REPO lets a COPY of this gate run from outside gates/ (fault-injection harness).
// Default is the real tree, so a normal run needs no environment at all.
const REPO = process.env.R_REPO || path.resolve(DIR, '..');
const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const MODULE = process.env.R_MODULE || 'geron-homl3';
const DIST = process.env.R_DIST || path.join(REPO, 'app/frontend/dist');
const PROGRESS = process.env.R_PROGRESS_PATH || '/var/tmp/edu-react-smoke/stores/progress.json';
const PENDING_KEY = 'eduPendingProgress';

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

/* ═════════ R-RO1: the write-SHAPE pattern set ═════════ */
const VERBS = ['POST', 'PUT', 'DELETE', 'PATCH'];
// The three quotings esbuild can emit for an object literal value.
const WRITE_PATTERNS = [
  ...VERBS.flatMap((v) => [`method:"${v}"`, `method:'${v}'`, 'method:`' + v + '`']),
  'XMLHttpRequest',
  'navigator.sendBeacon',
];
// ⛔ REPORTED, NEVER ASSERTED. Kept visible so the false positive is not silently re-added.
const REJECTED_PATTERNS = ['api/progress'];

const assetDir = path.join(DIST, 'assets');
const jsFiles = fs.readdirSync(assetDir).filter((f) => f.endsWith('.js'));
const bundle = jsFiles.map((f) => fs.readFileSync(path.join(assetDir, f), 'utf8')).join('\n');
const countOf = (needle) => bundle.split(needle).length - 1;
const hits = WRITE_PATTERNS.map((p) => [p, countOf(p)]).filter(([, n]) => n > 0);
const rejectedHits = REJECTED_PATTERNS.map((p) => [p, countOf(p)]);

check(`R-RO1 the built bundle contains ZERO non-GET WRITE SHAPES (${WRITE_PATTERNS.length} patterns over ${jsFiles.length} file(s))`,
  jsFiles.length > 0 && bundle.length > 1000 && hits.length === 0,
  `scanned=${jsFiles.join(',')} bytes=${bundle.length} writeShapeHits=${hits.length}`
  + (hits.length ? ` <-- ${JSON.stringify(hits)}` : '')
  + ` | REPORTED-NOT-ASSERTED ${JSON.stringify(rejectedHits)}: the plan's bare \`api/progress\``
  + ' substring is a LEGITIMATE GET route (queries.ts:146) and makes this gate RED ON A CORRECT BUILD');

/* ═════════ the browse ═════════ */
const before = fs.existsSync(PROGRESS)
  ? createHash('sha256').update(fs.readFileSync(PROGRESS)).digest('hex') : 'ABSENT';

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// ⛔ BEFORE page load. An init script added after goto() never runs for that document.
await page.addInitScript(([key, body]) => {
  try { window.localStorage.setItem(key, body); } catch { /* storage may be blocked */ }
}, [PENDING_KEY, JSON.stringify([{ module: 'geron-homl3', chapterIndex: 0, blockIndex: 0, done: true, ts: 1 }])]);

const observed = { get: 0, nonGet: [], control: 0 };
let windowOpen = true;
page.on('request', (req) => {
  const m = req.method();
  if (!windowOpen) { if (m !== 'GET') observed.control += 1; return; }
  if (m === 'GET') observed.get += 1;
  else observed.nonGet.push(`${m} ${req.url()}`);
});

const gotoBlock = async (ci, bi) => {
  await page.evaluate(([c, b]) => {
    const d = document.querySelectorAll('#toc-nav details')[c];
    if (!d) return;
    d.open = true;
    const btns = d.querySelectorAll('ol li button');
    if (btns[b]) btns[b].click();
  }, [ci, bi]);
  await page.waitForTimeout(700);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const seeded = await page.evaluate((k) => window.localStorage.getItem(k), PENDING_KEY);
await page.locator(`#library-grid [data-book="${MODULE}"]`).click();
await page.waitForTimeout(1500);
await page.locator('#read-tutorial-btn').click();
await page.waitForTimeout(1400);
const chapters = await page.$$eval('#toc-nav details', (d) => d.length);
// Every chapter, three blocks deep — enough traversal for a flush to have fired many times.
for (let c = 0; c < chapters; c += 1) for (let b = 0; b < 3; b += 1) await gotoBlock(c, b);
await page.locator('#nav-quiz').click();
await page.waitForTimeout(900);
await page.evaluate(() => document.getElementById('nav-settings')?.click());
await page.waitForTimeout(900);
await page.waitForTimeout(1200);   // let any deferred flush land inside the window

/* ---- the positive control: prove the listener CAN see a non-GET ---- */
windowOpen = false;
await page.evaluate(() => fetch('/api/health', { method: 'POST' }).catch(() => {}));
await page.waitForTimeout(900);

check('R-RO2 ZERO non-GET requests across a full browse — with the pending-progress queue SEEDED and a POSITIVE CONTROL',
  observed.nonGet.length === 0 && observed.get > 0 && observed.control === 1 && seeded !== null,
  `GET=${observed.get} nonGET=${observed.nonGet.length}${observed.nonGet.length ? ' ' + JSON.stringify(observed.nonGet.slice(0, 4)) : ''}`
  + ` control(deliberate POST caught)=${observed.control} seeded=${seeded === null ? 'NO <-- FLOOR FAILED' : 'yes'}`
  + ` chapters=${chapters}`
  + ' — ⛔ without the seed flushPendingProgress() returns early on an empty queue (app.js:1170)'
  + ' and zero is measured whether or not a write path exists; without the control, zero is also'
  + ' true of a listener that never attached');

await browser.close();

const after = fs.existsSync(PROGRESS)
  ? createHash('sha256').update(fs.readFileSync(PROGRESS)).digest('hex') : 'ABSENT';
check('R-RO3 the progress store is BYTE-IDENTICAL across the browse (the suite\'s own store, never the user\'s)',
  before === after && before !== 'ABSENT',
  `path=${PROGRESS} before=${before} after=${after}`
  + (before === 'ABSENT' ? ' <-- FLOOR FAILED: no store on disk, so "unchanged" proves nothing' : ''));

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
