// Seam 6 (state/QuizProvider), reducer half — THE QUIZ ATOM.
//
// ⛔ THESE 13 FIELDS ARE **ONE** useReducer, NOT 13 useState CALLS (A2b).
//    They are mutated together by resetRunState() and read together by tallyScore() /
//    tallyTotal(). Thirteen separate useState calls can flush partially, and a partial
//    flush is exactly how the B4/B5/B6 carry invariants break: a retry that fixes the
//    last 3 of 20 must read 20/20, or the reader is told they failed an assessment they
//    passed.
//
// ⛔ tallyScore / tallyTotal ARE DERIVED SELECTORS, computed during render and NEVER
//    STORED. Storing a tally is how it goes stale against the state it summarises.
//
// PORTED FROM (by symbol, app.js): the 13 top-level `let`s at the head of the file,
// resetRunState, tallyScore, tallyTotal, restartQuiz, retryWrongOnly, handleAnswerSelect,
// setModuleQuiz / setBlockQuiz / setSelectionQuiz / setAiQuiz.
//
// ⚠ `quizData` (the whole question bank) is deliberately NOT in this atom — it is
//    server-cache state that belongs to the loaded book, not to a run.

import type { QuizQuestion } from '../data/types';

/**
 * Which slice of the bank `active` currently holds.
 *
 * ⛔ `'selection'` RESTORED 22-09-26 (G-EVL-2 fix). A2 narrowed this union to three members,
 *    which left the picker's own "some blocks, from one or more chapters" case with NO honest
 *    value to set. It is a real legacy scope (app.js:1043) and it is NOT interchangeable with
 *    `'module'`: app.js:1223-1225 branches `quizScope === 'module'` one way and
 *    `'block' || 'selection'` the other, so conflating them would bake a wrong completion-credit
 *    decision into Phase 04. Nothing reads `scope` today except ResultScreen's `=== 'ai'` test,
 *    so adding the member changes no current behaviour — it stops the fix having to lie.
 */
export type QuizScope = 'module' | 'block' | 'selection' | 'ai';

export interface QuizState {
  /** 1 */ currentQuestionIndex: number;
  /** 2 */ score: number;
  /** 3 */ isAnswered: boolean;
  /** 4 — the option picked on the current question, so a resumed quiz shows it. */
  selectedAnswer: number | null;
  /** 5 */ active: QuizQuestion[];
  /** 6 — the set the run STARTED with; `active` narrows on a retry-wrong. */
  full: QuizQuestion[];
  /** 7 — positions in `active` answered wrongly during THIS run. */
  wrongIndices: number[];
  /** 8 — questions already passed, so a retry still posts 20/20 and never 3/3. */
  carriedCorrect: number;
  /** 9 */ carriedTotal: number;
  /** 10 */ generated: QuizQuestion[] | null;
  /** 11 */ scope: QuizScope;
  /** 12 */ scopeLabel: string;
  /** 13 — captured at start, read at finish, so navigating cannot credit the wrong block. */
  scopeBlockId: string | null;
}

export const initialQuizState: QuizState = {
  currentQuestionIndex: 0,
  score: 0,
  isAnswered: false,
  selectedAnswer: null,
  active: [],
  full: [],
  wrongIndices: [],
  carriedCorrect: 0,
  carriedTotal: 0,
  generated: null,
  scope: 'module',
  scopeLabel: '',
  scopeBlockId: null,
};

export type QuizAction =
  /** resetRunState(questions) — the ONE place a run starts. */
  | { type: 'run/reset'; questions: QuizQuestion[] }
  /** `replay` redraws an answer already scored — it must NOT score again. */
  | { type: 'run/answer'; index: number; correct: boolean; replay?: boolean }
  | { type: 'run/advance' }
  | { type: 'run/restart' }
  | { type: 'run/retryWrong' }
  | { type: 'scope/set'; scope: QuizScope; label: string; blockId: string | null }
  | { type: 'generated/set'; questions: QuizQuestion[] | null };

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'run/reset':
      // Mirrors resetRunState EXACTLY: one place starts a run, so nothing can begin
      // with a stale wrong-list or a stale carry from the previous assessment.
      return {
        ...state,
        active: action.questions,
        full: action.questions,
        wrongIndices: [],
        carriedCorrect: 0,
        carriedTotal: 0,
        currentQuestionIndex: 0,
        score: 0,
        isAnswered: false,
        selectedAnswer: null,
      };
    case 'scope/set':
      return { ...state, scope: action.scope, scopeLabel: action.label, scopeBlockId: action.blockId };
    case 'generated/set':
      return { ...state, generated: action.questions };
    /**
     * handleAnswerSelect (app.js:2915-2929) — the SCORING half only. Everything below
     * line 2930 there is DOM painting and belongs to quiz/OptionCard.
     *
     * ⛔ `replay` redraws an answer given before the learner left the screen; it was
     *    SCORED THEN. Re-scoring a replay double-counts a correct answer and can push a
     *    run past 100%.
     * ⛔ A miss is recorded BY POSITION, not by question object, so it survives a reload
     *    the same way the questions do and a retry run's own misses index into the
     *    NARROWED set. Recording the object breaks retry-of-a-retry.
     * ⛔ The guard is `isAnswered && !replay` — a second click on an answered question is
     *    ignored, which is what stops a learner clicking every option in turn.
     */
    case 'run/answer': {
      if (state.isAnswered && !action.replay) return state;
      const answered = { ...state, isAnswered: true, selectedAnswer: action.index };
      if (action.replay) return answered;
      if (action.correct) return { ...answered, score: state.score + 1 };
      if (state.wrongIndices.includes(state.currentQuestionIndex)) return answered;
      return { ...answered, wrongIndices: [...state.wrongIndices, state.currentQuestionIndex] };
    }

    /**
     * The next-button handler (app.js:1306-1316). ⚠ It advances PAST THE END on purpose:
     * `currentQuestionIndex === active.length` is the finish condition the screen reads,
     * and clamping here would make the last question unfinishable.
     */
    case 'run/advance':
      return {
        ...state,
        currentQuestionIndex: state.currentQuestionIndex + 1,
        isAnswered: false,
        selectedAnswer: null,
      };

    /**
     * restartQuiz (app.js:886-890). ⛔ Replays `full`, NOT `active`: after a retry-wrong,
     * `active` is the narrowed 3-question set, so restarting from it would silently turn a
     * 20-question assessment into a 3-question one.
     */
    case 'run/restart':
      return quizReducer(state, {
        type: 'run/reset',
        questions: state.full.length ? state.full : state.active,
      });

    /**
     * retryWrongOnly (app.js:895-911). THE CARRY INVARIANT — this is the case A2b exists
     * for, and the reason all 13 fields are ONE reducer.
     *
     * ⛔ carriedTotal is the tally BEFORE narrowing, and carriedCorrect is
     *    (that total − the number being retried). So a learner who missed 3 of 20 and
     *    fixes them finishes at 20/20, never 3/3. Thirteen separate useState calls can
     *    flush some of these and not others, and a partial flush tells the reader they
     *    failed an assessment they passed.
     * ⛔ `full` is PRESERVED across the narrowing, or a later restart replays the 3.
     * ⛔ Nothing happens when nothing was wrong — the legacy early return, kept.
     */
    case 'run/retryWrong': {
      const wrong = state.wrongIndices
        .map((index) => state.active[index])
        .filter((question): question is QuizQuestion => Boolean(question));
      if (!wrong.length) return state;
      const originalTotal = tallyTotal(state);
      return {
        ...state,
        active: wrong,
        full: state.full.length ? state.full : state.active,
        carriedCorrect: originalTotal - wrong.length,
        carriedTotal: originalTotal,
        wrongIndices: [],
        currentQuestionIndex: 0,
        score: 0,
        isAnswered: false,
        selectedAnswer: null,
      };
    }

    default:
      return state;
  }
}

/** Derived. Computed during render, never stored — see the header. */
export function tallyScore(state: QuizState): number {
  return state.score + state.carriedCorrect;
}

/** Derived. Computed during render, never stored — see the header. */
export function tallyTotal(state: QuizState): number {
  return state.carriedTotal || state.active.length;
}

/**
 * owningBlockId — WHICH block a finished run is allowed to credit. Derived during render,
 * NEVER stored (same rule as tallyScore/tallyTotal above). Ported from app.js:1125-1136.
 *
 * ⛔⛔ IT ASKS `full`, NOT `active`, AND THAT IS THE WHOLE POINT. After a retry-wrong run
 *     `active` is the NARROWED miss set — so a module-wide quiz narrowed to one block's
 *     three misses would, if this asked `active`, resolve to that block and tick it off a
 *     WHOLE-BOOK tally. The legacy's own line is
 *     `const asked = fullQuizData.length ? fullQuizData : activeQuizData`, and it is
 *     preserved verbatim here.
 * ⛔ An UNATTRIBUTED question (no `source.block`) makes the whole run unclaimable — early
 *    `return null`, not "skip it". One unattributed question among twenty means we cannot
 *    say which block the run proves, and guessing is how a block gets ticked by a quiz that
 *    never asked about it.
 * ⛔ `scopeBlockId` wins when set: it was captured AT START, so navigating during a run
 *    cannot credit the wrong block.
 *
 * ⚠ READ-ONLY. Phase 03 never posts a completion; this selector exists so the result
 *   screen can render the legacy's "a block needs 100%" note. The POST that consumes it
 *   (recordQuizResult) is Phase 04.
 */
export function owningBlockId(state: QuizState): string | null {
  if (state.scopeBlockId) return state.scopeBlockId;
  const asked = state.full.length ? state.full : state.active;
  if (!asked.length) return null;
  const blocks = new Set<string>();
  for (const question of asked) {
    const block = question?.source?.block;
    if (!block) return null; // unattributed question: cannot claim a block
    blocks.add(block);
  }
  return blocks.size === 1 ? [...blocks][0] : null;
}
