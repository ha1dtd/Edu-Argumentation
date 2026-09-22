// Seam 6 (state/QuizProvider), context half — one of the FOUR contexts (A2).
// The 13-field atom and its derived selectors live in ./quizReducer.
import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import { initialQuizState, quizReducer, tallyScore, tallyTotal } from './quizReducer';
import type { QuizAction, QuizState } from './quizReducer';

interface QuizContextValue {
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
  /** Derived during render. Never stored. */
  scored: number;
  /** Derived during render. Never stored. */
  total: number;
}

const QuizContext = createContext<QuizContextValue | null>(null);

export function QuizProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  const value = useMemo<QuizContextValue>(
    () => ({ state, dispatch, scored: tallyScore(state), total: tallyTotal(state) }),
    [state],
  );
  return <QuizContext.Provider value={value}>{children}</QuizContext.Provider>;
}

export function useQuiz(): QuizContextValue {
  const value = useContext(QuizContext);
  if (!value) throw new Error('useQuiz must be used inside <QuizProvider>');
  return value;
}
