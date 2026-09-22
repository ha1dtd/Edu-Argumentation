// Seam 18 (exercises), part 3 — THE PANEL. Split out of renderExercises.
//
// renderExercises is 202 lines, THE LONGEST of the six spanning functions, and it spanned
// five concerns at once. It is split four ways:
//   1. WHAT IS AN EXERCISE      -> exercises/exerciseSpec.ts
//   2. STATE + PERSISTENCE      -> exercises/exerciseReducer.ts   (⚑ the A1b delta)
//   3. THE OPTION CARD          -> quiz/OptionCard.tsx            (⛔ shared with the quiz)
//   4. LAYOUT + THE THREE CONTROLS -> here
//   5. MARKING (a model call)   -> stays OUT of Phase 03: submitWrittenExercises POSTs,
//      and Phase 03's bundle must contain ZERO non-GET call sites. The Submit button
//      renders DISABLED; A4/Phase 04 wires it.
//
// ⚑ THE A1b DELTA LIVES IN exerciseReducer.ts — read its header. In short: the three
//   controls below used to call renderTheoryBlock() and rebuild the WHOLE theory block;
//   here they dispatch, and the re-render scopes to this panel.
//
// ⚠ `data-exercise-panel` is a STABLE HOOK and not decoration: the panel's class set is
//   shared with the plain callout block, so a gate keyed on the class silently matches
//   the wrong element.
import { useEffect, useReducer } from 'react';
import { RichTextViewer } from '../reader/RichTextViewer';
import { OptionCard } from '../quiz/OptionCard';
import {
  emptyExerciseState,
  exerciseReducer,
  exerciseStoreKey,
  readExerciseState,
  writeExerciseState,
} from './exerciseReducer';
import type { ExerciseSpec } from './exerciseSpec';
import { useBookContext } from '../state/BookProvider';

export interface ExercisePanelProps {
  spec: ExerciseSpec;
  /** ch01-b08 — the block this panel's answers are stored under. */
  blockId?: string;
}

export function ExercisePanel({ spec, blockId = '' }: ExercisePanelProps) {
  const { moduleId } = useBookContext();
  const storeKey = exerciseStoreKey(moduleId, blockId);
  const [state, dispatch] = useReducer(exerciseReducer, emptyExerciseState, () =>
    readExerciseState(storeKey),
  );

  // ⛔ localStorage, never the server. See exerciseReducer's header.
  useEffect(() => {
    writeExerciseState(storeKey, state);
  }, [storeKey, state]);

  const hasChoices = spec.list.every(
    (entry) => Array.isArray(entry.options) && entry.options.length > 1 && Number.isInteger(entry.correct),
  );
  const mode = state.mode === 'choose' && !hasChoices ? 'write' : state.mode;

  const isRight = (n: number) => state.verdicts[n]?.verdict === 'correct';
  const full = spec.list;
  // Retry narrows the panel to what is LEFT — but only when there is genuinely a mix.
  const retryOnly = state.retryOnly && full.some((e) => isRight(e.n)) && full.some((e) => !isRight(e.n));
  const list = retryOnly ? full.filter((entry) => !isRight(entry.n)) : full;
  const carry = { hidden: full.length - list.length, total: full.length };

  return (
    <section className="my-6 rounded-xl border border-brand-600/40 bg-brand-600/5 p-5" data-exercise-panel="true">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-brand-400">
          {spec.title ?? `${spec.list.length} book exercises`}
        </h3>
        <div className="inline-flex rounded-lg border border-gray-600 overflow-hidden">
          {(['write', 'choose'] as const).map((value) => (
            <button
              key={value}
              type="button"
              disabled={value === 'choose' && !hasChoices}
              title={
                value === 'choose' && !hasChoices
                  ? 'This module has no multiple-choice options for its exercises yet.'
                  : undefined
              }
              // ⚑ A1b: dispatch, not renderTheoryBlock().
              onClick={() => dispatch({ type: 'mode/set', mode: value })}
            >
              {value === 'write' ? 'Write answers' : 'Multiple choice'}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-5 text-sm text-gray-400 leading-relaxed">
        {mode === 'write'
          ? 'Answer in your own words — you are marked on the meaning, not on matching the book’s wording. Answer all of them, then submit once.'
          : 'Pick an answer and it is marked straight away. Nothing is sent anywhere, so this works even with the AI quota spent.'}
      </p>

      {retryOnly && (
        <p className="mb-4 text-sm font-semibold text-brand-400">
          {`Retrying ${list.length} of ${carry.total} — ${carry.hidden} already correct and hidden. ${mode === 'write' ? 'Clear' : 'Start over'} brings them all back.`}
        </p>
      )}

      {list.map((entry) => (
        <div key={entry.n} className="mb-6 border-t border-gray-700/60 pt-5 first:border-t-0 first:pt-0" data-exercise-row={String(entry.n)}>
          <div className="font-medium leading-relaxed [overflow-wrap:anywhere]">
            <RichTextViewer content={entry.prompt} />
          </div>

          {mode === 'write' ? (
            <textarea
              className="mt-3 w-full rounded-lg border border-gray-600 bg-gray-900/70 p-3 text-sm leading-relaxed text-white placeholder-gray-500 focus:border-brand-600 focus:outline-none"
              rows={3}
              placeholder="Your answer…"
              maxLength={1500}
              value={state.answers[entry.n] ?? ''}
              onChange={(event) => dispatch({ type: 'answer/write', n: entry.n, text: event.target.value })}
            />
          ) : (
            <div className="mt-4 space-y-3">
              {(entry.options ?? []).map((text, index) => (
                <OptionCard
                  key={index}
                  index={index}
                  selected={state.picks[entry.n] === index}
                  // ⛔ D-12, the SECOND call site of the shared card — kept in lockstep with
                  //    quiz/QuizScreen.tsx by hand because they are two call sites of ONE
                  //    component. Every option resolves once the row is answered; `selected`
                  //    below separates the learner's wrong pick from the ones they did not
                  //    touch. R-B5b reds if these two ever diverge.
                  reveal={
                    state.verdicts[entry.n]
                      ? index === entry.correct
                        ? 'correct'
                        : 'incorrect'
                      : null
                  }
                  explanation={entry.explanations?.[index]}
                  disabled={Boolean(state.verdicts[entry.n])}
                  // Answer ON THE CLICK, exactly like the quiz: no separate Check step.
                  onSelect={() =>
                    dispatch({ type: 'answer/pick', n: entry.n, index, correct: index === entry.correct })
                  }
                >
                  <RichTextViewer content={text} />
                </OptionCard>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-700/60 pt-5">
        {mode === 'write' && (
          // ⛔ DISABLED IN PHASE 03. submitWrittenExercises() POSTs to the model in ONE
          //    call; a POST here would fail the read-only bundle gate. A4/P4 wires it.
          <button type="button" disabled title="Marking is not available in this phase yet.">
            Submit for marking
          </button>
        )}
        {/* ⚑ A1b: dispatch, not renderTheoryBlock(). */}
        <button type="button" onClick={() => dispatch({ type: 'retry/wrongOnly' })}>
          Retry the wrong ones
        </button>
        <button type="button" onClick={() => dispatch({ type: 'answers/clear' })}>
          {mode === 'write' ? 'Clear' : 'Start over'}
        </button>
      </div>
    </section>
  );
}
