// Seam 8 (routing) — THE READER CURSOR, IN THE HASH.
//
// ⛔ NOT React Router (A3d/Decision 4). `#chapter=N&block=N` is QUERY-shaped, not
//    path-shaped; a router buys nothing here and brings a dependency, a matcher and a
//    history model this app does not use. This is ~30 lines: hashchange + parse +
//    serialize. The frozen DOM contract carries the route as `#chapter=N&block=N`.
//
// ⛔⛔ B15 MUST BE REPRODUCED, DEFECT INCLUDED. It is a PRE-EXISTING deep-link defect,
//     out of scope, and it must NOT be fixed — accidentally or otherwise. gates/
//     b15probe.mjs is watching, and a FIXED B15 is a FAILED gate here.
//
// ⛔⛔ THE MECHANISM WAS WRONG IN SLICE A1 AND IS CORRECTED HERE (slice A3, 22-09-26).
//     A1 recorded the cause as renderTutorial()'s guard:
//         if (!tutorialData || !tutorialData.sections) return;
//     reasoning that "a packaged book carries `chapters`, not `sections`", so the guard
//     fires and the hash is never applied. ⛔ THAT IS FALSE, and it is false in the one
//     way that matters: MEASURED 22-09-26, the importer emits `tutorialData.sections`
//     (doc-importer/backend/book.py:219 and :241, blockify.py:6 and :127), and the app's
//     own theoryChapters() reads `tutorialData.sections` (app.js:1417). EVERY REAL BOOK
//     HAS `sections`. The guard never fires. A1's reproduction therefore matched the
//     observable for the wrong reason — and would have diverged the moment a reader with
//     progress clicked LEARN. (Slice A2 flagged the same thing independently.)
//
//     THE REAL MECHANISM, located by symbol, is the LEARN button — app.js:1238-1241:
//         dom.readTutorialBtn.addEventListener('click', () => {
//             const next = nextLesson();
//             if (next) selectTheory({chapterIndex: next.chapterIndex, blockIndex: next.blockIndex});
//             showTutorial();
//         });
//     selectTheory() WRITES THE HASH. So LEARN jumps to nextLesson() and STAMPS OVER the
//     deep link. renderTutorial() — the ONLY place that honours the hash — is called from
//     the book-LOAD path (app.js:1378), never from the LEARN click. Arriving on
//     `#chapter=1&block=8` and clicking LEARN therefore lands wherever nextLesson() says
//     and rewrites the hash to match. On a book with no progress that is block 1, which
//     is exactly the pinned :8791 baseline.
//
//     Measured on :8791 (21-09-26) — the probe compares ONLY `visibleScreens` and `hash`,
//     never pixel geometry:
//         before the LEARN click: screens ["welcome-screen"]            hash #chapter=1&block=8
//         after  the LEARN click: screens ["welcome-screen","tutorial-screen"]
//                                                                      hash #chapter=1&block=1
//
//     ⛔ WHERE EACH HALF LIVES, so neither is "tidied" away:
//        · THE OVERWRITE is state/ReaderCursorProvider.enterReader() — slice A2's file.
//        · THE LOAD-TIME HASH READ is applyHashOnEnter() + the load-edge effect BELOW.
//        Delete either and b15probe.mjs reads a different hash than :8791 does.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleData, TheoryCursor } from '../data/types';

const AT_START: TheoryCursor = { chapterIndex: 0, blockIndex: 0 };

/** theoryFromHash — 1-based in the URL, 0-based in memory. */
export function cursorFromHash(hash: string = window.location.hash): TheoryCursor {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const chapter = Number(params.get('chapter'));
  const block = Number(params.get('block'));
  return { chapterIndex: (chapter > 0 ? chapter : 1) - 1, blockIndex: (block > 0 ? block : 1) - 1 };
}

/** writeTheoryHash — replaceState, never pushState: Back must leave the reader. */
export function writeCursorHash(cursor: TheoryCursor): void {
  window.history.replaceState(
    null,
    '',
    `#chapter=${cursor.chapterIndex + 1}&block=${cursor.blockIndex + 1}`,
  );
}

/** clampTheory — a deep link past the end lands on the last real block, not blank. */
export function clampCursor(
  cursor: TheoryCursor,
  chapterCount: number,
  blockCountOf: (chapterIndex: number) => number,
): TheoryCursor {
  const chapterIndex = Math.min(Math.max(cursor.chapterIndex, 0), Math.max(chapterCount - 1, 0));
  const blockCount = blockCountOf(chapterIndex);
  return {
    chapterIndex,
    blockIndex: Math.min(Math.max(cursor.blockIndex, 0), Math.max(blockCount - 1, 0)),
  };
}

/**
 * renderTutorial()'s first two lines, ported exactly (app.js:2858-2859):
 *     if (!tutorialData || !tutorialData.sections) return;
 *     currentTheory = clampTheory(theoryFromHash());
 *
 * ⚠ THE GUARD IS KEPT BECAUSE IT IS FAITHFUL, NOT BECAUSE IT FIRES. Measured 22-09-26:
 *   every real book HAS `sections`, so this returns the hash cursor in practice. Slice A1
 *   believed the opposite and called this guard "the B15 defect"; it is not — see the
 *   file header. Keeping it costs nothing and reproduces the legacy branch exactly; a
 *   malformed upload with no `sections` opens at the start in both apps.
 */
export function applyHashOnEnter(data: ModuleData | null): TheoryCursor {
  if (!data || !Array.isArray((data as { sections?: unknown }).sections)) return AT_START;
  return cursorFromHash();
}

export interface HashCursor {
  cursor: TheoryCursor;
  /** Moves the cursor AND writes the hash — the two must never drift apart. */
  select: (next: TheoryCursor) => void;
}

export function useHashCursor(
  chapterCount: number,
  blockCountOf: (chapterIndex: number) => number,
  /**
   * The loaded module, if the caller has it. OPTIONAL on purpose: the hook's job is the
   * hash, and its two existing callers pass counts. ⚠ Omitting it leaves the load-time
   * hash read INERT — see the load-edge effect below. It is not a default to ignore.
   */
  module?: ModuleData | null,
): HashCursor {
  const [cursor, setCursor] = useState<TheoryCursor>(AT_START);

  const select = useCallback(
    (next: TheoryCursor) => {
      const clamped = clampCursor(next, chapterCount, blockCountOf);
      setCursor(clamped);
      writeCursorHash(clamped);
    },
    [chapterCount, blockCountOf],
  );

  // ⛔ THE LOAD-TIME HALF OF B15 — renderTutorial()'s hash read (app.js:2857-2861).
  //
  // Legacy: renderTutorial() is called from the BOOK-LOAD path (app.js:1378), right after
  // the module is parsed and before the landing dashboard is shown. That is the ONLY
  // place the hash is ever honoured. This effect is that call site, and nothing else.
  //
  // ⛔ IT MUST NOT FIRE ON ENTERING THE READER. Slice A3 first keyed this on the reader's
  //    VISIBILITY, which looked right and was wrong: LEARN must land on nextLesson(), not
  //    on the hash and not on block 1. Keying on visibility stamps block 1 over a reader
  //    with real progress — a DIVERGENCE from :8791 dressed up as B15 fidelity. The LEARN
  //    overwrite belongs to state/ReaderCursorProvider.enterReader() (slice A2), which
  //    calls select() and so writes the hash itself.
  //
  // THE LOAD EDGE, and its honest limit: a book becoming available is chapterCount going
  // 0 -> N. ⚠ Switching straight from one book to ANOTHER OF THE SAME CHAPTER COUNT is
  //   NOT detected here, because this hook is deliberately given counts and nothing else.
  //   Recorded as a REQUIREMENT ON SLICE A2, not papered over: expose a book identity
  //   token (moduleId) and key this effect on it. Until then the miss is inert — the
  //   legacy app re-reads the hash on that switch and we open at the start instead, and
  //   b15probe.mjs does not exercise a same-size book switch.
  //
  // ⚠ writeCursorHash uses replaceState, which does NOT emit `hashchange`, so this cannot
  //   feed the listener below. If it ever becomes pushState, this loops.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!chapterCount) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;
    // ⚠ NO MODULE PASSED => applyHashOnEnter returns AT_START and this is a NO-OP. That
    //   is the state today (both callers pass counts only), so the load-time hash read is
    //   WIRED BUT INERT. Said plainly rather than faked green: B15's OBSERVABLE is already
    //   correct without it, because the observable is produced by the LEARN overwrite.
    if (module === undefined) return;
    setCursor(clampCursor(applyHashOnEnter(module), chapterCount, blockCountOf));
  }, [chapterCount, blockCountOf, module]);

  useEffect(() => {
    const onHashChange = () => {
      // Mirrors the legacy listener: no chapters loaded means no cursor to move.
      if (!chapterCount) return;
      setCursor(clampCursor(cursorFromHash(), chapterCount, blockCountOf));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [chapterCount, blockCountOf]);

  return { cursor, select };
}
