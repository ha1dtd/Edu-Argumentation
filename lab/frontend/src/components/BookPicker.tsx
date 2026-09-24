import type { Book } from '../api';

// lab-select (app.css): own chevron + ellipsis for a long name; the full name is the tooltip.
const SELECT =
  'lab-select w-full min-w-0 min-h-[44px] rounded-lg bg-gray-800 border border-gray-600 text-gray-100 text-sm pl-3 focus:outline-none focus:border-brand-600';

export function BookPicker(props: {
  books: Book[];
  bookId: string | null;
  chapterN: number | null;
  onBook: (id: string) => void;
  onChapter: (n: number) => void;
}) {
  const book = props.books.find((b) => b.id === props.bookId) ?? null;
  const chapter = book?.chapters.find((c) => c.n === props.chapterN) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <label className="min-w-0 flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Book
        <select id="lab-book-select" className={SELECT} title={book?.title ?? ''} value={props.bookId ?? ''} onChange={(e) => props.onBook(e.target.value)}>
          {props.books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Chapter
        <select
          id="lab-chapter-select"
          className={SELECT}
          title={chapter?.title ?? ''}
          value={props.chapterN ?? ''}
          onChange={(e) => props.onChapter(Number(e.target.value))}
          disabled={!book}
        >
          {(book?.chapters ?? []).map((c) => (
            <option key={c.n} value={c.n}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
