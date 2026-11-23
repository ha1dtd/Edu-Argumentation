// Account redesign A (23-11-26): the top of the Account page — today / this week / streak / cards due / questions
// currently wrong, then one card per book (real title, lessons "84 of 322", cards due, last 7 days).
// Source: GET /api/account/overview (backend/insights.py documents every number).
// ⛔ Class strings are complete literals (Tailwind purge).
import type { AccountOverview, OverviewBook } from '../data/types';
import { BODY_MUTED, CAPTION, OUTLINE_BTN, SECTION_TITLE } from '../shell/ui';
import type { AccountBook } from './bookList';
import { fmtMs, fmtPct, plural, shortDay } from './format';

function Tile({ id, label, value, note }: { id: string; label: string; value: string; note: string }) {
  return (
    <div id={`tile-${id}`} data-tile={id} className="rounded-lg border border-gray-700 bg-gray-900 p-4 min-w-0">
      <dt className={CAPTION}>{label}</dt>
      <dd className="mt-1 text-2xl font-light text-white tabular-nums" data-cell="value">{value}</dd>
      <p className="mt-1 text-xs text-gray-400 break-words" data-cell="note">{note}</p>
    </div>
  );
}

export function OverviewTiles({ overview }: { overview: AccountOverview | undefined }) {
  if (!overview) {
    return <p id="overview-loading" className="mt-6 text-sm text-gray-400" aria-busy="true">Loading your numbers…</p>;
  }
  const { today, week, streak, totals } = overview;
  return (
    <dl id="overview-tiles" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Tile id="today" label="Today" value={String(today.answered)}
        note={today.answered ? `answers · ${fmtPct(today.accuracy)} right${today.ms ? ` · ${fmtMs(today.ms)}` : ''}` : 'answers so far today'} />
      <Tile id="week" label="This week" value={String(week.answered)}
        note={`answers since Monday · ${plural(week.activeDays, 'active day')} · last week: ${week.prevAnswered}`} />
      <Tile id="streak" label="Streak" value={plural(streak.current, 'day')}
        note={`longest ${streak.longest} · ${streak.activeDays30} of the last 30 days`} />
      <Tile id="due" label="Cards due now" value={String(totals.dueNow)} note={`of ${totals.cards} review cards`} />
      <Tile id="wrong" label="Currently wrong" value={String(totals.currentlyWrong)}
        note="questions whose latest answer was wrong" />
    </dl>
  );
}

function BookCard({ row, book, selected, onPick }: { row: OverviewBook; book: AccountBook | undefined; selected: boolean; onPick: () => void }) {
  const title = book?.title ?? row.module;
  const lessons = book?.lessons ? `${row.lessons} of ${book.lessons}` : String(row.lessons);
  const last = row.lastAt ? shortDay(row.lastAt.slice(0, 10)) : '—';
  return (
    <li data-module={row.module} className={`rounded-lg border bg-gray-900 p-4 ${selected ? 'border-brand-600' : 'border-gray-700'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="min-w-0 break-words text-lg font-semibold text-white" data-cell="title">{title}</h3>
        <span className="text-xs text-gray-400">last studied {last}</span>
        {book && (
          <button type="button" className={`${OUTLINE_BTN} ml-auto`} aria-pressed={selected} data-pick-book={row.module} onClick={onPick}
            aria-label={`Show insights for ${title}`}>
            {selected ? 'Showing below' : 'Show insights'}
          </button>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-gray-400">Lessons finished</dt><dd className="text-white font-medium" data-cell="lessons">{lessons}</dd></div>
        <div><dt className="text-gray-400">Cards due now</dt><dd className="text-white font-medium" data-cell="due">{row.srs.dueNow} <span className="text-gray-400 font-normal">of {row.srs.total}</span></dd></div>
        <div><dt className="text-gray-400">Currently wrong</dt><dd className="text-white font-medium" data-cell="wrong">{row.currentlyWrong}</dd></div>
        <div><dt className="text-gray-400">Last 7 days</dt><dd className="text-white font-medium" data-cell="week">{row.answered7} answered{row.answered7 ? ` · ${fmtPct(row.accuracy7)}` : ''}{row.ms7 ? ` · ${fmtMs(row.ms7)}` : ''}</dd></div>
      </dl>
    </li>
  );
}

export function BooksOverview({ overview, books, selected, onPick, loading, failed }: {
  overview: AccountOverview | undefined;
  books: AccountBook[];
  selected: string;
  onPick: (module: string) => void;
  loading: boolean;
  failed: boolean;
}) {
  const rows = overview?.books ?? [];
  return (
    <section id="account-books" className="bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8" aria-labelledby="account-books-title">
      <h2 id="account-books-title" className={SECTION_TITLE}>Your books</h2>
      <p className={`${BODY_MUTED} mb-6`}>Every book you have started: lessons, review cards and the last 7 days. Newest first.</p>
      {failed ? <p className="text-sm text-red-300" role="alert">Could not load your books.</p> : null}
      {loading ? <p className="text-sm text-gray-400" aria-busy="true">Loading…</p> : null}
      {overview && !rows.length ? <p className="text-sm text-gray-400">Nothing started yet.</p> : null}
      <ul id="account-books-list" className="space-y-3">
        {rows.map((row) => (
          <BookCard key={row.module} row={row} book={books.find((b) => b.module === row.module)}
            selected={row.module === selected} onPick={() => onPick(row.module)} />
        ))}
      </ul>
    </section>
  );
}
