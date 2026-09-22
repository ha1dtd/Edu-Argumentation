// Seam 9 (shell), part 2 — HEADER, BRAND, MENU, PRIMARY NAV.
//
// PORTED FROM (by symbol, app.js): setMenuOpen, isWideMenu, syncMenuToViewport,
// updateNavUI, NAV_BASE_CLASS, showLandingDashboard.
//
// Contract DOM this seam owns (frozen selector-contract.frozen.json):
//   header · #brand-home · #brand-home svg · #menu-btn · #menu-btn svg ·
//   #nav-learn · #nav-quiz  (plus #nav-tutorial, #nav-generated-quiz, #nav-settings,
//   #primary-nav, which the contract does not pin but the app uses)
//
// ⚠ Below `md` the nav is a dropdown; at `md+` it is an inline row and always shown.
//   The breakpoint is a matchMedia('(min-width: 768px)') query, not a CSS-only rule,
//   because `menuOpen` has to be forced true on the wide viewport or the row renders
//   collapsed after a resize.
import { useEffect } from 'react';
import type { NavTab } from './AppShell';

export interface HeaderProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onBrandHome: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  /**
   * syncMenuToViewport() — set, not toggle. See MENU_WIDE below for why the header cannot
   * derive this locally without diverging from the legacy's `aria-expanded`.
   */
  onSyncMenu: (open: boolean) => void;
}

// ── NAV_BASE_CLASS, ported VERBATIM from app.js ────────────────────────────────
// ⛔ THIS IS ONE STRING AND IT STAYS ONE STRING. The legacy's own comment says why it is
//    reassigned wholesale rather than patched: it "carries both layouts", so rewriting
//    className piecemeal wipes the responsive classes and leaves the mobile menu unstyled.
// ⛔ PURGE LANDMINE (ruling R8, Step C): every class name here is a COMPLETE LITERAL. A
//    real Tailwind build keeps only classes whose full name appears literally in a scanned
//    file, so an assembled name (`border-${x}`) emits nothing and the tab silently loses
//    its colour. Never interpolate a class name in this file.
const NAV_BASE_CLASS =
  'min-h-[44px] px-3 md:px-0 text-left md:text-center rounded-lg md:rounded-none pb-0 md:pb-1 border-b-2 border-transparent text-gray-400 transition-colors hover:text-white';

// updateNavUI's active override: the legacy REMOVES border-transparent + text-gray-400 and
// ADDS border-brand-500 + text-white. Same two swaps, expressed as a whole string.
const NAV_ACTIVE_CLASS =
  'min-h-[44px] px-3 md:px-0 text-left md:text-center rounded-lg md:rounded-none pb-0 md:pb-1 border-b-2 border-brand-500 text-white transition-colors hover:text-white';

/** The legacy's breakpoint, verbatim (app.js `MENU_WIDE`). */
const MENU_WIDE = '(min-width: 768px)';

/**
 * isWideMenu() — app.js's own helper, EXPORTED 22-09-26 (EVL fix 003) because the nav-click
 * handlers need it and they live in shell/AppShell.
 *
 * ⛔⛔ D-8 — THIS GUARD IS WHY THE NAV STOPPED WORKING AFTER THE FIRST CLICK.
 *     Every legacy nav listener closes the menu CONDITIONALLY (app.js:3487-3490):
 *         el.addEventListener('click', () => { if (!isWideMenu()) setMenuOpen(false); });
 *     The port dropped the guard and called setMenuOpen(false) unconditionally. `#primary-nav`
 *     hides with `.hidden-view` (display:none) whenever menuOpen is false, and the media-query
 *     listener only fires on a CHANGE — so at a desktop width the FIRST nav selection hid the
 *     ENTIRE NAV and nothing ever showed it again short of a resize.
 *     MEASURED on the deployed :8792 at 1440x1000, click-by-click: #nav-tutorial and #nav-quiz
 *     worked once each, and from then on EVERY nav control — PRACTICE, GENERATE QUIZ,
 *     SETTINGS, HOME — timed out, on EVERY screen, not only behind the quiz-setup overlay.
 *     The overlay was the place it was first noticed, not the cause.
 * ⚠ It is a live media query, read at click time, not a cached boolean: the header cannot
 *   decide this from a CSS class because the decision is behavioural, not presentational.
 */
export function isWideMenu(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MENU_WIDE).matches;
}

/** The five nav tabs, in the legacy's document order. `null` == HOME, which is brand-home's
 *  target: app.js maps #nav-tutorial to showLandingDashboard + updateNavUI('tutorial'). */
const NAV_TABS: ReadonlyArray<{ id: string; label: string; tab: NavTab | null }> = [
  { id: 'nav-tutorial', label: 'HOME', tab: null },
  { id: 'nav-learn', label: 'LEARN', tab: 'learn' },
  { id: 'nav-quiz', label: 'PRACTICE', tab: 'quiz' },
  { id: 'nav-generated-quiz', label: 'GENERATE QUIZ', tab: 'generated' },
  { id: 'nav-settings', label: 'SETTINGS', tab: 'settings' },
];

export function Header(props: HeaderProps) {
  const { activeTab, onSelectTab, onBrandHome, menuOpen, onToggleMenu, onSyncMenu } = props;

  // ⛔⛔ syncMenuToViewport — app.js:3491 + :3500, BOTH halves.
  //     Below md the nav is a dropdown (hidden until #menu-btn is pressed); at md+ it is an
  //     inline row that is ALWAYS shown. The legacy implements "always shown" by FORCING
  //     menuOpen true on a wide viewport — it is not a CSS-only rule — and it does so on
  //     DOMContentLoaded *and* on every matchMedia change.
  //     ⛔ Both are needed. Without the mount call the row renders collapsed on a desktop
  //        first paint; without the listener it collapses after a resize past the breakpoint
  //        and never comes back.
  //     ⚠ This is deliberately a SET (onSyncMenu) and not a toggle. Deriving "open || wide"
  //       locally would render the same pixels but leave #menu-btn's aria-expanded reading
  //       "false" while the nav is open — a divergence from the legacy that a DOM gate
  //       would not catch and a screen-reader user would.
  useEffect(() => {
    const query = window.matchMedia(MENU_WIDE);
    const sync = () => onSyncMenu(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [onSyncMenu]);

  return (
    /*
      Ported from aws-quiz-app/index.html's <header>. `relative` alongside `fixed` is the
      legacy's own pairing and is load-bearing for the dropdown: #primary-nav is
      `absolute top-full`, so it positions against THIS element.
      ⚠ `.glass-header` has NO RULE in src/styles/app.css — that stylesheet lists it under
        "NOT PORTED, appearance only". The class name is kept so the header is already
        correct the day the rule lands; today it contributes nothing. Tier 4, unverified.
    */
    <header
      className="glass-header fixed top-0 left-0 right-0 z-50 px-6 sm:px-12 py-5 flex justify-between items-center text-white relative"
      data-active-tab={activeTab}
    >
      {/*
        ⛔ `#brand-home svg` IS A PINNED CONTRACT SELECTOR (gate-a.mjs). The mark is inline
           SVG, ported shape-for-shape from aws-quiz-app/index.html:176-184 — NOT an <img>
           and NOT a background-image. Both of those render an identical-looking logo and
           empty the selector, which is the whole hazard the `tags` category exists for.
        ⚠ `fill="#ef5b5b"` on the middle bar is the brand red and is the ONE hard-coded
           colour here; everything else is `currentColor` so hover/active recolour it.
      */}
      <button
        id="brand-home"
        type="button"
        onClick={onBrandHome}
        className="flex items-center gap-3 min-h-[44px] rounded-lg pr-2 text-white transition-colors hover:text-brand-400 active:scale-95"
        aria-label="Back to the main menu"
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
        <h1 className="text-2xl font-bold tracking-widest uppercase">Edu-Arg</h1>
      </button>

      {/*
        ⛔ `#menu-btn svg` IS PINNED TOO, and `md:hidden` is a CLASS — the button is hidden
           at md+ by CSS, NEVER unmounted, or the sweep goes red on a wide viewport only
           (a failure that reproduces on one machine and not another).
        ⚠ aria-expanded is the STRING "true"/"false", same rule as aria-current (A3b):
           React drops `aria-expanded={false}` from the DOM entirely.
      */}
      {/*
        ⛔ #primary-nav HIDES BY CLASS (`hidden-view`), NEVER by unmounting. `#nav-learn` and
           `#nav-quiz` are pinned contract selectors and must resolve at ANY viewport and in
           ANY menu state — an unmounted dropdown empties both on a phone-width sweep only,
           which is a failure that reproduces on one machine and not another.
        The class string is the legacy's, verbatim: below md an absolutely-positioned card
        under the header; at md+ a static inline row with the card's chrome removed.
      */}
      <nav
        id="primary-nav"
        className={[
          'absolute md:static top-full right-4 md:right-auto mt-2 md:mt-0 flex flex-col md:flex-row items-stretch md:items-center gap-1 md:gap-8 text-sm font-semibold tracking-wider bg-gray-800 md:bg-transparent border md:border-0 border-gray-700 rounded-xl md:rounded-none p-2 md:p-0 shadow-2xl md:shadow-none min-w-[13rem] md:min-w-0 z-50',
          menuOpen ? null : 'hidden-view',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {NAV_TABS.map(({ id, label, tab }) => {
          // HOME is active whenever no other tab is — it is the landing state, and the
          // legacy's updateNavUI('tutorial') is what showLandingDashboard calls.
          const active = tab === null ? false : activeTab === tab;
          return (
            <button
              key={id}
              id={id}
              type="button"
              className={active ? NAV_ACTIVE_CLASS : NAV_BASE_CLASS}
              /* ⛔ THE STRING "true"/"false", never the boolean — React DROPS
                    aria-current={false} from the DOM entirely, and `[aria-current="true"]`
                    is a pinned attributeExpression (A3b). The asymmetry is the whole trap:
                    the false case has to be present and say "false". */
              aria-current={active ? 'true' : 'false'}
              onClick={() => {
                if (tab === null) onBrandHome();
                else onSelectTab(tab);
              }}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {/*
        The legacy's right-hand cluster (index.html). ⚠ It holds #menu-btn ONLY here: the
        `#custom-data-upload` input and its <label> were deliberately placed in
        library/LibraryScreen.tsx by slice A1 — recorded there as a declared placement
        deviation, since `label[for="custom-data-upload"] svg` is UNSCOPED and resolves
        either way while also satisfying `#services-section … label` with one element.
        Do not "restore" them here; that would create a SECOND matching element.
      */}
      <div className="flex items-center gap-4">
        <button
          id="menu-btn"
          type="button"
          onClick={onToggleMenu}
          className="md:hidden min-h-[44px] min-w-[44px] rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 transition-colors active:scale-95"
          aria-controls="primary-nav"
          aria-expanded={menuOpen ? 'true' : 'false'}
          aria-label="Open menu"
        >
          <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </header>
  );
}
