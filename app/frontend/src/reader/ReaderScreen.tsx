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
import { useLayoutEffect, useRef } from 'react';
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { useReaderCursor } from '../state/ReaderCursorProvider';
import { BlockRenderer } from './BlockRenderer';
import { TheoryToc } from './TheoryToc';
import { ExercisePanel } from '../exercises/ExercisePanel';
import { exerciseSpec } from '../exercises/exerciseSpec';
import type { SubBlock } from '../data/types';

export interface ReaderScreenProps {
  /** Drives the B7 scroll reset. See the header — this is NOT decoration. */
  isVisible: boolean;
}

export function ReaderScreen({ isVisible }: ReaderScreenProps) {
  const { chapters, blocksOf, assetBase } = useBookContext();
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

  const chapter = chapters[cursor.chapterIndex];
  const blocks = blocksOf(cursor.chapterIndex);
  const block = blocks[cursor.blockIndex];
  const theme = chapter?.themeColor ?? 'brand-600';
  const done = isBlockComplete(cursor.chapterIndex, cursor.blockIndex);
  const exercises = block ? exerciseSpec(block) : null;
  const subBlocks: SubBlock[] = Array.isArray(block?.blocks) ? (block.blocks as SubBlock[]) : [];

  return (
    // ⛔ B3 — THE READER IS TWO PANES, EACH SCROLLING ON ITS OWN, and the chain that makes
    //    that true is `min-h-0` at EVERY level plus `overflow-y-auto` on exactly the pane
    //    that should scroll. Ported from index.html:314-334 class-for-class.
    //    ⚠ `min-h-0` reads like noise and is the whole mechanism: a flex child defaults to
    //      `min-height:auto`, which means "never shrink below my content", so the pane grows
    //      to 3367px and the PAGE scrolls instead. Removing one `min-h-0` anywhere in the
    //      chain breaks scrolling while the layout still LOOKS correct.
    //    ⚠ #tutorial-screen's own half of the chain (`flex-1 min-h-0 flex flex-col
    //      lg:flex-row gap-2`) is on the <Screen> element in shell/AppShell.tsx, because
    //      that is the element carrying the id.
    <>
      {/* Mobile drawer backdrop; lg:hidden keeps it out of the desktop layout entirely. */}
      <div id="toc-backdrop" className="hidden-view fixed inset-0 z-40 bg-black/60 lg:hidden" />

      <TheoryToc cursor={cursor} onSelect={select} />

      {/*
        ⛔ THIS is the scroll container, not the window — that is what `body.reader-mode`'s
           100dvh cap exists to arrange, and it is what B7's `el.scrollTop = 0` writes to.
        ⛔ B7b's gate must FIRST assert `scrollHeight > clientHeight + 200` on THIS element
           and fail if it cannot scroll at all. On a short block `scrollHeight <=
           clientHeight`, so "scrollTop === 0" is true of a pane that never scrolled and the
           gate proves nothing.
      */}
      <article
        id="tutorial-article"
        ref={articleRef}
        className="min-w-0 flex-1 min-h-0 overflow-y-auto flex flex-col bg-gray-800 border border-gray-700 rounded-xl"
      >
        <div className="flex-1 w-full p-6 sm:p-8 lg:p-10">
        <p id="theory-chapter-label">{chapter?.title ?? ''}</p>
        <p id="theory-block-position" className={done ? 'text-green-400' : undefined}>
          {blocks.length
            ? `Block ${cursor.blockIndex + 1} of ${blocks.length}${done ? ' · ✓ completed' : ''}`
            : ''}
        </p>
        {/* ⛔ <h2>, not <h1> — index.html:342. The contract pins the ID, but the page
            already has an <h1> in the header and two would be an a11y regression the
            selector sweep cannot see. */}
        <h2 id="tutorial-main-title" className="text-[1.875rem] sm:text-4xl text-white font-light mb-8">
          {block?.term ?? `Theory block ${cursor.blockIndex + 1}`}
        </h2>

        {/* ⛔ `prose` IS LOAD-BEARING TWICE OVER: it is what the pinned Tailwind CDN URL's
            `?plugins=typography` query provides, and src/styles/app.css's
            `#tutorial-content.prose :where(p, ul, ol, li, blockquote)` rule only matches
            WITH it — that rule is what stops Tailwind's own 1rem overriding the reading
            scale. `max-w-none` removes prose's 65ch measure cap (user, 21-09-26: "the text
            have to fill the remaining space"). */}
        <div id="tutorial-content" className="text-gray-300 prose prose-invert max-w-none">
          {/*
            The exercise lesson renders as a FORM, not as a bulleted list: the book's own
            exercises ARE this block's assessment (19-09-26). Anything else in the lesson
            still renders ABOVE it — note `exercises.intro` goes through the same
            BlockRenderer, so R6 ordering holds inside an exercise lesson too.
          */}
          {exercises ? (
            <>
              <BlockRenderer blocks={exercises.intro} theme={theme} assetBase={assetBase} />
              <ExercisePanel spec={exercises} />
            </>
          ) : (
            <BlockRenderer blocks={subBlocks} theme={theme} assetBase={assetBase} />
          )}
        </div>

        {/*
          ⛑ WIRED BY SLICE A3 (the collision A2's comment below describes is settled).
             previousTheory/nextTheory walk ACROSS chapters and skip empty ones, so `null`
             means the true end of the BOOK — not the end of a chapter. A1's same-chapter
             approximation stranded the reader at every chapter boundary (18 times in
             Géron); that is gone.
        */}
        <button
          id="prev-block-btn"
          type="button"
          disabled={!previous}
          onClick={() => previous && select(previous)}
        >
          Previous
        </button>
        <button
          id="next-block-btn"
          type="button"
          disabled={!next}
          onClick={() => next && select(next)}
        >
          Next
        </button>
        {/*
          ⛑ THE STALE NOTE THAT SAT HERE IS DELETED, NOT EDITED. It said the cross-chapter
            walk was "NOT wired" and told the next owner to import theoryNav directly. Both
            halves were false by the time anyone read it: A3 wired the walk, and the walk now
            arrives through useReaderCursor() so that there is exactly ONE cursor (see the
            ⛑ block at the top of this file). A comment that describes a previous state as
            if it were the current one is worse than no comment — it sends the next agent to
            re-do work that is done, in a way that would reintroduce the two-cursor bug.
        */}
        <p id="ai-block-status" />
        <button id="block-ai-quiz-btn" type="button" disabled>
          {/* renderBlockQuizButton() names how many questions this block actually has, so
              you never start an assessment without knowing its size. It stays DISABLED in
              Phase 03: generating a quiz is a model call, i.e. a POST, and this phase's
              bundle must contain ZERO non-GET call sites. Wiring it is Phase 04. */}
          {block?.questions?.length ? `Quiz me on this block (${block.questions.length})` : 'Quiz me on this block'}
        </button>
        </div>
      </article>
    </>
  );
}
