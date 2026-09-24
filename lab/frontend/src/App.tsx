import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './api';
import type { Book, LessonDetail } from './api';
import { Header } from './components/Header';
import { BookPicker } from './components/BookPicker';
import { LessonList } from './components/LessonList';
import { CodeEditor } from './components/CodeEditor';
import { ResultPanel } from './components/ResultPanel';
import type { ResultState } from './components/ResultPanel';
import { LayoutToggle } from './components/LayoutToggle';
import { loadLayout, saveLayout } from './layout';
import type { Layout } from './layout';
import { codeKey, readStore, removeStore, writeStore } from './storage';

// Deep link: /lab/<bookId>/<chNN-bMM>. The book id is the MODULE id (e.g.
// openintro-statistics-2019-1045f2f5), never the reader's path slug.
function parsePath(): { book: string | null; lesson: string | null } {
  const rest = window.location.pathname.replace(/^\/lab\/?/, '');
  const [book, lesson] = rest.split('/').filter(Boolean).map(decodeURIComponent);
  return { book: book ?? null, lesson: lesson ?? null };
}

function pathFor(book: string | null, lesson: string | null): string {
  if (!book) return '/lab/';
  return `/lab/${encodeURIComponent(book)}/${lesson ? encodeURIComponent(lesson) : ''}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function App() {
  const [name, setName] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [chapterN, setChapterN] = useState<number | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [copied, setCopied] = useState(false);
  const runId = useRef(0);

  const book = useMemo(() => books?.find((b) => b.id === bookId) ?? null, [books, bookId]);
  const chapter = useMemo(() => book?.chapters.find((c) => c.n === chapterN) ?? null, [book, chapterN]);
  const running = result.kind === 'running';
  const edited = detail != null && code !== detail.code;

  // Apply a (book, lesson) choice, falling back sensibly and explaining an unknown link.
  const applySelection = useCallback((all: Book[], wantBook: string | null, wantLesson: string | null, push: boolean) => {
    let target = all.find((b) => b.id === wantBook) ?? null;
    let message: string | null = null;
    if (wantBook && !target) message = `There is no book "${wantBook}" in Lab. Pick one from the list.`;
    target = target ?? all[0] ?? null;
    let lesson: string | null = null;
    let chapterNumber = target?.chapters[0]?.n ?? null;
    if (target && wantLesson && target.id === wantBook) {
      const owner = target.chapters.find((c) => c.lessons.some((l) => l.id === wantLesson));
      if (owner) {
        chapterNumber = owner.n;
        lesson = wantLesson;
      } else {
        message = `Lesson ${wantLesson} has no code to run, or does not exist. Pick a lesson from the list.`;
      }
    }
    setBookId(target?.id ?? null);
    setChapterN(chapterNumber);
    setLessonId(lesson);
    setNotice(message);
    if (push) window.history.pushState(null, '', pathFor(target?.id ?? null, lesson));
  }, []);

  useEffect(() => {
    api.me().then((me) => setName(me.name), () => undefined);
    api.books().then(
      (all) => {
        setBooks(all);
        const { book: b, lesson: l } = parsePath();
        applySelection(all, b, l, false);
      },
      (error: unknown) => setLoadError(error instanceof ApiError ? error.message : 'Lab could not load the book list.'),
    );
  }, [applySelection]);

  useEffect(() => {
    const onPop = () => {
      if (!books) return;
      const { book: b, lesson: l } = parsePath();
      applySelection(books, b, l, false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [books, applySelection]);

  // Load the chosen lesson's code; an edit kept in localStorage wins over the original.
  useEffect(() => {
    setDetail(null);
    setResult({ kind: 'idle' });
    if (!bookId || !lessonId) return;
    let live = true;
    api.lesson(bookId, lessonId).then(
      (loaded) => {
        if (!live) return;
        setDetail(loaded);
        setCode(readStore(codeKey(bookId, lessonId)) ?? loaded.code);
      },
      (error: unknown) => live && setNotice(error instanceof ApiError ? error.message : 'Could not load this lesson.'),
    );
    return () => {
      live = false;
    };
  }, [bookId, lessonId]);

  const selectLesson = (id: string) => {
    setLessonId(id);
    setNotice(null);
    window.history.pushState(null, '', pathFor(bookId, id));
  };

  const changeCode = (next: string) => {
    setCode(next);
    if (!bookId || !lessonId || !detail) return;
    if (next === detail.code) removeStore(codeKey(bookId, lessonId));
    else writeStore(codeKey(bookId, lessonId), next);
  };

  const resetCode = () => {
    if (!bookId || !lessonId || !detail) return;
    removeStore(codeKey(bookId, lessonId));
    setCode(detail.code);
  };

  const copy = async () => {
    const ok = await copyText(code);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  };

  const run = async () => {
    if (!bookId || !lessonId || running) return;
    const id = ++runId.current;
    const started = Date.now();
    setResult({ kind: 'running', seconds: 0 });
    const timer = window.setInterval(() => {
      if (runId.current === id) setResult({ kind: 'running', seconds: Math.floor((Date.now() - started) / 1000) });
    }, 1000);
    try {
      const outcome = await api.run(bookId, lessonId, code);
      if (runId.current === id) setResult({ kind: 'done', result: outcome });
    } catch (error) {
      if (runId.current === id) {
        const failure = error instanceof ApiError ? error : new ApiError(0, 'Lab could not be reached.');
        setResult({ kind: 'failed', status: failure.status, message: failure.message });
      }
    } finally {
      window.clearInterval(timer);
    }
  };

  const stop = () => {
    if (bookId && lessonId) api.stop(bookId, lessonId).catch(() => undefined);
  };

  const resetKernel = async () => {
    if (!bookId || !lessonId) return;
    try {
      await api.resetKernel(bookId, lessonId);
      setResult({ kind: 'idle' });
      setNotice('Kernel reset — every variable from earlier runs of this lesson is gone.');
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'Could not reset the kernel.');
    }
  };

  const changeLayout = (next: Layout) => {
    setLayout(next);
    saveLayout(next);
  };

  const lessonRef = chapter?.lessons.find((l) => l.id === lessonId) ?? null;
  const showCode = layout.view !== 'result';
  const showResult = layout.view !== 'code';
  const twoColumns = layout.arrangement === 'side' && showCode && showResult;
  // Stacked with both panels: split the height (code 45 % / result 55 %, app.css). Else one row.
  const split = layout.arrangement === 'stacked' && showCode && showResult;

  return (
    <>
      <Header name={name} />
      <main id="lab-main" className="flex-1 flex flex-col lg:flex-row gap-6 p-4 sm:p-6 lg:px-8 lg:py-6 min-h-0">
        <aside id="lab-aside" className="lg:w-80 shrink-0 flex flex-col gap-4 bg-gray-800 border border-gray-700 rounded-xl p-4 lg:overflow-y-auto">
          {books ? (
            <>
              <BookPicker
                books={books}
                bookId={bookId}
                chapterN={chapterN}
                onBook={(id) => books && applySelection(books, id, null, true)}
                onChapter={(n) => {
                  setChapterN(n);
                  setLessonId(null);
                  window.history.pushState(null, '', pathFor(bookId, null));
                }}
              />
              <LessonList lessons={chapter?.lessons ?? []} lessonId={lessonId} onSelect={selectLesson} />
            </>
          ) : (
            <p className="text-sm text-gray-400">{loadError ?? 'Loading books…'}</p>
          )}
          {books && books.length === 0 ? <p className="text-sm text-gray-400">No book has code to run yet.</p> : null}
        </aside>

        <section id="lab-section" className="flex-1 min-w-0 flex flex-col gap-4">
          {notice ? (
            <p id="lab-notice" className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 text-sm text-gray-200">
              {notice}
            </p>
          ) : null}
          {lessonRef && detail ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <h2 id="lab-lesson-title" className="min-w-0 break-words text-2xl sm:text-3xl text-white font-light">
                  {lessonRef.n}. {lessonRef.title}
                </h2>
                <LayoutToggle layout={layout} onChange={changeLayout} />
              </div>
              <div
                id="lab-workspace"
                data-arrangement={layout.arrangement}
                data-view={layout.view}
                data-rows={split ? 'split' : 'one'}
                className={`grid gap-4 grid-cols-1 ${twoColumns ? 'md:grid-cols-2' : ''}`}
              >
                <div id="lab-code-pane" className={showCode ? 'lab-pane min-w-0 flex flex-col' : 'hidden'}>
                  <CodeEditor
                    code={code}
                    edited={edited}
                    running={running}
                    onChange={changeCode}
                    onRun={run}
                    onStop={stop}
                    onResetCode={resetCode}
                    onCopy={copy}
                    onResetKernel={resetKernel}
                    copied={copied}
                  />
                </div>
                <div id="lab-result-pane" className={showResult ? 'lab-pane min-w-0 flex flex-col' : 'hidden'}>
                  <ResultPanel state={result} onCopy={copy} />
                </div>
              </div>
            </>
          ) : books && !lessonId ? (
            <div className="rounded-xl bg-gray-800 border border-gray-700 p-8 text-gray-300">
              <h2 className="text-2xl text-white font-light mb-2">Lab</h2>
              <p>Pick a lesson on the left. Its code opens here — change it, run it, and see the result.</p>
              <p className="mt-2 text-sm text-gray-400">Your edits stay in this browser. Each person gets their own kernel.</p>
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}
