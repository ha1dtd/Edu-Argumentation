// Q&A examiner screen — the first add-on screen (study-rooms-qna P2, 29-09-26).
//
// Rendered by the add-on registry inside <Screen id="qna-screen"> (shell/screens.tsx). Stays
// mounted like every screen; `open` is true while it is the visible one.
//
// Flow: setup (book + chapters/blocks) -> question -> grading -> result (pass: Proceed / Ask;
// fail: Try again) -> ask-back -> ... -> done. "New" is always visible in a session, confirms,
// and clears it. The session survives a reload until New (useQnaSession).
//
// ⚑ ONE live region: #qna-status (role=status, atomic). Grade card takes focus when it arrives.
// ⚑ Reduced motion: the root turns off transitions/transforms for everything inside it.
// ⛔ Class strings are complete literals from shell/ui.ts (Tailwind purge). Copy stays terse.
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../account/AccountContext';
import { useLibrary } from '../state/LibraryProvider';
import { useBookContext } from '../state/BookProvider';
import { ScopePicker } from '../scope/ScopePicker';
import type { ScopeValue } from '../scope/ScopePicker';
import { BODY_MUTED, CAPTION, CARD, EYEBROW, FIELD, LABEL, OUTLINE_BTN, PAGE_TITLE, PRIMARY_BTN } from '../shell/ui';
import { GradeCard } from './GradeCard';
import { useQnaSession } from './useQnaSession';

const ROOT = 'space-y-6 motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:transform-none';
const TEXTAREA = 'w-full min-h-[44px] rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 transition-colors min-h-[10rem] resize-y';

export function QnaScreen({ open }: { open: boolean }) {
  const account = useAccount();
  const { ordered } = useLibrary();
  const { activeBookFile } = useBookContext();
  const qna = useQnaSession(account.id);
  const { session, busy, error } = qna;
  const [scope, setScope] = useState<ScopeValue>({ bookId: '', blocks: [] });
  const gradeRef = useRef<HTMLElement | null>(null);

  // Default the setup's book to the one being read, once the library is known.
  useEffect(() => {
    if (!scope.bookId && activeBookFile && ordered.some((b) => b.file === activeBookFile)) setScope({ bookId: activeBookFile, blocks: [] });
  }, [activeBookFile, ordered, scope.bookId]);

  const grade = session?.grade ?? null;
  useEffect(() => {
    if (grade && open) gradeRef.current?.focus();
  }, [grade, open]);

  const question = session ? session.questions[String(session.index)] : undefined;
  const total = session?.total ?? question?.total ?? null;

  let status = '';
  if (busy === 'question') status = 'Loading question…';
  else if (busy === 'grade') status = 'Grading…';
  else if (busy === 'ask') status = 'Asking…';
  else if (error) status = error;
  else if (session?.done) status = 'All questions answered.';
  // The latest event wins: an ask-back answer comes after the grade it follows.
  else if (session?.ask) status = session.ask.refused ? 'Not in this theory.' : 'Answer ready.';
  else if (grade) status = `Score ${String(grade.score)} of 10 — ${grade.pass ? 'passed' : 'not passed'}`;
  else if (question && total) status = `Question ${question.index + 1} of ${total}`;
  else if (!session) status = scope.blocks.length ? `${scope.blocks.length} lesson${scope.blocks.length === 1 ? '' : 's'} selected` : '';

  const confirmNew = () => {
    if (window.confirm('Start a new Q&A? This clears the current one.')) qna.reset();
  };

  return (
    <div className={ROOT}>
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={EYEBROW}>{question ? question.lessonTitle : 'Examiner'}</p>
            <h1 className={PAGE_TITLE}>Q&amp;A</h1>
          </div>
          {session ? (
            <button id="qna-new-btn" type="button" className={OUTLINE_BTN} onClick={confirmNew}>
              New
            </button>
          ) : null}
        </div>
        <p id="qna-status" role="status" aria-live="polite" aria-atomic="true" className={BODY_MUTED}>
          {status}
        </p>
      </div>

      {!session ? (
        <div className={CARD}>
          <ScopePicker books={ordered} value={scope} onChange={setScope} allowBookPick idBase="qna" />
          <div className="mt-6">
            <button
              id="qna-start-btn"
              type="button"
              className={PRIMARY_BTN}
              disabled={!scope.bookId || scope.blocks.length === 0}
              onClick={() => qna.start(scope.bookId, scope.blocks)}
            >
              Start
            </button>
          </div>
        </div>
      ) : session.done ? (
        <div className={CARD}>
          <p className="text-lg text-white">All questions answered.</p>
          <div className="mt-6">
            <button id="qna-done-new-btn" type="button" className={PRIMARY_BTN} onClick={confirmNew}>
              New
            </button>
          </div>
        </div>
      ) : (
        <div className={`${CARD} space-y-5`}>
          {total ? <p className={CAPTION}>{`Question ${(question?.index ?? session.index) + 1} of ${total}`}</p> : null}
          {question ? (
            <p id="qna-question" className="text-lg text-white">
              {question.question}
            </p>
          ) : error ? (
            <button id="qna-question-retry-btn" type="button" className={OUTLINE_BTN} onClick={qna.retryQuestion}>
              Try again
            </button>
          ) : null}

          {question ? (
            <div>
              <label htmlFor="qna-answer" className={LABEL}>
                Your explanation
              </label>
              <textarea
                id="qna-answer"
                className={TEXTAREA}
                value={session.draft}
                readOnly={Boolean(grade) || busy === 'grade'}
                onChange={(event) => qna.setDraft(event.target.value)}
              />
              {!grade ? (
                <div className="mt-4">
                  <button
                    id="qna-submit-btn"
                    type="button"
                    className={PRIMARY_BTN}
                    disabled={!session.draft.trim() || busy !== null}
                    onClick={() => void qna.submit()}
                  >
                    Submit
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {grade ? <GradeCard ref={gradeRef} grade={grade} /> : null}

          {grade && !grade.pass ? (
            <div className="flex flex-wrap gap-3">
              <button id="qna-retry-btn" type="button" className={PRIMARY_BTN} onClick={qna.tryAgain}>
                Try again
              </button>
            </div>
          ) : null}

          {grade && grade.pass ? (
            <div className="flex flex-wrap gap-3">
              <button id="qna-proceed-btn" type="button" className={PRIMARY_BTN} onClick={qna.proceed}>
                Proceed
              </button>
              {!session.askOpen ? (
                <button id="qna-ask-btn" type="button" className={OUTLINE_BTN} onClick={qna.openAsk}>
                  Ask
                </button>
              ) : null}
            </div>
          ) : null}

          {grade && grade.pass && session.askOpen ? (
            <div className="space-y-3">
              <label htmlFor="qna-ask-input" className={LABEL}>
                Your question
              </label>
              <input
                id="qna-ask-input"
                type="text"
                className={FIELD}
                value={session.askDraft}
                onChange={(event) => qna.setAskDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void qna.ask();
                }}
              />
              <button
                id="qna-ask-send-btn"
                type="button"
                className={OUTLINE_BTN}
                disabled={!session.askDraft.trim() || busy !== null}
                onClick={() => void qna.ask()}
              >
                Ask
              </button>
              {session.ask ? (
                <div id="qna-ask-answer" className="rounded-xl border border-gray-700 bg-gray-900/60 p-4">
                  <p className={CAPTION}>{session.ask.question}</p>
                  <p className={session.ask.refused ? 'mt-2 text-gray-400' : 'mt-2 text-gray-200 whitespace-pre-wrap'}>{session.ask.answer}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
