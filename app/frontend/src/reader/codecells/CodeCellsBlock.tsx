// Seam 17 (reader/codecells), part 1 — THE code_cells SUB-BLOCK.
//
// ⛔ Honours R6 ordering like every other sub-block: it renders where BlockRenderer puts
//    it, in document order, with no grouping.
//
// ⛔⛔ CELL NUMBERING IS CHAPTER-SCOPED (F7b(i)), AND ⚑ A2 WIRED IT. The number on a card
//     is its position in lessonCodeCells(chapterBlocks, lesson) — NOT its index in
//     block.cells. A long walkthrough is split across several lessons that share one
//     kernel via the parent `lesson` id; scope the scan to the visible block and
//     ch01-b08d's predict cell runs in a page that never executed ch01-b08c's fit —
//     `NameError: model`, at RUN time in Phase 04, not a cosmetic off-by-one here.
//
// ⛔ The chapter's blocks come from BookProvider.chapterBlocksForLesson(lesson) — the
//    chapter that OWNS this lesson id, found by scanning, never this block. Two reasons it
//    is not the reader's cursor: the cursor belongs to routing/useHashCursor (slice A3's,
//    in flight), and a lesson's own id is a stabler key than wherever the reader happens to
//    be standing. No prop is threaded through BlockRenderer either — that would put a
//    numbering concern in a renderer whose whole contract (R6) is "map blocks[], nothing else".
import { useMemo, useState } from 'react';
import type { SubBlock } from '../../data/types';
import { useBookContext } from '../../state/BookProvider';
import { cellOrdinal, lessonCodeCells } from './useCellState';
import { CodeCell } from './CodeCell';

export function CodeCellsBlock({ block }: { block: SubBlock }) {
  const cells = Array.isArray(block.cells) ? block.cells : [];
  const lesson = block.lesson ?? '';
  const [edits, setEdits] = useState<Record<string, string>>({});
  const { chapterBlocksForLesson } = useBookContext();

  /**
   * The CHAPTER's cells for this lesson, in page order — ⛔ F7b, BOTH halves come from
   * this one list and that is deliberate:
   *   (i)  the 1-based position in it IS the displayed cell number (chapter-scoped);
   *   (ii) it IS the run order Phase 04 slices with cellsUpTo() (page order).
   * Deriving them from two different lists is how they drift apart.
   */
  const chapterCells = useMemo(
    () => lessonCodeCells(chapterBlocksForLesson(lesson), lesson),
    [chapterBlocksForLesson, lesson],
  );

  return (
    <div className="not-prose my-6 space-y-4">
      {cells
        .filter((cell) => cell && typeof cell.id === 'string' && typeof cell.source === 'string')
        .map((cell, index) => (
          <CodeCell
            key={cell.id}
            cell={cell}
            lesson={lesson}
            // ⛔ R7 `ordinal` when the data carries one, else the measured CHAPTER-scoped
            //    position. The block-local `index` is the last resort only — a cell that
            //    somehow escapes the chapter scan still gets a number rather than NaN.
            number={cellOrdinal(cell, chapterCells) ?? index + 1}
            source={edits[cell.id] ?? cell.source}
            original={cell.source}
            onSourceChange={(source) => setEdits((all) => ({ ...all, [cell.id]: source }))}
            onReset={() =>
              setEdits((all) => {
                const next = { ...all };
                delete next[cell.id];
                return next;
              })
            }
          />
        ))}
    </div>
  );
}
