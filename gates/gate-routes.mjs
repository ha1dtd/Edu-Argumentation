#!/usr/bin/env node
/**
 * gate-routes.mjs — the route-parity gate. Tier 1, OFFLINE, no browser, no server.
 *
 * Phase 02 of the edu-replatform program (checklist items F1/F2).
 *
 * WHAT IT DOES
 *   Statically parses the FROZEN legacy server (aws-quiz-app/edu_server.py) for its API
 *   route inventory, statically parses the new FastAPI app for the routes it declares,
 *   and diffs the two. The result is a burn-down counter that Phases 3 and 4 drive to 0.
 *
 * REQUIRED CWD
 *   ml/study/Edu-Argumentation/      run as:  node gates/gate-routes.mjs
 *                                    or:      npm --prefix gates run gate-routes
 *   (the npm script runs with gates/ as cwd, so it walks up one level; both work)
 *
 * WHY THE SELF-CHECK EXISTS — read this before touching the regexes
 *   "15 missing" and "the regex matched nothing" are the SAME OUTPUT. A differ that
 *   reports a clean burn-down against an empty extraction is worse than no gate at all,
 *   because it is green for the wrong reason and nobody looks again.
 *
 *   So before any diff is printed, the extractor asserts it found EXACTLY 5 GET and
 *   EXACTLY 10 POST routes in the legacy file. Any other count exits non-zero with
 *   EXTRACTOR FAILED and prints NO diff. 5 + 10 = 15 is a measured fact about a file
 *   that is frozen and will never change again:
 *     - 5 GET   : the `route == "/api/..."` branches of do_GET (L1091-1116)
 *     - 10 POST : the 7-entry allowlist tuple (L1272-1273) + the 3 RUN_ROUTES (L43)
 *
 *   ⚠ The three routinely dropped in a rewrite are /api/run/stop, /api/run/reset-kernel
 *   and /api/general. A port that moves "the 12" silently loses them.
 *
 * ⛔ NO RUNTIME INTROSPECTION ENDPOINT. It would be a 16th route on a frozen 15-route
 *    contract, i.e. the gate would change the thing it measures. The FastAPI side is
 *    parsed statically, from source, for the same reason.
 *
 * FILE-SERVING SURFACE IS NOT PART OF THIS COUNT. It is 2 prefix-dispatched routes plus
 * the static fallthrough (/assets/<moduleId>/<file> at L1087, /book/<id>/... at L1089,
 * then super().do_GET()). Those are tracked in the phase plan's frozen contract table,
 * not here — they are not `/api/` routes and counting them would break the 15.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Hardcoded, relative to the nested repo root — NOT to process.cwd(), so the gate gives
// the same answer from ml/study/Edu-Argumentation/ and from gates/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = join(REPO_ROOT, 'aws-quiz-app', 'edu_server.py');
const FASTAPI_APP = join(REPO_ROOT, 'app', 'backend', 'main.py');

const EXPECTED_GET = 5;
const EXPECTED_POST = 10;

// Routes the new app is allowed to have that the legacy app never had.
const ALLOWED_EXTRA = new Set(['GET /api/health']);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function read(path, label) {
  if (!existsSync(path)) die(`EXTRACTOR FAILED: ${label} not found at ${path}`);
  return readFileSync(path, 'utf8');
}

/* -------------------------------------------------------------------------- */
/* Legacy extraction                                                          */
/* -------------------------------------------------------------------------- */
function extractLegacy(src) {
  // GET: the do_GET body dispatches on `route == "/api/..."`. Scope to do_GET so a
  // same-shaped comparison elsewhere in the file cannot inflate the count.
  const doGet = /def do_GET\(self\)[\s\S]*?(?=\n    def |\ndef |$)/.exec(src);
  if (!doGet) die('EXTRACTOR FAILED: could not locate do_GET in the legacy server');
  const gets = [...doGet[0].matchAll(/route == "(\/api\/[^"]+)"/g)].map((m) => m[1]);

  // POST: the allowlist tuple in do_POST, plus RUN_ROUTES spliced onto it with `+`.
  const doPost = /def do_POST\(self\)[\s\S]*?(?=\n    def |\ndef |$)/.exec(src);
  if (!doPost) die('EXTRACTOR FAILED: could not locate do_POST in the legacy server');
  const guard = /route not in \(([\s\S]*?)\)\s*\+\s*RUN_ROUTES:/.exec(doPost[0]);
  if (!guard) die('EXTRACTOR FAILED: could not locate the do_POST allowlist tuple');
  const allow = [...guard[1].matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);

  const runDecl = /RUN_ROUTES\s*=\s*\(([^)]*)\)/.exec(src);
  if (!runDecl) die('EXTRACTOR FAILED: could not locate the RUN_ROUTES declaration');
  const runs = [...runDecl[1].matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);

  return {
    get: [...new Set(gets)].sort(),
    post: [...new Set([...allow, ...runs])].sort(),
  };
}

/* -------------------------------------------------------------------------- */
/* New app extraction                                                         */
/* -------------------------------------------------------------------------- */
// Returns { api, nonApi }. The diff is scoped to /api/ routes ONLY, because the frozen
// contract is a 15-route API contract. The legacy app's "/" is not a route at all — it is
// the stdlib static fallthrough (row 3 of the plan's file-serving table) — so comparing the
// new app's SPA index route against it would report a permanent phantom "extra" and train
// whoever runs this gate to ignore the extra counter. Non-API routes are printed for
// visibility instead, which is the honest place for them.
function extractFastapi(src) {
  const routes = [...src.matchAll(/@app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)]
    .map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  const uniq = [...new Set(routes)].sort();
  return {
    api: uniq.filter((r) => r.split(' ')[1].startsWith('/api/')),
    nonApi: uniq.filter((r) => !r.split(' ')[1].startsWith('/api/')),
  };
}

/* -------------------------------------------------------------------------- */
const legacySrc = read(LEGACY, 'legacy server');
const legacy = extractLegacy(legacySrc);

// ---- SELF-CHECK. Runs BEFORE any diff is computed or printed. ----
if (legacy.get.length !== EXPECTED_GET || legacy.post.length !== EXPECTED_POST) {
  console.error(
    `EXTRACTOR FAILED: expected ${EXPECTED_GET} GET + ${EXPECTED_POST} POST in the frozen ` +
      `legacy server, found ${legacy.get.length} GET + ${legacy.post.length} POST.`,
  );
  console.error(`  GET  found: ${JSON.stringify(legacy.get)}`);
  console.error(`  POST found: ${JSON.stringify(legacy.post)}`);
  console.error('  The legacy file is FROZEN. A count change means the parse broke, not that');
  console.error('  the contract changed. Fix the extractor; do NOT print a burn-down.');
  process.exit(1);
}
console.log(`EXTRACTOR OK: ${legacy.get.length} GET + ${legacy.post.length} POST`);

const expected = new Set([
  ...legacy.get.map((r) => `GET ${r}`),
  ...legacy.post.map((r) => `POST ${r}`),
]);

const fastapi = extractFastapi(read(FASTAPI_APP, 'FastAPI app'));
const actual = new Set(fastapi.api);

const missing = [...expected].filter((r) => !actual.has(r)).sort();
const extra = [...actual].filter((r) => !expected.has(r) && !ALLOWED_EXTRA.has(r)).sort();
const allowed = [...actual].filter((r) => ALLOWED_EXTRA.has(r)).sort();

console.log(`${missing.length} missing · ${extra.length} extra · 0 unexpected`);
if (allowed.length) console.log(`allowed extras: ${allowed.join(', ')}`);
if (fastapi.nonApi.length)
  console.log(`non-API routes (outside the 15-route contract): ${fastapi.nonApi.join(', ')}`);
if (missing.length) {
  console.log('\nnot yet ported:');
  for (const r of missing) console.log(`  - ${r}`);
}
if (extra.length) {
  console.error('\nUNDECLARED ROUTES (not in the frozen contract, not allow-listed):');
  for (const r of extra) console.error(`  - ${r}`);
  process.exit(1);
}
