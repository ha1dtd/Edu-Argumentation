// Seam 3 (data/queries) — TanStack Query hooks, one per read route. THE SERVER-CACHE HALF
// OF A2: every global whose value comes from the server lives here, not in a context.
//
// NO STATE LIBRARY (ruling): server state lives here, client-only state becomes a React
// context under state/. The split is the whole reason this file exists — see A2.
//
// The six read routes are the Phase-02 FROZEN contract. Do not add a seventh here; a new
// route is a contract change, and gates/gate-routes.mjs pins the sorted route NAME LIST
// (sha bdd9eef3…), so a rename reads as a ported route without it.
//   GET /api/health · /api/general · /api/modules · /api/progress?module= ·
//   /api/provider · /api/settings
//
// ⛔⛔ CORRECTED BY SLICE A2, 22-09-26 — three wire shapes were wrong in A1 and each one
//    fails SILENTLY (type-correct, empty UI):
//      1. /api/modules returns {"books": [...]}, NOT a bare array (main.py:115). A1 typed it
//         as LibraryBook[], so LibraryProvider's `Array.isArray(data)` was ALWAYS false and
//         the grid rendered empty forever.
//      2. /api/general returns snake_case ai_question_count / fresh_quiz_size /
//         require_access_token (store.py:40-44). A1 named them aiQuestionCount /
//         generatedQuizSize, which no response carries.
//      3. /api/provider returns ready / model / token_required / admin_required
//         (main.py:129). A1 named token_required `requireToken`.
//
// ⛔ libraryOrder IS NOT DERIVED HERE (A2c). It is held by state/LibraryProvider, seeded
//    ONCE from the first successful useModules() result behind a hasSeeded ref. Deriving
//    it in a `select` or a useMemo over query data makes the grid reshuffle under the
//    cursor on every refetch — and `staleTime: Infinity` is NOT the fix, it just hides
//    the reshuffle and blocks the Phase 04 refetch. ⛔ There is no staleTime in this file.

import { useQueries, useQuery } from '@tanstack/react-query';
import { getJson } from './client';
import type { LibraryBook, ModulePayload, ProgressPayload } from './types';

/** /api/general, verbatim on the wire. Globals #22 GENERATED_QUIZ_SIZE and #23 aiQuestionCount. */
export interface GeneralSettings {
  ai_question_count?: number;
  fresh_quiz_size?: number;
  require_access_token?: boolean;
}

/** /api/provider, verbatim. Globals #24-#27 (providerReady/TokenRequired/Model + unknown). */
export interface ProviderStatus {
  ready?: boolean;
  model?: string | null;
  token_required?: boolean;
  admin_required?: boolean;
}

export interface SettingsPayload {
  api_url?: string;
  model?: string;
  json_mode?: boolean;
  api_key_set?: boolean;
  access_token_set?: boolean;
  ready?: boolean;
  general?: GeneralSettings;
  admin_required?: boolean;
}

/** The legacy defaults, which stand until the server overrides them (app.js:80-81). */
export const GENERAL_DEFAULTS = { aiQuestionCount: 5, generatedQuizSize: 20 } as const;
/** MAX_FRESH_QUIZ_SIZE (app.js:82) — a constant, not state. The server enforces the same cap. */
export const MAX_FRESH_QUIZ_SIZE = 30;

export const queryKeys = {
  modules: ['modules'] as const,
  general: ['general'] as const,
  provider: ['provider'] as const,
  settings: ['settings'] as const,
  progress: (moduleId: string) => ['progress', moduleId] as const,
  book: (file: string) => ['book', file] as const,
};

export function useModules() {
  return useQuery({
    queryKey: queryKeys.modules,
    // ⛔ The envelope is unwrapped HERE, once, so no consumer can forget it.
    queryFn: async ({ signal }) => {
      const payload = await getJson<{ books?: LibraryBook[] }>('/api/modules', signal);
      return Array.isArray(payload?.books) ? payload.books : [];
    },
  });
}

export function useGeneralSettings() {
  return useQuery({
    queryKey: queryKeys.general,
    queryFn: ({ signal }) => getJson<GeneralSettings>('/api/general', signal),
  });
}

export function useProviderStatus() {
  return useQuery({
    queryKey: queryKeys.provider,
    queryFn: ({ signal }) => getJson<ProviderStatus>('/api/provider', signal),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => getJson<SettingsPayload>('/api/settings', signal),
  });
}

/**
 * Globals #22/#23, DERIVED — never stored.
 * ⚠ Only a POSITIVE number overrides the default (app.js:3481-3482). A server that answers
 * 0 or null keeps the default, which is why this is not a `??`.
 */
export function useQuizSizing() {
  const { data } = useGeneralSettings();
  const fresh = Number(data?.fresh_quiz_size);
  const ai = Number(data?.ai_question_count);
  return {
    generatedQuizSize: fresh > 0 ? fresh : GENERAL_DEFAULTS.generatedQuizSize,
    aiQuestionCount: ai > 0 ? ai : GENERAL_DEFAULTS.aiQuestionCount,
    maxFreshQuizSize: MAX_FRESH_QUIZ_SIZE,
  };
}

/**
 * Globals #24-#27, DERIVED — never stored.
 *
 * ⛔ `statusUnknown` is the ERROR state, and it is NOT the same as "not ready": the legacy
 * code sets providerReady=false AND providerStatusUnknown=true only in the catch
 * (app.js:3350-3353). Collapsing the two tells the reader "no model is connected" when the
 * truth is "we could not ask". ⚠ Phase 03 is expected to read ready=false honestly —
 * :8792 carries no credential by construction (R-SEP4).
 */
export function useProviderReadiness() {
  const { data, isError } = useProviderStatus();
  return {
    ready: !isError && Boolean(data?.ready),
    statusUnknown: isError,
    tokenRequired: isError ? true : Boolean(data?.token_required),
    model: data?.model ?? '',
  };
}

/** Progress is READ-ONLY in Phase 03. The write lands in Phase 04, in its own module. */
export function useProgress(moduleId: string) {
  return useQuery({
    queryKey: queryKeys.progress(moduleId),
    queryFn: ({ signal }) =>
      getJson<ProgressPayload>(`/api/progress?module=${encodeURIComponent(moduleId)}`, signal),
    enabled: Boolean(moduleId),
  });
}

/**
 * EVERY book's completion count, one request per book — `loadLibrary`'s progress fan-out
 * (app.js:387-396), ported 22-09-26 (EVL fix 003).
 *
 * ⛔⛔ THIS WAS NEVER PORTED, AND THAT IS WHY THE HOME KPIs CONTRADICTED THE ROWS BENEATH THEM.
 *     MEASURED on the live server 22-09-26: `/api/modules` carries `file/title/chapters/
 *     lessons/questions/addedAt/lastReadAt` and **NO `done` KEY AT ALL** — on `:8792` and on
 *     the legacy `:8767` alike. `renderHomeKpis` reads `Number(book.done) || 0`, so without
 *     this fan-out every book scores 0 and the panel reported
 *         LESSONS DONE 0 · of 414 · 0%   ·   BOOKS 2 — none started yet
 *     while the current-book line two elements above said `18 / 310 lessons done` and the
 *     card below said `18/310 lessons · 6%`. Both of those read LIVE progress for the OPEN
 *     book; only the KPI panel needs every book, and only it was missing its source.
 *     ⛔ The KPI arithmetic (now library/LibraryScreen HomeKpis) was ported VERBATIM and is CORRECT. Do not
 *        "fix" the KPIs by changing that maths — the input was empty, not the formula.
 *
 * ⛔ READ-ONLY. GET only, no body, no write. Phase 03's whole claim is that `progress.json`
 *    is byte-identical across a full browse, and N more GETs cannot threaten that.
 * ⚠ The id rule is the legacy's, verbatim: a book's own `moduleId` UNLESS it is a transient
 *   `t-` id, in which case fall back to the filename. A `t-` id is not a progress key.
 * ⚠ The query key is `queryKeys.progress(id)` — deliberately the SAME key `useProgress` uses
 *   for the open book, so the two share one cache entry instead of racing two.
 */
export function useLibraryProgressCounts(moduleIds: string[]): Record<string, number> {
  const results = useQueries({
    queries: moduleIds.map((id) => ({
      queryKey: queryKeys.progress(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getJson<ProgressPayload>(`/api/progress?module=${encodeURIComponent(id)}`, signal),
      enabled: Boolean(id),
    })),
    // ⛔ The combine result must be a PLAIN OBJECT keyed by module id, not the results array:
    //    useQueries returns a NEW array identity on every render, and handing that to a
    //    useMemo dependency list re-runs the library reconcile on every paint.
    combine: (queries: { data?: ProgressPayload }[]) => {
      const counts: Record<string, number> = {};
      queries.forEach((query, index) => {
        const completed = query.data?.completed;
        counts[moduleIds[index]] = completed ? Object.keys(completed).length : 0;
      });
      return counts;
    },
  });
  return results;
}

/**
 * One book's payload — module.json for a packaged book, data/<name>.json for a legacy one.
 * The URL is built by data/bookPaths.bookLocationFor, which knows the difference.
 *
 * ⚠ geron-homl3's module.json is 5.5 MB. Anything that gates on this must wait for real
 * content, never on a fixed timeout — that is how a gate ended up "browsing both books"
 * while one contributed zero chapters.
 */
export function useBook(url: string | null) {
  return useQuery({
    queryKey: queryKeys.book(url ?? ''),
    queryFn: ({ signal }) => getJson<ModulePayload>(url as string, signal),
    enabled: Boolean(url),
  });
}
