#!/usr/bin/env node
/**
 * gate-r-qna.mjs — R-suite: THE Q&A EXAMINER API (study-rooms-qna P2, 29-09-26). Tier 2.
 *
 * Runs against its OWN fresh write harness (run-gates-react.sh starts it with
 * QNA_TEST_DEADLINE_S=10 and QNA_TEST_RETRY_MIN_S=5 — the ONLY process that ever sets them; the
 * live unit never does). The stub upstream (gates/stubs/stub-upstream.py) plays the model through
 * its scripted-reply queue (POST /__script), so every grade the app parses is a reply we chose,
 * and the stub LOG proves how many model calls were made.
 *
 * ⛔ What this proves: the parser, the pass rule (raw score > 8), the bucket, the deadline loop,
 *    the 502 path and the fail-closed OUT_OF_SCOPE mapping. It does NOT prove how the real model
 *    grades or refuses — that is the user's Tier-4 check.
 * ⛔ Each case uses its own X-Real-IP (TEST-NET-3, honoured from the loopback peer) so the per-IP
 *    `qna` bucket (30 / 600 s) is counted per case, never shared by accident.
 *
 * Twenty-eight result lines (RS-COUNT in gate-r-self.mjs moves with this number, always):
 *   QNA-P01..QNA-P18 (parser fault cases) · QNA-Q · QNA-G401 · QNA-G403 · QNA-G429 · QNA-B-SKIP
 *   QNA-A1..QNA-A4 · QNA-NOEFFECT
 */
const BASE = process.env.R_WRITE_BASE || 'http://127.0.0.1:8796';
const STUB = `http://127.0.0.1:${process.env.R_STUB_PORT || '8797'}`;
const STUB_LOG = process.env.R_STUB_LOG || '/var/tmp/edu-write-harness/stub.log';
const SESSION = process.env.R_SESSION || '';
const BOOK = 'geron-homl3';
const BLOCK = 'ch02-b07';

import fs from 'node:fs';

if (!SESSION) { console.error('REFUSING: needs R_SESSION — run via run-gates-react.sh'); process.exit(2); }
if (!STUB_LOG.startsWith('/var/tmp/')) { console.error('REFUSING: stub log not under /var/tmp'); process.exit(2); }

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

let ipN = 0;
const freshIp = () => `203.0.113.${(ipN += 1)}`;

async function post(route, body, { ip = freshIp(), cookie = SESSION, origin } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Real-IP': ip };
  if (cookie) headers.Cookie = `edu_session=${cookie}`;
  if (origin) headers.Origin = origin;
  const r = await fetch(BASE + route, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const stubLog = () => (fs.existsSync(STUB_LOG) ? fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const qnaCalls = (since) => stubLog().slice(since).filter((e) => String(e.kind).startsWith('qna-') || e.kind === 'scripted').length;
async function script(replies) {
  const r = await fetch(`${STUB}/__script`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true, replies }) });
  if (!r.ok) throw new Error(`stub /__script -> ${r.status}`);
}
const grade = (answer = 'my own words') => post('/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'Explain the idea.', answer });

/* ---- QNA-P01..P18: the parser fault list, each through a scripted model reply ---- */
// [id, label, first reply, expected: {score, pass} | 'reject' | 'garbage']
const CASES = [
  ['QNA-P01', 'fenced JSON ok', '```json\n{"score":9,"right":["a"],"feedback":"ok"}\n```', { score: 9, pass: true }],
  ['QNA-P02', 'prose-wrapped ok', 'Here is the grade: {"score":7,"missing":["b"]} hope it helps', { score: 7, pass: false }],
  ['QNA-P03', 'braces inside a string ok', '{"score":9,"feedback":"use {x} and } carefully"}', { score: 9, pass: true }],
  ['QNA-P04', 'score 8 -> pass false', '{"score":8}', { score: 8, pass: false }],
  ['QNA-P05', 'score 8.01 -> pass true (raw, unrounded)', '{"score":8.01}', { score: 8.01, pass: true }],
  ['QNA-P06', 'score 9 -> pass true', '{"score":9}', { score: 9, pass: true }],
  ['QNA-P07', 'score 10 -> pass true', '{"score":10}', { score: 10, pass: true }],
  ['QNA-P08', 'score 11 -> reject', '{"score":11}', 'reject'],
  ['QNA-P09', 'score -1 -> reject', '{"score":-1}', 'reject'],
  ['QNA-P10', 'score true -> reject', '{"score":true}', 'reject'],
  ['QNA-P11', 'score "9" (string) -> reject', '{"score":"9"}', 'reject'],
  ['QNA-P12', 'score NaN -> reject', '{"score":NaN}', 'reject'],
  ['QNA-P13', 'score Infinity -> reject', '{"score":Infinity}', 'reject'],
  ['QNA-P14', 'arrays missing -> []', '{"score":6,"feedback":"f"}', { score: 6, pass: false, empty: true }],
  ['QNA-P15', 'array of non-str -> reject', '{"score":9,"right":[1,2]}', 'reject'],
  ['QNA-P16', 'top-level list -> reject', '[{"score":9}]', 'reject'],
  ['QNA-P17', 'nested object inside a rejected one -> reject', '{"score":NaN,"x":{"score":9}}', 'reject'],
  ['QNA-P18', 'garbage twice -> 502', 'not json at all', 'garbage'],
];
for (const [id, label, reply, want] of CASES) {
  const before = stubLog().length;
  // A rejected reply is answered by the retry; script the SAME bad reply twice so the retry cannot rescue it.
  await script(typeof want === 'string' ? [{ text: reply }, { text: reply }] : [{ text: reply }]);
  const r = await grade();
  const calls = qnaCalls(before);
  if (typeof want === 'string') {
    check(`${id} ${label}`, r.status === 502 && r.json?.error === 'grade_unavailable' && r.json?.score === undefined && calls === 2,
      `status=${r.status} body=${r.text.slice(0, 80)} modelCalls=${calls} (want 502 grade_unavailable, no score, 2 calls)`);
  } else {
    const j = r.json || {};
    const arraysOk = !want.empty || ['right', 'wrong', 'missing', 'almost'].every((k) => Array.isArray(j[k]) && j[k].length === 0);
    check(`${id} ${label}`, r.status === 200 && j.score === want.score && j.pass === want.pass && arraysOk && calls === 1,
      `status=${r.status} score=${j.score} pass=${j.pass} arrays=${arraysOk} modelCalls=${calls}`);
  }
}
await script([]);

/* ---- QNA-Q: questions come in lesson order, one per block; done past the end; bad ids 400 ---- */
{
  const ip = freshIp();
  const before = stubLog().length;
  const blocks = [BLOCK, 'ch01-b02'];
  const q0 = await post('/api/qna/question', { bookId: BOOK, blocks, index: 0 }, { ip });
  const q1 = await post('/api/qna/question', { bookId: BOOK, blocks, index: 1 }, { ip });
  const q2 = await post('/api/qna/question', { bookId: BOOK, blocks, index: 2 }, { ip });
  const bad = await post('/api/qna/question', { bookId: BOOK, blocks: ['nope'], index: 0 }, { ip });
  const unknown = await post('/api/qna/question', { bookId: BOOK, blocks: ['ch99-b01'], index: 0 }, { ip });
  const noBook = await post('/api/qna/question', { bookId: 'no-such-book', blocks: [BLOCK], index: 0 }, { ip });
  const calls = qnaCalls(before);
  check('QNA-Q question: lesson order (ch01-b02 then ch02-b07), total 2, done at index 2; malformed / unknown block / unknown book -> 400 with no model call',
    q0.status === 200 && q0.json?.block === 'ch01-b02' && q0.json?.total === 2 && typeof q0.json?.question === 'string' && q0.json.question.length > 0
      && typeof q0.json?.lessonTitle === 'string' && q1.json?.block === BLOCK && q2.json?.done === true
      && bad.status === 400 && unknown.status === 400 && noBook.status === 400 && calls === 2,
    `q0=${q0.status}:${q0.json?.block}/${q0.json?.total} q1=${q1.json?.block} q2=${JSON.stringify(q2.json)} bad=${bad.status} unknown=${unknown.status} noBook=${noBook.status} modelCalls=${calls}`);
}

/* ---- QNA-G401: signed out -> 401 on all three ---- */
{
  const codes = [];
  for (const route of ['/api/qna/question', '/api/qna/grade', '/api/qna/ask']) codes.push((await post(route, { bookId: BOOK }, { cookie: '' })).status);
  check('QNA-G401 signed out: question / grade / ask -> 401', codes.every((c) => c === 401), codes.join(' '));
}

/* ---- QNA-G403: a foreign Origin -> 403, before any model call ---- */
{
  const before = stubLog().length;
  const codes = [];
  for (const [route, body] of [['/api/qna/question', { bookId: BOOK, blocks: [BLOCK], index: 0 }],
    ['/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'q', answer: 'a' }],
    ['/api/qna/ask', { bookId: BOOK, block: BLOCK, question: 'q' }]]) {
    codes.push((await post(route, body, { origin: 'http://evil.example' })).status);
  }
  check('QNA-G403 cross-origin: question / grade / ask -> 403 and 0 model calls', codes.every((c) => c === 403) && qnaCalls(before) === 0,
    `${codes.join(' ')} modelCalls=${qnaCalls(before)}`);
}

/* ---- QNA-G429: 30 calls pass, the 31st is 429 (the qna bucket exists — no KeyError 500) ---- */
{
  const ip = freshIp();
  const before = stubLog().length;
  const codes = [];
  for (let i = 0; i < 31; i += 1) codes.push((await post('/api/qna/ask', { bookId: BOOK, block: BLOCK, question: `q${i}` }, { ip })).status);
  const last = await post('/api/qna/ask', { bookId: BOOK, block: BLOCK, question: 'again' }, { ip });
  const first30 = codes.slice(0, 30).every((c) => c === 200);
  check('QNA-G429 per-IP qna bucket: calls 1-30 -> 200, call 31 -> 429 with retryAfter; 30 model calls, none after the limit',
    first30 && codes[30] === 429 && last.status === 429 && Number(last.json?.retryAfter) > 0 && qnaCalls(before) === 30,
    `first30=${first30} call31=${codes[30]} retryAfter=${last.json?.retryAfter} modelCalls=${qnaCalls(before)}`);
}

/* ---- QNA-B-SKIP: the retry is skipped when the budget is short (deadline 10 s, retry-min 5 s) ---- */
{
  const before = stubLog().length;
  await script([{ text: 'garbage, slowly', delay_s: 6 }, { text: '{"score":9}' }]);
  const t0 = Date.now();
  const r = await grade();
  const secs = (Date.now() - t0) / 1000;
  const calls = qnaCalls(before);
  await script([]);
  check('QNA-B-SKIP first reply garbage after 6 s of a 10 s budget (5 s retry-min) -> retry skipped: 502 grade_unavailable after 1 model call',
    r.status === 502 && r.json?.error === 'grade_unavailable' && calls === 1 && secs < 10,
    `status=${r.status} error=${r.json?.error} modelCalls=${calls} seconds=${secs.toFixed(1)}`);
}

/* ---- QNA-A1..A4: ask-back refusal is fail-closed ---- */
for (const [id, reply, refused] of [
  ['QNA-A1', 'OUT_OF_SCOPE', true],
  ['QNA-A2', ' out_of_scope. ', true],
  ['QNA-A3', 'Sorry — OUT_OF_SCOPE', true],
  ['QNA-A4', 'The theory says strata are subgroups.', false],
]) {
  await script([{ text: reply }]);
  const r = await post('/api/qna/ask', { bookId: BOOK, block: BLOCK, question: 'something' });
  const j = r.json || {};
  const ok = refused
    ? r.status === 200 && j.refused === true && j.answer === 'Not in this theory.'
    : r.status === 200 && j.refused === false && j.answer === reply;
  check(`${id} reply ${JSON.stringify(reply)} -> ${refused ? 'refused, fixed text, no model text' : 'not refused, model text returned'}`, ok,
    `status=${r.status} refused=${j.refused} answer=${JSON.stringify(j.answer)}`);
}
await script([]);

/* ---- QNA-NOEFFECT: a pass writes nothing — /api/progress is byte-identical before and after ---- */
{
  const read = async () => (await fetch(`${BASE}/api/progress?module=${BOOK}`, { headers: { Cookie: `edu_session=${SESSION}` } })).text();
  const before = await read();
  await script([{ text: '{"score":10}' }]);
  const r = await grade();
  const after = await read();
  await script([]);
  check('QNA-NOEFFECT a passing grade (score 10) records nothing: /api/progress identical before and after',
    r.status === 200 && r.json?.pass === true && before === after, `grade=${r.status}/${r.json?.pass} progressSame=${before === after}`);
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
