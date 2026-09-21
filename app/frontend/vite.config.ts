import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output goes to dist/ and is shipped to nn:/srv/foxai/edu-study/web/ by
// deploy/deploy-study.sh. NOTHING is ever built on nn (plan B4): that box is at
// swap 4053/4095 and an OOM kill there takes a JVM (Trino/Polaris/Airflow) with it.
//
// base '/' and the default 'assets' asset dir are DELIBERATE and RECORDED (execute
// instruction E17 / concern C12): the SPA's hashed bundles are served from /assets/,
// which shares a prefix with the guarded per-module asset route Phase 3 adds at
// /assets/<moduleId>/<file>. They stay separate because the backend registers the
// guarded routes BEFORE the SPA static mount and Starlette matches in registration
// order — see app/md/explain.md.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
  },
});
