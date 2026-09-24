import type { Arrangement, Layout, View } from '../layout';

const BTN = 'min-h-[36px] px-3 text-xs font-semibold uppercase tracking-wider transition-colors';
const on = 'bg-gray-700 text-white';
const off = 'text-gray-400 hover:text-white';

export function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (next: Layout) => void }) {
  const arrangement = (value: Arrangement, label: string) => (
    <button
      id={`lab-layout-${value}`}
      type="button"
      aria-pressed={layout.arrangement === value ? 'true' : 'false'}
      className={`${BTN} ${layout.arrangement === value ? on : off}`}
      onClick={() => onChange({ ...layout, arrangement: value })}
    >
      {label}
    </button>
  );
  const view = (value: View, label: string) => (
    <button
      id={`lab-view-${value}`}
      type="button"
      aria-pressed={layout.view === value ? 'true' : 'false'}
      className={`${BTN} ${layout.view === value ? on : off}`}
      onClick={() => onChange({ ...layout, view: value })}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-gray-600 overflow-hidden" role="group" aria-label="Layout">
        {arrangement('side', 'Side by side')}
        {arrangement('stacked', 'Stacked')}
      </div>
      <div className="flex rounded-lg border border-gray-600 overflow-hidden" role="group" aria-label="Show">
        {view('both', 'Both')}
        {view('code', 'Code only')}
        {view('result', 'Result only')}
      </div>
    </div>
  );
}
