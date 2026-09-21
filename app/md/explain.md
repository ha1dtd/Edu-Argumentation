# `app/` — the edu-study stack (`:8792`)

Mandatory per `lakehouse-architecture-standards.md` §10a: a non-orchestrated service still
ships an `explain.md`. `doc-importer/` has one; `aws-quiz-app/` does **not**, and that
omission is not being copied.

**What this is.** The replatformed study app: a React + TypeScript + Vite SPA served by a
FastAPI backend, running as `foxai-edu-study` on `:8792`. Phase 02 stands it up **empty** —
one API route and a page that says hello. Nothing is ported yet.

**What it is not.** It is **not** a replacement for `:8767` yet, and **not** connected to
`:8769`. Three separate services, three separate units, three separate PIDs — by user
ruling: *"The separation is needed since they do 2 different things, and if 1 break i can
still learn."* A migration is exactly where someone consolidates them for tidiness. Do not.

---

## File by file

### `frontend/` — the SPA (built on the workstation, never on `nn`)

| File | Purpose | Input | Output | How |
|---|---|---|---|---|
| `package.json` | pins + build scripts | — | — | react 19.2.7 (exact), react-dom 19.2.7, @tanstack/react-query ^5.101.4; dev: vite ^8.1.1, @vitejs/plugin-react ^6.0.3, typescript ~5.9, tailwindcss ^3.4.19. **No state library** — see below. |
| `vite.config.ts` | build config | `src/` | `dist/` | React plugin; `base: '/'`; `assetsDir: 'assets'`; no sourcemaps. |
| `index.html` | SPA shell | — | `dist/index.html` | Carries `<div id="root">` and the **pinned Tailwind CDN** `<script>`. |
| `src/main.tsx` | entry point | — | DOM mount | Creates the `QueryClient`, wraps `<App/>` in `QueryClientProvider`, mounts on `#root`. |
| `src/App.tsx` | the only screen | `/api/health` | rendered page | `useQuery` on health; renders the seven resolved store paths. |
| `src/api.ts` | the only backend caller | `fetch` | `HealthPayload` | Same-origin `fetch('/api/health')` — the SPA is served by the same app, so there is no base URL and no CORS. |

**No state management library.** Verified against the house reference: the CoreX console
ships **zero** of zustand / redux / jotai / mobx / recoil / valtio. Server state lives in
TanStack Query; genuinely-client state becomes a React context. Adding a store later is a
decision, not a drift.

**English only.** No i18n scaffold, no key files, no coverage gate (ruling R2). The console's
i18n machinery exists because it has two real audiences; this app has one.

**Tailwind is on the CDN for this phase**, pinned verbatim **including the query string**:

```
https://cdn.tailwindcss.com?plugins=typography
```

⛔ `?plugins=typography` is **load-bearing**. Dropping it silently removes every `prose`
style, and the damage surfaces as "the rewrite looks wrong" rather than as a missing
dependency. A URL recorded without its query is a **wrong** pin, not a shorter one. The v3
JIT CDN and the v4 browser build are different products with different class semantics — the
house pin is v3. The CDN→build swap is a Phase 3 slice of its own, because the purge is not
incremental: every screen depends on it at once.

⛔ **Never run a Vite/Node build on `nn`.** Measured 2026-09-21: free 1486 MB, available
8492 MB, **swap 4053/4095** — effectively exhausted. An OOM kill there takes a JVM
(Trino / Polaris / Airflow) with it; the 02-09 precedent cost two Flink jobs and an 11.9 h
crash loop. The larger free figure is not permission. Build here, ship artifacts.

### `backend/` — the FastAPI service

| File | Purpose | Input | Output | How |
|---|---|---|---|---|
| `main.py` | the app | HTTP | JSON + files | Registers `/api/health`, then `GET /`, then mounts the SPA assets. Order matters — see below. |
| `settings.py` | **the one accessor** | env | resolved paths | `store_paths()` / `store_path()` / `provider_config()`. Nothing else reads these variables. |
| `requirements.txt` | pins | — | — | fastapi 0.141.1 · **starlette 1.6.0** · uvicorn 0.52.0 · pydantic 2.13.5. |
| `README.md` | the standing rules | — | — | one worker (three causes) · plain `def` for provider handlers · `FileResponse` not `StaticFiles` · one accessor · no credentials. |

`/api/health` echoes **exactly seven** resolved `EDU_*` store paths and nothing else — no
token, key, model, provider URL or admin flag under any key name. Seven, **never nine**:
`:8767`'s environment holds nine `EDU_*` variables but only seven are paths, and the other
two are live secrets. `:8792` is unauthenticated and ufw rule #1 blanket-allows the whole
LAN, so the payload is public to `192.168.100.0/24` by construction.

### `md/explain.md`

This file.

---

## ⛔ The SPA static mount prefix — NAMED, not left for Phase 3 to rediscover

The SPA's hashed bundles are served from the prefix **`/assets`** (Vite's default, kept
deliberately). That prefix is **shared** with the guarded per-module route Phase 3 adds at
`/assets/<moduleId>/<file>`.

They stay separate because **Starlette matches routes in registration order**:

1. API routes
2. *(Phase 3)* the two guarded file routes — `/assets/<moduleId>/<file>` and `/book/<id>/…`
3. **then** the SPA static mount on `/assets`

So the 2-segment guarded route claims module assets, 1-segment build assets fall through to
the mount, and a guarded **403 does not fall through** to the mount. Registering the mount
first would shadow every guarded route and silently remove the `ASSET_FILE` allowlist —
which is the whole control.

**Phase 3 must keep this order.** If it ever becomes uncomfortable, change the SPA's
`assetsDir` to something disjoint (e.g. `static/`) rather than reordering the routes.

---

## Deployed layout on `nn`

```
/srv/foxai/edu-study/
  backend/        <- main.py, settings.py            (rsync'd from app/backend/)
  web/            <- index.html + assets/*.js        (rsync'd from app/frontend/dist/)
/home/ubuntu/edu-study-venv/                          <- python deps, OUTSIDE the rsync tree
```

⛔ The venv lives **outside** `/srv/foxai/edu-study/` on purpose. That tree is deployed with
`rsync --delete`, so anything kept inside it is wiped on every deploy and the service comes
back **healthy and empty** — the exact failure `:8767`'s own unit comments warn about for
`provider.env`. Same reason the house keeps `~/edu-importer-venv` and
`~/geron-learn-app-venv` outside their web roots.

The backend resolves `web/` from `__file__`, not from an environment variable: the unit pins
exactly seven `EDU_*` variables and exit gate G8 asserts that count, so an eighth would fail
the gate. There is nothing to configure.

## Deploy

`deploy/deploy-study.sh` — snapshot → rsync → sha256 gate → restart → verify, with
`--rollback` and a build-refusal grep. It never writes `~/foxai-data/`. See its own header.

⛔ It is a **separate script** from `deploy/deploy.sh` (which serves `:8767`) and that one is
**never edited by this phase**.
