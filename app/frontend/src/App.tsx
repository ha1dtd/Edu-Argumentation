import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api';

// Phase 2 is deliberately EMPTY: it proves the new stack can be built here, shipped to
// nn, started under systemd and serve one honest page. No content is ported yet — that
// is Phase 3. English only (ruling R2).
export default function App() {
  const { data, error, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
  });

  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">FoxAI Edu Study</h1>
      <p className="mt-2 text-sm text-gray-600">
        New stack skeleton — Phase 02. React + TypeScript + Vite over FastAPI.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-medium">Backend health</h2>
        {isPending && <p className="mt-2 text-sm">Checking…</p>}
        {error && (
          <p className="mt-2 text-sm text-red-700">
            Could not reach /api/health: {(error as Error).message}
          </p>
        )}
        {data && (
          <>
            <p className="mt-2 text-sm">
              {data.service} — {data.status} ({data.phase})
            </p>
            <h3 className="mt-4 text-sm font-medium">Resolved store paths</h3>
            <ul className="mt-1 text-xs">
              {Object.entries(data.paths).map(([name, value]) => (
                <li key={name}>
                  <code>{name}</code> = <code>{value}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
