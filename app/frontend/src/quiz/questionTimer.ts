// Account redesign C (23-11-26): how long a question was on screen before it was answered.
//
// `useQuestionTimer(resetKey)` starts a clock when `resetKey` changes (a new question / a new run) and
// returns `read()`: the milliseconds since then, MINUS the time the tab was hidden, capped at
// QUESTION_TIME_CAP_MS — a question left open over lunch must not read as an hour of study.
// Only wall time with the tab visible counts; the server stores it as answer_log.duration_ms.
import { useEffect, useRef } from 'react';

export const QUESTION_TIME_CAP_MS = 5 * 60_000;

/** Pure: elapsed visible ms, capped. `hiddenMs` = hidden time already closed, `hiddenSince` = start of an open hidden spell. */
export function visibleElapsedMs(startedAt: number, now: number, hiddenMs: number, hiddenSince: number | null): number {
  const open = hiddenSince === null ? 0 : Math.max(0, now - hiddenSince);
  return Math.max(0, Math.min(QUESTION_TIME_CAP_MS, Math.round(now - startedAt - hiddenMs - open)));
}

export function useQuestionTimer(resetKey: unknown): () => number {
  const state = useRef({ startedAt: performance.now(), hiddenMs: 0, hiddenSince: null as number | null });
  useEffect(() => {
    state.current = { startedAt: performance.now(), hiddenMs: 0, hiddenSince: document.hidden ? performance.now() : null };
  }, [resetKey]);
  useEffect(() => {
    const onChange = () => {
      const s = state.current;
      if (document.hidden) {
        if (s.hiddenSince === null) s.hiddenSince = performance.now();
      } else if (s.hiddenSince !== null) {
        s.hiddenMs += performance.now() - s.hiddenSince;
        s.hiddenSince = null;
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return () => {
    const s = state.current;
    return visibleElapsedMs(s.startedAt, performance.now(), s.hiddenMs, s.hiddenSince);
  };
}
