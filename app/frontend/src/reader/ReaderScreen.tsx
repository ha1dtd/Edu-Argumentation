// Seam 13 (reader/ReaderScreen) — THE READING PANE.
//
// PORTED FROM (by symbol, app.js): renderTheoryBlock, selectTheory, renderTutorial,
// showTutorial, previousTheory, nextTheory, renderBlockQuizButton, setReaderMode.
//
// ⛔⛔ B7 — SCROLL RESET IS TIED TO **VISIBILITY**, NOT TO THE CURSOR (Decision 6).
//     A useLayoutEffect keyed on [cursor, isVisible] writes el.scrollTop = 0 ONLY WHEN
//     VISIBLE. Both legacy write sites (selectTheory's reset and returnToReader's)
//     collapse into this one effect.
//     ⚠ A ref callback would be the idiomatic React place for this and it NEVER
//       RE-FIRES here, because the screen is never unmounted — see shell/Screen.tsx.
//     Without the reset, "Next" lands you halfway down the next lesson: the READING PANE
//     scrolls, not the window.
//
// ⛔ B3 — the `body.reader-mode` 100dvh / min-h-0 chain is what makes #tutorial-article
//    the scroll container rather than the window. The <body> class is owned by AppShell;
//    the min-h-0 chain is owned here, and breaking either makes the pane un-scrollable
//    while still looking correct.
//    ⚠ The scroll gate carries an ANTI-VACUITY FLOOR: it must FIRST assert
//      `scrollHeight > clientHeight + 200` and fail if the fixture cannot scroll at all.
//      On a short block `scrollHeight <= clientHeight` and "scrollTop === 0" passes
//      trivially.
//
// Contract DOM this seam owns:
//   #tutorial-screen · #tutorial-content · `#tutorial-content button` ·
//   `#tutorial-content rich-text-viewer` · `#tutorial-content .katex .sqrt`
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useReaderCursor } from '../state/ReaderCursorProvider';
import { BlockRenderer } from './BlockRenderer';
import { TheoryToc } from './TheoryToc';
import { ExercisePanel } from '../exercises/ExercisePanel';
import { exerciseSpec } from '../exercises/exerciseSpec';
import type { SubBlock } from '../data/types';
import type { StudyActions } from '../shell/useStudyActions';
import { AI_ONLY_ON_LIBRARY_BOOKS } from '../shell/useStudyActions';

export interface ReaderScreenProps {
  /** Drives the B7 scroll reset. See the header — this is NOT decoration. */
  isVisible: boolean;
  /** Phase 04: the assessment + AI quiz actions (shell/useStudyActions). */
  actions: StudyActions;
}

/** isWideViewport (app.js:259) — the contents panel is a column at lg+, a drawer below. */
const WIDE_VIEWPORT = '(min-width: 1024px)';
function isWideViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(WIDE_VIEWPORT).matches;
}

export function ReaderScreen({ isVisible, actions }: ReaderScreenProps) {
  const { chapters, blocksOf, assetBase, quizBank } = useBookContext();
  const { isBlockComplete } = useProgressContext();
  // ⚠ COLLISION REPAIR (slice A3, 22-09-26). Slices A2 and A3 both edited this file in
  //   the same window. A2 lifted the cursor into state/ReaderCursorProvider (a 5th
  //   context, because CodeCellsBlock and AppShell also need it) and rewired the import
  //   here; A3 had already replaced this call with a 3-argument useHashCursor. The two
  //   writes interleaved and left a file importing useReaderCursor while still CALLING
  //   useHashCursor — it did not compile.
  //   Resolved in A2's favour, on the merits: routing/useHashCursor.ts stays the hash
  //   mechanism (A3's seam, unchanged), and the provider is the right owner of a cursor
  //   two sibling screens share. A3's B15 work moved into useHashCursor.ts, where it
  //   belongs. Recorded, not silently merged — see the slice-A3 report.
  //   ⛑ CLOSED BY SLICE A4/B, 22-09-26 — AND THE PREVIOUS RESOLUTION NOTE WAS WRONG.
  //   A3's report said A2 "backed the provider out". On disk it did not:
  //   state/ReaderCursorProvider.tsx exists and shell/AppShell.tsx mounts it and calls its
  //   enterReader(). A3 then repaired THIS file back to a direct useHashCursor() call — so
  //   the app shipped **TWO CURSOR INSTANCES**, and that is not a tidiness problem:
  //     · #read-tutorial-btn (LEARN) moved the PROVIDER's cursor;
  //     · this screen rendered a DIFFERENT cursor that never heard about it, because
  //       writeCursorHash uses replaceState and replaceState emits NO `hashchange`;
  //     · so LEARN did not stamp the hash the reader was showing — B15's overwrite half
  //       was dead, and b15probe.mjs would have read a different hash than :8791.
  //   That is exactly blocker A2-R3. The fix is the one line ReaderCursorProvider's own
  //   header asks for, and it is now applied. ⛔ ONE cursor. Do not reintroduce a local
  //   useHashCursor() here for any reason.
  const { cursor, select, previous, next } = useReaderCursor();
  // ⛔ `previous`/`next` come from the provider and are CROSS-CHAPTER (state/theoryNav).
  //    A1's same-chapter approximation disabled Next on the last block of EVERY chapter and
  //    stranded the reader 18 times in Géron; `null` here means the true end of the BOOK.
  // ⚠ HTMLElement, not HTMLDivElement — the scroll container is an <article> (B3 markup).
  const articleRef = useRef<HTMLElement | null>(null);

  // ⛔ B7. Keyed on [cursor, isVisible]; writes only when visible.
  useLayoutEffect(() => {
    if (!isVisible) return;
    const element = articleRef.current;
    if (element) element.scrollTop = 0;
  }, [cursor, isVisible]);

  // tocOpen / setTocOpen / syncTocToViewport (app.js:257-275): open by default where there
  // is room for it, closed where there is not; re-synced when the viewport crosses lg.
  const [tocOpen, setTocOpen] = useState<boolean>(isWideViewport);
  useEffect(() => {
    const query = window.matchMedia(WIDE_VIEWPORT);
    const sync = () => setTocOpen(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!tocOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isWideViewport()) setTocOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tocOpen]);

  const chapter = chapters[cursor.chapterIndex];
  const blocks = blocksOf(cursor.chapterIndex);
  const block = blocks[cursor.blockIndex];
  const theme = chapter?.themeColor ?? 'brand-600';
  const done = isBlockComplete(cursor.chapterIndex, cursor.blockIndex);
  const exercises = block ? exerciseSpec(block) : null;
  const subBlocks: SubBlock[] = Array.isArray(block?.blocks) ? (block.blocks as SubBlock[]) : [];
  const blockId = `ch${String(cursor.chapterIndex + 1).padStart(2, '0')}-b${String(cursor.blockIndex + 1).padStart(2, '0')}`;

  // renderTheoryBlock clears #ai-block-status on every block change (app.js:2297).
  const { setAiBlockStatus } = actions;
  useEffect(() => {
    setAiBlockStatus('');
  }, [cursor.chapterIndex, cursor.blockIndex, setAiBlockStatus]);

  // renderBlockQuizButton (app.js:2300) — the button names how many questions this block has.
  const written = quizBankFor(blockId);
  let quizLabel: string;
  let quizTitle: string;
  let quizDisabled = false;
  if (exercises) {
    // On the exercise lesson the exercises on the page ARE the assessment (user, 19-09-26).
    quizLabel = done ? '✓ Exercises complete' : 'Answer the exercises above';
    quizTitle = done
      ? 'Already completed. You can still redo the exercises above.'
      : 'This block is completed by answering the exercises on this page, not by a separate quiz.';
    quizDisabled = true;
  } else if (written > 0) {
    quizLabel = `${done ? 'Retake' : 'Begin Assessment'} · ${written} question${written === 1 ? '' : 's'}`;
    quizTitle = done ? 'Already completed. Retaking cannot un-complete it.' : 'Assess only the block you are reading — 100% marks it complete';
  } else {
    quizLabel = `${done ? 'Retake' : 'Begin Assessment'} · AI-written`;
    quizTitle = 'This block has no written questions; the connected model writes them';
  }

  // syncAiQuizButton (app.js:3359) — recomputed from whatever is true NOW.
  const aiTitle = actions.providerStatusUnknown
    ? 'Provider status unavailable; the book quizzes still work'
    : actions.aiReady
      ? `Generate questions with ${actions.providerModel || 'the connected model'}`
      : actions.providerReady
        ? AI_ONLY_ON_LIBRARY_BOOKS
        : 'Unavailable until an operator configures a provider on the server';

  return (
    <>
      {/* Mobile drawer backdrop; lg:hidden keeps it out of the desktop layout entirely. */}
      <div
        id="toc-backdrop"
        className={`${tocOpen ? '' : 'hidden-view '}fixed inset-0 z-40 bg-black/60 lg:hidden`}
        onClick={() => setTocOpen(false)}
      />

      <TheoryToc
        cursor={cursor}
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        onSelect={(next) => {
          select(next);
          if (!isWideViewport()) setTocOpen(false);
        }}
      />

      {/*
        ⛔ THIS is the scroll container, not the window — that is what `body.reader-mode`'s
           100dvh cap exists to arrange, and it is what B7's `el.scrollTop = 0` writes to.
      */}
      <article
        id="tutorial-article"
        ref={articleRef}
        className="min-w-0 flex-1 min-h-0 overflow-y-auto flex flex-col bg-gray-800 border border-gray-700 rounded-xl"
      >
        <div className="flex-1 w-full p-6 sm:p-8 lg:p-10">
          <div className="flex items-center gap-3 mb-4">
            <button
              id="toc-toggle-btn"
              type="button"
              onClick={() => setTocOpen((open) => !open)}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-brand-600 transition-colors active:scale-95 flex items-center justify-center shrink-0"
              aria-controls="toc-panel"
              aria-expanded={tocOpen ? 'true' : 'false'}
              aria-label="Contents"
              title="Contents"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

          {/*
            ⚑ PHASE 04 PARITY: these two do NOT exist in the legacy markup (index.html:333-341)
              — renderTheoryBlock writes to them through `if (dom.x)` guards that find nothing.
              The port rendered them VISIBLY above every title. Kept in the DOM (an earlier gate
              may read them) but hidden, which is what the reader sees on :8767.
          */}
          <p id="theory-chapter-label" className="hidden-view">{chapter?.title ?? ''}</p>
          <p id="theory-block-position" className={done ? 'hidden-view text-green-400' : 'hidden-view'}>
            {blocks.length ? `Block ${cursor.blockIndex + 1} of ${blocks.length}${done ? ' · ✓ completed' : ''}` : ''}
          </p>

          {/* ⛔ <h2>, not <h1> — index.html:342. */}
          <h2 id="tutorial-main-title" className="text-[1.875rem] sm:text-4xl text-white font-light mb-8">
            {block?.term ?? `Theory block ${cursor.blockIndex + 1}`}
          </h2>

          {/* ⛔ `prose` IS LOAD-BEARING — see app.css `#tutorial-content.prose`. */}
          <div id="tutorial-content" className="text-gray-300 prose prose-invert max-w-none">
            {exercises ? (
              <>
                <BlockRenderer blocks={exercises.intro} theme={theme} assetBase={assetBase} />
                <ExercisePanel spec={exercises} blockId={blockId} recordProgress={actions.recordProgress} />
              </>
            ) : (
              <BlockRenderer blocks={subBlocks} theme={theme} assetBase={assetBase} />
            )}
          </div>

          {/* One row, one button size (user, 21-09-26) — index.html:348-357, verbatim. */}
          <div className="mt-10 pt-6 border-t border-gray-700 flex flex-wrap items-center gap-3">
            <button
              id="prev-block-btn"
              type="button"
              disabled={!previous}
              onClick={() => previous && select(previous)}
              className="min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-200 font-semibold uppercase tracking-wider text-sm transition-colors hover:bg-gray-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              id="tutorial-to-quiz-btn"
              type="button"
              disabled={quizDisabled}
              title={quizTitle}
              onClick={actions.beginBlockAssessment}
              className={`min-h-[44px] px-5 rounded-lg border border-brand-600 text-brand-400 hover:bg-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95${quizDisabled ? ' opacity-50 cursor-not-allowed' : ''}`}
            >
              <span id="tutorial-to-quiz-label">{quizLabel}</span>
            </button>
            <button
              id="block-ai-quiz-btn"
              type="button"
              disabled={!actions.aiReady || actions.aiBusy}
              title={aiTitle}
              onClick={() => void actions.startBlockAiQuiz()}
              className="min-h-[44px] px-5 rounded-lg border border-gray-600 text-gray-300 hover:border-brand-600 hover:text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              AI quiz
            </button>
            <button
              id="next-block-btn"
              type="button"
              disabled={!next}
              onClick={() => next && select(next)}
              className="min-h-[44px] px-5 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-semibold uppercase tracking-wider text-sm transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
            >
              Next
            </button>
          </div>
          <p id="ai-block-status" className="mt-3 text-xs text-gray-500" role="status">
            {actions.aiBlockStatus}
          </p>
        </div>
      </article>
    </>
  );

  function quizBankFor(id: string): number {
    return quizBank.filter((q) => q?.source?.block === id).length;
  }
}
