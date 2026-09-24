import { readStore, writeStore } from './storage';

// Plan D6: side-by-side <-> stacked, and which panels show. Remembered in localStorage.
export type Arrangement = 'side' | 'stacked';
export type View = 'both' | 'code' | 'result';
export interface Layout {
  arrangement: Arrangement;
  view: View;
}

const KEY = 'lab:layout';
export const DEFAULT_LAYOUT: Layout = { arrangement: 'side', view: 'both' };

export function loadLayout(): Layout {
  const raw = readStore(KEY);
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as Partial<Layout>;
    return {
      arrangement: parsed.arrangement === 'stacked' ? 'stacked' : 'side',
      view: parsed.view === 'code' || parsed.view === 'result' ? parsed.view : 'both',
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout): void {
  writeStore(KEY, JSON.stringify(layout));
}
