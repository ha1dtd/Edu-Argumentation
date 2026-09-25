import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MAX_CODE_BYTES, byteLength } from '../api';

// A plain monospace <textarea> — no editor dependency (plan F4). Tab inserts four spaces.
// ⚑ 25-09-26 (user): exactly four buttons — Run, Stop, Reset, Copy. Reset = start over: original
//   code AND a fresh kernel (the old separate "Reset to original" + "Reset kernel" pair, merged).
const BTN =
  'min-h-[36px] px-3 rounded-lg border text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed';

export function CodeEditor(props: {
  code: string;
  edited: boolean;
  running: boolean;
  onChange: (code: string) => void;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const size = byteLength(props.code);
  // Long lines never wrap; when some line is wider than the box, a fade on the right edge says
  // "there is more — scroll sideways" (a headless or overlay scrollbar alone is easy to miss).
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  const measure = () => {
    const area = areaRef.current;
    if (area) setMoreRight(area.scrollWidth - area.clientWidth - area.scrollLeft > 2);
  };
  useEffect(() => {
    measure();
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [props.code]);
  const tooBig = size > MAX_CODE_BYTES;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!props.running && !tooBig) props.onRun();
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const area = event.currentTarget;
    const { selectionStart, selectionEnd, value } = area;
    const next = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
    props.onChange(next);
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = selectionStart + 4;
    });
  };

  return (
    // ⚑ 25-09-26 (user): the code panel is a CARD like the result panel, with its buttons in the card's
    //   header row — so side by side the two cards are exactly the same height.
    <div id="lab-code" className="flex flex-col h-full min-h-0 rounded-xl bg-gray-800 border border-gray-700 overflow-hidden">
      {/* ⚑ 25-09-26 (user): header keeps its padding; the editor below fills the card edge to edge. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-700">
        <h3 className="mr-auto text-xs font-semibold uppercase tracking-wider text-gray-400">Code</h3>
        <button
          id="lab-run-btn"
          type="button"
          onClick={props.onRun}
          disabled={props.running || tooBig}
          className={`${BTN} border-brand-600 bg-brand-600 text-white hover:bg-brand-500`}
        >
          Run
        </button>
        <button id="lab-stop-btn" type="button" onClick={props.onStop} disabled={!props.running} className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}>
          Stop
        </button>
        <button
          id="lab-reset-btn"
          type="button"
          onClick={props.onReset}
          disabled={props.running}
          title="Start over: the lesson's original code, a fresh Python session, an empty result"
          className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}
        >
          Reset
        </button>
        <button id="lab-copy-btn" type="button" onClick={props.onCopy} className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}>
          {props.copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="relative flex-1 min-h-[12rem] bg-gray-950">
        <textarea
          id="lab-editor"
          ref={areaRef}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={props.code}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={measure}
          aria-label="Lesson code"
          className="absolute inset-0 w-full h-full resize-none bg-gray-950 border-0 text-gray-100 p-4 font-mono text-sm leading-6 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-600"
        />
        {moreRight ? (
          <div
            id="lab-editor-more"
            aria-hidden="true"
            className="pointer-events-none absolute top-px bottom-3 right-3 w-10 bg-gradient-to-l from-gray-950 to-transparent flex items-center justify-end pr-1 text-gray-400"
          >
            <span className="text-lg leading-none">›</span>
          </div>
        ) : null}
      </div>
      {tooBig ? (
        <p id="lab-too-big" className="px-4 py-2 text-sm text-red-400 border-t border-gray-700">
          This code is {Math.ceil(size / 1024)} KB. The shared runner takes at most 64 KB per run.
        </p>
      ) : null}
    </div>
  );
}
