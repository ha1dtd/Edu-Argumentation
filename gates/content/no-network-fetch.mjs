// no-network-fetch.mjs — Phase-1 C6: no code cell performs a REMOTE fetch.
//
// Why: the runner caps a cell at CELL_TIMEOUT_SECONDS=60. A cell that downloads
// spends its budget on the network and comes back status:"timeout", which reads as
// "this code is too heavy to run" — a false R13 weight verdict about the code,
// caused entirely by the network (ch03-b01 c01: 65.1 s -> timeout before staging).
//
// Static and self-contained: ONE module.json in, counts out. No Playwright, no
// node_modules, no GATE_BASE. Node stdlib only.
//
// What it counts: code_cells cells whose source CALLS a fetch API
// (urlretrieve / urlopen / requests.* / sklearn fetch_* / tfds.load / get_file /
// load_dataset / !wget|curl). A call whose every URL literal in the cell is local
// (localhost / 127.0.0.1 / 0.0.0.0 — e.g. TF-Serving) is a LOCAL SERVICE CALL,
// not a remote fetch: it is printed as excluded, never dropped silently.
//
// ⚠ What it cannot see (stated, not hidden): a fetch reached indirectly — through
// a helper, an exec, a library default such as tfds' implicit download, or a URL
// handed to a reader such as pandas.read_csv("https://..."). Cells that carry a URL
// literal but no matched call are printed as ADVISORY and are not counted.
// On the RED fixture that is ch01-b08 `load`, which reads its CSVs from github
// through read_csv — a real fetch this gate does not count.
//
// ⚠ REBUILT 23-09-26 from the Phase-1 spec + report (the original was never pushed).
//
// Usage:  node no-network-fetch.mjs <module.json> [--expect N]     (default N = 0)
// Exit:   0 GREEN (hits == N) · 1 RED (hits != N) · 2 usage / unreadable input
import fs from 'node:fs';

const FETCH_CALLS = [
  ['urllib.request.urlretrieve', /\burlretrieve\s*\(/],
  ['urllib.request.urlopen', /\burlopen\s*\(/],
  ['requests', /\brequests\.(?:get|post|put|patch|delete|head|request)\s*\(/],
  ['sklearn.datasets.fetch_*', /\bfetch_[a-z0-9_]+\s*\(/],
  ['tfds.load', /\btfds\.load\s*\(/],
  ['keras get_file', /\bget_file\s*\(/],
  ['load_dataset', /\bload_dataset\s*\(/],
  ['wget/curl', /^\s*!\s*(?:wget|curl)\b/m],
];
const URL_RE = /https?:\/\/[^\s"'`)]+/g;
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?:[:/]|$)/;

function usage(msg) {
  if (msg) console.error(`no-network-fetch: ${msg}`);
  console.error('usage: node no-network-fetch.mjs <module.json> [--expect N]');
  process.exit(2);
}

const args = process.argv.slice(2);
let file = null;
let expect = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--expect') {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 0) usage('--expect needs a non-negative integer');
    expect = n;
  } else if (!file) file = args[i];
  else usage(`unexpected argument ${args[i]}`);
}
if (!file) usage('no module.json given');

let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  usage(`cannot read ${file}: ${e.message}`);
}
const sections = doc?.tutorialData?.sections;
if (!Array.isArray(sections)) usage(`${file}: no tutorialData.sections — not a module.json`);

const hits = [];
const local = [];
const advisory = [];
let scanned = 0;
sections.forEach((sec, si) => {
  (sec?.items || []).forEach((it, ii) => {
    const lid = `ch${String(si + 1).padStart(2, '0')}-b${String(ii + 1).padStart(2, '0')}`;
    for (const b of it?.blocks || []) {
      if (!b || b.type !== 'code_cells') continue;
      for (const c of b.cells || []) {
        scanned++;
        const src = String(c?.source ?? '');
        const calls = FETCH_CALLS.filter(([, re]) => re.test(src)).map(([label]) => label);
        const urls = src.match(URL_RE) || [];
        const row = { lid, id: String(c?.id ?? '?'), term: String(it?.term ?? ''), calls };
        if (calls.length) {
          if (urls.length && urls.every((u) => LOCAL.test(u))) local.push(row);
          else hits.push(row);
        } else if (urls.length) advisory.push(row);
      }
    }
  });
});

const line = (r) => `    ${r.lid} cell ${r.id} — ${r.calls.join(', ') || 'URL literal only'}   [${r.term}]`;
console.log(`no-network-fetch — ${file}`);
console.log(`  cells scanned: ${scanned}`);
console.log(`  REMOTE FETCH hits: ${hits.length} (expected ${expect})`);
hits.forEach((r) => console.log(line(r)));
if (local.length) {
  console.log(`  excluded — local service call, not a remote fetch: ${local.length}`);
  local.forEach((r) => console.log(line(r)));
}
if (advisory.length) {
  console.log(`  advisory — URL literal but no matched call (NOT counted): ${advisory.length}`);
  advisory.forEach((r) => console.log(line(r)));
}
if (hits.length === expect) {
  console.log('  RESULT: GREEN');
  process.exit(0);
}
console.log(`  RESULT: RED — ${hits.length} remote-fetch cell(s), expected ${expect}`);
process.exit(1);
