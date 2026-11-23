// Account redesign B + C (23-11-26): "Your learning" for ONE book — what is weak, what is improving, how much
// time per topic, how the review schedule is going. Source: GET /api/account/insights (backend/insights.py
// documents every number; the same definitions are printed under each block).
// ⛔ Class strings are complete literals (Tailwind purge). Every chart value is also text.
import type { ReactNode } from 'react';
import { useBookContext } from '../state/BookProvider';
import { useQuiz } from '../state/QuizProvider';
import { SESSION_SIZE, useAccountInsights, usePrefs } from '../data/queries';
import type { AccountInsights, MasteryArea, SessionRow, TopicRow } from '../data/types';
import { BODY_MUTED, CAPTION, OUTLINE_BTN } from '../shell/ui';
import { Heatmap, WeekTrend } from './charts';
import { fmtMs, fmtPct, plural, shortDay, signed } from './format';
import { areaQuestions, drawForArea } from './ProgressPanel';

const SUB_TITLE = 'text-lg font-semibold text-white';
const BLOCK = 'mt-8';

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div id={id} className={BLOCK} role="group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className={SUB_TITLE}>{title}</h3>
      {children}
    </div>
  );
}

const KIND_WORD: Record<string, string> = { practice: 'Practice', quiz: 'AI quiz', review: 'Review', exam: 'Exam', retry: 'Retry wrong' };

function trendWord(t: TopicRow['trend']): string {
  if (t.delta === null) return 'not enough answers for a trend yet';
  return `${t.label} (${signed(t.delta)} points: newest ${t.recent}% vs earlier ${t.earlier}%)`;
}

function TopicLine({ topic, onPractice, canPractice, withTrend }: {
  topic: TopicRow; onPractice: (t: TopicRow) => void; canPractice: (t: TopicRow) => boolean; withTrend: boolean;
}) {
  const width = topic.accuracy ?? 0;
  const below = (topic.accuracy ?? 0) < 80;
  const practicable = canPractice(topic);
  return (
    <li data-topic={topic.id} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 break-words font-semibold text-white" data-cell="name">{topic.name}</span>
        <span className="tabular-nums text-sm" data-cell="pct">
          <span className="font-semibold text-white">{fmtPct(topic.accuracy)}</span>{' '}
          <span className="ml-1 text-gray-400">{topic.right}/{topic.answered}</span>
        </span>
        <button type="button" className={`${OUTLINE_BTN} ml-auto`} disabled={!practicable} data-practice-topic={topic.id}
          aria-label={`Practice ${topic.name}`} onClick={() => onPractice(topic)}>
          Practice
        </button>
      </div>
      <span className="mt-2 block relative h-2 rounded-full bg-gray-700 overflow-hidden" aria-hidden="true">
        <span className={`absolute inset-y-0 left-0 rounded-full ${below ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${width}%` }} />
      </span>
      <p className="mt-2 text-xs text-gray-400 break-words" data-cell="facts">
        {topic.currentlyWrong ? `${plural(topic.currentlyWrong, 'question')} wrong now` : 'nothing wrong now'}
        {topic.cards ? ` · ${plural(topic.lapses, 'lapse')} on ${plural(topic.cards, 'card')}` : ''}
        {topic.leeches ? ` · ${plural(topic.leeches, 'leech', 'leeches')}` : ''}
        {withTrend ? ` · ${trendWord(topic.trend)}` : ''}
        {!practicable ? ' · no questions for it in the open book' : ''}
      </p>
    </li>
  );
}

function TrendLine({ topic }: { topic: TopicRow }) {
  return (
    <li data-topic={topic.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="min-w-0 break-words text-gray-200">{topic.name}</span>
      <span className="tabular-nums text-white font-semibold">{topic.trend.earlier}% → {topic.trend.recent}%</span>
      <span className="text-xs text-gray-400">{signed(topic.trend.delta ?? 0)} points</span>
    </li>
  );
}

function TimeBlock({ time }: { time: AccountInsights['time'] }) {
  const max = Math.max(1, ...time.byTopic.map((t) => t.ms));
  const sessions: SessionRow[] = time.sessions;
  return (
    <Block id="insights-time" title="Time spent">
      {!time.trackedAnswers ? (
        <p className={BODY_MUTED}>No question time measured yet. It is recorded from now on, for every answer you give.</p>
      ) : (
        <>
          <p className={BODY_MUTED} data-cell="time-total">
            <span className="text-white font-semibold">{fmtMs(time.totalMs)}</span> on questions across {plural(time.trackedAnswers, 'timed answer')}
            {time.since ? ` since ${shortDay(time.since.slice(0, 10))}` : ''}; {fmtMs(time.avgQuestionMs)} per question
            {time.avgSessionMs ? `, ${fmtMs(time.avgSessionMs)} per session` : ''}.
            {time.untrackedAnswers ? ` ${plural(time.untrackedAnswers, 'older answer')} had no timer and are not counted.` : ''}
          </p>
          <ul id="time-by-topic" className="mt-4 space-y-2">
            {time.byTopic.map((t) => (
              <li key={t.id} data-topic={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                <span className="min-w-0 break-words text-gray-200">{t.name}</span>
                <span className="order-3 col-span-2 sm:order-none sm:col-span-1 relative h-2.5 rounded-full bg-gray-700 overflow-hidden" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-sky-400" style={{ width: `${Math.max(2, Math.round((100 * t.ms) / max))}%` }} />
                </span>
                <span className="tabular-nums whitespace-nowrap text-right" data-cell="time">
                  <span className="font-semibold text-white">{fmtMs(t.ms)}</span>{' '}
                  <span className="ml-1 text-gray-400">{fmtMs(t.avgMs)} each</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {sessions.length > 0 && (
        <details className="mt-4" id="insights-sessions">
          <summary className="cursor-pointer text-sm text-gray-200 min-h-[44px] flex items-center">Recent sessions ({time.sessionsTotal} in all)</summary>
          <ul className="divide-y divide-gray-700 text-sm">
            {sessions.map((s) => (
              <li key={s.runId} className="py-2 flex flex-wrap justify-between gap-x-3 gap-y-1" data-run={s.runId}>
                <span className="text-gray-200">{KIND_WORD[s.kind] ?? s.kind} · {s.right}/{s.answered} right</span>
                <span className="tabular-nums text-gray-400">{s.ms === null ? 'time not measured' : fmtMs(s.ms)} · {shortDay(s.at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-xs text-gray-400">Time = how long a question was on screen before you answered it (time with the tab hidden is left out, and one question counts at most 5 minutes). Reading lessons is not timed.</p>
    </Block>
  );
}

function ScheduleBlock({ data }: { data: AccountInsights }) {
  const { srs, grades, calibration } = data;
  const peak = Math.max(1, ...srs.next7.map((d) => d.count));
  const pctOf = (n: number) => (grades.total ? Math.round((100 * n) / grades.total) : 0);
  const cal = (['sure', 'unsure', 'guess'] as const).filter((c) => calibration[c].n > 0);
  return (
    <Block id="insights-schedule" title="Review schedule">
      <p className={BODY_MUTED} data-cell="schedule-summary">
        <span className="text-white font-semibold">{srs.dueNow}</span> cards due now of {srs.total}
        {srs.leeches ? ` · ${plural(srs.leeches, 'leech', 'leeches')} (missed 6+ times)` : ''}
        {data.retention30 !== null ? ` · recall ${data.retention30}% over the last 30 days (${plural(data.reviews30, 'review answer')})` : ''}.
      </p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className={CAPTION}>Due in the next 7 days</h4>
          <ul id="next7" className="mt-2 flex items-end gap-1.5 h-20" aria-label="Cards due per day, next 7 days">
            {srs.next7.map((d) => (
              <li key={d.day} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" data-day={d.day} data-count={d.count}>
                <span className="text-[11px] tabular-nums text-gray-200">{d.count}</span>
                <span className="w-full rounded-t bg-sky-400" style={{ height: `${Math.max(3, Math.round((100 * d.count) / peak) * 0.6)}%` }} aria-hidden="true" />
              </li>
            ))}
          </ul>
          <div className="mt-1 flex justify-between text-[11px] text-gray-400 tabular-nums" aria-hidden="true">
            <span>{shortDay(srs.next7[0].day)}</span><span>{shortDay(srs.next7[srs.next7.length - 1].day)}</span>
          </div>
        </div>
        <div>
          <h4 className={CAPTION}>Cards by stage</h4>
          <dl id="stages" className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-400">New (never graded)</dt><dd className="text-white tabular-nums">{srs.stages.new}</dd>
            <dt className="text-gray-400">Learning (under 4 days)</dt><dd className="text-white tabular-nums">{srs.stages.learning}</dd>
            <dt className="text-gray-400">Young (4 to 13 days)</dt><dd className="text-white tabular-nums">{srs.stages.young}</dd>
            <dt className="text-gray-400">Mature (14-day cap)</dt><dd className="text-white tabular-nums">{srs.stages.mature}</dd>
          </dl>
        </div>
      </div>
      <h4 className={`mt-6 ${CAPTION}`}>How you graded your reviews</h4>
      {grades.total ? (
        <p id="grade-mix" className="mt-2 text-sm text-gray-200 tabular-nums" data-total={grades.total}>
          Again {grades.again} ({pctOf(grades.again)}%) · Hard {grades.hard} ({pctOf(grades.hard)}%) · Good {grades.good} ({pctOf(grades.good)}%) · Easy {grades.easy} ({pctOf(grades.easy)}%)
          <span className="text-gray-400"> — {plural(grades.total, 'grade')}{grades.since ? ` since ${shortDay(grades.since.slice(0, 10))}` : ''}</span>
        </p>
      ) : (
        <p id="grade-mix" className="mt-2 text-sm text-gray-400">No grades logged yet. Every Hard / Good / Easy you press from now on is kept.</p>
      )}
      {cal.length > 0 && (
        <p id="calibration" className="mt-3 text-sm text-gray-200">
          When you said{' '}
          {cal.map((c, i) => (
            <span key={c}>{i ? ', ' : ''}“{c}” you were right {fmtPct(Math.round((100 * calibration[c].right) / calibration[c].n))} of the time ({calibration[c].n})</span>
          ))}.
        </p>
      )}
    </Block>
  );
}

export function InsightsPanel({ moduleId, title, open, onStartRun }: { moduleId: string; title: string; open: boolean; onStartRun: () => void }) {
  const query = useAccountInsights(moduleId, open);
  const { moduleId: openModule, quizBank } = useBookContext();
  const { dispatch } = useQuiz();
  const prefs = usePrefs(openModule, open);
  const size = prefs.data?.sessionSize ?? SESSION_SIZE.fallback;
  const sameBook = openModule === moduleId;
  const asArea = (t: TopicRow): MasteryArea => ({ id: t.id, name: t.name, chapters: t.chapters, right: 0, answered: 0, pct: null });
  const canPractice = (t: TopicRow) => sameBook && quizBank.length > 0 && areaQuestions(quizBank, asArea(t)).length > 0;
  const practice = (t: TopicRow) => {
    const questions = drawForArea(quizBank, asArea(t), size);
    if (!questions.length) return;
    dispatch({ type: 'run/reset', questions });
    dispatch({ type: 'scope/set', scope: 'selection', label: t.name, blockId: null });
    onStartRun();
  };

  if (query.isLoading) return <p className="mt-6 text-sm text-gray-400" aria-busy="true" id="insights-loading">Loading your learning insights…</p>;
  if (query.isError || !query.data) return <p className="mt-6 text-sm text-red-300" role="alert" id="insights-error">Could not load the insights for {title}.</p>;
  const d = query.data;
  const hasData = d.answeredTotal > 0 || d.srs.total > 0;
  if (!hasData) return <p id="insights-empty" className="mt-6 text-sm text-gray-400">No answers in {title} yet. Practise a chapter and your weak spots, trend and time appear here.</p>;
  const topicWord = d.areaKind === 'domain' ? 'domains' : 'topics';
  return (
    <div id="insights-body" data-module={moduleId}>
      <Block id="insights-weak" title={`What is weak`}>
        <p className={BODY_MUTED}>
          Lowest accuracy first, {topicWord} with at least {d.minAnswers} answers. {plural(d.currentlyWrong, 'question')} in this book are wrong right now (your latest answer to them was wrong).
        </p>
        {d.weak.length ? (
          <ul id="weak-list" className="mt-4 space-y-3">
            {d.weak.map((t) => <TopicLine key={t.id} topic={t} onPractice={practice} canPractice={canPractice} withTrend />)}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-gray-400" id="weak-empty">Not enough answers yet to rank anything (needs {d.minAnswers} in a topic).</p>
        )}
        {d.notStarted.length > 0 && (
          <p id="not-started" className="mt-4 text-sm text-gray-400">
            <span className="text-gray-200">Not started:</span> {d.notStarted.join(' · ')}.
          </p>
        )}
        <p className="mt-3 text-xs text-gray-400">
          Chapter and practice-set answers on the same subject count together. Retries are left out. “Lapses” = times a review card went back to the start.
          {d.unassigned ? ` ${plural(d.unassigned, 'answer')} fit no topic.` : ''}
        </p>
      </Block>

      <Block id="insights-improving" title="What is improving">
        {d.improving.length || d.slipping.length ? (
          <>
            {d.improving.length > 0 && (
              <ul id="improving-list" className="mt-3 space-y-2" aria-label="Improving topics">
                {d.improving.map((t) => <TrendLine key={t.id} topic={t} />)}
              </ul>
            )}
            {d.slipping.length > 0 && (
              <>
                <h4 className={`mt-4 ${CAPTION}`}>Slipping</h4>
                <ul id="slipping-list" className="mt-2 space-y-2" aria-label="Slipping topics">
                  {d.slipping.map((t) => <TrendLine key={t.id} topic={t} />)}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className={BODY_MUTED} id="improving-empty">No topic has moved by 10 points or more yet.</p>
        )}
        <p className="mt-3 text-xs text-gray-400">Newest 10 answers of a topic vs the answers before them (needs 15 or more answers). Moved 10+ points = improving or slipping.</p>
      </Block>

      <Block id="insights-activity" title="Activity and trend">
        <div className="mt-3"><Heatmap from={d.heatmap.from} days={d.heatmap.days} max={d.heatmap.max} /></div>
        <div className="mt-6"><WeekTrend weeks={d.weeks} /></div>
      </Block>

      <TimeBlock time={d.time} />
      <ScheduleBlock data={d} />
    </div>
  );
}
