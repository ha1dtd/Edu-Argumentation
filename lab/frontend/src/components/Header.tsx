// The study app's top bar look (app/frontend/src/shell/Header.tsx): same logo mark, same
// type, same brand red — with "Lab" after the name and a way back to the study app.
// On the VPN door (http://<host>:8798) the study app is on its own port; through the public
// nginx it is this origin's root.
const STUDY_HOME = window.location.port === '8798' ? `${window.location.protocol}//${window.location.hostname}:8767/` : '/';

export function Header({ name }: { name: string | null }) {
  return (
    <header className="px-4 sm:px-12 py-4 sm:py-5 gap-4 flex justify-between items-center text-white border-b border-gray-800 bg-gray-900">
      <a
        id="lab-brand"
        href={STUDY_HOME}
        className="flex items-center gap-3 min-w-0 min-h-[44px] rounded-lg pr-2 whitespace-nowrap text-white transition-colors hover:text-brand-400"
        aria-label="Lab — back to the study app"
      >
        <svg className="w-8 h-8 shrink-0" viewBox="0 0 40 40" aria-hidden="true">
          <rect x="2" y="2" width="36" height="36" rx="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <g fill="currentColor">
            <rect x="13" y="11" width="4.5" height="18" rx="1" />
            <rect x="13" y="11" width="14" height="4.5" rx="1" />
            <rect x="13" y="24.5" width="14" height="4.5" rx="1" />
          </g>
          <rect x="13" y="17.75" width="10" height="4.5" rx="1" fill="#ef5b5b" />
        </svg>
        {/* ⚑ 25-09-26 (user): the mark + "Lab" only, like the importer's mark + "Importer". */}
        <span className="text-xl sm:text-2xl font-bold tracking-widest uppercase">Lab</span>
      </a>
      <div className="flex items-center gap-6 shrink-0 text-sm font-semibold tracking-wider">
        {/* ⚑ 25-09-26 (user): the signed-in account in brand red, so it is obvious whose kernel runs. */}
        {name ? <span id="lab-user" className="hidden sm:inline text-brand-600 normal-case">{name}</span> : null}
        {/* ⚑ 25-09-26 (user): the way back to the study app is a BOOK glyph (same glyph as the importer's). */}
        <a
          id="lab-study-link"
          href={STUDY_HOME}
          title="Study app"
          aria-label="Study app"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-brand-600 transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 6.5C10.3 5.2 7.9 4.5 4 4.5v13c3.9 0 6.3.7 8 2 1.7-1.3 4.1-2 8-2v-13c-3.9 0-6.3.7-8 2z" />
            <path d="M12 6.5v13" />
          </svg>
        </a>
      </div>
    </header>
  );
}
