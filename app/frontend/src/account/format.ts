// Account redesign (23-11-26): small display helpers for the Account page. Pure — no React, no I/O.

/** 45 s · 12 min · 1 h 05 min. `null` (not measured) reads "—". */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${hours} h`;
}

export const fmtPct = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `${value}%`);

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "2026-11-23" -> "23 Nov" (the date is the learner's day; no timezone shift is applied). */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

/** "+3" / "-2" / "0" for a difference. */
export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
