// The application root. ⚑ SLICE A2 WIRED THE MOUNT POINT slice A1 named.
//
// Before this slice App.tsx was the Phase-02 health page — one honest page proving the new
// stack could be built, shipped and served. It has done its job: the R- gate suite reads
// GET /api/health (gates/gate-r-read.mjs:209, run-gates-react.sh:122), not this page, so
// replacing it costs no gate.
//
// ⛔ Nothing is deployed by this slice. :8792 keeps serving the previous bundle until
//    deploy/deploy-study.sh runs, and the reader is still half-ported (A3 owns DOM
//    fidelity, A4 the remaining behaviour). Typechecking is Tier 1 and proves nothing
//    about whether the port is faithful.
import { AppProviders, AppShell } from './shell/AppShell';

export default function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}
