import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MAX_CODE_BYTES, byteLength } from '../api';

// A plain monospace <textarea> — no editor dependency (plan F4). Tab inserts four spaces.
// ⚑ 24-09-26: compact (px-3, text-xs) so all five fit ONE row in a side-by-side column at 1440 px;
//   the row still wraps on a narrow screen. Reset kernel sits apart on the right (ml-auto).
const BTN =
  'min-h-[36px] px-3 rounded-lg border text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed';

export function CodeEditor(props: {
  code: string;
  edited: boolean;
  running: boolean;
  onChange: (code: string) => void;
  onRun: () => void;
  onStop: () => void;
  onResetCode: () => void;
  onCopy: () => void;
  onResetKernel: () => void;
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
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2">
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
        <button id="lab-reset-code-btn" type="button" onClick={props.onResetCode} disabled={!props.edited} className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}>
          Reset to original
        </button>
        <button id="lab-copy-btn" type="button" onClick={props.onCopy} className={`${BTN} border-gray-600 text-gray-200 hover:bg-gray-700`}>
          {props.copied ? 'Copied' : 'Copy'}
        </button>
        <button
          id="lab-reset-kernel-btn"
          type="button"
          onClick={props.onResetKernel}
          disabled={props.running}
          title="Forget every variable this lesson's kernel holds"
          className={`${BTN} ml-auto border-gray-600 text-gray-200 hover:bg-gray-700`}
        >
          Reset kernel
        </button>
      </div>
      <div className="relative flex-1 min-h-[12rem]">
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
          className="absolute inset-0 w-full h-full resize-none rounded-xl bg-gray-950 border border-gray-700 text-gray-100 p-4 font-mono text-sm leading-6 focus:outline-none focus:border-brand-600"
        />
        {moreRight ? (
          <div
            id="lab-editor-more"
            aria-hidden="true"
            className="pointer-events-none absolute top-px bottom-3 right-3 w-10 rounded-r-xl bg-gradient-to-l from-gray-950 to-transparent flex items-center justify-end pr-1 text-gray-400"
          >
            <span className="text-lg leading-none">›</span>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-gray-500">
        {props.edited ? 'Edited — your version is kept in this browser until you press Reset to original. ' : ''}
        Ctrl+Enter runs. Long lines scroll sideways (Shift + wheel).
      </p>
      {tooBig ? (
        <p id="lab-too-big" className="text-sm text-red-400">
          This code is {Math.ceil(size / 1024)} KB. The shared runner takes at most 64 KB per run.
        </p>
      ) : null}
    </div>
  );
}
