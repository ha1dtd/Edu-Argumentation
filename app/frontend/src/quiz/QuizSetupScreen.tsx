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
import { useEffect, useRef, useState } from 'react';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useQuiz } from '../state/QuizProvider';
import type { QuizQuestion } from '../data/types';
import type { StudyActions } from '../shell/useStudyActions';
import { AI_ONLY_ON_LIBRARY_BOOKS } from '../shell/useStudyActions';
// study-rooms-qna P2 (29-09-26): the chapter/block tree moved to scope/ScopePicker.tsx, verbatim;
// this dialog renders it bound to the active book (allowBookPick={false}).
import { ScopePicker } from '../scope/ScopePicker';

/** setupMode (app.js:3091). PRACTICE and GENERATE QUIZ open this same dialog. */
export type SetupMode = 'practice' | 'generate';

export interface QuizSetupScreenProps {
  mode: SetupMode;
  /** True while the dialog is showing — the selection is (re)loaded on each open. */
  open: boolean;
  /** Switches the shell to #quiz-screen (practice). ⛔ SEEDING THE RUN IS THIS SEAM'S JOB. */
  onStart: () => void;
  onCancel: () => void;
  actions: StudyActions;
}

/**
 * practiceQuestionsFor(ids), ported verbatim (app.js:3121).
 * ⛔ Filters on `source.block`, never on position.
 */
export function practiceQuestionsFor(bank: QuizQuestion[], ids: string[]): QuizQuestion[] {
  const wanted = new Set(ids);
  return bank.filter((question) => question?.source?.block && wanted.has(question.source.block));
}

const GHOST_BTN =
  'min-h-[44px] px-4 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function QuizSetupScreen({ mode, open, onStart, onCancel, actions }: QuizSetupScreenProps) {
  const { chapters, blocksOf, quizBank, data, moduleId, activeBookFile } = useBookContext();
  const { blockIdOf } = useProgressContext();
  const { dispatch } = useQuiz();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const startRef = useRef<HTMLButtonElement | null>(null);

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
  const storeKey = `eduQuizSetup.${moduleId}.${mode}`;   // readSetupChoice/saveSetupChoice (app.js:3097)

  // openQuizSetup (app.js:3230): on every open, restore THIS mode's saved pick and expand the
  // chapters that hold part of it, so a saved pick is visible, not hidden. Then focus Start.
  useEffect(() => {
    if (!open) return;
    let saved: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) || '[]');
      saved = Array.isArray(raw) ? raw : [];
    } catch {
      saved = [];
    }
    const valid = new Set(allIds);
    const next = new Set(saved.filter((id) => valid.has(id)));
    setSelected(next);
    setExpanded(new Set(chapters.map((_c, ci) => ci).filter((ci) => blocksOf(ci).some((_b, bi) => next.has(blockIdOf(ci, bi))))));
    document.body.classList.add('overflow-hidden');
    requestAnimationFrame(() => startRef.current?.focus());
    return () => document.body.classList.remove('overflow-hidden');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeKey]);

  const ids = allIds.filter((id) => selected.has(id));   // selectedBlockIds: reading order
  // renderSetupCount (app.js:3208).
  const blocksText = `${ids.length} block${ids.length === 1 ? '' : 's'}`;
  let countText: string;
  let ready = ids.length > 0;
  if (!ids.length) {
    countText = 'Nothing selected';
  } else if (mode === 'practice') {
    const count = practiceQuestionsFor(quizBank, ids).length;
    countText = `${blocksText} · ${count} question${count === 1 ? '' : 's'}`;
    ready = count > 0;
  } else if (!actions.aiReady) {
    countText = actions.providerReady ? AI_ONLY_ON_LIBRARY_BOOKS : 'No model connected';
    ready = false;
  } else {
    const count = ids.length === 1 ? actions.aiQuestionCount : actions.generatedCountFor(ids.length);
    countText = `${blocksText} · ${count} AI questions`;
  }

  /** The #setup-start-btn listener (app.js:3294). */
  const start = () => {
    if (!ids.length) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify(ids));
    } catch {
      /* per-viewer convenience only */
    }
    if (mode === 'generate') {
      // Everything ticked is the same as no restriction: draw from the whole book.
      void actions.startGeneratedQuiz(ids.length === allIds.length ? [] : ids);
      return;
    }
    if (ids.length === allIds.length) {
      dispatch({ type: 'run/reset', questions: quizBank });
      dispatch({ type: 'scope/set', scope: 'module', label: (data?.title as string | undefined) || 'Whole module', blockId: null });
    } else if (ids.length === 1) {
      const only = catalog.find((entry) => entry.id === ids[0]);
      dispatch({ type: 'run/reset', questions: practiceQuestionsFor(quizBank, ids) });
      dispatch({
        type: 'scope/set',
        scope: 'block',
        label: `${only?.chapterTitle || `Chapter ${(only?.chapterIndex ?? 0) + 1}`} — ${only?.term || `Block ${(only?.blockIndex ?? 0) + 1}`}`,
        blockId: ids[0],
      });
    } else {
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

  return (
    <>
      {/* ⛔ The backdrop is the dismiss affordance (D-8). */}
      <div id="setup-backdrop" className="fixed inset-0 bg-black/70" onClick={onCancel} />
      <div
        className="relative min-h-full flex items-start sm:items-center justify-center p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancel();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-title"
          className="w-full max-w-3xl bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8 shadow-2xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 id="setup-title" className="text-3xl text-white font-light">
              {mode === 'practice' ? 'Practice' : 'AI-Quiz'}
            </h2>
            <div className="flex items-center gap-2">
              <button id="setup-all-btn" type="button" className={GHOST_BTN} onClick={() => setSelected(new Set(allIds))}>
                All
              </button>
              <button id="setup-none-btn" type="button" className={GHOST_BTN} onClick={() => setSelected(new Set())}>
                None
              </button>
              {/*
                ⚠ NOT IN THE LEGACY. Added in Phase 03 item E (the D-8 nav trap) and fenced by
                  gate-r-modal.mjs: the header is covered while this modal is open, so the way out
                  has to be visible from the top of the dialog. Kept deliberately.
              */}
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

          {/* ⚠ Phase 03 item E, fenced by gate-r-modal.mjs — see the close button above. */}
          <p id="setup-dismiss-hint" className="mb-4 text-sm text-gray-400">
            The menu bar is hidden while you choose. Press{' '}
            <kbd className="rounded border border-gray-600 px-1.5 py-0.5 font-mono text-xs text-gray-200">Esc</kbd>,
            or use <span className="text-gray-200 font-semibold">&times;</span> / Cancel, to go back.
          </p>

          <ScopePicker
            books={[]}
            value={{ bookId: activeBookFile ?? '', blocks: [...selected] }}
            onChange={(next) => setSelected(new Set(next.blocks))}
            allowBookPick={false}
            chapters={chapters}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />

          <p id="setup-count" className="mt-4 text-sm text-gray-400" role="status" aria-live="polite">
            {countText}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              ref={startRef}
              id="setup-start-btn"
              type="button"
              disabled={!ready}
              onClick={start}
              className="min-h-[44px] px-8 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start
            </button>
            {/* ⚠ Quiz sessions (resume) were not ported in Phase 03, so there is never one to
                  resume: the button stays in its legacy initial state, hidden. */}
            <button id="setup-resume-btn" type="button" className={`hidden-view min-h-[44px] px-6 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600`}>
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
