// Q&A examiner — session state + server calls (study-rooms-qna P2, 29-09-26).
//
// ⚑ PERSISTED PER ACCOUNT + SCOPE UNTIL "New" (memory in-progress-work-persists-until-new):
//   localStorage `qna:<accountId>:<bookId>:<sortedBlocksHash>` holds the index, the questions
//   already fetched (one model call each, cached here), the answer draft and the last grade.
//   `qna:<accountId>:current` points at the open session so a reload restores it.
// ⛔ Every call goes through data/writes.ts:postJson (gate-r-ro R-RO1: ONE non-GET fetch literal).
// ⛔ Pass is the SERVER's `pass` (raw score > 8). Nothing here rounds or recomputes it, and a pass
//    writes nothing to /api/progress (F23).
import { useCallback, useEffect, useRef, useState } from 'react';
import { postJson } from '../data/writes';

export interface QnaQuestion {
  index: number;
  total: number;
  block: string;
  question: string;
  lessonTitle: string;
}

export interface QnaGrade {
  score: number;
  right: string[];
  almost: string[];
  missing: string[];
  wrong: string[];
  feedback: string;
  pass: boolean;
}

export interface QnaAsk {
  question: string;
  answer: string;
  refused: boolean;
}

export interface QnaSession {
  bookId: string;
  /** Sorted theoryBlockId strings. */
  blocks: string[];
  index: number;
  total: number | null;
  questions: Record<string, QnaQuestion>;
  draft: string;
  grade: QnaGrade | null;
  done: boolean;
  askOpen: boolean;
  askDraft: string;
  ask: QnaAsk | null;
}

export type QnaBusy = 'question' | 'grade' | 'ask' | null;

/** FNV-1a 32-bit, hex. Stable across reloads; only needs to separate scopes. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function sortBlocks(blocks: string[]): string[] {
  return [...new Set(blocks)].sort();
}

const pointerKey = (accountId: number) => `qna:${accountId}:current`;
const sessionKey = (accountId: number, bookId: string, blocks: string[]) => `qna:${accountId}:${bookId}:${hash(blocks.join(','))}`;

function readSession(accountId: number): QnaSession | null {
  try {
    const key = localStorage.getItem(pointerKey(accountId));
    if (!key) return null;
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!raw || typeof raw !== 'object' || typeof raw.bookId !== 'string' || !Array.isArray(raw.blocks)) return null;
    return raw as QnaSession;
  } catch {
    return null;
  }
}

function writeSession(accountId: number, session: QnaSession | null, previous: QnaSession | null): void {
  try {
    if (!session) {
      if (previous) localStorage.removeItem(sessionKey(accountId, previous.bookId, previous.blocks));
      localStorage.removeItem(pointerKey(accountId));
      return;
    }
    const key = sessionKey(accountId, session.bookId, session.blocks);
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem(pointerKey(accountId), key);
  } catch {
    /* per-viewer convenience only */
  }
}

/** Plain copy for a failed call. 429 carries the wait. */
async function errorText(response: Response | null, fallback: string): Promise<string> {
  if (!response) return 'Could not reach the server — try again.';
  let body: { error?: string; retryAfter?: number } = {};
  try {
    body = await response.json();
  } catch {
    /* not json */
  }
  if (response.status === 429) {
    const minutes = Math.max(1, Math.ceil((Number(body.retryAfter) || 60) / 60));
    return `Too many requests. Try again in ${minutes} min.`;
  }
  if (response.status === 502 || response.status === 504) return fallback;
  return body.error || fallback;
}

async function call(route: '/api/qna/question' | '/api/qna/grade' | '/api/qna/ask', body: unknown): Promise<Response | null> {
  try {
    return await postJson(route, body);
  } catch {
    return null;
  }
}

export function useQnaSession(accountId: number) {
  const [session, setSessionState] = useState<QnaSession | null>(() => readSession(accountId));
  const [busy, setBusy] = useState<QnaBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const setSession = useCallback(
    (next: QnaSession | null) => {
      writeSession(accountId, next, sessionRef.current);
      sessionRef.current = next;
      setSessionState(next);
    },
    [accountId],
  );
  const patch = useCallback((change: Partial<QnaSession>) => {
    const current = sessionRef.current;
    if (current) setSession({ ...current, ...change });
  }, [setSession]);

  const loadQuestion = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.done || current.questions[String(current.index)]) return;
    setBusy('question');
    setError(null);
    const response = await call('/api/qna/question', { bookId: current.bookId, blocks: current.blocks, index: current.index });
    setBusy(null);
    if (!response || !response.ok) {
      setError(await errorText(response, 'Could not get a question — try again.'));
      return;
    }
    const body = (await response.json()) as QnaQuestion & { done?: boolean };
    const latest = sessionRef.current;
    if (!latest || latest.bookId !== current.bookId || latest.index !== current.index) return;
    if (body.done) {
      setSession({ ...latest, done: true, total: body.total });
      return;
    }
    setSession({ ...latest, total: body.total, questions: { ...latest.questions, [String(body.index)]: body } });
  }, [setSession]);

  // Fetch the current question when it is not cached yet (fresh session, Proceed, reload mid-fetch).
  useEffect(() => {
    if (session && !session.done && !session.questions[String(session.index)] && busy === null && error === null) void loadQuestion();
  }, [session, busy, error, loadQuestion]);

  const start = (bookId: string, blocks: string[]) => {
    setError(null);
    setSession({
      bookId, blocks: sortBlocks(blocks), index: 0, total: null, questions: {}, draft: '', grade: null,
      done: false, askOpen: false, askDraft: '', ask: null,
    });
  };

  const submit = async () => {
    const current = sessionRef.current;
    const question = current?.questions[String(current.index)];
    if (!current || !question || !current.draft.trim() || busy) return;
    setBusy('grade');
    setError(null);
    const response = await call('/api/qna/grade', { bookId: current.bookId, block: question.block, question: question.question, answer: current.draft });
    setBusy(null);
    if (!response || !response.ok) {
      setError(await errorText(response, 'Grading failed — try again.'));   // the draft is kept
      return;
    }
    const grade = (await response.json()) as QnaGrade;
    patch({ grade });
  };

  const tryAgain = () => {
    setError(null);
    patch({ grade: null, draft: '', askOpen: false, ask: null, askDraft: '' });
  };

  const proceed = () => {
    const current = sessionRef.current;
    if (!current) return;
    setError(null);
    const next = current.index + 1;
    const done = current.total !== null && next >= current.total;
    setSession({ ...current, index: next, grade: null, draft: '', askOpen: false, ask: null, askDraft: '', done });
  };

  const ask = async () => {
    const current = sessionRef.current;
    const question = current?.questions[String(current.index)];
    if (!current || !question || !current.askDraft.trim() || busy) return;
    setBusy('ask');
    setError(null);
    const response = await call('/api/qna/ask', { bookId: current.bookId, block: question.block, question: current.askDraft });
    setBusy(null);
    if (!response || !response.ok) {
      setError(await errorText(response, 'No answer — try again.'));
      return;
    }
    const body = (await response.json()) as { answer: string; refused: boolean };
    patch({ ask: { question: current.askDraft, answer: body.answer, refused: Boolean(body.refused) } });
  };

  const reset = () => {
    setError(null);
    setBusy(null);
    setSession(null);
  };

  return {
    session, busy, error, start, submit, tryAgain, proceed, ask, reset,
    retryQuestion: () => { setError(null); },
    setDraft: (draft: string) => patch({ draft }),
    setAskDraft: (askDraft: string) => patch({ askDraft }),
    openAsk: () => patch({ askOpen: true }),
  };
}
