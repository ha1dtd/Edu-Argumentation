// Seam 1b (data/writes) — THE ONLY PLACE THIS APP WRITES TO THE BACKEND. Phase 04.
//
// ⛔ ONE PRIMITIVE, ONE `method: 'POST'` SITE. data/client.ts stays GET-only by construction
//    (its header explains why a generic request(method) is banned there). Every write in the
//    app goes through `postJson` below, so the built bundle carries EXACTLY ONE non-GET
//    fetch literal — and gates/gate-r-ro.mjs R-RO1 asserts that count is exactly one. A second
//    write primitive anywhere is a gate failure, not a style choice.
//
// ⛔ THE ROUTES ARE THE PHASE-02 CONTRACT, MINUS THE THREE RUN ROUTES (ruling R24). The paths below are the legacy's own
//    (app.js), relative to the origin that served the SPA — same-origin by design, and the
//    backend refuses a foreign Origin with 403.
//
// PORTED FROM (by symbol, app.js): postProgress, queuePendingProgress, flushPendingProgress,
// PROGRESS_PENDING_KEY, generationToken, adminToken, rememberAdminToken.

import { bounceToLogin } from './client';

export type WriteRoute =
  | '/api/progress'
  | '/api/book/rename'
  | '/api/book/delete'
  | '/api/settings'
  | '/api/quiz'
  | '/api/quiz/fresh'
  | '/api/ask'
  | '/api/exercise/grade'
  // ⚑ Phase 06a (ruling R25): sign-in, the account page, the owner's account admin, wrong answers.
  | '/api/auth/login'
  | '/api/auth/logout'
  | '/api/account/password'
  | '/api/accounts'
  // ⚑ 23-09-26: owner-only per-account Claude access (which 9router combos the account's AI uses).
  | '/api/accounts/claude-access'
  | '/api/wrong-answers';
// ⚑ Ruling R24 (23-09-26): /api/run, /api/run/stop, /api/run/reset-kernel are GONE — the code
//   runner was removed. Seven write routes remain.

/** The one write primitive. Returns the raw Response — each caller owns its own error copy,
 *  exactly as each legacy call site did. */
// `signal` (25-09-26): lets the reader CANCEL an AI-Quiz while it is being written. Aborting stops
// the wait in the browser; a model call the server already started still finishes on its side.
export function postJson(route: WriteRoute, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  return fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  }).then((response) => {
    // ⚑ Phase 06a: a session that expired mid-read goes to sign-in. The login POST's own 401 is
    //   "wrong password", which the login page shows — never a bounce.
    if (route !== '/api/auth/login') bounceToLogin(response.status);
    return response;
  });
}

// ---------------------------------------------------------------- wrong answers (Phase 06a)
export type QuizKind = 'bank' | 'ai' | 'fresh' | 'exercise';

export interface WrongAnswerBody {
  module: string;
  block: string | null;
  kind: QuizKind;
  question: string;
  options: string[];
  chosen: number;
  correct: number;
  attempt?: string;
}

/**
 * Record ONE wrong answer, full text and options (ruling R25: "store only the wrong answer").
 * Fire-and-forget: a failed record must never interrupt the quiz the reader is in the middle of.
 */
export function recordWrongAnswer(body: WrongAnswerBody): void {
  if (!body.question || !Array.isArray(body.options) || body.chosen === body.correct) return;
  void postJson('/api/wrong-answers', body).catch(() => undefined);
}

// ---------------------------------------------------------------- progress
export interface ProgressBody {
  module: string;
  block: string;
  score: number;
  total: number;
  source: string;
}

export interface ProgressReply {
  module?: string;
  completed?: Record<string, unknown>;
  marked?: boolean;
}

export const PROGRESS_PENDING_KEY = 'eduPendingProgress';

/**
 * postProgress (app.js:1150) — one POST with retries. The network to this box spikes, and a
 * dropped write used to be swallowed silently.
 *   returns the reply        -> reached the server
 *   returns null             -> 4xx, our fault, retrying will not help
 *   returns undefined        -> never reached the server (queue it)
 */
export async function postProgress(body: ProgressBody, attempts = 3): Promise<ProgressReply | null | undefined> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await postJson('/api/progress', body);
      if (response.ok) return (await response.json()) as ProgressReply;
      if (response.status >= 400 && response.status < 500) return null;
    } catch {
      /* network: fall through to the retry */
    }
    if (attempt < attempts) await new Promise((done) => setTimeout(done, 400 * attempt));
  }
  return undefined;
}

/** queuePendingProgress (app.js:1140) — keep the last 10 unsent completions for the next load. */
export function queuePendingProgress(body: ProgressBody): void {
  try {
    const queued = JSON.parse(localStorage.getItem(PROGRESS_PENDING_KEY) || '[]') as ProgressBody[];
    localStorage.setItem(PROGRESS_PENDING_KEY, JSON.stringify([...queued.slice(-9), body]));
  } catch {
    /* storage blocked: the retry was the only chance */
  }
}

/**
 * flushPendingProgress (app.js:1167) — re-sends anything a previous session could not save.
 * Returns the replies that landed, so the caller can refresh the progress cache.
 * ⛔ Runs ONCE per page load (the legacy's DOMContentLoaded). An empty queue sends nothing —
 *    gate R-RO2 asserts an unseeded browse makes ZERO non-GET requests.
 */
export async function flushPendingProgress(): Promise<ProgressReply[]> {
  let queued: ProgressBody[] = [];
  try {
    queued = JSON.parse(localStorage.getItem(PROGRESS_PENDING_KEY) || '[]') as ProgressBody[];
  } catch {
    return [];
  }
  if (!Array.isArray(queued) || !queued.length) return [];
  const left: ProgressBody[] = [];
  const landed: ProgressReply[] = [];
  for (const body of queued) {
    const data = await postProgress(body, 2);
    if (data === undefined) left.push(body);
    else if (data && data.completed) landed.push(data);
  }
  try {
    if (left.length) localStorage.setItem(PROGRESS_PENDING_KEY, JSON.stringify(left));
    else localStorage.removeItem(PROGRESS_PENDING_KEY);
  } catch {
    /* storage blocked */
  }
  return landed;
}

// ---------------------------------------------------------------- tokens
/**
 * generationToken (app.js:3024). `null` means the reader cancelled the prompt — abort.
 * `''` means no token is needed. The provider's token_required flag decides.
 */
export function generationToken(tokenRequired: boolean): string | null {
  if (!tokenRequired) return '';
  return window.prompt('Generation access token') || null;
}

/** The admin token lives in sessionStorage only: it dies with the tab (app.js:3426). */
export function adminToken(): string {
  try {
    return sessionStorage.getItem('eduAdminToken') || '';
  } catch {
    return '';
  }
}

export function rememberAdminToken(token: string): void {
  try {
    sessionStorage.setItem('eduAdminToken', token);
  } catch {
    /* private mode */
  }
}

// ---------------------------------------------------------------- sign out (23-09-26)
/**
 * Sign out, from the top bar's LOG OUT entry or the Account page. ONE implementation for both.
 *
 * Order, each step deliberate:
 *   1. Flush any unsent lesson completions WHILE the session still exists — after step 2 they
 *      would either 401 or, worse, be sent later under the NEXT account to sign in on this browser.
 *   2. POST /api/auth/logout — the server deletes the session row and clears the cookie.
 *   3. Clear what this browser holds FOR THIS PERSON: the admin token (sessionStorage), the tutor
 *      conversation, any still-unsent completions, and exercise drafts. None of these is keyed by
 *      account, so leaving them would show one person's work to the next.
 *      ⚠ `eduActiveBook` (which book was open) is a UI preference, not personal work — kept.
 *   4. A FULL navigation to /login, which also drops the in-memory query cache.
 * A failed network call never blocks the navigation: the reader asked to leave, so they leave.
 */
export async function signOut(): Promise<void> {
  await flushPendingProgress().catch(() => undefined);
  await postJson('/api/auth/logout', {}).catch(() => undefined);
  try {
    sessionStorage.removeItem('eduAdminToken');
  } catch {
    /* private mode */
  }
  try {
    const drop = [PROGRESS_PENDING_KEY, 'eduAskConversation'];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('eduExercises.')) drop.push(key);
    }
    for (const key of drop) localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
  window.location.assign('/login');
}
