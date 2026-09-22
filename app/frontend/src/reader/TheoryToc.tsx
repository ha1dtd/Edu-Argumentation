// Seam 14 (reader/TheoryToc) — THE CHAPTER / BLOCK TABLE OF CONTENTS.
//
// Split out of renderTheoryToc (84 lines — one of the six spanning functions). It is its
// own seam because it is the only consumer of chapterProgress()/overallProgress() and
// because it owns four contract selectors on its own.
//
// Contract DOM this seam owns:
//   #toc-nav · `#toc-nav details` · `#toc-nav summary div` · `ol li button` ·
//   `[aria-current="true"]`
//
// ⛔⛔ aria-current — THE ASYMMETRY IS DELIBERATE AND MEASURED.
//     Here it is set ONLY on the current item and OMITTED otherwise (the legacy code
//     does `if (isCurrent) button.setAttribute('aria-current','true')`). In
//     library/BookCard it is set on EVERY card as "true" or "false". Both are reproduced
//     as-is.
//     ⛔ In React, `aria-current={false}` is OMITTED FROM THE DOM ENTIRELY, so the value
//        must be the STRING "true" or `undefined` — never a boolean. Getting this wrong
//        empties `[aria-current="true"]` and reads as a broken port (A3b, fails A-G10/G3).
//
// ⚠ `<details>` / `<summary>` are the real elements, not a div-and-a-click-handler:
//    `#toc-nav details` and `#toc-nav summary div` are both pinned selectors. The current
//    chapter's <details> is OPEN.
// ⚠ The per-chapter meter is a real role="progressbar" with valuenow/min/max and a label.
// ⚠ The page range lives beside the block count here — the reader used to carry
//   "N theory blocks · pages X-Y" above every lesson, repeating a count the sidebar
//   already showed (user, 21-09-26).
import { useBookContext } from '../state/BookProvider';
import { useProgressContext } from '../state/ProgressProvider';
import type { TheoryCursor } from '../data/types';

export interface TheoryTocProps {
  cursor: TheoryCursor;
  onSelect: (next: TheoryCursor) => void;
}

export function TheoryToc({ cursor, onSelect }: TheoryTocProps) {
  const { chapters, blocksOf } = useBookContext();
  const { chapterProgress, isBlockComplete, overall } = useProgressContext();
  const summary = overall();
  const totalBlocks = chapters.reduce((sum, _chapter, index) => sum + blocksOf(index).length, 0);

  return (
    /*
      ⛔⛔ D-1's OTHER HALF — THE ToC MUST BE ITS OWN SCROLL CONTAINER. Class strings ported
          22-09-26 (EVL fix 003) VERBATIM from aws-quiz-app/index.html:320 and :330.
          Before this fix BOTH elements carried NO className. MEASURED at 1440x1000 on the
          deployed :8792:
            #toc-panel  clientHeight 4807     (it grew to 19 chapters of content)
            #toc-nav    scrollHeight 1960 === clientHeight 1960   (never a scroll container)
          So the contents list was 4807px tall inside a 1000px window that clips, i.e. the ToC
          scrolled away with — and past — the reading pane. That is exactly the read → scroll →
          lose your place loop ruling R6 exists to stop, and it is why F5 asks the user to
          confirm no scroll-away.
      ⛔ THE SPLIT IS LOAD-BEARING: the PANEL is `flex flex-col min-h-0 lg:h-full` (bounded,
         does not grow) and the NAV inside it is `flex-1 overflow-y-auto` (the thing that
         actually scrolls). Put overflow on the panel instead and the summary line scrolls
         away with the list.
      ⚠ `fixed lg:static` is the legacy's mobile drawer: below `lg` the panel is an overlay
        (paired with #toc-backdrop, already ported), at `lg`+ it is an in-flow column.
      ⚠ It stays a <div>, not the legacy's <aside>: `#toc-panel` is pinned by ID only in
        gates/selector-contract.frozen.json, and `aside` is not in the contract's tag list, so
        changing the tag buys nothing and risks a shape the contract does not describe.
    */
    <div
      id="toc-panel"
      className="fixed lg:static inset-y-0 left-0 z-50 w-80 max-w-[85vw] lg:w-72 xl:w-80 lg:max-w-none shrink-0 flex flex-col min-h-0 bg-gray-800 border border-gray-700 rounded-xl lg:h-full"
      aria-label="Table of contents"
    >
      {/* The legacy's panel head: `shrink-0`, so it never competes with the scrolling nav. */}
      <div className="px-5 py-4 border-b border-gray-700 shrink-0">
        <p className="text-white font-semibold text-sm uppercase tracking-widest">Contents</p>
        <p id="toc-summary" className="text-xs text-gray-400 mt-1">
          {`${chapters.length} chapters · ${totalBlocks} blocks · ${summary.done}/${summary.total} done (${summary.percent}%)`}
        </p>
      </div>
      <nav id="toc-nav" className="p-2 flex-1 overflow-y-auto">
        {chapters.map((chapter, chapterIndex) => {
          const blocks = blocksOf(chapterIndex);
          const done = chapterProgress(chapterIndex);
          const pages =
            chapter.pageStart && chapter.pageEnd ? ` · pages ${chapter.pageStart}-${chapter.pageEnd}` : '';
          return (
            <details key={chapterIndex} open={chapterIndex === cursor.chapterIndex} className="rounded-lg">
              <summary>
                {/* `#toc-nav summary div` — a pinned selector. Keep the wrapper. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">{chapter.title}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums">{`${done.percent}%`}</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={done.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${chapter.title} progress`}
                >
                  <div style={{ width: `${done.percent}%` }} />
                </div>
                <div>{`${done.done} of ${done.total} blocks${pages}`}</div>
              </summary>
              <ol className="mb-2 px-2 space-y-1">
                {blocks.map((block, blockIndex) => {
                  const isCurrent =
                    chapterIndex === cursor.chapterIndex && blockIndex === cursor.blockIndex;
                  const complete = isBlockComplete(chapterIndex, blockIndex);
                  return (
                    <li key={blockIndex}>
                      <button
                        type="button"
                        // ⛔ String or undefined. NEVER a boolean. See the header.
                        aria-current={isCurrent ? 'true' : undefined}
                        title={complete ? 'Completed — 100% on this block’s assessment' : undefined}
                        onClick={() => onSelect({ chapterIndex, blockIndex })}
                      >
                        {`${complete ? '✓ ' : ''}${blockIndex + 1}. ${block.term ?? 'Theory block'}`}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </details>
          );
        })}
      </nav>
      {/* A3 OWNS the narrow-viewport behaviour: #toc-toggle-btn, #toc-close-btn,
          #toc-backdrop, and closing the panel on selection below the lg breakpoint. */}
    </div>
  );
}
