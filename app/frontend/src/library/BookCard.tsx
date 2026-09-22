// Seam 11 (library/BookCard) — ONE CARD IN THE LIBRARY GRID.
//
// Split out of renderLibrary (one of the six spanning functions). The card is its own
// seam because it carries four of the contract's selectors on its own and because the
// rename affordance (Phase 04) attaches here, not to the grid.
//
// Contract DOM this component owns:
//   #library-grid [data-book]            · every card
//   #library-grid [data-book="*"]        · a specific book's card
//   #library-grid [data-book][aria-current="true"]
//   #library-grid [data-rename="*"]      · the title, double-click to rename
//   #library-grid input[type="text"]     · the rename input (Phase 04 — a WRITE)
//
// ⛔⛔ aria-current IS THE STRING "true"/"false" — NEVER a boolean. React omits
//     aria-current={false} from the DOM ENTIRELY, and the contract selector
//     `[aria-current="true"]` then matches zero elements and reads as a broken port.
//     ⚠ NOTE THE ASYMMETRY, measured from the legacy app and deliberate: the CARD sets
//       aria-current on every card ("true" or "false"); the TOC BUTTON sets it only on
//       the current item and omits it otherwise. Both behaviours are reproduced as-is.
//
// ⚠ It is a <div role="button" tabIndex={0}>, NOT a <button>. The title turns into an
//   <input> on double-click, and an <input> inside a <button> is invalid and unfocusable
//   in browsers. Do not "clean this up" into a <button>.
import type { LibraryBook } from '../data/types';

export interface BookCardProps {
  book: LibraryBook;
  /** The book currently open. Drives the "Current" chip and aria-current. */
  current: boolean;
  /** Lessons done — the OPEN book reports live progress, others their stored count. */
  done: number;
  onOpen: (file: string) => void;
}

/*
  ⛔⛔ THE CLASS STRINGS ARE VERBATIM FROM `renderLibrary` (aws-quiz-app/js/app.js:465-522),
      ported 22-09-26 (EVL fix 003). A3's header said "A3 OWNS the class strings and the exact
      element order" and A3 shipped the element order WITHOUT them — MEASURED on the deployed
      :8792 before this fix, `#library-grid [data-book]`.className was the EMPTY STRING, as
      were #library-grid, #read-tutorial-btn and #services-section. So the library rendered as
      a bare stack of text lines flush to x=0 and read as "the port is broken".
  ⚠ The card's border/background is CONDITIONAL on `current` in the legacy and stays so here;
    that pair is what the "Current" chip reinforces, and it is the only place `current`
    changes appearance rather than just `aria-current`.
*/
const CARD_BASE =
  'flex flex-col gap-3 text-left rounded-xl border p-5 min-h-[44px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
const CARD_CURRENT = 'border-brand-600 bg-gray-800';
const CARD_OTHER = 'border-gray-700 bg-gray-800/60 hover:border-gray-500 hover:bg-gray-800';

export function BookCard({ book, current, done, onOpen }: BookCardProps) {
  const percent = book.lessons ? Math.round((done / book.lessons) * 100) : 0;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${CARD_BASE} ${current ? CARD_CURRENT : CARD_OTHER}`}
      data-book={book.file}
      aria-current={current ? 'true' : 'false'}
      onClick={() => onOpen(book.file)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(book.file);
        }
      }}
    >
      {/* The legacy wraps title + chip in a `head` div; the flex row is what puts the chip
          on the title's right instead of on its own line. */}
      <div className="flex items-start justify-between gap-3">
        <h3
          className="text-white font-semibold leading-snug line-clamp-2"
          data-rename={book.file}
          title="Double-click to rename"
        >
          {book.title}
        </h3>
        {current && (
          <span
            className="shrink-0 rounded-full bg-brand-600/15 px-2.5 py-1 text-xs font-semibold text-brand-400"
            title="Click the card to close this book"
          >
            Current
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        {book.chapters === 1 ? '1 chapter' : `${book.chapters} chapters`}
      </p>
      <div
        className="h-1.5 rounded-full bg-gray-700 overflow-hidden"
        role="progressbar"
        aria-label={`${book.title}: lessons done`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-gray-400 tabular-nums">{`${done}/${book.lessons} lessons · ${percent}%`}</p>
      {/*
        PHASE 04 lands `#library-grid input[type="text"]` here — the rename input.
        It is a WRITE (POST /api/rename), so it does not exist in this phase at all.
        The contract selector is therefore a KNOWN GAP for the Phase-03 sweep, not a
        missing element to fake with a disabled input.
      */}
    </div>
  );
}
