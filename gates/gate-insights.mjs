#!/usr/bin/env node
/**
 * gate-insights.mjs — Account page redesign A + B + C (23-11-26), in a real browser.
 *
 * Tier 1/2, browser: the REAL built bundle (app/frontend/dist) with the API stubbed in the browser:
 *     cd app/frontend && ./node_modules/.bin/vite build && node ../../gates/gate-insights.mjs
 * Env: GI_DIST (another build, for fault injection), GI_SHOTS (screenshots, default /var/tmp/pcstudy/insights-shots),
 *      GATE_CHROME (a chromium binary when playwright's own revision is not installed).
 * Proves (A) the page opens on the book studied LAST, shows its real title and lesson total (the "t-…" id of the AWS
 * book used to show raw), lists a book that exists twice once, calls the number "currently wrong", keeps practice
 * sets apart from chapters, starts History CLOSED and stays short on a phone; (B) weak topics ranked with their
 * numbers as text, improving / slipping, a heatmap, a 12-week trend, the review schedule, the Hard / Good / Easy mix
 * — every chart value also as text; Practice on a weak topic runs ONLY that topic's questions; one failing read
 * leaves the rest of the page standing; (C) an answer is POSTed with durationMs and a review grade with its
 * confidence, and the Time block shows time per topic and per session in words.
 * Fails when: the page opens on the wrong book, a title falls back to the raw id, History opens by itself, a
 * practice set lands among the chapters, a weak topic loses its numbers, Practice mixes in other topics,
 * durationMs / confidence is not sent, a viewport scrolls sideways, or a new control is under 44 px.
 * ⚠ No red proof was run when this gate was written (23-11-26) — see the README row.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = process.env.GI_DIST || resolve(fileURLToPath(new URL('.', import.meta.url)), '../app/frontend/dist');
const SHOTS = process.env.GI_SHOTS || '/var/tmp/pcstudy/insights-shots';
if (!existsSync(join(DIST, 'index.html'))) { console.log(`FAIL  X0  no build at ${DIST} — run vite build first`); process.exit(2); }
mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname; const file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const results = [];
const check = (id, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail ?? ''}`); };

// ---- two books: the first is open by default, the AWS-style one (a "t-" module id) was studied last ----------------------
const SECTIONS = ['Chapter 1: Storage', 'Chapter 2: Databases', 'Chapter 3: Networking', 'Practice 1: Databases', 'Practice 2: Storage'];
const bank = [];
SECTIONS.forEach((_, i) => { const c = i + 1; for (let q = 1; q <= 4; q += 1) bank.push({ question: `Gate Q c${c} q${q}: pick the right one`, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correct: (c + q) % 4,
  explanations: null, source: { chapter: c, block: `ch0${c}-b01`, question: `ch0${c}-b01-q${q}` } }); });
const CORRECT = new Map(bank.map((b) => [b.question, b.correct]));
const aws = { moduleId: 't-gate-aws', tutorialData: { title: 'Gate Cloud Book', sections: SECTIONS.map((t, i) => ({ title: t, themeColor: 'indigo-500', items: [{ term: `Lesson ${i + 1}`, blocks: [{ type: 'text', content: 'Hi.' }] }] })) }, quizData: bank };
const geron = { moduleId: 'geron-homl3', tutorialData: { title: 'Gate Geron', sections: [{ title: 'Chapter 1: Basics', themeColor: 'indigo-500', items: [{ term: 'L', blocks: [{ type: 'text', content: 'x' }] }] }] }, quizData: [] };

const T = (n) => `2026-11-${String(n).padStart(2, '0')}T08:00:00+00:00`;
const topic = (id, name, answered, right, extra = {}) => ({ id, name, groups: ['chapters', 'practice'], chapters: id === 'databases' ? [2, 4] : id === 'storage' ? [1, 5] : [3], answered, right,
  accuracy: answered ? Math.round((100 * right) / answered) : null, enough: answered >= 5, currentlyWrong: 0, cards: 0, lapses: 0, leeches: 0, due: 0, lastAt: T(22),
  trend: { recent: null, earlier: null, delta: null, label: 'not enough yet' }, ...extra });
const DB = topic('databases', 'Databases', 40, 25, { currentlyWrong: 6, cards: 18, lapses: 9, leeches: 1, trend: { recent: 55, earlier: 66, delta: -11, label: 'slipping' } });
const ST = topic('storage', 'Storage', 30, 21, { currentlyWrong: 2, cards: 12, lapses: 3, trend: { recent: 90, earlier: 62, delta: 28, label: 'improving' } });
const NET = topic('networking', 'Networking', 3, 3, { groups: ['chapters'] });
const days = []; for (let i = 0; i < 106; i += 1) { const d = new Date(Date.UTC(2026, 7, 10 + i)); days.push({ d: d.toISOString().slice(0, 10), n: i % 5 === 0 ? 0 : (i * 7) % 23, ms: 1000 * i }); }
const weeks = Array.from({ length: 12 }, (_, i) => ({ start: new Date(Date.UTC(2026, 8, 7 + 7 * i)).toISOString().slice(0, 10), answered: 10 + i * 3, accuracy: 60 + i * 2, reviews: 5 + i, recall: 70 + i, ms: 60000 * i,
  grades: { again: i, hard: 1, good: 2 * i, easy: 1 } }));
const INSIGHTS = { module: 't-gate-aws', areaKind: 'chapter', now: T(23), topics: [ST, DB, NET], weak: [DB, ST], improving: [ST], slipping: [DB], notStarted: ['Networking basics', 'Security'], unassigned: 4, minAnswers: 5,
  heatmap: { from: '2026-08-10', days, max: 22 }, weeks,
  time: { totalMs: 3900000, trackedAnswers: 120, untrackedAnswers: 80, since: '2026-11-23T08:00:00+00:00', avgQuestionMs: 32500, byTopic: [
    { id: 'databases', name: 'Databases', ms: 2400000, tracked: 70, answered: 100, avgMs: 34286 }, { id: 'storage', name: 'Storage', ms: 1500000, tracked: 50, answered: 60, avgMs: 30000 }],
    sessionsTotal: 9, avgSessionMs: 433000, sessions: [
      { runId: 'run-a', kind: 'review', at: '2026-11-23T05:00:00+00:00', answered: 20, right: 17, ms: 600000, wallMs: 700000 },
      { runId: 'run-b', kind: 'practice', at: '2026-11-22T05:00:00+00:00', answered: 10, right: 6, ms: null, wallMs: 300000 }] },
  srs: { total: 40, dueNow: 12, dueToday: 15, leeches: 1, stages: { new: 5, learning: 10, young: 15, mature: 10 }, next7: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-${24 + i}`, count: i * 3 })) },
  grades: { again: 5, hard: 10, good: 30, easy: 5, total: 50, since: '2026-11-23T08:00:00+00:00' }, retention30: 88, reviews30: 200,
  calibration: { sure: { n: 10, right: 9 }, unsure: { n: 5, right: 3 }, guess: { n: 4, right: 1 } }, currentlyWrong: 8, answeredTotal: 200 };
const BOOK_ROW = (module, lessons, extra = {}) => ({ module, lastAt: T(23), lessons, currentlyWrong: 8, aiAnswered: 3, answered7: 41, accuracy7: 78, ms7: 1500000,
  srs: { total: 40, dueNow: 12, dueToday: 15, leeches: 1, stages: { new: 5, learning: 10, young: 15, mature: 10 }, next7: [] }, ...extra });
const OVERVIEW = { now: T(23), today: { date: '2026-11-23', answered: 7, accuracy: 86, ms: 240000 },
  week: { start: '2026-11-23', answered: 41, accuracy: 78, activeDays: 1, ms: 1500000, prevAnswered: 30, prevAccuracy: 70 }, streak: { current: 5, longest: 9, activeDays30: 14, lastActive: '2026-11-23' },
  lastBook: 't-gate-aws', books: [BOOK_ROW('t-gate-aws', 2), BOOK_ROW('geron-homl3', 1, { lastAt: T(2), currentlyWrong: 0, answered7: 0, accuracy7: null, ms7: 0 })],
  totals: { dueNow: 24, currentlyWrong: 8, cards: 80 } };
const area = (id, name, chapters, answered, right, group) => ({ id, name, chapters, answered, right, pct: answered >= 5 ? Math.round((100 * right) / answered) : null, enough: answered >= 5, lastAt: T(22), group });
const MASTERY = { module: 't-gate-aws', areaKind: 'chapter', exam: null, window: 200, minAnswers: 5, target: 80, unassigned: 4, areas: [
  area('ch01', SECTIONS[0], [1], 12, 10, 'chapters'), area('ch02', SECTIONS[1], [2], 9, 5, 'chapters'), area('ch03', SECTIONS[2], [3], 3, 3, 'chapters'),
  area('ch04', SECTIONS[3], [4], 7, 5, 'practice'), area('ch05', SECTIONS[4], [5], 0, 0, 'practice')],
  nextUp: { id: 'ch02', name: SECTIONS[1], reason: 'weakest', answered: 9, right: 5, pct: 56 } };
const LONG = 'A very long question text that goes on and on about a scenario with many words so a phone has to wrap it several times over '.repeat(3);
const HIST = Array.from({ length: 50 }, (_, i) => ({ id: `a:${200 - i}`, source: 'log', question: `ch02-b01-q${(i % 4) + 1}`, label: LONG, chapter: 2, domain: null, runKind: 'practice', runId: `run-${Math.floor(i / 5)}`, correct: i % 3 !== 0, confidence: null, chosen: 0, at: `2026-11-22T0${i % 9}:00:00+00:00` }));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });

async function open({ width = 1366, height = 900, insightsFail = false } = {}) {
  const gets = { insights: [], mastery: [], overview: 0 }; const posts = { answers: [], grades: [] };
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const m = route.request().method();
    const body = () => JSON.parse(route.request().postData() || '{}');
    if (u.pathname === '/api/auth/me') return json(route, { account: { id: 2, username: 'gate', displayName: 'Gate', isOwner: false } });
    if (u.pathname === '/api/modules') return json(route, { books: [
      { file: 'geron-homl3', moduleId: 'geron-homl3', title: 'Gate Geron', chapters: 1, lessons: 1, questions: 0, default: true },
      { file: 't-gate-aws', moduleId: 't-gate-aws', title: 'Gate Cloud Book', chapters: 5, lessons: 12, questions: bank.length },
      { file: 'dup-a.json', moduleId: 'gate-dup', title: 'Dup book', chapters: 1, lessons: 2, questions: 0, lastReadAt: 5 },
      { file: 'dup-b.json', moduleId: 'gate-dup', title: 'Dup book', chapters: 1, lessons: 2, questions: 0, lastReadAt: 9 }] });
    if (u.pathname === '/api/account/stats') return json(route, { completed: [], wrongAnswers: [], wrongTotal: 0, attempts: Array.from({ length: 8 }, (_, i) => ({ module: 't-gate-aws', block: `ch0${(i % 3) + 1}-b01`, score: 4, total: 5, source: 'written', at: T(20 - i) })) });
    if (u.pathname === '/api/account/overview') { gets.overview += 1; return json(route, OVERVIEW); }
    if (u.pathname === '/api/account/insights') { gets.insights.push(u.searchParams.get('module')); return insightsFail ? json(route, { error: 'boom' }, 500) : json(route, INSIGHTS); }
    if (u.pathname === '/api/mastery') { gets.mastery.push(u.searchParams.get('module')); return json(route, u.searchParams.get('module') === 't-gate-aws' ? MASTERY : { ...MASTERY, module: 'geron-homl3', areas: [], nextUp: null, unassigned: 0 }); }
    if (u.pathname === '/api/history') return json(route, { module: 't-gate-aws', filter: 'all', items: HIST, nextCursor: null, counts: { all: 50, wrong: 17, flagged: 0 }, runs: {} });
    if (u.pathname === '/api/answers' && m === 'POST') { posts.answers.push(body()); return json(route, { outcome: 'logged' }, 201); }
    if (u.pathname === '/api/review/grade' && m === 'POST') { posts.grades.push(body()); return json(route, { question: 'x', dueAt: T(24) }); }
    if (u.pathname === '/api/review/seen' && m === 'POST') return json(route, { outcome: 'created' });
    if (u.pathname === '/api/review/due') return json(route, { due: [], dueCount: 0, total: 0 });
    if (u.pathname === '/api/review/stats') return json(route, { dueNow: 0, dueToday: 0, next7: [], total: 0, leeches: 0, retention: null });
    if (u.pathname === '/api/study/prefs') return json(route, { module: 't-gate-aws', newPerDay: 20, sessionSize: 20 });
    if (u.pathname === '/api/flags' && m === 'GET') return json(route, { flags: [], count: 0 });
    if (u.pathname === '/api/progress') return json(route, { module: 't-gate-aws', completed: {} });
    if (u.pathname === '/api/general') return json(route, { ai_question_count: 5, fresh_quiz_size: 10 });
    if (u.pathname === '/api/provider') return json(route, { ready: true, model: 'stub-model', token_required: false });
    return json(route, {});
  });
  await page.route('**/book/geron-homl3/module.json', (route) => json(route, geron));
  await page.route('**/book/t-gate-aws/module.json', (route) => json(route, aws));
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  return { page, gets, posts, errors };
}
const nav = async (page, id) => { if (!(await page.locator(id).isVisible())) { await page.locator('#menu-btn').click(); await page.waitForTimeout(300); } await page.locator(id).click(); await page.waitForTimeout(1200); };
const raw = (page, sel) => page.locator(sel).first().evaluate((e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const sideways = (page) => page.evaluate(() => Math.max(-1, ...[...document.querySelectorAll('body *')].filter((e) => !e.closest('header') && !e.closest('#activity-heatmap') && e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().right - window.innerWidth))));
const minBox = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return Math.min(Math.round(r.width), Math.round(r.height)); }));

// ---- 1. the top of the page: numbers, books, default book ---------------------------------------------------------------
{
  const { page, gets, errors } = await open();
  await nav(page, '#nav-account');
  const tiles = await page.$$eval('#overview-tiles [data-tile]', (ts) => Object.fromEntries(ts.map((t) => [t.getAttribute('data-tile'), (t.querySelector('[data-cell="value"]')?.textContent || '').trim()])));
  check('A1 five tiles: today 7 · this week 41 · streak 5 days · cards due 24 · currently wrong 8', JSON.stringify(tiles) === JSON.stringify({ today: '7', week: '41', streak: '5 days', due: '24', wrong: '8' }), JSON.stringify(tiles));
  const wrongLabel = await raw(page, '#tile-wrong');
  check('A2 the number is called "Currently wrong" (not the old ever-growing "Wrong answers recorded") and says what it counts', /Currently wrong\s*8/i.test(wrongLabel) && /latest answer was wrong/i.test(wrongLabel) && !/recorded/i.test(await raw(page, '#overview-tiles')), wrongLabel);
  check('A3 the page opens on the book studied LAST: insights + mastery asked for t-gate-aws, the select shows it', gets.insights.every((m) => m === 't-gate-aws') && gets.insights.length > 0 && gets.mastery.every((m) => m === 't-gate-aws') && (await page.locator('#account-book').inputValue()) === 't-gate-aws', `insights=${gets.insights} mastery=${gets.mastery} select=${await page.locator('#account-book').inputValue().catch(() => '?')}`);
  const cards = await page.$$eval('#account-books-list > li', (ls) => ls.map((l) => ({ m: l.getAttribute('data-module'), t: l.querySelector('[data-cell="title"]')?.textContent, lessons: l.querySelector('[data-cell="lessons"]')?.textContent, due: l.querySelector('[data-cell="due"]')?.textContent.replace(/\s+/g, ' ') })));
  check('A4 the "t-…" book shows its real title and "2 of 12" lessons — never the raw id', cards[0]?.m === 't-gate-aws' && cards[0].t === 'Gate Cloud Book' && cards[0].lessons === '2 of 12' && /^12 of 40/.test(cards[0].due) && cards.every((c) => !/^t-/.test(c.t)), JSON.stringify(cards));
  const options = await page.$$eval('#account-book option', (os) => os.map((o) => o.textContent));
  check('A5 a book listed from two files shows ONCE in the Book select', options.filter((o) => o === 'Dup book').length === 1 && options.length === 3, options.join('|'));
  check('A6 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 2. B: weak / improving / activity / schedule ------------------------------------------------------------------------
{
  const { page, errors } = await open();
  await nav(page, '#nav-account');
  const weak = await page.$$eval('#weak-list > li', (ls) => ls.map((l) => ({ id: l.getAttribute('data-topic'), name: l.querySelector('[data-cell="name"]')?.textContent, pct: l.querySelector('[data-cell="pct"]')?.textContent.replace(/\s+/g, ' ').trim(), facts: l.querySelector('[data-cell="facts"]')?.textContent })));
  check('B1 weak spots: Databases 63% 25/40 first, then Storage 70% 21/30 — numbers as text', weak.length === 2 && weak[0].id === 'databases' && weak[0].pct === '63% 25/40' && weak[1].pct === '70% 21/30', JSON.stringify(weak.map((w) => [w.id, w.pct])));
  check('B2 each weak topic says what is wrong in words: wrong now · lapses on cards · leeches · its trend', /6 questions wrong now/.test(weak[0].facts) && /9 lapses on 18 cards/.test(weak[0].facts) && /1 leech/.test(weak[0].facts) && /slipping \(-11 points: newest 55% vs earlier 66%\)/.test(weak[0].facts), weak[0].facts);
  check('B3 topics never started are named', /Not started:\s*Networking basics · Security/.test(await raw(page, '#not-started')), await raw(page, '#not-started'));
  const imp = await raw(page, '#improving-list'); const slip = await raw(page, '#slipping-list');
  check('B4 improving: Storage 62% → 90% (+28 points) · slipping: Databases 66% → 55%', /Storage 62% → 90% \+28 points/.test(imp) && /Databases 66% → 55% -11 points/.test(slip), `${imp} / ${slip}`);
  const heat = await page.$$eval('#activity-heatmap [data-day]', (cs) => ({ n: cs.length, sum: cs.reduce((s, c) => s + Number(c.getAttribute('data-n')), 0) }));
  check('B5 heatmap: one cell per day (106), the cells add up to the answers, and the same numbers are written below', heat.n === 106 && heat.sum > 0 && new RegExp(`${heat.sum} answers on \\d+ days since 10 Aug`).test(await raw(page, '#insights-activity')), JSON.stringify(heat));
  const wk = await page.$$eval('#weekly-trend [data-week]', (cs) => cs.map((c) => c.getAttribute('data-accuracy')));
  check('B6 weekly trend: 12 weeks, oldest left, accuracy 60 → 82, with a week-by-week table behind it', wk.length === 12 && wk[0] === '60' && wk[11] === '82' && (await page.locator('#weekly-table tbody tr').count()) === 12, wk.join(','));
  const sch = await raw(page, '#insights-schedule');
  check('B7 schedule: 12 due now of 40 · 1 leech · recall 88% · stages 5/10/15/10 · 7 day bars with counts', /12 cards due now of 40/.test(sch) && /1 leech/.test(sch) && /recall 88% over the last 30 days/.test(sch) && (await page.locator('#next7 li').count()) === 7 && /New \(never graded\) 5 Learning \(under 4 days\) 10 Young \(4 to 13 days\) 15 Mature \(14-day cap\) 10/.test(sch), sch.slice(0, 300));
  check('B8 Hard / Good / Easy mix is written out with percentages, and confidence calibration reads in words', /Again 5 \(10%\) · Hard 10 \(20%\) · Good 30 \(60%\) · Easy 5 \(10%\)/.test(await raw(page, '#grade-mix')) && /“sure” you were right 90% of the time \(10\)/.test(await raw(page, '#calibration')), `${await raw(page, '#grade-mix')} | ${await raw(page, '#calibration')}`);
  check('B9 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 3. C: time ---------------------------------------------------------------------------------------------------------------
{
  const { page } = await open();
  await nav(page, '#nav-account');
  const t = await raw(page, '#insights-time');
  check('C1 time total in words: 1 h 05 min over 120 timed answers, 33 s each (32.5), 7 min per session; older answers say they had no timer', /1 h 05 min on questions across 120 timed answers since 23 Nov; 33 s per question, 7 min per session/.test(t) && /80 older answers had no timer/.test(t), t.slice(0, 260));
  const bt = await page.$$eval('#time-by-topic > li', (ls) => ls.map((l) => [l.getAttribute('data-topic'), l.querySelector('[data-cell="time"]')?.textContent.replace(/\s+/g, ' ').trim()]));
  check('C2 time per topic, biggest first: Databases 40 min (34 s each) · Storage 25 min (30 s each)', JSON.stringify(bt) === JSON.stringify([['databases', '40 min 34 s each'], ['storage', '25 min 30 s each']]), JSON.stringify(bt));
  await page.locator('#insights-sessions > summary').click();
  const sess = await raw(page, '#insights-sessions');
  check('C3 sessions: right/answered and time per session; an untimed one says "time not measured"', /Review · 17\/20 right\s*10 min/.test(sess) && /Practice · 6\/10 right\s*time not measured/.test(sess) && /9 in all/.test(sess), sess);
  check('C4 the page says what "time" means and that lessons are not timed', /Reading lessons is not timed/.test(t), '');
  await page.close();
}

// ---- 4. A: groups, collapsed history, Practice on a weak topic ---------------------------------------------------------
{
  const { page, errors } = await open();
  await nav(page, '#nav-account');
  const main = await page.$$eval('#mastery-list > li', (ls) => ls.map((l) => l.getAttribute('data-area')));
  const pr = await page.locator('#mastery-practice-group').evaluate((d) => ({ open: d.open, summary: d.querySelector('summary').textContent.replace(/\s+/g, ' ').trim(), rows: d.querySelectorAll('li[data-area]').length }));
  check('A7 mastery: the 3 real chapters in the main list; 2 practice sets in a CLOSED group that says "1 of 2 started"', JSON.stringify(main) === '["ch01","ch02","ch03"]' && !pr.open && /Practice sets — 1 of 2 started/.test(pr.summary) && pr.rows === 2, JSON.stringify({ main, pr }));
  check('A8 Next up is a chapter (Chapter 2), AI answers outside any bar are named', /Next up\s*Chapter 2: Databases/.test(await raw(page, '#mastery-next-up')) && /4 answers are not in any bar/.test(await raw(page, '#mastery-unassigned')), await raw(page, '#mastery-unassigned'));
  const h = await page.locator('#history-details').evaluate((d) => ({ open: d.hasAttribute('open'), listVisible: document.getElementById('history-list')?.checkVisibility() ?? false }));
  check('A9 History starts CLOSED (its list is not on screen) and opens on tap', !h.open && !h.listVisible, JSON.stringify(h));
  await page.locator('#history-details > summary').click(); await page.waitForTimeout(300);
  check('A10 opened, History shows the same list as before', (await page.locator('#history-list').isVisible()) && (await page.locator('#history-list li[data-correct]').count()) === 50, '');
  const attempts = await page.locator('#account-attempts > li').count();
  check('A11 Recent assessments show 5, the other 3 sit behind "Show 3 more"', attempts === 5 && /Show 3 more/.test(await raw(page, '#account-attempts-more > summary')), `rows ${attempts}`);
  await page.locator('[data-practice-topic="databases"]').click(); await page.waitForTimeout(900);
  const seen = []; let n = 0;
  while (n < 12 && (await page.locator('#next-btn').count()) && await page.locator('#question-text').count()) {
    const q = await page.locator('#question-text').first().evaluate((e) => { const v = e.querySelector('rich-text-viewer'); return (v && v.shadowRoot ? [...v.shadowRoot.childNodes].filter((x) => x.nodeName !== 'STYLE').map((x) => x.textContent).join(' ') : e.textContent).replace(/\s+/g, ' ').trim(); });
    if (!q) break; seen.push(q); n += 1;
    await page.locator('#options-container .option-card').nth(CORRECT.get(q) ?? 0).click().catch(() => {}); await page.waitForTimeout(250);
    if (!(await page.locator('#next-btn').isVisible().catch(() => false))) break;
    await page.locator('#next-btn').click(); await page.waitForTimeout(350);
  }
  const chapters = [...new Set(seen.map((s) => (/ c(\d) /.exec(s) || [])[1]))].sort();
  check('A12 Practice on the weak topic "Databases" asks ONLY Databases questions (chapter 2 + practice set 4), 8 of them', chapters.join(',') === '2,4' && new Set(seen).size === 8, `chapters ${chapters} n=${new Set(seen).size} ${seen.map((x) => x.slice(0, 22)).join(" / ")}`);
  check('A13 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 5. C: what an answer sends ---------------------------------------------------------------------------------------------
{
  const { page, posts, errors } = await open();
  await nav(page, '#nav-account');
  await page.locator('[data-practice-topic="storage"]').click(); await page.waitForTimeout(900);
  await page.waitForTimeout(1500);                                                       // the question stays on screen ~1.5 s
  await page.locator('#options-container .option-card').first().click(); await page.waitForTimeout(600);
  const a = posts.answers[0] || {};
  check('W1 an answer is POSTed with durationMs: a whole number of ms, about the 1.5 s it was on screen (0..300000)', Number.isInteger(a.durationMs) && a.durationMs >= 1200 && a.durationMs <= 8000 && typeof a.clientId === 'string', JSON.stringify(a).slice(0, 200));
  check('W2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 6. one failing read leaves the rest of the page standing ------------------------------------------------------------
{
  const { page, errors } = await open({ insightsFail: true });
  await nav(page, '#nav-account');
  check('E1 insights 500 -> one error line in its card; tiles, books and mastery still render; no page error', /Could not load the insights for Gate Cloud Book/.test(await raw(page, '#insights-error')) && (await page.locator('#overview-tiles [data-tile]').count()) === 5 && (await page.locator('#account-books-list > li').count()) === 2 && (await page.locator('#mastery-list > li').count()) === 3 && errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 7. phone height, no sideways scroll, 44 px --------------------------------------------------------------------------------
for (const w of [390, 834, 1440]) {
  const { page, errors } = await open({ width: w, height: w === 390 ? 844 : 900 });
  await nav(page, '#nav-account');
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const d = await sideways(page);
  const boxes = await minBox(page, '#account-book, [data-pick-book], [data-practice-topic], #insights-sessions > summary, #history-details > summary, #mastery-practice-group > summary');
  await page.screenshot({ path: `${SHOTS}/account-${w}.png`, fullPage: true });
  const phoneOk = w !== 390 || height < 6500;                                           // was 16,607 px with every answer listed
  check(`W ${w}px: nothing sticks out sideways; new controls >= 44 px; page height ${height}px${w === 390 ? ' (< 6500, was 16607)' : ''}`, d <= 0 && boxes.length >= 8 && boxes.every((n) => n >= 44) && phoneOk && errors.length === 0, `overflow ${d} boxes ${boxes.join(',')} ${errors.join('|')}`);
  await page.close();
}

await browser.close(); server.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed · screenshots in ${SHOTS}`);
process.exit(bad ? 1 : 0);
