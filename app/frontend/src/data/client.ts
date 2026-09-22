// Seam 1 (data/client) — THE ONLY PLACE THIS APP TALKS TO THE BACKEND.
//
// ⛔ GET-ONLY BY CONSTRUCTION. This is not a style rule, it is the Phase 03 exit gate:
//    the built bundle must contain ZERO non-GET fetch call sites, and the gate greps the
//    bundle for a named, closed pattern set —
//        fetch( carrying method:"POST"|'POST'|`POST` (and the same 3 quotings for
//        PUT|DELETE|PATCH) · XMLHttpRequest · navigator.sendBeacon · api/progress
//    The gate is fault-proved: a copy of the bundle with one method:"POST" spliced in
//    must go RED. Adding a write here does not "fail a lint" — it fails the phase.
//
// ⛔ Do not add a `method` option to getJson(). A single generic request() with a method
//    parameter is exactly the shape the gate cannot distinguish from a write path.
//    Phase 04 adds writes; it adds them in a NEW module, and it re-baselines the gate.
//
// Same-origin by design: the SPA is served by the FastAPI app that answers the API, so
// there is no base URL, no CORS and no host to configure.

export class ApiError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`${path} returned ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The one primitive. No method argument, deliberately — see the header. */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new ApiError(path, response.status);
  return (await response.json()) as T;
}

export interface HealthPayload {
  status: string;
  service: string;
  phase: string;
  /**
   * Exactly the seven EDU_* STORE PATHS, and nothing else.
   * ⛔ Never a token, key, model, provider URL or admin flag under any key name:
   * :8792 is unauthenticated and ufw rule #1 blanket-allows the whole LAN.
   */
  paths: Record<string, string>;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthPayload> {
  return getJson<HealthPayload>('/api/health', signal);
}
