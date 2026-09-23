#!/usr/bin/env node
/**
 * gate-r-style.mjs — THE NEW SCREENS LOOK LIKE THE OLD ONES, MEASURED, NOT EYEBALLED. 23-09-26.
 *
 * WHY IT EXISTS. The user, verbatim: "the shade of the red filled button like continue reading on
 * the home page is the correct red shade, while Account page button is vastly different, both font,
 * font size, shade of red. Even the sign in screen is also off compare to the rest of the UI" — and
 * "Where is the log out button bruh? … there is an upload button on the top bar … Replace that with
 * the logout button". All of it was found BY EYE while 149 gates were green, because no gate ever
 * compared a NEW screen against an OLD one. This one does, with getComputedStyle, pair by pair.
 *
 * WHAT IT COMPARES (every pair, in BOTH emulated colour schemes — prefers-color-scheme light AND dark):
 *   Account primary button   vs  #read-tutorial-btn ("Continue reading")
 *   #login-submit            vs  #read-tutorial-btn
 *   Account secondary button vs  #start-btn ("Practice", the home page's outline button)
 *   #nav-logout (LOG OUT)    vs  #nav-account (its top-bar neighbour)
 *   Account / sign-in h1     vs  #welcome-title;   Account h2  vs  #library-heading
 *   Account / sign-in copy   vs  #current-meta;    inputs + labels vs the Settings page's
 *   Account / sign-in card   vs  #welcome-screen;  hover colour of the red button and the nav entry
 * Any property difference = FAIL. Plus: every font family, font size and text/fill/border colour on
 * the two new screens must already occur on the home + Settings screens (R-S-VOCAB); no top-bar
 * control may open a file chooser (R-S-NOFILE); LOG OUT exists, has a name, is keyboard reachable
 * and really signs out — /api/progress answers 401 with the old cookie (R-S-LOGOUT).
 *
 * ⚠ "BOTH MODES", STATED HONESTLY: this app has ONE theme (dark), like :8767 — there is no light
 *   theme and no toggle, and `body` is a hard-coded #111827. The gate therefore runs the whole
 *   measurement under BOTH `prefers-color-scheme` values, which proves every pair holds whichever
 *   the OS asks for. It does NOT prove a light theme exists; none does.
 *
 * ⛔ RUN WITHOUT lib/auth-preload.mjs (run-gates-react.sh: R_NO_PRELOAD=1). This gate CLICKS LOG OUT.
 *    Under the preload the browser would carry R_SESSION — the one session every other suite signs
 *    in with — and logging it out would turn every later suite red. So it signs in THROUGH THE REAL
 *    FORM as the throwaway gate-reader account (R_GATE_READER / R_GATE_READER_PW), which also means
 *    the sign-in page is measured signed out, the way a person sees it.
 *    ⚠ It must run BEFORE gate-r-auth.mjs: that suite ends by rate-limiting 127.0.0.1's sign-ins for
 *      5 minutes. (Only FAILED attempts count; this gate makes none.)
 *
 * Optional: R_STYLE_SHOTS=<dir> saves full-page screenshots of sign-in, home, Account and the top
 * bar in both schemes (used for the 23-09-26 handoff). No effect on the verdict.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const READER = process.env.R_GATE_READER || 'gate-reader';
const READER_PW = process.env.R_GATE_READER_PW || '';
const MODULE = process.env.R_MODULE || 'geron-homl3';
const SHOTS = process.env.R_STYLE_SHOTS || '';
if (SHOTS && /^\/(tmp|dev\/shm)\//.test(SHOTS)) throw new Error('R_STYLE_SHOTS is on tmpfs (RAM). Use /var/tmp or a repo path.');
if (!READER_PW) throw new Error('R_GATE_READER_PW is unset — run through run-gates-react.sh, which creates the gate accounts.');

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

// Longhands only: Chrome's computed SHORTHANDS (`padding`, `border-radius`) are not reliable to diff.
const TEXT_PROPS = [
  'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-transform', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius',
  'border-bottom-right-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-top-color', 'border-bottom-width', 'border-bottom-color',
];
// Controls also compare HEIGHT. Text blocks and cards do not: a heading's height is its line count,
// which depends on the words in it (a book title vs a person's name), not on the style.
const CONTROL_PROPS = [...TEXT_PROPS, 'height'];
const CARD_PROPS = [
  'background-color', 'border-top-color', 'border-top-width', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'font-family', 'color',
];

const styleOf = (page, sel, props) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return Object.fromEntries(p.map((k) => [k, cs.getPropertyValue(k)]));
}, [sel, props]);

/** Every font family / size / colour actually painted inside `rootSel`. Colour of TEXT only where
 *  the element has its own text; fills only when not transparent; borders only when drawn. */
const vocabOf = (page, rootSel) => page.evaluate((root) => {
  const out = { family: [], size: [], color: [] };
  const add = (k, v) => { if (!out[k].includes(v)) out[k].push(v); };
  const clear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
  for (const host of document.querySelectorAll(root)) {
    for (const el of [host, ...host.querySelectorAll('*')]) {
      if (!el.getClientRects().length) continue;               // not rendered
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText) { add('family', cs.fontFamily); add('size', cs.fontSize); add('color', cs.color); }
      if (!clear(cs.backgroundColor)) add('color', cs.backgroundColor);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 && !clear(cs.getPropertyValue(`border-${side}-color`))) {
          add('color', cs.getPropertyValue(`border-${side}-color`));
        }
      }
    }
  }
  return out;
}, rootSel);

const diff = (a, b, props) => {
  if (!a || !b) return [`${a ? '' : 'NEW ELEMENT MISSING '}${b ? '' : 'REFERENCE MISSING'}`.trim()];
  return props.filter((p) => a[p] !== b[p]).map((p) => `${p}: "${a[p]}" vs "${b[p]}"`);
};
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const parkMouse = async (page) => { await page.mouse.move(2, 998); await settle(page, 300); };

// Pairs: [label, newScreenKey, newSel, refKey, refSel, props]. Keys name the screen a value was read on.
const PAIRS = {
  'R-S-PRIMARY-ACCOUNT': [['Account "Change password"', 'account', '#account-password-form button[type="submit"]', 'home', '#read-tutorial-btn', CONTROL_PROPS]],
  'R-S-PRIMARY-LOGIN': [['sign-in submit', 'login', '#login-submit', 'home', '#read-tutorial-btn', CONTROL_PROPS]],
  'R-S-SECONDARY-ACCOUNT': [['Account "Sign out"', 'account', '#account-signout-btn', 'home', '#start-btn', CONTROL_PROPS]],
  'R-S-NAV-LOGOUT': [['top bar LOG OUT', 'home', '#nav-logout', 'home', '#nav-account', CONTROL_PROPS]],
  'R-S-TITLE': [
    ['Account h1', 'account', '#account-title', 'home', '#welcome-title', TEXT_PROPS],
    ['sign-in h1', 'login', '#login-title', 'home', '#welcome-title', TEXT_PROPS],
  ],
  'R-S-SECTION': [
    ['Account h2 "Your progress"', 'account', '#account-progress-title', 'home', '#library-heading', TEXT_PROPS],
    ['Account h2 "Change password"', 'account', '#account-password-form h2', 'home', '#home-kpis-heading', TEXT_PROPS],
  ],
  'R-S-BODY': [
    ['Account body copy', 'account', '#account-progress-title + p', 'home', '#current-meta', TEXT_PROPS],
    ['sign-in body copy', 'login', '#login-copy', 'home', '#current-meta', TEXT_PROPS],
  ],
  'R-S-INPUT': [
    ['Account input', 'account', '#account-current-password', 'settings', '#set-api-url', CONTROL_PROPS],
    ['sign-in input', 'login', '#login-username', 'settings', '#set-api-url', CONTROL_PROPS],
  ],
  'R-S-LABEL': [
    ['Account label', 'account', 'label[for="account-current-password"]', 'settings', 'label[for="set-api-url"]', TEXT_PROPS],
    ['sign-in label', 'login', 'label[for="login-username"]', 'settings', 'label[for="set-api-url"]', TEXT_PROPS],
  ],
  'R-S-CARD': [
    ['Account card', 'account', '#account-screen > div:first-child', 'home', '#welcome-screen', CARD_PROPS],
    ['sign-in card', 'login', '#login-card', 'home', '#welcome-screen', CARD_PROPS],
  ],
};
const HOVER = [
  ['Account primary :hover', 'account', '#account-password-form button[type="submit"]', 'home', '#read-tutorial-btn', ['background-color', 'color']],
  ['sign-in submit :hover', 'login', '#login-submit', 'home', '#read-tutorial-btn', ['background-color', 'color']],
  ['LOG OUT :hover', 'home', '#nav-logout', 'home', '#nav-account', ['color', 'background-color']],
];

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const measured = {};      // scheme -> screen -> sel -> props
const hovered = {};       // scheme -> screen -> sel -> props
const vocab = {};         // scheme -> { fresh, ref }
const logout = {};        // scheme -> facts
const nofile = {};        // scheme -> facts

const allSelsFor = (screen) => {
  const s = new Set();
  for (const rows of Object.values(PAIRS)) for (const [, nk, ns, rk, rs] of rows) { if (nk === screen) s.add(ns); if (rk === screen) s.add(rs); }
  return [...s];
};

async function readScreen(page, scheme, screen) {
  // RESTING state vs RESTING state. The sign-in page autofocuses its username field, and a focused
  // field's border is brand red — measured 23-09-26, run 1 read that as a mismatch. Blur first.
  await page.evaluate(() => document.activeElement?.blur?.());
  await parkMouse(page);
  measured[scheme][screen] = {};
  for (const sel of allSelsFor(screen)) measured[scheme][screen][sel] = await styleOf(page, sel, CONTROL_PROPS);
  hovered[scheme][screen] = hovered[scheme][screen] || {};
  for (const [, nk, ns, rk, rs, props] of HOVER) {
    for (const [k, sel] of [[nk, ns], [rk, rs]]) {
      if (k !== screen || hovered[scheme][screen][sel]) continue;
      const box = await page.locator(sel).first().boundingBox().catch(() => null);
      if (!box) { hovered[scheme][screen][sel] = null; continue; }
      await page.hover(sel, { force: true });
      await settle(page, 400);                                   // transition-colors is 150ms
      hovered[scheme][screen][sel] = await styleOf(page, sel, props);
      await parkMouse(page);
    }
  }
}

async function shot(page, scheme, name, clip) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await parkMouse(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`), fullPage: !clip, clip });
}

for (const scheme of ['light', 'dark']) {
  measured[scheme] = {}; hovered[scheme] = {};
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
  const page = await ctx.newPage();

  // ---- sign-in page, signed out ----
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 600);
  await readScreen(page, scheme, 'login');
  const loginVocab = await vocabOf(page, '#login-screen');
  await shot(page, scheme, 'signin');

  // ---- sign in through the real form ----
  await page.fill('#login-username', READER);
  await page.fill('#login-password', READER_PW);
  await page.press('#login-password', 'Enter');
  await page.waitForFunction(() => location.pathname !== '/login', null, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await settle(page, 1200);
  const bookIsOpen = () => page.evaluate((m) => document.querySelector(`#library-grid [data-book="${m}"]`)?.getAttribute('aria-current') === 'true', MODULE);
  if (!(await bookIsOpen())) { await page.locator(`#library-grid [data-book="${MODULE}"]`).click(); await settle(page, 1500); }
  if (!(await bookIsOpen())) throw new Error(`⛔ PRECONDITION: ${MODULE} is not open, so #read-tutorial-btn/#welcome-title would be measured hidden. Refusing to continue.`);
  await page.evaluate(() => document.fonts.ready);

  // ---- home ----
  await readScreen(page, scheme, 'home');
  const homeVocab = await vocabOf(page, 'header, #landing-dashboard, #welcome-screen, #home-kpis, #services-section');
  await shot(page, scheme, 'home');
  await shot(page, scheme, 'topbar', { x: 0, y: 0, width: 1440, height: 90 });

  // ---- R-S-NOFILE: nothing in the top bar reaches a file chooser ----
  {
    const dom = await page.evaluate(() => {
      const header = document.querySelector('header');
      const fileInputs = [...document.querySelectorAll('input[type="file"]')];
      return {
        headerFound: Boolean(header),
        inHeader: header ? header.querySelectorAll('input[type="file"]').length : -1,
        labelsInHeaderToFile: fileInputs.filter((i) => [...(i.labels || [])].some((l) => header?.contains(l))).length,
        headerControlsToFile: header ? [...header.querySelectorAll('[aria-controls],[for]')]
          .filter((e) => fileInputs.some((i) => i.id && (e.getAttribute('aria-controls') === i.id || e.getAttribute('for') === i.id))).length : -1,
      };
    });
    let choosers = 0;
    page.on('filechooser', () => { choosers += 1; });
    // Positive control FIRST: prove the detector sees a real file chooser, or a 0 below means nothing.
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = '__gate_fc_probe';
      d.style.cssText = 'position:fixed;left:600px;top:500px;z-index:99999';
      d.innerHTML = '<input type="file" id="__gate_fc_input"><label for="__gate_fc_input" id="__gate_fc_label" style="display:inline-block;padding:10px;background:#000;color:#fff">probe</label>';
      document.body.appendChild(d);
    });
    await page.click('#__gate_fc_label');
    await settle(page, 500);
    const detectorWorks = choosers === 1;
    await page.evaluate(() => document.getElementById('__gate_fc_probe')?.remove());
    choosers = 0;
    // Real clicks on EVERY rendered top-bar control except LOG OUT (tested on its own below).
    const ids = await page.evaluate(() => [...document.querySelectorAll('header button, header a, header label, header [role="button"]')]
      .filter((e) => e.getClientRects().length && e.id !== 'nav-logout')
      .map((e, i) => { if (!e.id) e.setAttribute('data-gate-fc', String(i)); return e.id ? `#${e.id}` : `[data-gate-fc="${i}"]`; }));
    for (const sel of ids) {
      await page.locator(sel).first().click({ force: true, timeout: 3000 }).catch(() => {});
      await settle(page, 350);
    }
    nofile[scheme] = { ...dom, detectorWorks, clicked: ids.length, choosers };
    // Back to a known state (the clicks above navigated between screens).
    await page.evaluate(() => document.getElementById('nav-tutorial')?.click());
    await settle(page, 800);
  }

  // ---- settings ----
  await page.evaluate(() => document.getElementById('nav-settings')?.click());
  await page.waitForSelector('#set-api-url', { state: 'visible', timeout: 8000 }).catch(() => {});
  await settle(page, 600);
  await readScreen(page, scheme, 'settings');
  const settingsVocab = await vocabOf(page, '#settings-screen');

  // ---- account ----
  await page.evaluate(() => document.getElementById('nav-account')?.click());
  await page.waitForSelector('#account-progress-title', { state: 'visible', timeout: 8000 }).catch(() => {});
  await settle(page, 1200);
  await readScreen(page, scheme, 'account');
  const accountVocab = await vocabOf(page, '#account-screen');
  await shot(page, scheme, 'account');

  vocab[scheme] = {
    fresh: { login: loginVocab, account: accountVocab },
    ref: {
      family: [...new Set([...homeVocab.family, ...settingsVocab.family])],
      size: [...new Set([...homeVocab.size, ...settingsVocab.size])],
      color: [...new Set([...homeVocab.color, ...settingsVocab.color])],
    },
  };

  // ---- R-S-LOGOUT: exists, named, keyboard reachable (light) / clicked (dark), and REALLY signs out ----
  {
    await page.evaluate(() => document.getElementById('nav-tutorial')?.click());
    await settle(page, 700);
    const cookie = (await ctx.cookies()).find((c) => c.name === 'edu_session')?.value || '';
    const named = await page.locator('header').getByRole('button', { name: /^log out$/i }).count();
    const visible = await page.locator('#nav-logout').isVisible().catch(() => false);
    let reachedBy = 'mouse';
    let tabs = 0;
    let before = '';
    if (scheme === 'light') {
      // From a FRESH page load, so Tab starts at the top of the document — not from whatever the
      // NOFILE clicks last focused (run 1 reached LOG OUT in 1 Tab for exactly that reason).
      reachedBy = 'keyboard';
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await settle(page, 800);
      const seq = [];
      for (tabs = 1; tabs <= 40; tabs += 1) {
        await page.keyboard.press('Tab');
        seq.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || ''));
        if (seq[seq.length - 1] === 'nav-logout') break;
      }
      before = seq[seq.length - 2] || '';
      if (seq[seq.length - 1] === 'nav-logout') await page.keyboard.press('Enter');
      else tabs = -1;
    } else {
      await page.click('#nav-logout');
    }
    await page.waitForFunction(() => location.pathname === '/login', null, { timeout: 10000 }).catch(() => {});
    const onLogin = await page.evaluate(() => location.pathname === '/login');
    const progress = cookie
      ? (await fetch(`${BASE}/api/progress?module=${MODULE}`, { headers: { Cookie: `edu_session=${cookie}` }, redirect: 'manual' })).status
      : -1;
    const cookieCleared = !(await ctx.cookies()).some((c) => c.name === 'edu_session' && c.value);
    logout[scheme] = { visible, named, reachedBy, tabs, before, onLogin, progress, cookieCleared, hadCookie: Boolean(cookie) };
  }
  await ctx.close();
}
await browser.close();

/* ═══════════════════════ verdicts ═══════════════════════ */
const table = [];
for (const [id, rows] of Object.entries(PAIRS)) {
  const bad = [];
  for (const scheme of ['light', 'dark']) {
    for (const [label, nk, ns, rk, rs, props] of rows) {
      const a = measured[scheme][nk]?.[ns] ?? null;
      const b = measured[scheme][rk]?.[rs] ?? null;
      const d = diff(a && Object.fromEntries(props.map((p) => [p, a[p]])), b && Object.fromEntries(props.map((p) => [p, b[p]])), props);
      if (d.length) bad.push(`[${scheme}] ${label} (${ns} vs ${rs}): ${d.join('; ')}`);
      if (scheme === 'light') table.push({ id, label, ns, rs, n: props.length, match: d.length === 0, a });
    }
  }
  const n = rows.reduce((t, r) => t + r[5].length, 0);
  check(id, bad.length === 0,
    bad.length ? `MISMATCH ${bad.join(' | ')}` : `${rows.map((r) => `${r[2]}==${r[4]}`).join(', ')} — ${n} properties × 2 schemes identical`);
}
{
  const bad = [];
  for (const scheme of ['light', 'dark']) {
    for (const [label, nk, ns, rk, rs, props] of HOVER) {
      const d = diff(hovered[scheme][nk]?.[ns] ?? null, hovered[scheme][rk]?.[rs] ?? null, props);
      if (d.length) bad.push(`[${scheme}] ${label}: ${d.join('; ')}`);
    }
  }
  check('R-S-HOVER', bad.length === 0,
    bad.length ? `MISMATCH ${bad.join(' | ')}` : `hover colours identical for ${HOVER.map((h) => h[2]).join(', ')} (e.g. primary -> ${hovered.light.home['#read-tutorial-btn']?.['background-color']})`);
}
{
  const bad = [];
  for (const scheme of ['light', 'dark']) {
    const { fresh, ref } = vocab[scheme];
    for (const [screen, v] of Object.entries(fresh)) {
      for (const k of ['family', 'size', 'color']) {
        const extra = v[k].filter((x) => !ref[k].includes(x));
        if (extra.length) bad.push(`[${scheme}] ${screen} ${k} not on home/settings: ${extra.join(', ')}`);
      }
    }
  }
  const r = vocab.light.ref;
  check('R-S-VOCAB', bad.length === 0,
    bad.length ? bad.join(' | ')
      : `every family/size/colour painted on sign-in + Account already occurs on home/settings (reference: ${r.family.length} family, ${r.size.length} sizes [${r.size.join(' ')}], ${r.color.length} colours)`);
}
{
  const ok = ['light', 'dark'].every((s) => {
    const f = nofile[s];
    return f.headerFound && f.inHeader === 0 && f.labelsInHeaderToFile === 0 && f.headerControlsToFile === 0
      && f.detectorWorks && f.clicked >= 7 && f.choosers === 0;
  });
  check('R-S-NOFILE', ok, `no top-bar control reaches a file input or opens a file chooser: ${JSON.stringify(nofile)}`
    + ' (detectorWorks = a probe <input type=file> DID raise a chooser, so choosers=0 is a real zero)');
}
{
  const ok = ['light', 'dark'].every((s) => {
    const l = logout[s];
    return l.visible && l.named === 1 && l.hadCookie && l.onLogin && l.progress === 401 && l.cookieCleared
      && (l.reachedBy !== 'keyboard' || (l.tabs > 1 && l.before === 'nav-account'));
  });
  check('R-S-LOGOUT', ok, `LOG OUT visible, named, keyboard-reachable from the top of a fresh page (tab order: straight after ACCOUNT), lands on /login, old session -> /api/progress 401: ${JSON.stringify(logout)}`);
}

// The parity table, for the report (not a result line).
console.log('\nPARITY TABLE (light; dark identical where PASS):');
for (const t of table) {
  const a = t.a || {};
  console.log(`  ${t.match ? 'match ' : 'DIFFER'}  ${t.id.padEnd(22)} ${t.label.padEnd(30)} ${t.ns} vs ${t.rs}  [${t.n} props]  bg=${a['background-color']} color=${a.color} size=${a['font-size']} weight=${a['font-weight']} lh=${a['line-height']} radius=${a['border-top-left-radius']} pad=${a['padding-top']}/${a['padding-left']} h=${a.height}`);
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) { console.log(`FAILED: ${failed.map((r) => r.id).join(', ')}`); process.exit(1); }
