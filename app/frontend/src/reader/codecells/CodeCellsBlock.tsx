// Seam 17 (reader/codecells), part 1 — THE code_cells SUB-BLOCK. Ruling R24: static listings.
//
// ⛔ Honours R6 ordering like every other sub-block: it renders where BlockRenderer puts it, in
//    document order, with no grouping.
// ⛔ The number on each card is CHAPTER-scoped (BookProvider.chapterBlocksForLesson), the same
//    number the book's walkthrough uses.
import { useMemo } from 'react';
import type { SubBlock } from '../../data/types';
import { useBookContext } from '../../state/BookProvider';
import { cellOrdinal, lessonCodeCells } from './useCellState';
import { CodeCell } from './CodeCell';

export function CodeCellsBlock({ block }: { block: SubBlock }) {
  const cells = Array.isArray(block.cells) ? block.cells : [];
  const lesson = block.lesson ?? '';
  const { chapterBlocksForLesson } = useBookContext();
  const chapterCells = useMemo(
    () => lessonCodeCells(chapterBlocksForLesson(lesson), lesson),
    [chapterBlocksForLesson, lesson],
  );
  return (
    <div className="not-prose my-6 space-y-4">
      {cells
        .filter((cell) => cell && typeof cell.id === 'string' && typeof cell.source === 'string')
        .map((cell, index) => (
          <CodeCell key={cell.id} cell={cell} number={cellOrdinal(cell, chapterCells) ?? index + 1} />
        ))}
    </div>
  );
}
