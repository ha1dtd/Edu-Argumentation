// Seam 17 (reader/codecells) — CELL STATE. ⛔ RULING R7: RENDER ONLY IN PHASE 03.
//     process/features/ml/active/edu-replatform_21-09-26/RULING-R7-runnable-python_21-09-26.md
//
// ⛔ PHASE 03 RENDERS CELLS. IT DOES NOT EXECUTE THEM. The run path (/api/run,
//    /api/run/stop, /api/run/reset-kernel proxied to the runner on .68:8790) is PHASE 04.
//    `Run` renders DISABLED here. Do not wire a fetch from this seam.
//
// ⛔⛔ TWO BEHAVIOURS ARE EASY TO LOSE IN A COMPONENT SPLIT, AND BOTH BREAK REAL CELLS
//     (F7b):
//   (i)  CELL NUMBERING IS **CHAPTER-SCOPED**, NOT BLOCK-SCOPED. `lessonCodeCells`
//        scans EVERY item in the chapter, because a long walkthrough is split across
//        several lessons that still share one kernel via the parent `lesson` id. Scope
//        the scan to the visible block and ch01-b08d's predict cell runs in a page that
//        never executed ch01-b08c's fit — `NameError: model`.
//   (ii) RUN ORDER IS **DERIVED FROM PAGE ORDER**. `runCell` sends cells.slice(0, upTo+1).
//        The ordering contract is explicit in the data and enforced in the UI; it is
//        never left to the reader.
//
// ⛔ `codeCellViews` IS DELETED, NOT PORTED (A2d). It was a Map of DOM handles — a cache
//    React does not need and must not grow back.
//    `codeCellState` and `lessonRuns` DO port: edited source and run status survive
//    leaving a lesson and coming back, and nothing is saved on the server.
import { useCallback, useRef } from 'react';
import type { CodeCell, SubBlock, TheoryBlock } from '../../data/types';

export type CellTone = 'muted' | 'ok' | 'error';

export interface CellRuntimeState {
  original: string;
  source: string;
  outputs: unknown[];
  status: string;
  tone: CellTone;
  started: number;
}

/** `${moduleId}|${lesson}|${cellId}` — module-scoped, or two books share state. */
export function cellKey(moduleId: string, lesson: string, cellId: string): string {
  return `${moduleId}|${lesson}|${cellId}`;
}

/**
 * lessonCodeCells — ⛔ scans the WHOLE CHAPTER. See (i) in the header.
 * Returns the chapter's cells for one `lesson`, in page order. The 1-based position in
 * this array IS the cell number shown in the UI and IS `ordinal` (R7).
 */
export function lessonCodeCells(chapterBlocks: TheoryBlock[], lesson: string): CodeCell[] {
  return chapterBlocks
    .flatMap((item) => (item && Array.isArray(item.blocks) ? item.blocks : []))
    .filter(
      (sub: SubBlock) =>
        sub && sub.type === 'code_cells' && sub.lesson === lesson && Array.isArray(sub.cells),
    )
    .flatMap((sub: SubBlock) => sub.cells ?? [])
    .filter((cell) => cell && typeof cell.id === 'string' && typeof cell.source === 'string');
}

/** R7: every consumer reads the language through here, never off the raw field. */
export function cellLanguage(cell: CodeCell): string {
  return cell.language ?? 'python';
}

/**
 * cellsUpTo — ⛔ F7b(ii). RUN ORDER IS DERIVED FROM PAGE ORDER, and it is a pure slice.
 *
 * ⚑ WHY THIS EXISTS IN A PHASE THAT DOES NOT RUN ANYTHING. The legacy `runCell` sends
 *   `cells.slice(0, upTo + 1)` — every cell up to and including the one clicked, in page
 *   order — because the cells in a lesson SHARE A KERNEL and are meaningless out of
 *   sequence: `housing.hist()` needs the earlier `housing = load_housing_data()` to have
 *   run (ruling R7, constraint 2). That contract is one line of code and very easy to lose
 *   in a component split, where "run this cell" reads like an obviously-correct thing for a
 *   Run button to do. Phase 04 wires the fetch; if it has to REDISCOVER the slicing rule at
 *   that point, it will discover it as a `NameError` from a real kernel instead.
 *
 * ⛔ THIS IS NOT AN EXECUTION PATH AND MUST NOT BECOME ONE HERE. It takes a list and
 *    returns a shorter list. No fetch, no session, no side effect — Phase 03's bundle must
 *    contain ZERO non-GET call sites, and that is asserted against the built bundle.
 *
 * ⚠ `upTo` is an INDEX into `ordered`, not a 1-based cell number. The UI shows 1-based
 *   numbers (and R7's `ordinal` is 1-based), so passing the displayed number here runs one
 *   cell too many — off by one in the direction that silently succeeds.
 */
export function cellsUpTo(ordered: CodeCell[], upTo: number): CodeCell[] {
  if (!Number.isInteger(upTo) || upTo < 0) return [];
  return ordered.slice(0, upTo + 1);
}

/**
 * cellOrdinal — the 1-based CHAPTER-scoped position, R7's `ordinal` when the data has one.
 * ⛔ F7b(i): the fallback scans the CHAPTER (`lessonCodeCells`), never the visible block.
 *    Scope it to the block and ch01-b08d's `predict` cell is numbered as if ch01-b08c's
 *    `fit` had never happened — which is exactly the state its kernel would be in.
 */
export function cellOrdinal(cell: CodeCell, ordered: CodeCell[]): number | null {
  if (typeof cell.ordinal === 'number') return cell.ordinal;
  const at = ordered.findIndex((entry) => entry.id === cell.id);
  return at < 0 ? null : at + 1;
}

export function useCellState(moduleId: string) {
  const store = useRef(new Map<string, CellRuntimeState>());
  /** `${moduleId}|${lesson}` -> running cell id. Ports; Phase 04 uses it. */
  const lessonRuns = useRef(new Map<string, string>());

  const cellState = useCallback(
    (lesson: string, cell: CodeCell): CellRuntimeState => {
      const key = cellKey(moduleId, lesson, cell.id);
      const existing = store.current.get(key);
      if (existing) return existing;
      const fresh: CellRuntimeState = {
        original: cell.source,
        source: cell.source,
        outputs: [],
        status: '',
        tone: 'muted',
        started: 0,
      };
      store.current.set(key, fresh);
      return fresh;
    },
    [moduleId],
  );

  return { cellState, lessonRuns };
}
