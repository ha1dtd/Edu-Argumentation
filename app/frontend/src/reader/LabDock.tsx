// ⚑ 25-09-26 (user): "I just want the learning to open the current exact lab tab and put in the
//   same browser window … a divider to resize is good."
//
// The WHOLE Lab page (its own header, book/chapter/lesson menus, everything) in an <iframe> beside
// the reading pane. Lab stays its own service (ruling R10 — if Lab breaks, reading still works);
// this only frames it. The src is the reader's own relative `/lab/<module>/<lesson>`:
//   · public door  https://<ip>/lab/...  — same origin, nginx proxies /lab/ to Lab;
//   · VPN door     http://<host>:8767/lab/...  — the study app 302s it to :8798 (Lab's direct door).
// Lab allows exactly these two parents to frame it (CSP frame-ancestors, lab_server.py).
//
// ⚑ 25-09-26 (user, second pass): EVERY screen opens Lab in this window — wide screens beside the
//   lesson with a drag divider, phones as a full-screen layer over it. No bar of our own: Lab's
//   header carries the glyphs (close / open in a new tab), which post a message up to us
//   (see labMessages below; ReaderScreen handles them).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

const WIDTH_KEY = 'reader:labWidth';
const MIN_LAB = 360;
const MIN_READER = 360;

function storedWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function LabDock({ src }: { src: string }) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(storedWidth);
  const [dragging, setDragging] = useState(false);

  // First open with no remembered width: half of the row.
  useEffect(() => {
    if (width !== null) return;
    const row = paneRef.current?.parentElement;
    if (row) setWidth(Math.round(row.getBoundingClientRect().width / 2));
  }, [width]);

  const clamp = (value: number) => {
    const row = paneRef.current?.parentElement;
    const total = row ? row.getBoundingClientRect().width : window.innerWidth;
    return Math.max(MIN_LAB, Math.min(value, total - MIN_READER));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const row = paneRef.current?.parentElement;
    if (!row) return;
    setWidth(clamp(row.getBoundingClientRect().right - event.clientX));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    try {
      if (width) window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      /* not remembered — fine */
    }
  };

  return (
    <>
      <div
        id="lab-dock-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the Lab panel"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`hidden lg:flex shrink-0 w-2 cursor-col-resize items-center justify-center rounded-full transition-colors ${dragging ? 'bg-brand-600' : 'bg-transparent hover:bg-gray-700'}`}
      >
        <span className="h-10 w-0.5 rounded-full bg-gray-500" aria-hidden="true" />
      </div>
      <div
        id="lab-dock"
        ref={paneRef}
        style={width ? ({ '--lab-dock-w': `${width}px` } as CSSProperties) : undefined}
        className="fixed inset-0 z-50 flex flex-col bg-gray-900 lg:static lg:inset-auto lg:z-auto lg:shrink-0 lg:min-h-0 lg:w-[var(--lab-dock-w,50%)] lg:rounded-xl lg:border lg:border-gray-700 lg:overflow-hidden"
      >
        {/* While dragging, the iframe would swallow the pointer; a transparent sheet keeps it here. */}
        <div className="relative flex-1 min-h-0">
          <iframe id="lab-dock-frame" title="Lab" src={src} className="absolute inset-0 w-full h-full border-0 bg-gray-900" />
          {dragging ? <div className="absolute inset-0 cursor-col-resize" aria-hidden="true" /> : null}
        </div>
      </div>
    </>
  );
}

/** Where Lab can live: this origin (public door, nginx /lab/) or :8798 on this host (VPN door). */
export function labOrigins(): string[] {
  return [window.location.origin, `http://${window.location.hostname}:8798`];
}

/** A Lab href from a message, reduced to the relative `/lab/...` path this app frames; null if foreign. */
export function labPath(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href, window.location.origin);
    if (!labOrigins().includes(url.origin) || !url.pathname.startsWith('/lab/')) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
