import type { LessonRef } from '../api';

// Lessons are numbered the way the reader numbers them: 1-based position in the chapter.
export function LessonList(props: { lessons: LessonRef[]; lessonId: string | null; onSelect: (id: string) => void }) {
  return (
    <ol id="lab-lesson-list" className="flex flex-col gap-1">
      {props.lessons.map((lesson) => {
        const active = lesson.id === props.lessonId;
        return (
          <li key={lesson.id}>
            <button
              type="button"
              data-lesson={lesson.id}
              aria-current={active ? 'true' : 'false'}
              onClick={() => props.onSelect(lesson.id)}
              className={[
                'w-full text-left min-h-[44px] px-3 py-2 rounded-lg text-sm transition-colors border',
                active
                  ? 'bg-gray-700 border-brand-600 text-white'
                  : 'border-transparent text-gray-300 hover:bg-gray-800 hover:text-white',
              ].join(' ')}
            >
              {lesson.n}. {lesson.title}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
