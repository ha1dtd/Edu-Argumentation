// Seam 17 (reader/codecells), part 2 — ONE CODE LISTING. Ruling R24: static, with a Copy button.
//
// ⚑ R24 (23-09-26) removed Edit / Reset / Run, the kernel status line, the output panel and the
//   "Run disabled" badge (R13 is superseded — nothing runs, so nothing is disabled).
// ⛔ PARITY: element for element the legacy's NEW renderCodeCells (aws-quiz-app/js/app.js, R24
//    carve-out) — the same card, header, class strings, copy icon, `data-copy` / `data-copy-label` /
//    `data-copy-state` hooks and `aria-label="Copy cell N"`. The label says "Copied" (or "Copy
//    failed") for 1.5 s; the ICON does not change — the legacy's does not.
import { useEffect, useRef, useState } from 'react';
import type { CodeCell as CodeCellData } from '../../data/types';
import { copyText } from './useCellState';

const COPY_BUTTON_CLASS =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 text-gray-300 hover:bg-gray-700 hover:text-white';

export interface CodeCellProps {
  cell: CodeCellData;
  /** 1-based position in the CHAPTER's cell sequence. */
  number: number;
}

export function CodeCell({ cell, number }: CodeCellProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    const ok = await copyText(cell.source);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1500);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60" aria-label={`Code cell ${number}`} data-cell={cell.id}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-700 px-3 py-1">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{`Cell ${number}`}</div>
        <button
          type="button"
          className={COPY_BUTTON_CLASS}
          data-copy=""
          data-copy-state={state === 'idle' ? undefined : state}
          aria-label={`Copy cell ${number}`}
          onClick={() => void copy()}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span data-copy-label="">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
        </button>
      </div>
      <pre className="m-0 overflow-x-auto whitespace-pre bg-transparent p-4 font-mono text-sm leading-6 text-gray-100">
        <code>{cell.source}</code>
      </pre>
    </section>
  );
}
