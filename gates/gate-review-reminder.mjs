#!/usr/bin/env node
/**
 * gate-review-reminder.mjs — the floating review reminder (quiz/ReviewReminder.tsx), 01-11-26.
 *
 * Tier 1/2, browser: the REAL built bundle (app/frontend/dist) with the API stubbed in the browser:
 *     cd app/frontend && ./node_modules/.bin/vite build && node ../../gates/gate-review-reminder.mjs
 * Proves: with cards due the button sits on the right edge with a red badge = dueCount and shakes
 * (animation reviewNudge); its panel has ONE row per chapter (blocks of one chapter merged, server priority order,
 * unknown blocks under "Other" last) and a chapter's Review button asks /api/review/due-in for THAT
 * chapter's blocks only and opens a recall-first run of them; the Review button opens a "how many"
 * field (99 typed on a 2-question chapter becomes 2, 1 runs 1); the button hides during the quiz; with
 * nothing due there is no badge and no motion; with the server failing there is no button at all.
 * 01-11-26 per-chapter rework. Screenshots: /var/tmp/review-reminder-*.png.
 * 23-11-26 (SRS v2): two daily limits (chapter 100, AI-written 20 — both held lines, the AI row labelled with its own
 * limit), the "Due, waiting today" list (heldBlocks), and the grade retry queue: a review grade whose POST fails
 * (503) is tried 3 times, kept in localStorage, shows a small non-blocking notice, and is resent on the next load
 * with the SAME press time `at`; a 4xx is not queued; an empty queue sends nothing.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIST = process.env.MA_DIST || resolve(fileURLToPath(new URL('.', import.meta.url)), '../app/frontend/dist');
if (!existsSync(join(DIST, 'index.html'))) { console.log(`FAIL  X0  no build at ${DIST} — run vite build first`); process.exit(2); }
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
const mk = (q, options, correct, ch, n) => ({ question: q, options, correct, explanations: options.map((o) => `Why ${o}.`), source: { chapter: ch, block: `ch0${ch}-b01`, question: `ch0${ch}-b01-q${n}` } });
const module_ = {
  moduleId: 'geron-homl3',
  tutorialData: { title: 'Test book', sections: [
    { title: 'Chapter 1: Cloud', themeColor: 'indigo-500', items: [{ term: 'Lesson one', blocks: [{ type: 'text', content: 'Hello.' }] }] },
    { title: 'Chapter 2: Storage', themeColor: 'indigo-500', items: [{ term: 'Lesson two', blocks: [{ type: 'text', content: 'Hi.' }] }] },
  ] },
  quizData: [mk('Q1', ['A1', 'B1', 'C1', 'D1'], 0, 1, 1), mk('Q2', ['A2', 'B2', 'C2', 'D2'], 2, 1, 2), mk('Q3', ['A3', 'B3', 'C3', 'D3'], 1, 2, 1)],
};
// One block per chapter, plus "other" (cards with no book key) which must land in "Other", last.
// 12-11-26: `held` (due but over today's cap) + `upcoming` (not due yet, per block, earliest due time).
const IN = (ms) => new Date(Date.now() + ms).toISOString();
const UPCOMING = [{ block: 'ch02-b01', count: 5, nextDueAt: IN(3 * 86_400_000 + 3_600_000) }, { block: 'ch01-b01', count: 2, nextDueAt: IN(5 * 3_600_000 + 60_000) }];
const AGO = (ms) => new Date(Date.now() - ms).toISOString();
// 23-11-26: chapter limit 100 + AI limit 20; heldBlocks = due now but outside today's limits (AI cards under "other").
const HELD = [{ block: 'ch02-b01', count: 1, oldestDueAt: AGO(2 * 86_400_000 + 3_600_000) }, { block: 'other', count: 2, oldestDueAt: AGO(86_400_000 + 3_600_000) }, { block: 'ch01-b01', count: 2, oldestDueAt: AGO(4 * 86_400_000 + 3_600_000) }];
const BLOCKS = { blocks: [{ block: 'other', due: 4 }, { block: 'ch02-b01', due: 1 }, { block: 'ch01-b01', due: 2 }], dueCount: 7, held: 3, dailyCap: 100, aiDueCount: 4, aiHeld: 2, aiDailyCap: 20, heldBlocks: HELD, upcoming: UPCOMING, total: 9 };
const CARDS = { 'ch01-b01': [{ question: 'ch01-b01-q2', dueAt: 'x', reps: 1, lapses: 0 }, { question: 'ch01-b01-q1', dueAt: 'x', reps: 2, lapses: 0 }], 'ch02-b01': [{ question: 'ch02-b01-q1', dueAt: 'x', reps: 1, lapses: 0 }] };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ executablePath: chromium.executablePath() });
async function open(dueMode, context, grade = { status: 200 }) {
  const page = await (context || await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const dueIn = [];
  const gradePosts = [];
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/auth/me') return json(route, { account: { id: 1, username: 't', displayName: 'T', isOwner: true } });
    if (u.pathname === '/api/modules') return json(route, { books: [{ file: 'geron-homl3', book: 'geron-homl3', base: 'book/geron-homl3/', moduleId: 'geron-homl3', title: 'Test book', chapters: 2, lessons: 2, questions: 3, default: true }] });
    if (u.pathname === '/api/review/due-blocks') {
      if (dueMode === 'down') return route.fulfill({ status: 500, body: 'no' });
      if (dueMode === 'empty') return json(route, { blocks: [], dueCount: 0, held: 0, dailyCap: 100, aiDueCount: 0, aiHeld: 0, aiDailyCap: 20, heldBlocks: [], upcoming: UPCOMING, total: 5 });
      return json(route, BLOCKS);
    }
    if (u.pathname === '/api/review/due-in') {
      const blocks = (u.searchParams.get('blocks') || '').split(',');
      const limit = Number(u.searchParams.get('limit'));
      dueIn.push({ blocks: blocks.join(','), limit });
      const due = blocks.flatMap((b) => CARDS[b] || []).slice(0, limit);
      return json(route, { due, dueCount: due.length });
    }
    if (u.pathname === '/api/review/grade') { gradePosts.push(JSON.parse(route.request().postData() || '{}')); return json(route, { question: 'x' }, grade.status); }
    if (u.pathname === '/api/progress') return json(route, { module: 'geron-homl3', completed: {} });
    if (u.pathname === '/api/general') return json(route, { ai_question_count: 5, fresh_quiz_size: 10 });
    if (u.pathname === '/api/provider') return json(route, { ready: false, model: '', token_required: false });
    return json(route, {});
  });
  await page.route('**/book/geron-homl3/module.json', (route) => json(route, module_));
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  return { page, errors, dueIn, gradePosts };
}
const btn = (page) => page.locator('#review-reminder');
const exists = (page, sel) => page.locator(sel).count().then((n) => n > 0);
const anim = (page) => btn(page).evaluate((el) => getComputedStyle(el).animationName);

// ---- 1. cards due ------------------------------------------------------------------------------------
{
  const { page, errors, dueIn } = await open('due');
  const box = await btn(page).boundingBox();
  check('D1 button visible on the right edge, around mid-height', Boolean(box) && box.x + box.width > 1366 - 40 && box.y > 768 * 0.3 && box.y < 768 * 0.7, JSON.stringify(box));
  check('D2 red badge shows the total due count', (await page.locator('#review-reminder-badge').innerText()).trim() === '7');
  check('D3 button shakes (animation reviewNudge)', (await anim(page)) === 'reviewNudge', await anim(page));
  await page.screenshot({ path: '/var/tmp/review-reminder-due.png' });
  await btn(page).click(); await page.waitForTimeout(300);
  const rows = await page.locator('#review-reminder-chapters li').allInnerTexts();
  check('D4 one row per chapter, SERVER priority order (Ch 2 sent first), AI-written last with its own limit', rows.length === 3 && /Chapter 2: Storage/.test(rows[0]) && /1 left/.test(rows[0]) && /Chapter 1: Cloud/.test(rows[1]) && /2 left/.test(rows[1]) && /AI-written \(own limit 20 a day\)/.test(rows[2]) && /4 left/.test(rows[2]), rows.map((r) => r.replace(/\n/g, ' ')).join(' | '));
  await page.screenshot({ path: '/var/tmp/review-reminder-panel.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('D5 Escape closes the panel', !(await exists(page, '#review-reminder-panel')));
  await btn(page).click(); await page.waitForTimeout(200);
  check('D6 Review opens a how-many field, not a run', !(await exists(page, '.review-pick-input')) && (await page.locator('li[data-chapter="chapter-0"] .review-pick-btn').click().then(() => page.waitForTimeout(200)).then(() => exists(page, '.review-pick-input'))) && dueIn.length === 0);
  const input = page.locator('li[data-chapter="chapter-0"] .review-pick-input');
  await input.fill('99'); await input.blur(); await page.waitForTimeout(100);
  check('D7 typing 99 on a 2-question chapter corrects to 2', (await input.inputValue()) === '2', await input.inputValue());
  await page.locator('li[data-chapter="chapter-0"] .review-pick-start').click(); await page.waitForTimeout(900);
  check('D7b the run asks for that chapter\'s blocks with limit 2 and runs 2', dueIn.length === 1 && dueIn[0].blocks === 'ch01-b01' && dueIn[0].limit === 2 && /chapter 1: cloud\s*·\s*2 due/i.test(await page.locator('#quiz-scope-label').innerText()), JSON.stringify(dueIn) + ' ' + await page.locator('#quiz-scope-label').innerText());
  check('D8 recall-first: the question shows alone with a recall box', (await exists(page, '#recall-input')) && (await page.locator('#options-container .option-card').count()) === 0);
  check('D9 reminder hidden during the quiz', !(await btn(page).isVisible()));
  check('D10 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

{
  const { page, errors, dueIn } = await open('due');
  await btn(page).click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-btn').click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-input').fill('1'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  check('P1 typing 1 + Enter runs 1 question', dueIn[0]?.limit === 1 && /·\s*1 due/i.test(await page.locator('#quiz-scope-label').innerText()), JSON.stringify(dueIn));
  check('P2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}
{
  const { page, dueIn } = await open('due');
  await btn(page).click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-btn').click(); await page.waitForTimeout(200);
  await page.screenshot({ path: '/var/tmp/review-reminder-pick.png' });
  await page.locator('li[data-chapter="chapter-0"] .review-pick-start').click(); await page.waitForTimeout(900);
  check('P3 blank field runs the whole chapter (2)', dueIn[0]?.limit === 2, JSON.stringify(dueIn));
  await page.close();
}

// ---- C. the reader's chat button: the glyph's drawn box is centred in the circle (01-11-26) ----------
{
  const { page, errors } = await open('due');
  await page.locator('#nav-learn').click(); await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const fab = document.querySelector('#ask-fab'); const svg = fab?.querySelector('svg'); if (!fab || !svg) return null;
    const f = fab.getBoundingClientRect(); const g = svg.getBBox(); const ctm = svg.getScreenCTM();
    const cx = ctm.a * (g.x + g.width / 2) + ctm.e, cy = ctm.d * (g.y + g.height / 2) + ctm.f;
    return { dx: +(cx - (f.left + f.width / 2)).toFixed(2), dy: +(cy - (f.top + f.height / 2)).toFixed(2) };
  });
  check('C1 chat glyph centred in its button (<= 0.5 px both axes)', Boolean(m) && Math.abs(m.dx) <= 0.5 && Math.abs(m.dy) <= 0.5, JSON.stringify(m));
  await page.locator('#ask-fab').screenshot({ path: '/var/tmp/review-reminder-chatfab.png' });
  check('C2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}

// ---- 1b. calmer (12-11-26): coming-back list, held note, shake once per day ----------------------------
{
  const { page, errors } = await open('due');
  await btn(page).click(); await page.waitForTimeout(300);
  const up = await page.locator('#review-reminder-upcoming li').allInnerTexts();
  check('G1 "Coming back": one row per chapter, soonest first, with count and time', up.length === 2 && /Chapter 1: Cloud/.test(up[0]) && /2/.test(up[0]) && /in 5 hours/.test(up[0]) && /Chapter 2: Storage/.test(up[1]) && /5/.test(up[1]) && /in 3 days/.test(up[1]), up.map((r) => r.replace(/\s+/g, ' ')).join(' | '));
  check('G2 held note says 3 wait for tomorrow, limit 100 (chapter cards)', /3 more are waiting for tomorrow \(daily limit 100\)/.test(await page.locator('#review-reminder-held').innerText()), await page.locator('#review-reminder-held').innerText());
  check('G2b second held line: 2 AI-written wait, AI limit 20 (its own limit, separate line)', /2 AI-written are waiting for tomorrow \(AI limit 20\)/.test(await page.locator('#review-reminder-ai-held').innerText()), await page.locator('#review-reminder-ai-held').innerText());
  const wl = await page.locator('#review-reminder-waiting li').allInnerTexts();
  check('G2c "Due, waiting today": one row per chapter, longest-waiting first, AI-written as its own row', wl.length === 3 && /Chapter 1: Cloud/.test(wl[0]) && /2\s*·\s*for 4 days/.test(wl[0]) && /Chapter 2: Storage/.test(wl[1]) && /1\s*·\s*for 2 days/.test(wl[1]) && /AI-written/.test(wl[2]) && /2\s*·\s*for 1 day/.test(wl[2]), wl.map((r) => r.replace(/\s+/g, ' ')).join(' | '));
  check('G3 held cards are not in the badge or rows (7 = 2 + 1 + 4)', (await page.locator('#review-reminder-badge').innerText()).trim() === '7');
  await page.screenshot({ path: '/var/tmp/review-reminder-coming-back.png' });
  check('G4 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const first = await open('due', ctx);
  const a1 = await anim(first.page); await first.page.close();
  const second = await open('due', ctx);        // same browser, same day: reload
  const a2 = await anim(second.page);
  check('G5 first load of the day shakes', a1 === 'reviewNudge', a1);
  check('G6 a reload the same day does NOT shake, badge stays', a2 === 'none' && (await exists(second.page, '#review-reminder-badge')), a2);
  check('G7 no page errors', first.errors.length === 0 && second.errors.length === 0);
  await ctx.close();
}
{
  const { page } = await open('empty');
  await btn(page).click(); await page.waitForTimeout(200);
  const t = await page.locator('#review-reminder-panel').innerText();
  check('G8 nothing due: still lists what is coming back', /coming back/i.test(t) && /in 3 days/.test(t), t.replace(/\s+/g, ' '));
  check('G8b nothing due and nothing held: no held lines, no waiting list', !(await exists(page, '#review-reminder-held')) && !(await exists(page, '#review-reminder-ai-held')) && !(await exists(page, '#review-reminder-waiting')));
  await page.close();
}

// ---- 1c. a review grade must not be lost (23-11-26) ---------------------------------------------------
async function pressGood(page, dueIn) {
  await btn(page).click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-btn').click(); await page.waitForTimeout(200);
  await page.locator('li[data-chapter="chapter-0"] .review-pick-start').click(); await page.waitForTimeout(900);
  await page.locator('#recall-show-btn').click(); await page.waitForTimeout(300);
  await page.locator('#options-container .option-card').nth(2).click(); await page.waitForTimeout(300);   // Q2: the right option is C2
  await page.locator('#grade-good-btn').click();
}
const queued = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('eduPendingReviewGrades') || '[]'));
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const a = await open('due', ctx, { status: 503 });
  check('Q0 an empty queue sends nothing on load', a.gradePosts.length === 0);
  await pressGood(a.page, a.dueIn); await a.page.waitForTimeout(2600);
  const q = await queued(a.page);
  check('Q1 a failing save is tried 3 times, each with the same press time', a.gradePosts.length === 3 && a.gradePosts.every((g) => g.question === 'ch01-b01-q2' && g.grade === 'good' && g.at === a.gradePosts[0].at) && !Number.isNaN(Date.parse(a.gradePosts[0].at)), JSON.stringify(a.gradePosts.map((g) => g.at)));
  check('Q2 after 3 failures the grade is kept in this browser (localStorage), once', q.length === 1 && q[0].question === 'ch01-b01-q2' && q[0].grade === 'good' && q[0].at === a.gradePosts[0].at, JSON.stringify(q));
  const note = await a.page.locator('#grade-queue-notice').innerText().catch(() => '');
  check('Q3 a small notice says 1 answer is not saved yet', /1 review answer is not saved yet/.test(note), note);
  const q4 = { pe: await a.page.locator('#grade-queue-notice').evaluate((el) => getComputedStyle(el).pointerEvents), dialog: await exists(a.page, '#app-dialog'), nextCard: await exists(a.page, '#recall-input') };
  check('Q4 the notice does not block: no app dialog (#app-dialog), pointer-events none, the run already moved on', q4.pe === 'none' && !q4.dialog && q4.nextCard, JSON.stringify(q4));
  await a.page.screenshot({ path: '/var/tmp/review-reminder-grade-queue.png' });
  const savedAt = a.gradePosts[0].at; await a.page.close();
  const b = await open('due', ctx, { status: 200 });         // next load, server back: the queue is resent
  await b.page.waitForTimeout(1200);
  check('Q5 next load resends the queued grade with the SAME press time, once', b.gradePosts.length === 1 && b.gradePosts[0].at === savedAt && b.gradePosts[0].question === 'ch01-b01-q2', JSON.stringify(b.gradePosts));
  check('Q6 once it lands the queue is empty and the notice is gone', (await queued(b.page)).length === 0 && !(await exists(b.page, '#grade-queue-notice')));
  check('Q7 no page errors', a.errors.length === 0 && b.errors.length === 0, a.errors.concat(b.errors).join('|'));
  await b.page.close(); await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 768 } });      // fresh browser: no half-finished run to restore
  const c = await open('due', ctx2, { status: 400 });
  await pressGood(c.page, c.dueIn); await c.page.waitForTimeout(1500);
  check('Q8 a 4xx (our fault) is not retried and not queued', c.gradePosts.length === 1 && (await queued(c.page)).length === 0 && !(await exists(c.page, '#grade-queue-notice')), String(c.gradePosts.length));
  await ctx2.close();
}

// ---- 2. nothing due / server failing -------------------------------------------------------------------
{
  const { page, errors } = await open('empty');
  check('E1 nothing due: button shows, no badge', (await btn(page).isVisible()) && !(await exists(page, '#review-reminder-badge')));
  check('E2 nothing due: no motion', (await anim(page)) === 'none', await anim(page));
  await page.screenshot({ path: '/var/tmp/review-reminder-done.png' });
  await btn(page).click(); await page.waitForTimeout(200);
  check('E3 nothing due: panel says all reviewed, no Start button', /all reviewed/i.test(await page.locator('#review-reminder-panel').innerText()) && !(await exists(page, '#review-reminder-start')));
  check('E4 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}
{
  const { page, errors } = await open('down');
  check('F1 server 500: no reminder at all', !(await exists(page, '#review-reminder')));
  check('F2 no page errors', errors.length === 0, errors.join('|'));
  await page.close();
}
await browser.close(); server.close();
const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
