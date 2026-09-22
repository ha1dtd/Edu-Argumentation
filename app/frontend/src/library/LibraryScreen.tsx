// Seam 10 (library/LibraryScreen) — THE WELCOME SCREEN: grid, empty state, services.
//
// PORTED FROM (by symbol, app.js): renderLibrary (58 lines — one of the six spanning
// functions), loadLibrary, openBook, closeBook, showLandingDashboard.
//
// HOW renderLibrary WAS SPLIT (three ways, by concern):
//   1. ORDER      -> state/LibraryProvider (snapshotLibraryOrder + orderedLibraryBooks)
//   2. ONE CARD   -> library/BookCard
//   3. THE GRID + the empty state + renderHomeKpis' call site -> here
//
// Contract DOM this seam owns:
//   #welcome-screen · #welcome-body · #welcome-empty · #library-grid ·
//   #import-book-link · #services-section · `#services-section a, #services-section label` ·
//   `label[for="custom-data-upload"] svg` · #read-tutorial-btn
//
// ⛔ #read-tutorial-btn is how the reader is ENTERED. Clicking a library card fetches
//    module.json and leaves the app on #welcome-screen — a gate that clicked a card and
//    then looked for chapters reported "browsing both books" while one contributed zero.
//
// ⛔ The empty state is toggled by CLASS, not unmounted: `#welcome-empty` is a pinned
//    contract selector and must resolve whether or not the library is empty.
import { useBookContext } from '../state/BookProvider';
import { useLibrary } from '../state/LibraryProvider';
import { useProgressContext } from '../state/ProgressProvider';
import { BookCard } from './BookCard';
import { HomePanel } from './HomePanel';

export interface LibraryScreenProps {
  /** #read-tutorial-btn — the ONLY way into the reader. */
  onOpenReader: () => void;
}

export function LibraryScreen({ onOpenReader }: LibraryScreenProps) {
  const { ordered } = useLibrary();
  const { activeBookFile, openBook, closeBook, data } = useBookContext();
  const { overall } = useProgressContext();
  const isEmpty = ordered.length === 0 && !data?.title;
  const live = overall();

  return (
    <div id="welcome-body">
      <HomePanel
        bookTitle={(data?.title as string | undefined) ?? null}
        overall={live}
        // A2 OWNS nextLesson(): the first block with no completion, walking chapters in
        // order. Stubbed null here so the button simply does not render yet.
        nextLessonLabel={null}
        onResume={onOpenReader}
      />

      {/*
        ⛔ CLASS STRINGS VERBATIM from aws-quiz-app/index.html:250 (#read-tutorial-btn) and
           :294-:296 (the library heading row + grid), ported 22-09-26 (EVL fix 003). Before
           this fix every element in this file except #import-book-link and the upload label
           carried NO className at all — measured on the deployed :8792 — so the primary
           entrance to the reader rendered as the bare word "Learn".
      */}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          id="read-tutorial-btn"
          type="button"
          onClick={onOpenReader}
          className="min-h-[44px] px-6 rounded-lg bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider text-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Learn
        </button>
      </div>

      {/* ⛔ Toggled by CLASS, never unmounted — `#welcome-empty` is a pinned contract
          selector and must resolve in BOTH states. The copy is the legacy's (index.html:234). */}
      <p id="welcome-empty" className={isEmpty ? 'mt-3 text-gray-400' : 'hidden-view mt-3 text-gray-400'}>
        No book selected. Pick one from the library below.
      </p>

      <h2 className="mt-10 mb-4 text-2xl text-white font-light">Library</h2>

      <div id="library-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {ordered.map((book) => (
          <BookCard
            key={book.file}
            book={book}
            current={book.file === activeBookFile}
            // The OPEN book reports LIVE progress; the others report their stored count,
            // clamped so a stale server count can never exceed the lesson total.
            done={
              book.file === activeBookFile
                ? live.done
                : Math.min(book.done ?? 0, book.lessons)
            }
            onOpen={(file) => (file === activeBookFile ? closeBook() : openBook(file))}
          />
        ))}
      </div>

      {/*
        ⛔ `#services-section a, #services-section label` is ONE pinned selector and it must
           match BOTH kinds of child — a gate that found only the <a> would still report a
           non-zero count, so the <label> has to be a real <label>, not a styled <div>.
        ⚠ PLACEMENT DEVIATION, deliberate and recorded: in the legacy app the upload
           input+label live in the HEADER (aws-quiz-app/index.html:200-203), not in
           #services-section. The contract selector `label[for="custom-data-upload"] svg`
           is UNSCOPED, so it resolves either way; keeping the pair here (A1's placement)
           also satisfies `#services-section … label` with one element instead of two.
           Recorded rather than silently "corrected" back to the header.
        ⛔ `htmlFor` is what emits the `for` ATTRIBUTE. React's DOM prop is `htmlFor`;
           writing `for=` in JSX emits nothing and empties `[for="custom-data-upload"]`.
        ⚠ The file <input> is `hidden-view` (display:none), NOT unmounted — same rule as
           the screens. A <label> needs a real control to point at.
      */}
      <div id="services-section" className="mt-6 flex flex-wrap items-center gap-4">
        <a
          id="import-book-link"
          href="/"
          className="inline-flex items-center gap-2 min-h-[44px] text-gray-300 hover:text-white transition-colors"
        >
          {/* A3/A4 OWN the copy and the importer target (:8769). The ELEMENT and its two
              pinned selectors are what this slice is responsible for. */}
          Import a book
        </a>
        <label
          htmlFor="custom-data-upload"
          className="cursor-pointer text-gray-300 hover:text-white transition-colors"
          title="Load Course JSON"
        >
          {/* Ported shape-for-shape from aws-quiz-app/index.html:202. Inline SVG, never an
              <img>: `label[for="custom-data-upload"] svg` is a pinned contract selector. */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
        </label>
        <input id="custom-data-upload" type="file" accept=".json" className="hidden-view" />
      </div>
    </div>
  );
}
