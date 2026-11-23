// A small, NON-BLOCKING notice (23-11-26): review grades (Hard / Good / Easy / Again) that could not reach the
// server are kept in this browser and resent (data/writes.ts). While any wait, say so — in one line, bottom left,
// no dialog, no focus grab — and disappear the moment the queue is empty.
import { useSyncExternalStore } from 'react';
import { pendingGradeCount, subscribePendingGrades } from '../data/writes';

export function GradeQueueNotice() {
  const waiting = useSyncExternalStore(subscribePendingGrades, pendingGradeCount, () => 0);
  if (waiting <= 0) return null;
  return (
    <div
      id="grade-queue-notice"
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-40 max-w-xs rounded-lg border border-gray-600 bg-gray-800/95 px-3 py-2 text-xs text-gray-200 shadow-lg"
    >
      {waiting} review {waiting === 1 ? 'answer is' : 'answers are'} not saved yet. Retrying…
    </div>
  );
}
