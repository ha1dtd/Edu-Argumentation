// Seam 17 (reader/codecells), part 2 — ONE CELL CARD.
//
// Split out of renderCodeCells (118 lines — one of the six spanning functions). The card
// is its own seam because renderCodeCells was doing three unrelated jobs at once:
// building markup, wiring six listeners, and caching DOM handles. Only the first is a
// component.
//
// ⛔ R7: RENDER ONLY. `Run` is DISABLED in Phase 03. The Edit/Reset affordances are
//    local-only and touch nothing but in-memory state.
//
// Keyboard contract, ported verbatim — it is an accessibility obligation, not a nicety:
//   · Tab inserts four spaces (and does NOT move focus) while editing;
//   · Escape leaves the editor and returns focus to the Edit button;
//   · the hint is announced via aria-describedby, id `cell-hint-<lesson>-<cellId>`;
//   · every control carries a numbered aria-label ("Edit cell 3"), because "Edit" alone
//     is ambiguous when a lesson has eleven cells.
import { useRef, useState } from 'react';
import type { CodeCell as CodeCellData } from '../../data/types';
import { cellLanguage } from './useCellState';

export interface CodeCellProps {
  cell: CodeCellData;
  lesson: string;
  /** 1-based position in the CHAPTER's cell sequence. See useCellState (i). */
  number: number;
  source: string;
  original: string;
  onSourceChange: (source: string) => void;
  onReset: () => void;
}

export function CodeCell(props: CodeCellProps) {
  const { cell, lesson, number, source, original, onSourceChange, onReset } = props;
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement | null>(null);
  const hintId = `cell-hint-${lesson}-${cell.id}`;
  const edited = source !== original;

  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60"
      aria-label={`Code cell ${number}`}
      data-cell={cell.id}
      data-language={cellLanguage(cell)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-700 px-3 py-1">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {`Cell ${number}`}
          <span className={edited ? undefined : 'hidden-view'}>edited</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            ref={editRef}
            type="button"
            aria-label={editing ? `Done editing cell ${number}` : `Edit cell ${number}`}
            onClick={() => setEditing((on) => !on)}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
          <button type="button" aria-label={`Reset cell ${number}`} onClick={onReset}>
            Reset
          </button>
          {/* ⛔ R7 / Phase 03: DISABLED. The runner is Phase 04. */}
          <button type="button" disabled aria-label={`Run cell ${number} (available in a later phase)`}>
            Run
          </button>
        </div>
      </div>

      <pre
        className={`m-0 overflow-x-auto whitespace-pre bg-transparent p-4 font-mono text-sm leading-6 text-gray-100${editing ? ' hidden-view' : ''}`}
      >
        <code>{source}</code>
      </pre>

      <textarea
        className={`block w-full resize-y whitespace-pre border-0 bg-gray-900 p-4 font-mono text-sm leading-6 text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600${editing ? '' : ' hidden-view'}`}
        spellCheck={false}
        wrap="off"
        autoCapitalize="off"
        autoComplete="off"
        aria-label={`Cell ${number} code`}
        aria-describedby={hintId}
        value={source}
        onChange={(event) => onSourceChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            const field = event.currentTarget;
            const { selectionStart, selectionEnd } = field;
            onSourceChange(`${source.slice(0, selectionStart)}    ${source.slice(selectionEnd)}`);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
            editRef.current?.focus();
          }
        }}
      />

      <span className="sr-only" id={hintId}>
        Tab inserts spaces. Escape leaves the editor.
      </span>

      {/* A4/Phase 04 OWN the output panel: status (role="status", aria-atomic) + items,
          rendered through sanitizeTable for HTML output. Hidden until a run exists. */}
      <div className="hidden-view space-y-3 border-t border-gray-700 px-4 py-3" data-stub="P4: cell outputs" />
    </section>
  );
}
