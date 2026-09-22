// Seam 15 (reader/BlockRenderer), leaf 3 — CALLOUT / DEFAULT PANEL / DEEPER.
//
// PORTED FROM (by symbol, app.js): the tail of appendTheoryContent (the callout and
// default `section` panel, including the themed title and the bullet list), renderDeeper.
//
// ⛔⛔ THE THEME TITLE IS A **LOOKUP OF COMPLETE CLASS STRINGS**, NEVER AN INTERPOLATION.
//     This is the Tailwind purge landmine that slice C fixed in the legacy app, and it
//     is just as live here: the CDN generated CSS at RUNTIME by watching the DOM, so an
//     assembled class name worked. A REAL BUILD PURGES BY SCANNING SOURCE and keeps only
//     classes whose COMPLETE NAME appears literally in a scanned file.
//     ⛔ Never `text-${theme}`. ⛔ Never a tailwind.config `safelist` — a safelist makes
//        the build green while LEAVING THE CONSTRUCTION IN PLACE, so the next themeColor
//        a book introduces loses its colour silently all over again.
//     An unknown value takes the brand-600 fallback AND stamps data-theme-fallback, so a
//     data defect becomes visible instead of silent. The gate is: a full browse of both
//     books yields ZERO [data-theme-fallback] elements.
//
// ⚠ THE LOOKUP IS **10** ENTRIES, NOT 9. Slice C measured a tenth against the DEPLOYED
//   corpus: `blue-500`, carried by data/Deployment-MLOps.json, which is live on nn. It
//   is a real Tailwind colour, so a build would have purged a colour that worked.
//   `aws-indigo` is deliberately ABSENT — it is not a Tailwind colour and never was in
//   the brand palette, so it produced no rule under the CDN either. It takes the
//   fallback and stamps itself. Inventing a hex would be guessing at a designer's intent.
import { RichTextViewer } from '../RichTextViewer';
import type { SubBlock } from '../../data/types';

/** ⛔ COMPLETE CLASS STRINGS. Never concatenated, never interpolated. */
export const THEME_TITLE_CLASS: Record<string, string> = {
  'indigo-500': 'text-lg font-semibold text-indigo-500 mb-3',
  'emerald-500': 'text-lg font-semibold text-emerald-500 mb-3',
  'purple-500': 'text-lg font-semibold text-purple-500 mb-3',
  'teal-500': 'text-lg font-semibold text-teal-500 mb-3',
  'amber-500': 'text-lg font-semibold text-amber-500 mb-3',
  'sky-500': 'text-lg font-semibold text-sky-500 mb-3',
  'rose-500': 'text-lg font-semibold text-rose-500 mb-3',
  'violet-500': 'text-lg font-semibold text-violet-500 mb-3',
  'blue-500': 'text-lg font-semibold text-blue-500 mb-3',
  'brand-600': 'text-lg font-semibold text-brand-600 mb-3',
};

export const THEME_TITLE_CLASS_FALLBACK = THEME_TITLE_CLASS['brand-600'];

export interface PanelBlockProps {
  block: SubBlock;
  /** chapter.themeColor, already defaulted to 'brand-600' by the caller. */
  theme: string;
}

export function PanelBlock({ block, theme }: PanelBlockProps) {
  const isCallout = block.type === 'callout';
  const known = Object.prototype.hasOwnProperty.call(THEME_TITLE_CLASS, theme);
  const bullets = Array.isArray(block.items)
    ? block.items
    : Array.isArray(block.bullets)
      ? block.bullets
      : null;

  return (
    <section
      className={
        isCallout
          ? 'my-6 rounded-xl border border-brand-600/40 bg-brand-600/5 p-5'
          : 'my-6 rounded-xl border border-gray-700 bg-gray-900/60 p-5'
      }
    >
      {block.title && (
        <h3
          className={
            isCallout
              ? 'text-lg font-semibold text-brand-400 mb-3'
              : THEME_TITLE_CLASS[theme] ?? THEME_TITLE_CLASS_FALLBACK
          }
          data-theme-fallback={!isCallout && !known ? String(theme) : undefined}
        >
          {block.title}
        </h3>
      )}

      {(block.content || block.intro) && (
        <div className="leading-relaxed">
          <RichTextViewer content={block.content ?? block.intro ?? ''} />
        </div>
      )}

      {bullets && (
        <ul className="mt-3 space-y-3">
          {bullets.map((entry, index) => (
            // A3: the legacy cloned tmpl-tutorial-list-item. The <span> wrapper is part
            // of that template's shape — keep it when A3 ports the markup.
            <li key={index}>
              <span>
                <RichTextViewer content={entry} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
