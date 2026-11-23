// THE REVIEW REMINDER (01-11-26, user: "a popup icon on the right side … red number badge, vibrate
// to prompt me to review. It only stays still … when I complete the review for that day").
//
// A floating button on the right edge, over every screen except a running quiz, the picker and the
// AI-quiz spinner. It reads the SAME spaced-repetition cards as "Review due (N)" in Practice
// (SM-2-lite in backend/store.srs_next) — no new schedule, no new table:
//   · cards due now > 0  -> red badge with the count + a shake 3x once a day (#review-reminder.is-nudge)
//   · cards due now = 0  -> no badge, no motion: today's review is done.
// A card is enrolled by answering it in any ordinary quiz, so finishing chapter 5's quiz is what
// brings chapter 5 back tomorrow (right answer: 1 day, then 4, then interval x ease, at most 14 days).
//
// ⚑ PER CHAPTER (01-11-26, user: "the review would be very large, so divide per chapter … even when I
//   don't complete it in one day, it still pings me … the same chapter must not appear 2 times").
//   The panel has ONE row per chapter with its due count and its own Review button; a run takes only
//   that chapter's cards (/api/review/due-in). Progress IS the card state: a graded card leaves the due
//   pile, an unreviewed one stays due tomorrow, so the row shrinks as he works and comes back until
//   it is empty. Rows are keyed by chapter and counts by card, so nothing is listed twice.
// ⚑ HOW MANY (01-11-26, user: "a chapter has 35, I write 99 => choose 35"): a row's Review button opens
//   a number field under it; blank = the whole chapter, above the chapter's count = the chapter's count,
//   below 1 = 1. The field corrects itself on blur so he sees the number that will run.
// ⚠ A card graded "again" is due again in 10 minutes, so the badge can come back the same day —
//   that is the relearning step, not a bug.
// ⚠ prefers-reduced-motion: reduce turns the shake off (styles/app.css); the badge stays.
// ⚑ CALMER (12-11-26, user: "the questions come back too constantly"): the shake plays 3 times, ONCE per
//   study day per browser (localStorage), not forever; the panel adds a "Coming back" list — per chapter,
//   how many cards and when the first returns — and says how many are held back by the daily cap
//   (backend/store.REVIEW_PER_DAY). The badge and rows already count only what the cap lets through.
// ⚑ TWO LIMITS (23-11-26, user: "limit per day to 100 … AI-written is separate, own quota"): chapter cards 100 a
//   day, AI-written cards ("other" block) 20 a day, each its own budget. The panel shows both held lines and a
//   "Due, waiting today" list per chapter — cards that are due NOW but wait outside today's limits, so an old
//   chapter's waiting cards are visible, not hidden behind a number.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchReviewDueIn, useReviewDueBlocks } from '../data/queries';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useQuiz } from '../state/QuizProvider';
import { showNotice } from '../shell/dialog';
import { reviewRunQuestions } from './QuizSetupScreen';

/** The number a typed value becomes: blank or not a number -> all `max`; else clamped to 1..max. */
export function pickCount(typed: string, max: number): number {
  const n = Math.floor(Number(typed));
  if (typed.trim() === '' || !Number.isFinite(n)) return max;
  return Math.min(max, Math.max(1, n));
}

const NUDGE_DAY_KEY = 'edu.reviewNudgeDay';
const AI_TITLE = 'AI-written';

/** "since today", "for 4 days" — how long a due card has been waiting. */
export function waitingFor(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return 'since today';
  return `for ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "now", "in 3 hours", "in 2 days" — when a not-yet-due card comes back. */
export function comesBackIn(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const hours = ms / 3_600_000;
  if (hours < 1) return 'in under an hour';
  if (hours < 24) return `in ${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Poll every 2 minutes: one grouped count per call, and a card falling due shows up without a reload. */
const POLL_MS = 120_000;

export interface ReviewReminderProps {
  /** False on screens where a floating button would get in the way (running quiz, picker, spinner). */
  visible: boolean;
  /** Switches the shell to #quiz-screen once the run is seeded. */
  onStart: () => void;
}

interface ChapterRow {
  key: string;
  title: string;
  due: number;
  /** The server's block ids for this chapter, sent back to fetch its cards. */
  blocks: string[];
}

export function ReviewReminder({ visible, onStart }: ReviewReminderProps) {
  const { chapters, blocksOf, moduleId, quizBank } = useBookContext();
  const { blockIdOf } = useProgressContext();
  const { dispatch } = useQuiz();
  const review = useReviewDueBlocks(moduleId, true, POLL_MS);
  const dueCount = review.data?.dueCount ?? 0;
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  // The row whose number field is open, and what is typed in it.
  const [picking, setPicking] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The shake: once per day, the first time cards are due on that day in this browser.
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    if (dueCount === 0) { setNudge(false); return; }
    if (!visible) return;
    try {
      const today = new Date().toDateString();
      if (window.localStorage.getItem(NUDGE_DAY_KEY) !== today) {
        window.localStorage.setItem(NUDGE_DAY_KEY, today);
        setNudge(true);
      }
    } catch { /* storage blocked: no shake, the badge still shows */ }
  }, [dueCount, visible]);

  // One row per chapter, in the server's priority order; a block the book does not hold ("other" = AI-written cards,
  // or a block from an older edition) is counted under "Other", last.
  const rows = useMemo<ChapterRow[]>(() => {
    const chapterOfBlock = new Map<string, number>();
    chapters.forEach((_, chapterIndex) =>
      blocksOf(chapterIndex).forEach((_, blockIndex) => chapterOfBlock.set(blockIdOf(chapterIndex, blockIndex), chapterIndex)),
    );
    const grouped = new Map<number, ChapterRow>();
    for (const { block, due } of review.data?.blocks ?? []) {
      const chapterIndex = chapterOfBlock.get(block) ?? -1;
      const row = grouped.get(chapterIndex) ?? {
        key: chapterIndex < 0 ? 'other' : `chapter-${chapterIndex}`,
        title: chapterIndex < 0 ? `${AI_TITLE} (own limit ${review.data?.aiDailyCap ?? 20} a day)` : chapters[chapterIndex]?.title ?? 'Other',
        due: 0,
        blocks: [],
      };
      row.due += due;
      row.blocks.push(block);
      grouped.set(chapterIndex, row);
    }
    // 18-11-26: the server sends blocks in review priority (freshest chapter first) — keep that order.
    return [...grouped.entries()].sort(([a], [b]) => (a < 0 ? 1 : b < 0 ? -1 : 0)).map(([, row]) => row);
  }, [chapters, blocksOf, blockIdOf, review.data]);

  // "Coming back": the not-yet-due cards, one row per chapter, soonest first.
  const upcoming = useMemo(() => {
    const chapterOfBlock = new Map<string, number>();
    chapters.forEach((_, chapterIndex) =>
      blocksOf(chapterIndex).forEach((_, blockIndex) => chapterOfBlock.set(blockIdOf(chapterIndex, blockIndex), chapterIndex)),
    );
    const grouped = new Map<number, { key: string; title: string; count: number; next: string }>();
    for (const { block, count, nextDueAt } of review.data?.upcoming ?? []) {
      const chapterIndex = chapterOfBlock.get(block) ?? -1;
      const row = grouped.get(chapterIndex) ?? {
        key: chapterIndex < 0 ? 'other' : `chapter-${chapterIndex}`,
        title: chapterIndex < 0 ? AI_TITLE : chapters[chapterIndex]?.title ?? 'Other',
        count: 0,
        next: nextDueAt,
      };
      row.count += count;
      if (Date.parse(nextDueAt) < Date.parse(row.next)) row.next = nextDueAt;
      grouped.set(chapterIndex, row);
    }
    return [...grouped.values()].sort((a, b) => Date.parse(a.next) - Date.parse(b.next));
  }, [chapters, blocksOf, blockIdOf, review.data]);
  // "Due, waiting today": due now but outside today's limits, per chapter, longest-waiting first.
  const waiting = useMemo(() => {
    const chapterOfBlock = new Map<string, number>();
    chapters.forEach((_, chapterIndex) =>
      blocksOf(chapterIndex).forEach((_, blockIndex) => chapterOfBlock.set(blockIdOf(chapterIndex, blockIndex), chapterIndex)),
    );
    const grouped = new Map<number, { key: string; title: string; count: number; oldest: string }>();
    for (const { block, count, oldestDueAt } of review.data?.heldBlocks ?? []) {
      const chapterIndex = chapterOfBlock.get(block) ?? -1;
      const row = grouped.get(chapterIndex) ?? {
        key: chapterIndex < 0 ? 'other' : `chapter-${chapterIndex}`,
        title: chapterIndex < 0 ? AI_TITLE : chapters[chapterIndex]?.title ?? 'Other',
        count: 0,
        oldest: oldestDueAt,
      };
      row.count += count;
      if (Date.parse(oldestDueAt) < Date.parse(row.oldest)) row.oldest = oldestDueAt;
      grouped.set(chapterIndex, row);
    }
    return [...grouped.values()].sort((a, b) => Date.parse(a.oldest) - Date.parse(b.oldest));
  }, [chapters, blocksOf, blockIdOf, review.data]);
  const held = review.data?.held ?? 0;
  const aiHeld = review.data?.aiHeld ?? 0;
  const heldLines = (
    <>
      {held > 0 && (
        <p id="review-reminder-held" className="mt-1 text-xs text-gray-400">
          {held} more {held === 1 ? 'is' : 'are'} waiting for tomorrow (daily limit {review.data?.dailyCap ?? 100}).
        </p>
      )}
      {aiHeld > 0 && (
        <p id="review-reminder-ai-held" className="mt-1 text-xs text-gray-400">
          {aiHeld} AI-written {aiHeld === 1 ? 'is' : 'are'} waiting for tomorrow (AI limit {review.data?.aiDailyCap ?? 20}).
        </p>
      )}
    </>
  );
  const waitingList = waiting.length > 0 && (
    <div id="review-reminder-waiting" className="mt-3 border-t border-gray-700 pt-3">
      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Due, waiting today</p>
      <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1 text-xs text-gray-300">
        {waiting.map((row) => (
          <li key={row.key} data-chapter={row.key} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 flex-1 truncate" title={row.title}>{row.title}</span>
            <span className="shrink-0 text-gray-400">{row.count} · {waitingFor(row.oldest)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  const comingBack = upcoming.length > 0 && (
    <div id="review-reminder-upcoming" className="mt-3 border-t border-gray-700 pt-3">
      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Coming back</p>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1 text-xs text-gray-300">
        {upcoming.map((row) => (
          <li key={row.key} data-chapter={row.key} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 flex-1 truncate" title={row.title}>{row.title}</span>
            <span className="shrink-0 text-gray-400">{row.count} · {comesBackIn(row.next)}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  // Close on Escape or a click outside, like any popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  // Coming back from a review run: close the panel and re-count at once, not at the next poll.
  const { refetch } = review;
  useEffect(() => {
    if (!open) setPicking(null);
  }, [open]);
  useEffect(() => {
    if (!visible) setOpen(false);
    else void refetch();
  }, [visible, refetch]);

  const startChapter = async (row: ChapterRow) => {
    const count = pickCount(typed, row.due);
    setTyped(String(count));
    setStarting(row.key);
    try {
      const page = await fetchReviewDueIn(moduleId, row.blocks, count);
      const questions = reviewRunQuestions(quizBank, page.due, count);
      if (!questions.length) {
        void review.refetch();
        return;
      }
      setOpen(false);
      setPicking(null);
      dispatch({ type: 'run/reset', questions });
      dispatch({ type: 'scope/set', scope: 'review', label: `Review · ${row.title}`, blockId: null });
      onStart();
    } catch {
      void showNotice({ title: 'Review could not start', body: 'The server did not answer. Try again in a moment.' });
    } finally {
      setStarting(null);
    }
  };

  // A failed call (signed out, server down) shows nothing rather than a wrong "all done".
  if (!moduleId || !review.data) return null;

  return (
    <div ref={rootRef} className={`${visible ? '' : 'hidden-view '}fixed right-4 top-1/2 -translate-y-1/2 z-40`}>
      {open && (
        <div
          id="review-reminder-panel"
          role="dialog"
          aria-label="Review reminder"
          className="absolute right-full top-1/2 -translate-y-1/2 mr-3 w-80 rounded-2xl border border-gray-700 bg-gray-800 p-4 shadow-2xl"
        >
          {dueCount > 0 ? (
            <>
              <p className="text-base font-bold text-white">
                {dueCount} {dueCount === 1 ? 'question' : 'questions'} to review
              </p>
              <p className="mt-1 text-sm text-gray-400">One chapter at a time. What you leave stays here for later.</p>
              {heldLines}
              <ul id="review-reminder-chapters" className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
                {rows.map((row) => (
                  <li key={row.key} data-chapter={row.key}>
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-gray-200" title={row.title}>{row.title}</span>
                        <span className="text-xs text-gray-400">{row.due} left</span>
                      </span>
                      <button
                        type="button"
                        aria-expanded={picking === row.key}
                        onClick={() => {
                          setPicking((current) => (current === row.key ? null : row.key));
                          setTyped('');
                        }}
                        className="review-pick-btn min-h-[36px] shrink-0 rounded-lg bg-brand-600 px-3 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        Review ▾
                      </button>
                    </div>
                    {picking === row.key && (
                      <form
                        className="mt-2 flex items-center gap-2 rounded-lg bg-gray-900/60 p-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void startChapter(row);
                        }}
                      >
                        <label className="flex-1 text-xs text-gray-400">
                          How many? (max {row.due})
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={row.due}
                            autoFocus
                            value={typed}
                            placeholder={String(row.due)}
                            onChange={(event) => setTyped(event.target.value)}
                            onBlur={() => typed.trim() !== '' && setTyped(String(pickCount(typed, row.due)))}
                            className="review-pick-input mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-white focus:border-brand-600 focus:outline-none"
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={starting !== null}
                          className="review-pick-start min-h-[36px] self-end rounded-lg bg-brand-600 px-3 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-brand-900 disabled:cursor-wait disabled:opacity-60"
                        >
                          {starting === row.key ? '…' : 'Start'}
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              {waitingList}
              {comingBack}
            </>
          ) : (
            <>
              <p className="text-base font-bold text-white">All reviewed for now</p>
              <p className="mt-1 text-sm text-gray-400">
                {review.data.total > 0
                  ? 'Nothing is due. Questions come back here when it is time to recall them.'
                  : 'Answer a quiz and its questions come back here when it is time to recall them.'}
              </p>
              {heldLines}
              {waitingList}
              {comingBack}
            </>
          )}
        </div>
      )}
      <button
        id="review-reminder"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={dueCount > 0 ? `${dueCount} questions due for review` : 'No questions due for review'}
        // 01-11-26 (user: "increase the size and color … so it pops up better"): 64 px; red with a glow
        // while cards are due, plain grey when the day's review is done.
        className={`${
          dueCount > 0
            ? `is-due ${nudge ? 'is-nudge ' : ''}bg-brand-600 border-brand-400 text-white shadow-[0_0_24px_rgba(239,91,91,0.65)] ring-4 ring-brand-600/30 hover:bg-brand-500`
            : 'bg-gray-800 border-gray-600 text-gray-100 shadow-lg hover:border-brand-600'
        } relative flex h-16 w-16 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
      >
        {/* lucide "brain", inlined like the header glyphs (shell/Header.tsx). */}
        <svg viewBox="0 0 24 24" className="block h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
          <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
          <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
          <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
          <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
          <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
          <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
          <path d="M6 18a4 4 0 0 1-1.967-.516" />
          <path d="M19.967 17.484A4 4 0 0 1 18 18" />
        </svg>
        {dueCount > 0 && (
          <span
            id="review-reminder-badge"
            className="absolute -right-1.5 -top-1.5 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full border-2 border-brand-600 bg-white px-1.5 text-sm font-extrabold text-red-600 shadow"
          >
            {dueCount > 99 ? '99+' : dueCount}
          </span>
        )}
      </button>
    </div>
  );
}
