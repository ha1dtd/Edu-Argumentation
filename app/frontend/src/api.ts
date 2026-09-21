// The single place the SPA talks to the backend.
//
// Phase 2 has exactly one endpoint: GET /api/health. The other 15 routes are frozen in
// the phase plan's migration contract and land in Phases 3-4; gates/gate-routes.mjs
// burns that list down and will report 15 missing until then.
//
// Same-origin by design: the SPA is served by the same FastAPI app that answers the API,
// so there is no base URL, no CORS, and no host to configure.

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

export async function fetchHealth(signal?: AbortSignal): Promise<HealthPayload> {
  const response = await fetch('/api/health', { signal });
  if (!response.ok) {
    throw new Error(`/api/health returned ${response.status}`);
  }
  return (await response.json()) as HealthPayload;
}
