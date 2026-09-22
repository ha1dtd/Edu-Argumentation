// Seam 12 (library/HomePanel) — THE LANDING DASHBOARD PANEL + KPIs.
//
// PORTED FROM (by symbol, app.js): renderHome, renderHomeKpis, nextLesson, plural.
// Markup ported from aws-quiz-app/index.html's #welcome-screen body and #home-kpis section.
//
// Owns #welcome-title · #current-meta · #current-progress-label · #current-progress-percent ·
// #current-progress-track · #current-progress-bar · #current-next · #home-kpis and the
// five KPI slots. None of these are in the frozen contract, so they are shape-free for
// the gates — but they are what the reader sees first, so this ports them exactly.
//
// ⚠ Closing a book is NOT a separate control: the card that opened it closes it, and
//   this panel stays where it is, empty (user, 21-09-26). Do not add a Close button.
//
// ⚑ WHY THIS COMPONENT READS CONTEXTS DIRECTLY (slice E, 22-09-26).
//   The A3 stub fixed a four-prop data contract "so A2 can wire it", and A2 wired the three
//   it could reach. But `renderHomeKpis` is in this file's own PORTED-FROM list and it is a
//   function OF THE LIBRARY (every book's lessons/chapters/questions/done), while
//   `renderHome`'s #current-meta line is a function of the OPEN BOOK's counts. Neither is
//   reachable through those four props. Widening the prop list would push library data
//   through LibraryScreen for no reason — it already holds both contexts. The prop contract
//   is therefore UNCHANGED (nothing that passes props today breaks) and the two ported
//   functions read their own sources, exactly as the legacy globals did.
//
// ⛔ READ-ONLY. This panel renders progress; it never writes it. Phase 03's whole claim is
//    that `progress.json` is byte-identical across a full browse.
import { useBookContext } from '../state/BookProvider';
import { useLibrary } from '../state/LibraryProvider';
import type { ProgressSummary } from '../state/ProgressProvider';

export interface HomePanelProps {
  bookTitle: string | null;
  overall: ProgressSummary;
  /** Label of the next unread lesson, or null when the book is finished / unopened. */
  nextLessonLabel: string | null;
  onResume: () => void;
}

/** plural(count, word) — ported verbatim. toLocaleString is the legacy's: "1,550 questions". */
function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

// ⚠ `onResume` is INTENTIONALLY NOT DESTRUCTURED. It stays in the props contract because
//   LibraryScreen passes it and Phase 04 may want it, but #current-next is a plain <p> in
//   the legacy — the resume ACTION is #read-tutorial-btn, which LibraryScreen owns and
//   already wires. Hanging an onClick on a <p> here would create a second, unannounced,
//   non-focusable entrance to the reader.
export function HomePanel({ bookTitle, overall, nextLessonLabel }: HomePanelProps) {
  const { chapters, blocksOf, quizBank } = useBookContext();
  const { books } = useLibrary();

  // renderHome's #current-meta line: "19 chapters · 310 lessons · 1,550 questions".
  const lessonCount = chapters.reduce((sum, _chapter, index) => sum + blocksOf(index).length, 0);
  const meta = [
    plural(chapters.length, 'chapter'),
    plural(lessonCount, 'lesson'),
    plural(quizBank.length, 'question'),
  ].join(' · ');

  // ── renderHomeKpis, ported ────────────────────────────────────────────────────
  // ⚠ The legacy's own comment, and it is the reason this panel is not gated on "no book
  //   open": it WAS, but the default book auto-opens, so that state is rare and the panel
  //   would never have appeared. It does not duplicate the current-book panel above —
  //   that one is THIS book, this one is every book.
  const sum = (key: 'lessons' | 'chapters' | 'questions') =>
    books.reduce((total, book) => total + (Number(book[key]) || 0), 0);
  const kpiLessons = sum('lessons');
  // ⛔ CLAMPED PER BOOK, not after summing. A stale server count for one book must not be
  //    able to push the total past that book's lesson count — the legacy clamps inside the
  //    reduce and the difference only shows up on real, slightly-stale data.
  const kpiDone = books.reduce(
    (total, book) => total + Math.min(Number(book.done) || 0, Number(book.lessons) || 0),
    0,
  );
  const kpiPercent = kpiLessons ? Math.round((kpiDone / kpiLessons) * 100) : 0;
  const started = books.filter((book) => (Number(book.done) || 0) > 0).length;
  // ⚠ A COPY before sort: `[...books]`. Array.prototype.sort mutates, and `books` is the
  //   provider's array — sorting it in place would reorder the library grid as a side
  //   effect of rendering a KPI, which is exactly the A2c "document order unchanged" gate.
  const furthest = [...books].sort((a, b) => (Number(b.done) || 0) - (Number(a.done) || 0))[0];
  const hasBooks = books.length > 0;

  return (
    <>
      {/*
        ⛔ THE CARD. Added 22-09-26 (EVL fix 003). In the legacy the current-book panel IS
           `#welcome-screen` and carries the card chrome on the section itself
           (aws-quiz-app/index.html:231: `animate-fade-in bg-gray-800 border border-gray-700
           rounded-2xl p-6 sm:p-8`). Here `#welcome-screen` is the generic <Screen> primitive
           and also contains the library and the KPI panel, so putting the chrome THERE would
           box the whole page. The chrome is applied to the current-book region instead —
           same pixels, one extra div.
        ⚠ DECLARED DEVIATION: the legacy keeps #read-tutorial-btn INSIDE this card
          (index.html:250); here it is rendered by library/LibraryScreen and therefore sits
          just BELOW the card. The button is styled identically; only its container differs.
      */}
      <div className="animate-fade-in bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8">
      {/* renderHome's current-book panel. */}
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Current book</p>
      <h1 id="welcome-title" className="mt-2 text-3xl sm:text-4xl font-light text-white leading-tight">
        {bookTitle ?? ''}
      </h1>
      {/* ⚠ Empty, not a message, when nothing is open: the "No book selected…" copy belongs
            to #welcome-empty (library/LibraryScreen), which is still an unfilled stub there.
            Two elements carrying the same sentence is how a copy change half-lands. */}
      <p id="current-meta" className="mt-2 text-sm text-gray-400">
        {bookTitle ? meta : ''}
      </p>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span id="current-progress-label" className="text-gray-300">
            {`${overall.done} / ${overall.total} lessons done`}
          </span>
          <span id="current-progress-percent" className="font-semibold text-white tabular-nums">
            {`${overall.percent}%`}
          </span>
        </div>
        {/*
          ⚠ role="progressbar" WITH aria-valuenow is the legacy's, and the value is set on
            the TRACK, not the bar. The bar is the visual fill; the track is the control a
            screen reader announces. Splitting those two swaps a styled div for the widget.
        */}
        <div
          id="current-progress-track"
          className="mt-2 h-2 rounded-full bg-gray-700 overflow-hidden"
          role="progressbar"
          aria-label="Lessons done"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overall.percent}
        >
          <div
            id="current-progress-bar"
            className="h-full rounded-full bg-brand-600 transition-all duration-300"
            style={{ width: `${overall.percent}%` }}
          />
        </div>
        {/*
          #current-next is a <p> in the legacy, not a button — the resume ACTION is
          #read-tutorial-btn (library/LibraryScreen), and this line only says where you are.
          ⚠ A2 still passes nextLessonLabel={null}: nextLesson() is unported, so the line
            renders empty rather than guessing. Named, not papered over.
        */}
        <p id="current-next" className="mt-3 text-sm text-gray-400 truncate">
          {nextLessonLabel ?? ''}
        </p>
      </div>
      </div>

      {/*
        renderHomeKpis — across-the-library totals.
        ⛔ HIDDEN BY CLASS, never unmounted: `panel.classList.add/remove('hidden-view')` is
           what the legacy does, and #home-kpis is this seam's anchor for the five slots.
      */}
      <section
        id="home-kpis"
        className={hasBooks ? 'mt-10' : 'hidden-view mt-10'}
        aria-labelledby="home-kpis-heading"
      >
        <h2 id="home-kpis-heading" className="text-2xl text-white font-light mb-4">
          Your progress
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-gray-400">Lessons done</p>
            <p id="kpi-lessons" className="mt-1 text-3xl text-white font-bold tabular-nums">
              {kpiDone}
            </p>
            <div className="mt-3 h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
              <div id="kpi-lessons-bar" className="h-full rounded-full bg-brand-600" style={{ width: `${kpiPercent}%` }} />
            </div>
            <p id="kpi-lessons-sub" className="mt-2 text-xs text-gray-400 tabular-nums">
              {`of ${kpiLessons} · ${kpiPercent}%`}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-gray-400">Books</p>
            <p id="kpi-books" className="mt-1 text-3xl text-white font-bold tabular-nums">
              {books.length}
            </p>
            <p id="kpi-books-sub" className="mt-2 text-xs text-gray-400 tabular-nums">
              {started ? `${started} started` : 'none started yet'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-gray-400">Chapters</p>
            <p id="kpi-chapters" className="mt-1 text-3xl text-white font-bold tabular-nums">
              {sum('chapters')}
            </p>
            <p className="mt-2 text-xs text-gray-400">across the library</p>
          </div>
          <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-gray-400">Questions</p>
            <p id="kpi-questions" className="mt-1 text-3xl text-white font-bold tabular-nums">
              {sum('questions').toLocaleString()}
            </p>
            <p className="mt-2 text-xs text-gray-400">available to practise</p>
          </div>
        </div>
        <p id="kpi-furthest" className="mt-4 text-sm text-gray-400">
          {furthest && (Number(furthest.done) || 0) > 0
            ? `Furthest along: ${furthest.title} — ${furthest.done} of ${furthest.lessons} lessons.`
            : 'Pick a book below to start.'}
        </p>
      </section>
    </>
  );
}
