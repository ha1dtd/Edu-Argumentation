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

/** chapterName (app.js:3115): titles already read "Chapter 3: X"; numbering them again gave "3. Chapter 3: X". */
function chapterName(title: string | undefined, chapterIndex: number): string {
  return String(title || '').replace(/^chapter\s+\d+\s*[:.\-–—]\s*/i, '') || `Chapter ${chapterIndex + 1}`;
}

const CHECKBOX_CLASS = 'h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-600';
const GHOST_BTN =
  'min-h-[44px] px-4 rounded-lg border border-gray-600 text-gray-200 hover:border-brand-600 hover:text-white text-sm font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/** A checkbox whose `indeterminate` is a DOM property, not an attribute (syncSetupTree). */
function ChapterBox(props: { checked: boolean; indeterminate: boolean; chapterIndex: number; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.indeterminate;
  }, [props.indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={CHECKBOX_CLASS}
      data-chapter={String(props.chapterIndex)}
      checked={props.checked}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  );
}

export function QuizSetupScreen({ mode, open, onStart, onCancel, actions }: QuizSetupScreenProps) {
  const { chapters, blocksOf, quizBank, data, moduleId } = useBookContext();
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

  const setMany = (list: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      list.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

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

          {/* min-w-0: a fieldset will not shrink below its widest line by default. */}
          <fieldset className="min-w-0">
            <legend className="sr-only">Chapters and blocks</legend>
            {/* renderSetupTree (app.js:3126), element for element. */}
            <div
              id="setup-tree"
              className="max-h-[55vh] overflow-y-auto overscroll-contain rounded-xl border border-gray-700 bg-gray-900/60 divide-y divide-gray-700/70"
            >
              {chapters.map((chapter, ci) => {
                const blockIds = blocksOf(ci).map((_b, bi) => blockIdOf(ci, bi));
                const picked = blockIds.filter((id) => selected.has(id)).length;
                const isOpen = expanded.has(ci);
                return (
                  <div key={ci} data-chapter-group={String(ci)}>
                    {/* Sticky, so a long chapter's blocks never scroll away from their chapter. */}
                    <div className="sticky top-0 z-10 flex items-center gap-1 pr-3 bg-gray-900">
                      <button
                        type="button"
                        data-toggle={String(ci)}
                        aria-expanded={isOpen ? 'true' : 'false'}
                        aria-controls={`setup-blocks-${ci}`}
                        aria-label={`Blocks of chapter ${ci + 1}`}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(ci)) next.delete(ci);
                            else next.add(ci);
                            return next;
                          })
                        }
                      >
                        <svg
                          className={`w-4 h-4 transition-transform${isOpen ? ' rotate-90' : ''}`}
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <label className="flex flex-1 min-w-0 items-center gap-3 min-h-[44px] cursor-pointer">
                        <ChapterBox
                          chapterIndex={ci}
                          checked={picked > 0 && picked === blockIds.length}
                          indeterminate={picked > 0 && picked < blockIds.length}
                          onChange={(on) => setMany(blockIds, on)}
                        />
                        <span className="truncate text-white">{`${ci + 1}. ${chapterName(chapter.title, ci)}`}</span>
                        <span className="ml-auto shrink-0 pl-2 text-xs text-gray-400 tabular-nums" data-tally={String(ci)}>
                          {picked ? `${picked}/${blockIds.length}` : `${blockIds.length}`}
                        </span>
                      </label>
                    </div>
                    <ul id={`setup-blocks-${ci}`} className={isOpen ? 'pb-2' : 'hidden-view pb-2'}>
                      {blocksOf(ci).map((block, bi) => {
                        const id = blockIdOf(ci, bi);
                        return (
                          <li key={id}>
                            <label className="flex items-center gap-3 min-h-[44px] pl-14 pr-3 cursor-pointer hover:bg-gray-800/60">
                              <input
                                type="checkbox"
                                className={CHECKBOX_CLASS}
                                data-block={id}
                                checked={selected.has(id)}
                                onChange={(event) => setMany([id], event.target.checked)}
                              />
                              <span className="min-w-0 text-sm text-gray-300">{`${bi + 1}. ${(block && block.term) || `Block ${bi + 1}`}`}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </fieldset>

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
