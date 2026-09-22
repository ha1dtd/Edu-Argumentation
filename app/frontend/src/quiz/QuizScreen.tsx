// Seam 20 (quiz/QuizScreen) — THE QUESTION, THE OPTIONS AND THE ACTION BAR.
//
// PORTED FROM (by symbol, app.js): showQuizScreen, loadQuestion, handleAnswerSelect,
// startQuiz, restartQuiz, retryWrongOnly, renderQuizScope, and the `#next-btn` listener
// (app.js:1306-1316) — which is where D-10 lived.
//
// ⛔⛔ B6 — THE ACTION BAR STAYS **INSIDE** `#quiz-screen`. `position: fixed` escapes
//     LAYOUT but NOT `display: none`, which is why moving the bar out breaks hiding: the
//     screen goes away and a fixed bar stays welded to the viewport over the next screen.
//
// ⛔⛔ B6b — THE PORTAL HAZARD. `createPortal(bar, document.body)` is THE idiomatic React
//     move for a fixed bar. It reproduces the visual exactly and breaks the hiding.
//     The gate is:
//         document.querySelector('#quiz-screen')
//                 .contains(document.querySelector('#action-container')) === true
//         and, after navigating away,  offsetParent === null
//     ⛔ Do not reach for a portal here. Not for z-index, not for stacking context.
//
// ⚑ LOAD-BEARING, NOT DECORATION: `#quiz-screen`'s `pb-32` RESERVES the bar's height, and
//   `html { scroll-padding-bottom: 7rem }` is a WCAG 2.2 AA obligation. Dropping either
//   hides the last option behind the bar.
//
// Contract DOM this seam owns:
//   #quiz-screen · #options-container · `#options-container .option-card` (+ .option-text,
//   .explanation-inner, .explanation-text) · #action-container ·
//   `#action-container .action-bar-inner` · #next-btn · #quiz-new-btn · #restart-btn
import { useEffect } from 'react';
import { RichTextViewer } from '../reader/RichTextViewer';
import { OptionCard } from './OptionCard';
import { useQuiz } from '../state/QuizProvider';

export interface QuizScreenProps {
  /**
   * ⛔ The screen is ALWAYS MOUNTED (shell/Screen.tsx) — `isVisible` is how a mounted-but-
   *    hidden screen knows not to act. Without it D-10's finish effect below would fire
   *    from under a `display:none` screen and yank the learner out of wherever they are.
   *    Same pattern ReaderScreen already uses for its B7 scroll reset.
   */
  isVisible: boolean;
  /** showResults()'s screen switch. Owned by shell/AppShell — a screen does not show its siblings. */
  onFinish: () => void;
  /** `#quiz-new-btn` — openQuizSetup(sessionKey()) (app.js:1321). */
  onNewQuiz: () => void;
}

export function QuizScreen({ isVisible, onFinish, onNewQuiz }: QuizScreenProps) {
  // ⚠ `total` is deliberately NOT destructured here. #score-tracker is the BARE tally
  //   (app.js:655/2930); the denominator belongs to #next-hint and #final-fraction.
  const { state, dispatch, scored } = useQuiz();
  const question = state.active[state.currentQuestionIndex];
  const count = state.active.length;
  const isLast = count > 0 && state.currentQuestionIndex === count - 1;

  // ⛔ B6 — the bar is SHOWN once the question is answered and HIDDEN otherwise, by CLASS.
  //    `hidden-view` is display:none, and that is the half `position: fixed` does not
  //    escape. This is why the bar must stay a DESCENDANT of #quiz-screen (B6b): hiding
  //    the screen must hide the bar, and only containment gives that for free.
  const barVisible = state.isAnswered;

  /*
    ⛔⛔ D-10 — THE FINISH. THIS IS THE DEFECT THAT LET THE QUIZ WALK OFF THE END.

    `showResults` (app.js:694, 93 lines — one of the plan's six spanning functions) was
    UNPORTED. `run/advance` was dispatched unconditionally on every `#next-btn` click,
    including the last one, and NOTHING ever set the screen to 'result'. MEASURED on the
    deployed :8792 before this fix: answering the fifth of five left `#quiz-screen` up
    showing `Question 6 of 5`, zero option cards, and `#result-screen` — whose content
    rendered CORRECTLY in the DOM the whole time — still `display: none`.

    The legacy's own finish is the `#next-btn` listener (app.js:1306-1316):
        currentQuestionIndex++;
        if (currentQuestionIndex < activeQuizData.length) loadQuestion();
        else { recordQuizResult(); showResults(); }

    ⛔ THE CONDITION IS READ FROM STATE, NOT FROM THE CLICK. `currentQuestionIndex ===
       active.length` is the finish condition state/quizReducer.ts documents `run/advance`
       as producing ON PURPOSE ("it advances PAST THE END … clamping here would make the
       last question unfinishable"). So the advance still happens, exactly as before — this
       effect observes the post-advance state rather than second-guessing the reducer.
       Clamping the reducer instead would have been the wrong fix: it would have made the
       last question unfinishable, which is the trap that comment exists to prevent.
    ⛔ NO 14TH FIELD. Nothing new is stored: `finished` is a DERIVED selector computed
       during render, the same rule as tallyScore()/tallyTotal(). A `hasFinished` boolean in
       the atom is exactly the stale-summary shape the reducer's header bans.
    ⛔ NO PARALLEL STATE AND NO NEW ACTION. The run still starts with `run/reset`, answers
       with `run/answer`, advances with `run/advance`, and restarts with `run/restart` /
       `run/retryWrong`. This effect adds a SCREEN SWITCH, which is the shell's job.
    ⚠ `count === 0` is the legacy's OTHER finish: startQuiz() calls showResults() outright
      when the chosen set is empty (app.js:686-688), and ResultScreen already renders
      "No Assessment Available." for total === 0.
    ⚠ PHASE 04 SEAM: the legacy calls `recordQuizResult()` immediately BEFORE showResults()
      on this one path — "the one genuine finish". That is a POST and Phase 03 is read-only
      and must be INCAPABLE of writing, so it is deliberately absent. When it lands it goes
      HERE, on this branch only, and it must read owningBlockId(state) — which asks `full`,
      not the narrowed `active`. See state/quizReducer.ts:owningBlockId.
  */
  const finished = count === 0 || state.currentQuestionIndex >= count;
  useEffect(() => {
    if (isVisible && finished) onFinish();
  }, [isVisible, finished, onFinish]);

  return (
    // ⚠ NO wrapper padding here. `pb-32` belongs ON #quiz-screen itself (shell/AppShell),
    //   exactly as the legacy has it (`<div id="quiz-screen" class="hidden-view w-full
    //   pb-32">`). Putting it on an inner div reserves the bar's height inside a box that
    //   is not the one the bar is positioned against — it LOOKS the same until the last
    //   option is the one being covered.
    <>
      {/*
        ⛔ R-2 — EVERY CLASS STRING FROM HERE DOWN IS COPIED FROM
           aws-quiz-app/index.html:446-470, ELEMENT FOR ELEMENT. Before 22-09-26 this whole
           header carried NO className at all, so the quiz screen rendered as bare text:
           "RetakeNew quiz" run together above a lone "Next" bottom-right. That is the same
           shape as D-4 (the picker) and D-5 (the library) — A3/A4 shipped the element order
           and left the class strings behind.
      */}
      <div className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
        <div className="min-w-0">
          <div className="text-xl text-white font-light">
            Question{' '}
            {/*
              ⛔ THE BADGE IS THE BARE NUMBER — `currentQuestionIndex + 1`, exactly as
                 loadQuestion writes it (app.js:2870). It is NOT "Question N of M".
              ⛔⛔ AND IT IS CLAMPED, WHICH IS THE SECOND HALF OF D-10. In the legacy the
                  badge is PAINTED BY loadQuestion(), and loadQuestion() is NOT CALLED on
                  the finishing click — so the legacy's badge simply keeps its last value
                  while the result screen takes over. This port DERIVES the badge from the
                  index on every render, so the deliberate past-the-end advance became
                  VISIBLE as `Question 6 of 5`. The clamp restores the legacy's observable
                  behaviour without touching the reducer's documented finish condition.
                  ⚠ Both halves are needed. The finish effect alone still flashes the
                    out-of-range number for one frame before the screen switches.
            */}
            <span className="font-bold text-brand-600" id="question-number-badge">
              {count ? Math.min(state.currentQuestionIndex + 1, count) : ''}
            </span>
          </div>
          <p
            id="quiz-scope-label"
            className="mt-1 text-[0.75rem] uppercase tracking-widest text-gray-500 truncate"
          >
            {state.scopeLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:gap-6">
          {/*
            ⛔ D-10's sibling defect: `#quiz-new-btn` WAS NOT WIRED — it had no onClick at
               all, so clicking "New quiz" did nothing (browser-confirmed, EVL fix 003 step
               24). The legacy binds it to `openQuizSetup(sessionKey())` (app.js:1321), i.e.
               it opens the PICKER and leaves the current run saved until Start replaces it.
               `onNewQuiz` is AppShell's openQuizSetup, which is the same call the nav's
               PRACTICE tab already makes — so "New" and PRACTICE cannot drift apart.
          */}
          <button
            id="quiz-new-btn"
            type="button"
            className="min-h-[44px] text-sm font-semibold text-gray-500 hover:text-brand-600 transition-colors uppercase tracking-wider"
            onClick={onNewQuiz}
          >
            New
          </button>
          <button
            id="retake-btn-header"
            type="button"
            className="min-h-[44px] text-sm font-semibold text-gray-500 hover:text-brand-600 transition-colors uppercase tracking-wider"
            onClick={() => dispatch({ type: 'run/restart' })}
          >
            Restart
          </button>
          {/*
            ⛔ `#score-tracker` IS THE BARE TALLY, not "N / M" — `dom.scoreTracker.textContent
               = tallyScore()` (app.js:655, 2930). The denominator belongs to #next-hint and
               to the result screen's #final-fraction; duplicating it here is where the two
               drift. It reads the DERIVED selector, so a retry-wrong run still shows the
               carried score and never this run's raw count.
          */}
          <div className="whitespace-nowrap text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Score:{' '}
            <span id="score-tracker" className="text-brand-600 text-lg font-bold">
              {scored}
            </span>
          </div>
        </div>
      </div>

      {/* A3: #question-asset renders the question's figure/equation through VisualBlock. */}
      <div id="question-asset" />
      <h3 id="question-text" className="text-xl text-white mb-8 leading-relaxed font-medium">
        {question && <RichTextViewer content={question.question} />}
      </h3>

      {/*
        ⛔ `grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8` is VERBATIM from the legacy
           (aws-quiz-app/index.html:464) and it is the SECOND HALF OF D-2, not decoration.
           D-2's acceptance is that the reveal reaches the LEGACY GEOMETRY (~180px), and the
           wrap width is what decides that. MEASURED at 1440x1000 with the explanation text
           finally rendering but this class still absent: the card was full-bleed 1404px, a
           307-character explanation wrapped to two lines, and the reveal opened to 81px —
           past the 41px of bare padding, but still under R-B1's `open > 100`. Two columns put
           the card at ~700px, which is the width the legacy's 180px was measured at.
        ⚠ A GRID, NOT `space-y`: the legacy's own comment says grid's default
          `align-items: stretch` is what keeps a short answer level with a long one, so a row
          never reads ragged (user, 21-09-26).
      */}
      <div id="options-container" className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {(question?.options ?? []).map((text, index) => (
          <OptionCard
            key={index}
            index={index}
            selected={state.selectedAnswer === index}
            /*
              ⛔⛔ D-12 — EVERY CARD CARRIES A VERDICT ONCE ANSWERED. CORRECTED 22-09-26
                  (EVL fix 005). This used to fall through to `null` for the wrong options
                  the learner did NOT pick, so only 2 of 4 cards ever opened and the other
                  two kept their unanswered look. The legacy loops ALL cards
                  (app.js:2934-2983). `selected` — already passed below — is what tells the
                  card apart the learner's own wrong pick (red) from a wrong option they
                  never touched (opacity-50); the verdict itself is the same 'incorrect'.
              ⛔ The SAME change is made at the exercises' call site (exercises/
                 ExercisePanel.tsx) in the same edit. One card, two call sites, and R-B5b
                 reds the moment they disagree.
            */
            reveal={
              state.isAnswered ? (index === question?.correct ? 'correct' : 'incorrect') : null
            }
            /*
              ⛔⛔ `explanations[index]`, PER OPTION — NOT the singular `explanation`.
                  CORRECTED 22-09-26 (EVL fix 003). This passed `question?.explanation`, and
                  MEASURED on the live bank: 1,550 questions in geron-homl3, ZERO carry a
                  singular `explanation`. The field is `explanations`, one entry per option.
                  data/types.ts:103-109 already documents the trap and
                  exercises/ExercisePanel.tsx:132 already does it correctly
                  (`entry.explanations?.[index]`) — this call site was the one that drifted.
              ⚠ WHY IT LOOKED LIKE A CSS BUG: the reveal still "worked" — `.explanation-text`
                still switched 0fr -> 1fr — but it animated an EMPTY box, so it opened to its
                own 41px of padding and stopped. The legacy opens to 180px (run-gates.sh's own
                transcript: `Q2c ... after={"inner":179,"wrap":180}`). A reveal that opens to
                its padding is indistinguishable from a broken transition by eye.
              ⛔ The singular prop is KEPT on OptionCard: exerciseSpec flattens the per-option
                 form to one string per option, so the COMPONENT's contract is correct. The
                 flattening is the CALLER's job, which is precisely what was missing here.
            */
            explanation={question?.explanations?.[index] ?? undefined}
            disabled={state.isAnswered}
            onSelect={() =>
              dispatch({ type: 'run/answer', index, correct: index === question?.correct })
            }
          >
            <RichTextViewer content={text} />
          </OptionCard>
        ))}
      </div>

      {/*
        ⛔⛔ INSIDE #quiz-screen. See B6 / B6b in the header. NO PORTAL — not for z-index,
            not for stacking context, not because `document.body` is "where fixed things
            go". `createPortal(bar, document.body)` reproduces the visual EXACTLY and
            breaks the hiding, which is the worst possible failure shape: it looks right
            in the state you are testing and is wrong in the state you are not.
        ⚑ Measured this slice: `createPortal` appears ZERO times in the React source
          (the only occurrence in the tree is the warning in this file's header).
      */}
      <div
        id="action-container"
        className={
          barVisible
            ? 'glass-bar fixed inset-x-0 bottom-1.5 z-40'
            : 'hidden-view glass-bar fixed inset-x-0 bottom-1.5 z-40'
        }
      >
        <div className="action-bar-inner mx-auto flex w-full items-center justify-between gap-4 px-4 py-3">
          {/*
            ⛔ THE PINNED BAR CARRIES THE POSITION, and that is the legacy's own reason:
               "the header that used to show it scrolls out of view the moment the
               explanations expand" (app.js:2886-2890). Its TWO forms are not
               interchangeable — `carriedTotal` being set means this is a REDO run, and the
               bar says so ("N of M left to redo"). M here is the NARROWED set on purpose:
               it counts the redo list, not the assessment. The assessment's denominator is
               the carried one and it surfaces on #final-fraction.
          */}
          <p
            id="next-hint"
            className="min-w-0 truncate text-xs font-semibold uppercase tracking-widest text-gray-500"
          >
            {count
              ? state.carriedTotal
                ? `${Math.min(state.currentQuestionIndex + 1, count)} of ${count} left to redo`
                : `Question ${Math.min(state.currentQuestionIndex + 1, count)} of ${count}`
              : ''}
          </p>
          <button
            id="next-btn"
            type="button"
            className="min-h-[44px] shrink-0 bg-brand-600 hover:bg-brand-900 text-white font-bold uppercase tracking-wider py-3 px-8 transition-colors rounded-lg"
            onClick={() => dispatch({ type: 'run/advance' })}
          >
            {/* loadQuestion (app.js:2880-2884): the last question says so. */}
            <span id="next-btn-text">{isLast ? 'Finish Assessment' : 'Next Question'}</span>
          </button>
        </div>
      </div>

      {/*
        ⛔ #progress-container LIVES INSIDE #quiz-screen IN THIS PORT, and that is deliberate.
           The legacy keeps it at body level and toggles `hidden-view` by hand in
           showQuizScreen()/showResults(). Containment gives the same behaviour for free and
           for the same reason as B6: `position: fixed` escapes layout but not `display:none`,
           so hiding the quiz screen hides the bar. One less hand-toggled class to forget.
        ⚠ It renders LAST so the action bar (z-40, bottom-1.5) is not covered by this z-50
          strip; the legacy has the same 6px clearance.
      */}
      <div
        id="progress-container"
        className="fixed bottom-0 left-0 w-full h-1.5 bg-gray-800 z-50"
      >
        <div
          id="progress-bar"
          className="h-full bg-brand-600 transition-all duration-500 ease-out"
          style={{ width: `${count ? (Math.min(state.currentQuestionIndex, count) / count) * 100 : 0}%` }}
        />
      </div>
    </>
  );
}
