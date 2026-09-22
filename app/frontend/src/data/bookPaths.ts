// Seam 1 (data/client), second file — HOW A BOOK ADDRESSES ITS OWN FILES.
//
// PORTED FROM (by symbol, app.js): DEFAULT_BOOK, bookUrlFor, assetUrl, moduleIdFor.
//
// ⛔⛔ CORRECTED BY SLICE A2, 22-09-26. A1 sent EVERY book to `/book/<file>/module.json`.
//    There are TWO shapes and only one of them lives under /book/:
//      · PACKAGED  library/<moduleId>/{module.json, assets/}  -> /book/<id>/module.json
//      · LEGACY    data/<name>.json                           -> /data/<name>.json
//    app/backend/main.py serves /book/{rest:path} through content.resolve_book_file(), which
//    rejects anything that is not a packaged module id — so a legacy book requested there is
//    a guaranteed 404 with no console error beyond the fetch failure.
//    ⛔ Identified BY SHAPE, never by the library listing: at startup the default book is
//       opened before /api/modules has answered (app.js:59-63), and looking it up there made
//       the first load 404 and left the home dashboard empty.
//
// ⛔ The backend registers the guarded /book/ and /assets/ FileResponse routes BEFORE the
//    SPA StaticFiles mount, and Starlette matches in registration order. Never construct a
//    book URL that bypasses those prefixes — the traversal guard and the import-report.json
//    allowlist live on them.

import type { ModulePayload } from './types';

/** The packaged book that loads when nothing else is selected. */
export const DEFAULT_BOOK = 'geron-homl3';

export interface BookLocation {
  /** Where to fetch the payload. */
  url: string;
  /** What this book's `src` values are relative to. '' for a legacy book. */
  base: string;
}

/** Packaged == a bare folder name. Legacy == a *.json filename. Shape, not a lookup. */
export function isPackagedBookFile(file: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(file) && !file.endsWith('.json');
}

/**
 * bookUrlFor — mirrors app.js:64-69 exactly, both branches.
 *
 * ⛔⛔ `base` IS `/book/<id>/`, **NOT** `/book/<id>/assets/`. CORRECTED 22-09-26 (EVL fix 003).
 *     A packaged book's `src` values ALREADY CARRY the `assets/` segment — MEASURED on the live
 *     library: all 564 `src` values in geron-homl3/module.json begin `assets/`, e.g.
 *     `assets/fig-2-9.png`. The legacy is explicit about it (app.js:55-57):
 *         "A packaged book sets it to book/<moduleId>/, so its `src` is relative to the BOOK
 *          (assets/x.png) and the same folder works unzipped anywhere."
 *     Appending `assets/` here joined the segment TWICE and every book figure 404'd on
 *         /book/geron-homl3/assets/assets/fig-2-9.png
 *     ⛔ THE DATA IS THE CONTRACT — a book is a PACKAGE and `src` is relative to the BOOK.
 *        Do NOT "fix" this by rewriting module.json; the join is what was wrong.
 *     ⚠ Only two 404s were ever OBSERVED because only one block had been opened. All 564 were
 *       broken; they are simply lazy-loaded.
 */
export function bookLocationFor(file: string): BookLocation {
  return isPackagedBookFile(file)
    ? { url: `/book/${encodeURIComponent(file)}/module.json`, base: `/book/${file}/` }
    : { url: `/data/${encodeURIComponent(file)}`, base: '' };
}

/** Kept for callers that only want the fetch URL. */
export function bookUrlFor(file: string): string {
  return bookLocationFor(file).url;
}

/**
 * Resolve one asset `src` against its book.
 *
 * ⚠ `src` is relative to the BOOK, not to the app. Joining it against the page URL is
 * the bug that silently serves a 404 image with no console error.
 * Mirrors assetUrl() at app.js:71-74, including the `data:` passthrough A1 dropped.
 */
export function assetUrl(assetBase: string, src: string): string {
  if (!src) return '';
  if (/^(https?:|data:|\/\/|\/)/.test(src)) return src;
  if (!assetBase) return src;
  return `${assetBase.replace(/\/$/, '')}/${src.replace(/^\.?\//, '')}`;
}

/**
 * The BOOK prefix for a packaged book, when only the module id is known.
 *
 * ⛔ Corrected with bookLocationFor above and for the SAME reason: what `src` is relative to is
 *    the BOOK, not the book's assets folder. It returned `/book/<id>/assets` and would have
 *    reproduced the doubled-segment 404 the day something called it.
 * ⚠ MEASURED 22-09-26: this function has ZERO callers in the React tree — only `location.base`
 *   flows to VisualBlock. Fixed rather than deleted so the two cannot disagree later, and
 *   named here so nobody re-derives the wrong shape from it.
 */
export function assetBaseFor(moduleId: string): string {
  return `/book/${encodeURIComponent(moduleId)}/`;
}

/**
 * The module id a book is keyed by — progress, exercise state and code-cell state are
 * all scoped by it, so getting it wrong silently mixes two books' state together.
 *
 * ⚠ The id may sit at the PAYLOAD root or inside tutorialData; store.py:119 reads both.
 */
export function moduleIdFor(data: ModulePayload | null, bookFile?: string | null): string {
  const explicit = data?.moduleId ?? (data?.tutorialData?.moduleId as string | undefined);
  if (typeof explicit === 'string' && explicit) return explicit;
  if (bookFile) return stripExtension(bookFile);
  return DEFAULT_BOOK;
}

function stripExtension(file: string): string {
  return file.replace(/\.json$/i, '');
}
