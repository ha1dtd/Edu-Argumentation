// Account redesign B (23-11-26): the two small charts of the Account page, plain markup (no chart library).
// Every number a chart shows is ALSO text (a title / a list / a table), so colour and size are never the only cue.
// ⛔ Class strings are complete literals (Tailwind purge).
import type { WeekBucket } from '../data/types';
import { fmtPct, plural, shortDay } from './format';

const LEVEL = ['bg-gray-700', 'bg-green-900', 'bg-green-700', 'bg-green-500', 'bg-green-400'];

/** Intensity 0-4 of a day with `n` answers when the busiest day had `max`. */
export function heatLevel(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(4, 1 + Math.floor((3 * (n - 1)) / Math.max(1, max - 1 || 1)));
}

/** Activity heatmap: one column per week (Monday first), one row per weekday. */
export function Heatmap({ from, days, max }: { from: string; days: { d: string; n: number; ms: number }[]; max: number }) {
  // `from` is a Monday, so cell i sits in row i % 7 and column floor(i / 7) — grid-flow-col does exactly that.
  const active = days.filter((d) => d.n > 0).length;
  const total = days.reduce((sum, d) => sum + d.n, 0);
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div
          id="activity-heatmap"
          className="inline-grid grid-flow-col grid-rows-[repeat(7,12px)] gap-[3px]"
          role="img"
          aria-label={`Answers per day since ${shortDay(from)}: ${plural(total, 'answer')} on ${plural(active, 'day')}`}
        >
          {days.map((d) => (
            <span key={d.d} title={`${shortDay(d.d)}: ${plural(d.n, 'answer')}`} data-day={d.d} data-n={d.n}
              className={`block h-3 w-3 rounded-[3px] ${LEVEL[heatLevel(d.n, max)]}`} />
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        {plural(total, 'answer')} on {plural(active, 'day')} since {shortDay(from)}. Darker = more answers that day (busiest day: {max}).
      </p>
    </div>
  );
}

/** Weekly accuracy (all answers) and recall (review answers), 12 weeks, newest on the right. */
export function WeekTrend({ weeks }: { weeks: WeekBucket[] }) {
  const empty = weeks.every((w) => w.answered === 0);
  if (empty) return <p className="text-sm text-gray-400">No answers in the last {weeks.length} weeks.</p>;
  return (
    <div>
      <div id="weekly-trend" className="flex items-end gap-1.5 h-28" role="img"
        aria-label={`Accuracy per week, last ${weeks.length} weeks: ${weeks.map((w) => `${shortDay(w.start)} ${fmtPct(w.accuracy)}`).join(', ')}`}>
        {weeks.map((w) => (
          <div key={w.start} className="flex-1 min-w-0 flex flex-col justify-end h-full" data-week={w.start} data-accuracy={w.accuracy ?? ''}>
            <div className="flex items-end justify-center gap-0.5 h-full">
              <span className={`w-1/2 rounded-t ${w.accuracy === null ? 'bg-gray-700' : w.accuracy >= 80 ? 'bg-green-400' : 'bg-amber-400'}`}
                style={{ height: `${w.accuracy ?? 3}%` }} title={`${shortDay(w.start)}: ${fmtPct(w.accuracy)} of ${plural(w.answered, 'answer')}`} />
              <span className={`w-1/2 rounded-t ${w.recall === null ? 'bg-gray-700' : 'bg-sky-400'}`}
                style={{ height: `${w.recall ?? 3}%` }} title={`${shortDay(w.start)}: recall ${fmtPct(w.recall)} of ${plural(w.reviews, 'review answer')}`} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-400 tabular-nums" aria-hidden="true">
        <span>{shortDay(weeks[0].start)}</span>
        <span>{shortDay(weeks[weeks.length - 1].start)}</span>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        <span className="inline-block h-2 w-2 rounded-sm bg-green-400 align-middle" /> accuracy, all answers{' '}
        <span className="ml-3 inline-block h-2 w-2 rounded-sm bg-sky-400 align-middle" /> recall, review answers only. Weeks start on Monday.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-gray-200 min-h-[44px] flex items-center">Week-by-week numbers</summary>
        <div className="overflow-x-auto">
          <table id="weekly-table" className="w-full text-sm text-left">
            <thead className="text-xs uppercase tracking-wider text-gray-400">
              <tr><th className="py-2 pr-3">Week of</th><th className="py-2 pr-3">Answers</th><th className="py-2 pr-3">Accuracy</th><th className="py-2 pr-3">Recall</th><th className="py-2">Grades A / H / G / E</th></tr>
            </thead>
            <tbody className="text-gray-200 tabular-nums">
              {[...weeks].reverse().map((w) => (
                <tr key={w.start} className="border-t border-gray-700">
                  <td className="py-1.5 pr-3">{shortDay(w.start)}</td><td className="py-1.5 pr-3">{w.answered}</td>
                  <td className="py-1.5 pr-3">{fmtPct(w.accuracy)}</td><td className="py-1.5 pr-3">{fmtPct(w.recall)}</td>
                  <td className="py-1.5">{w.grades.again} / {w.grades.hard} / {w.grades.good} / {w.grades.easy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
