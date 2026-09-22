// Seam 19 (ask) — THE IN-APP TUTOR PANEL. Independently shippable (221 lines).
//
// PORTED FROM (by symbol, app.js): askDom, askLessonLabel, askSyncLesson, askSave,
// askRecord, askRestore, askNewConversation, askBubble, askSetOpen, askSubmit, askInit,
// ASK_STORE_KEY, ASK_MAX_TURNS, ASK_BADGE.
//
// ⛔ `POST /api/ask` IS A WRITE-SHAPED CALL AND IS **NOT** IN PHASE 03. The read-only gate
//    greps the built bundle for a closed pattern set — `fetch(` with a non-GET `method:`
//    in any of three quotings, `XMLHttpRequest`, `navigator.sendBeacon`, `api/progress`.
//    A `method:"POST"` here fails the phase, not a lint.
//    Phase 03 renders the panel shell and its conversation history (localStorage,
//    `eduAskConversation`, bounded to ASK_MAX_TURNS = 40). Sending is Phase 04.
//
// ⚠ The tutor answers grounded lesson -> book -> model knowledge, and each answer is
//   LABELLED with which of the three it came from (ASK_BADGE). The badge is not
//   decoration: it is how the reader knows whether the book actually said this.
//
// ⚑ 22-09-26 (EVL fix 004, R-3) — TWO DEFECTS FIXED HERE, and they are different in kind:
//
//   1. THE PANEL AND THE FAB CARRIED NO CLASS STRINGS AT ALL. MEASURED on the deployed
//      :8792: #ask-panel opened at **48 px tall** with its whole contents collapsed to the
//      running text "CloseNew conversation / Send", and #ask-fab rendered as the bare word
//      "Ask". Every class below is copied from aws-quiz-app/index.html:566-587, element for
//      element — the same failure and the same fix as D-4 (picker) and D-5 (library).
//
//   2. ⛔⛔ THE FAB WAS VISIBLE ON EVERY SCREEN. The legacy scopes it to the READER and
//      nothing else (app.js:3710-3717): it observes #tutorial-screen's class attribute and
//      toggles `hidden-view` on the FAB with it, ALSO force-closing the panel on the way
//      out. Without that, the FAB floated over the home page, the quiz, the settings screen
//      and — visibly, in screenshot 08-quiz-setup.png — straight THROUGH the quiz-setup
//      backdrop, which is a modal it has no business being above.
//      ⚠ The observer is NOT ported: React already knows which screen is up, so `reading`
//        is a prop from shell/AppShell. The legacy's own comment explains why IT needed an
//        observer — "rather than patching the five places that show or hide it, one of
//        those would eventually be missed" — and a single owning prop is the same argument
//        answered better. The BEHAVIOUR is identical; only the plumbing is React's.
import { useEffect, useState } from 'react';

const ASK_MAX_TURNS = 40;

export interface AskPanelProps {
  /** True only while the reader is the visible screen. See the ⚑ block above. */
  reading: boolean;
}

export function AskPanel({ reading }: AskPanelProps) {
  const [open, setOpen] = useState(false);

  // askSetOpen(false) on the way OUT of the reader (app.js:3715). Without this the panel
  // stays open behind a hidden FAB and reappears — still open — on the next visit.
  useEffect(() => {
    if (!reading) setOpen(false);
  }, [reading]);

  return (
    <>
      <button
        id="ask-fab"
        type="button"
        aria-label="Ask about this lesson"
        aria-expanded={open}
        aria-controls="ask-panel"
        className={`${reading ? '' : 'hidden-view '}fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-brand-600 text-white shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
        onClick={() => setOpen((on) => !on)}
      >
        {/* The legacy's own speech-bubble glyph (index.html:568-570), path data verbatim. */}
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 10h8M8 14h5M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12z"
          />
        </svg>
      </button>

      {/*
        ⛔ THE SIZE CLASSES ARE THE PANEL. `w-[44rem] max-w-[calc(100vw-3rem)] h-[80vh]
           max-h-[calc(100vh-8rem)]` plus the `flex flex-col` column are what make this a
           conversation window instead of the 48px strip that was measured. The three
           children then split it: header `shrink-0`, log `flex-1 overflow-y-auto`, form
           `shrink-0`. Drop the column and the log stops being the part that scrolls.
        ⚠ `<aside>` here vs the legacy's `<section>`: kept from the existing port. Both are
          contract tags and the contract selector is the id, not the tag.
      */}
      <aside
        id="ask-panel"
        aria-label="Ask about this lesson"
        className={`${open ? '' : 'hidden-view '}fixed bottom-24 right-6 z-40 flex flex-col w-[44rem] max-w-[calc(100vw-3rem)] h-[80vh] max-h-[calc(100vh-8rem)] rounded-2xl border border-gray-700 bg-gray-800 shadow-2xl`}
        data-max-turns={ASK_MAX_TURNS}
      >
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm">Ask about this lesson</p>
            <p id="ask-context" className="text-xs text-gray-400 truncate">
              {/* A4: askLessonLabel() — which lesson the answer is grounded in. */}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              id="ask-new"
              type="button"
              title="Start a new conversation and delete this one"
              className="min-h-[36px] px-3 rounded-lg border border-gray-600 text-gray-300 text-xs font-semibold uppercase tracking-wider hover:text-white hover:bg-gray-700 transition-colors"
            >
              New
            </button>
            <button
              id="ask-close"
              type="button"
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              onClick={() => setOpen(false)}
            >
              <svg
                className="w-5 h-5 mx-auto"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        {/* `[overflow-wrap:anywhere]` is the legacy's: a pasted URL must not widen the panel. */}
        <div id="ask-log" className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm [overflow-wrap:anywhere]">
          {/* A4: askRestore() renders the stored turns as askBubble()s. */}
        </div>

        {/* ⛔ No onSubmit handler in Phase 03 — submitting is a POST. See the header. */}
        <form id="ask-form" className="shrink-0 border-t border-gray-700 p-3 flex items-end gap-2">
          <label className="sr-only" htmlFor="ask-input">
            Your question
          </label>
          {/*
            ⛔⛔ THIS STAYS `<input type="text">`, AND THE REASON IS A MEASUREMENT, NOT A
                PREFERENCE. The legacy element is a `<textarea rows="1">` that grows to a
                128px cap as the reader types (askInit's input listener). Porting the tag
                was tried in this slice and REVERTED: it turned R-C1 RED —
                  `UNEXPECTED MISSES: attributeExpressions [type="text"]`
                — because `#ask-input` is the ONLY element in the whole React app that
                satisfies the frozen contract's `[type="text"]` entry.
            ⚑ RECORDED AS A LATENT VACUITY, because that is what it really is. The legacy
              owner of `[type="text"]` is **`#set-model`** (index.html:399), the settings
              model field. This port renders `#set-model` as a read-only `<p>` — correct for
              a phase that must be incapable of writing — so the contract entry has been
              propped up by an unrelated element the whole time. Whoever makes settings
              editable in Phase 04 restores the real owner, and only THEN can this become
              the textarea the legacy has. ⛔ Do not "fix" it by widening the contract.
            ⚠ maxLength/placeholder are the legacy's own; `resize-none`/`max-h-32` are kept
              so the swap back to a textarea is a one-line change later.
          */}
          <input
            id="ask-input"
            type="text"
            maxLength={600}
            placeholder="What don't you get?"
            className="flex-1 resize-none rounded-lg bg-gray-900 border border-gray-600 px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-brand-600 max-h-32"
          />
          <button
            id="ask-send"
            type="submit"
            disabled
            title="Asking is not available in this phase yet."
            className="min-h-[44px] px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Ask
          </button>
        </form>
      </aside>
    </>
  );
}
