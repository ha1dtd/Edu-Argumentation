// Seam 23 (quiz/QuizSetupScreen) — THE MULTI-SELECT CHAPTER / BLOCK PICKER.
//
// PORTED FROM (by symbol, app.js): renderSetupTree, setChapterOpen, syncSetupTree,
// renderSetupCount, openQuizSetup, closeQuizSetup, readSetupChoice, saveSetupChoice,
// allBlockIds, selectedBlockIds, practiceQuestionsFor, generateScopeText.
//
// Contract DOM this seam owns:
//   #quiz-setup-screen · #setup-tree · `#setup-tree input[data-block="*"]` ·
//   #setup-all-btn · #setup-none-btn · #setup-start-btn · #setup-cancel-btn
//   (+ #setup-close-btn, added by item E 22-09-26 — NOT a frozen-contract selector)
//
// ⛔ `data-block` on each checkbox is a CONTRACT ATTRIBUTE, not a convenience: the gate
//    selects `#setup-tree input[data-block="*"]`. Losing it in favour of a React key or
//    a value prop empties that selector.
// ⚠ The picker is MULTI-SELECT WITH DESELECT, and the chosen set is REMEMBERED per mode
//   (practice / generate) across visits.
import { useState } from 'react';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useQuiz } from '../state/QuizProvider';
import type { QuizQuestion } from '../data/types';

export interface QuizSetupScreenProps {
  /** Switches the shell to #quiz-screen. ⛔ SEEDING THE RUN IS THIS SEAM'S JOB — see `start`. */
  onStart: () => void;
  onCancel: () => void;
}

/**
 * practiceQuestionsFor(ids), ported verbatim (app.js:3093-3096).
 * ⛔ Filters on `source.block`, never on position: the bank is not ordered by block and a
 *    positional slice would hand the learner another block's questions.
 */
export function practiceQuestionsFor(bank: QuizQuestion[], ids: string[]): QuizQuestion[] {
  const wanted = new Set(ids);
  return bank.filter((question) => question?.source?.block && wanted.has(question.source.block));
}

export function QuizSetupScreen({ onStart, onCancel }: QuizSetupScreenProps) {
  const { chapters, blocksOf, quizBank, data } = useBookContext();
  const { blockIdOf } = useProgressContext();
  const { dispatch } = useQuiz();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // allBlockIds(), plus the coordinates each id maps back to. ⛔ Built in ONE pass so the
  // inverse lookup cannot drift from the forward one — the legacy parses the id back out with
  // a regex (blockFromId, app.js:793); walking the book we already have is the same answer
  // without a second source of truth for the id format.
  const catalog = chapters.flatMap((chapter, chapterIndex) =>
    blocksOf(chapterIndex).map((block, blockIndex) => ({
      id: blockIdOf(chapterIndex, blockIndex),
      chapterIndex,
      blockIndex,
      chapterTitle: chapter.title,
      term: block.term,
    })),
  );
  const allIds = catalog.map((entry) => entry.id);

  /**
   * ⛔⛔ THE FIX FOR G-EVL-2. The measured defect: `#setup-start-btn` was wired to
   *     `onStart={() => setScreen('quiz')}` (AppShell:210) — it changed the SCREEN and
   *     dispatched NOTHING, so the 13-field atom kept `active: []` and `#options-container`
   *     rendered zero option cards. 4 of the 5 declared contract-selector gaps were that one
   *     defect. Measured on :8792 22-09-26: the picker could not even be exercised, because
   *     G-EVL-1 left `#setup-tree` with no checkboxes at all.
   *
   * ⛔ IT GOES THROUGH THE EXISTING REDUCER ACTIONS — `run/reset` + `scope/set` — and adds NO
   *    parallel state. The 13 fields stay ONE `useReducer` (A2b): they are reset together by
   *    `run/reset` and read together by the derived `tallyScore()`/`tallyTotal()` selectors,
   *    which stay computed-during-render and are never stored. The two dispatches are batched
   *    into one render and touch disjoint fields, so nothing can flush partially.
   * ⛔ THE CARRY INVARIANT IS UNTOUCHED: `run/reset` zeroes `carriedCorrect`/`carriedTotal`
   *    (a fresh run carries nothing) and `full` is seeded to the SAME set as `active`, which
   *    is what lets a later `run/retryWrong` post the ORIGINAL denominator — 20/20, never 3/3.
   *
   * Ported from the `setupStartBtn` click listener (app.js:3266-3291) with its three branches:
   */
  const start = () => {
    // selectedBlockIds() (app.js:3083) — filters allBlockIds(), so the run is in BOOK order
    // regardless of the order the learner ticked the boxes.
    const ids = allIds.filter((id) => selected.has(id));
    if (!ids.length) return;

    if (ids.length === allIds.length) {
      // setModuleQuiz() (app.js:1020). ⛔ The WHOLE bank, not the filtered set: a question whose
      // `source.block` does not match any rendered block still belongs to the module run.
      dispatch({ type: 'run/reset', questions: quizBank });
      dispatch({
        type: 'scope/set',
        scope: 'module',
        label: (data?.title as string | undefined) || 'Whole module',
        blockId: null,
      });
    } else if (ids.length === 1) {
      // setBlockQuiz() (app.js:1027). ⛔ This is the ONLY branch that sets a scopeBlockId —
      // it is the only one where a single block owns the result and can be credited by it.
      const only = catalog.find((entry) => entry.id === ids[0]);
      dispatch({ type: 'run/reset', questions: practiceQuestionsFor(quizBank, ids) });
      dispatch({
        type: 'scope/set',
        scope: 'block',
        label: `${only?.chapterTitle || `Chapter ${(only?.chapterIndex ?? 0) + 1}`} — ${
          only?.term || `Block ${(only?.blockIndex ?? 0) + 1}`
        }`,
        blockId: ids[0],
      });
    } else {
      // setSelectionQuiz() (app.js:1041). Any mix of blocks: NO single block owns it, so
      // blockId stays null and no block is marked complete by it.
      const hit = [...new Set(ids.map((id) => catalog.find((entry) => entry.id === id)?.chapterIndex ?? -1))];
      const wholeChapter = hit.length === 1 && ids.length === blocksOf(hit[0]).length;
      dispatch({ type: 'run/reset', questions: practiceQuestionsFor(quizBank, ids) });
      dispatch({
        type: 'scope/set',
        scope: 'selection',
        label: wholeChapter
          ? chapters[hit[0]]?.title || `Chapter ${hit[0] + 1}`
          : `${ids.length} blocks from ${hit.length} chapter${hit.length === 1 ? '' : 's'}`,
        blockId: null,
      });
    }
    onStart();
  };

  /*
    ⛔⛔ CLASS STRINGS PORTED 22-09-26 (EVL fix 003) — VERBATIM from the legacy dialog markup
        (aws-quiz-app/index.html:534-556) and `renderSetupTree` (js/app.js:3098-3150).
        BEFORE this fix every element in this component carried NO className at all. What the
        learner actually saw, measured and screenshotted on the deployed :8792:
          · raw black-on-white text with no page gutter and no dialog box;
          · the 19 chapter rows overlapping the app's own leftovers behind them;
          · and the five controls rendered as one run-together string —
            "Select allSelect noneResumeStartCancel" — not as buttons.
    ⛔ `#setup-backdrop` MUST carry `fixed inset-0 bg-black/70`. It is not decoration: it is
       BOTH the dim and the click target that dismisses the dialog. With no class it had a
       zero-sized box, which is half of the D-8 nav trap.
    ⛔ The dialog element keeps `role="dialog" aria-modal="true" aria-labelledby="setup-title"`.
       An overlay that traps the pointer without announcing itself as a modal is worse than
       one that does not trap it.
    ⚠ DECLARED DEVIATION, kept from the A4 port: this is a <details>/<summary> tree, while the
      legacy builds a div/button tree with a sticky chapter head and per-chapter tallies. The
      CONTRACT selector is `#setup-tree input[data-block="*"]`, which both shapes satisfy, and
      `details` is already a contract tag. Restyling it into the legacy's exact widget is a
      bigger change than these eight defects authorise; the classes below make the existing
      shape legible and operable, which is what was broken.
    ⚠ `CHECKBOX_CLASS` is app.js:3067 verbatim, including `accent-brand-600` — which is one of
      the utilities that generated NOTHING before the brand palette was added to index.html.
  */
  const CHECKBOX_CLASS = 'h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-600';
  const GHOST_BTN =
    'min-h-[44px] px-4 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

  return (
    <>
      {/* ⛔ The backdrop is the dismiss affordance. See the block above. */}
      <div id="setup-backdrop" className="fixed inset-0 bg-black/70" onClick={onCancel} />
      {/*
        ⛔ THE DISMISS HANDLER IS ON **THIS** ELEMENT TOO, not only on #setup-backdrop, and the
           `event.target === event.currentTarget` test is what makes it correct.
           MEASURED 22-09-26: this centring wrapper is a LATER SIBLING of the backdrop and
           spans the same box, so it sits ON TOP and swallows every click aimed at the
           backdrop — a click at (30, 950) left the picker open. `#setup-backdrop` keeps its
           own handler (it is the element a reader would expect to be the dismiss target, and
           it still receives clicks wherever the wrapper does not cover); this one closes the
           hole the wrapper opened.
        ⚠ The identity test is load-bearing: without it a click anywhere INSIDE the dialog
          bubbles up here and closes the picker mid-selection.
      */}
      <div
        className="relative min-h-full flex items-start sm:items-center justify-center p-4"
        onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-title"
          className="w-full max-w-3xl bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8 shadow-2xl"
        >
          {/*
            ⛔⛔ ITEM E (22-09-26) — THE DISMISSAL IS MADE OBVIOUS. READ BEFORE REMOVING.
                `#quiz-setup-screen` is `fixed inset-0 z-[60]`, the header is `z-50`, so while
                the picker is open it COVERS the nav. That is the legacy's own layering
                (index.html:534) and it is correct modal behaviour — the final EVL measured it
                and classified it a CONCERN, not a FAIL: `elementFromPoint` over `#brand-home`
                returns the picker's centring wrapper, and Playwright reports "subtree
                intercepts pointer events". The learner is NOT trapped (Escape and Cancel both
                work, both measured) but the way out was not VISIBLE from the top of the
                dialog, where the covered nav is.
            ⛔ THE FIX IS DELIBERATELY *NOT* "RAISE THE HEADER ABOVE THE MODAL". Two reasons:
                1. `aria-modal="true"` tells assistive tech everything outside the dialog is
                   inert. Leaving the nav clickable makes the DOM contradict that attribute.
                2. The alternative fix touches `#primary-nav`'s visibility, and D-8 — the nav
                   trap that killed EVERY nav control on EVERY screen — was caused by exactly
                   that surface. `#primary-nav` must never be left `display:none`; the safest
                   change here is the one that does not go near it.
            ⛔ `#setup-close-btn` is a NEW id and is NOT in selector-contract.frozen.json.
               That file is deliberately NOT regenerated (it is generated FROM the gates).
               gate-r-theme.mjs asserts this button instead.
            ⚠ It is a SECOND affordance, not a replacement: `#setup-cancel-btn` stays exactly
              where it was, and the Escape handler is untouched.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 id="setup-title" className="text-3xl text-white font-light">
              Choose what to be assessed on
            </h2>
            <div className="flex items-center gap-2">
              <button id="setup-all-btn" type="button" className={GHOST_BTN} onClick={() => setSelected(new Set(allIds))}>
                Select all
              </button>
              <button id="setup-none-btn" type="button" className={GHOST_BTN} onClick={() => setSelected(new Set())}>
                Select none
              </button>
              <button
                id="setup-close-btn"
                type="button"
                onClick={onCancel}
                aria-label="Close and go back"
                title="Close and go back (Esc)"
                className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white hover:bg-gray-700 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* The nav is behind the overlay while this is open; say so, in words, where the
              learner is already looking. Plain text, no id — the two BUTTONS are what the
              gate asserts, because a sentence is not an affordance. */}
          <p id="setup-dismiss-hint" className="mb-4 text-sm text-gray-400">
            The menu bar is hidden while you choose. Press{' '}
            <kbd className="rounded border border-gray-600 px-1.5 py-0.5 font-mono text-xs text-gray-200">Esc</kbd>,
            or use <span className="text-gray-200 font-semibold">&times;</span> / Cancel, to go back.
          </p>

          {/* min-w-0: a fieldset will not shrink below its widest line by default, and long
              chapter titles scrolled the page sideways on phones (the legacy's own note). */}
          <fieldset className="min-w-0">
            <legend className="sr-only">Chapters and blocks</legend>
            {/*
              ⛔ `max-h-[55vh] overflow-y-auto` is what stops 19 chapters x 21 blocks running
                 off the bottom of the window with no scrollbar — the same class of defect as
                 D-1, in a different container.
            */}
            <div
              id="setup-tree"
              className="max-h-[55vh] overflow-y-auto overscroll-contain rounded-xl border border-gray-700 bg-gray-900/60 divide-y divide-gray-700/70"
            >
              {chapters.map((chapter, chapterIndex) => (
                <details key={chapterIndex} className="rounded-lg">
                  <summary className="min-h-[44px] flex items-center px-3 py-2 cursor-pointer text-white hover:bg-gray-800/60">
                    {`${chapterIndex + 1}. ${chapter.title}`}
                  </summary>
                  <ul className="pb-2">
                    {blocksOf(chapterIndex).map((block, blockIndex) => {
                      const id = blockIdOf(chapterIndex, blockIndex);
                      return (
                        <li key={id}>
                          <label className="flex items-center gap-3 min-h-[44px] pl-10 pr-3 cursor-pointer hover:bg-gray-800/60">
                            <input
                              type="checkbox"
                              className={CHECKBOX_CLASS}
                              data-block={id}
                              checked={selected.has(id)}
                              onChange={(event) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(id);
                                  else next.delete(id);
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0 text-sm text-gray-300">
                              {`${blockIndex + 1}. ${block.term ?? 'Theory block'}`}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ))}
            </div>
          </fieldset>

          <p id="setup-count" className="mt-4 text-sm text-gray-400" role="status" aria-live="polite">
            {/* A4 OWNS renderSetupCount(): it says how many QUESTIONS the selection carries,
                not how many blocks — the two differ and the question count is the useful one. */}
            {`${selected.size} selected`}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* ⛔ `start`, NOT the bare `onStart` prop — `onStart` only switches the screen. See
                the `start` doc block above (G-EVL-2).
                ⚠ ONE LEGACY BRANCH IS NOT PORTED, declared: startQuiz() (app.js:683-691) routes
                  an EMPTY question set to showResults() instead of the quiz screen. The button
                  is disabled while nothing is ticked, so it is reachable only when every ticked
                  block happens to carry zero written questions. Known-gap, not papered over. */}
            <button
              id="setup-start-btn"
              type="button"
              disabled={selected.size === 0}
              onClick={start}
              className="min-h-[44px] px-8 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start
            </button>
            {/* A4: resumeQuizSession() — an unfinished run is offered back. ⛔ `hidden-view` is
                the legacy's own initial state for this button (index.html:551); it is shown
                only when there IS a session to resume, which is Phase 04 state. It stays
                MOUNTED and hidden by class rather than unmounted, like every other control. */}
            <button id="setup-resume-btn" type="button" className={`hidden-view ${GHOST_BTN}`}>
              Resume
            </button>
            <button
              id="setup-cancel-btn"
              type="button"
              onClick={onCancel}
              className="min-h-[44px] px-6 rounded-lg text-sm font-semibold uppercase tracking-wider text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ml-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
