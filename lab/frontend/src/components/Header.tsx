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
        aria-label="Back to the study app"
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
        <span className="text-xl sm:text-2xl font-bold tracking-widest uppercase">Edu-Arg</span>
        <span className="text-xl sm:text-2xl font-light tracking-widest uppercase text-brand-600">Lab</span>
      </a>
      <div className="flex items-center gap-6 shrink-0 text-sm font-semibold tracking-wider">
        {name ? <span id="lab-user" className="hidden sm:inline text-gray-400 normal-case">{name}</span> : null}
        <a href={STUDY_HOME} className="min-h-[44px] flex items-center whitespace-nowrap uppercase text-gray-300 hover:text-white transition-colors"><span className="hidden sm:inline">Back to&nbsp;</span>study</a>
      </div>
    </header>
  );
}
