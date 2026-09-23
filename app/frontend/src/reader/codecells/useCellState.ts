// Seam 17 (reader/codecells) — CELL HELPERS. Static listings since ruling R24.
//
// ⚑ RULING R24 (23-09-26) — THE CODE RUNNER IS REMOVED. "it is not a good way of learning, and it
//   adds complexity to the interface itself." Supersedes R7 (every block runnable) and R13 (runner
//   weight limit). A `code_cells` block now renders as STATIC code with a Copy button: no Edit,
//   no Reset, no Run, no kernel, no run status. The DATA is untouched (module.json keeps its
//   code_cells); only the rendering changed. Practice happens in a local terminal with the
//   geron-lab viewer, fed by each lesson's run-verified "Full script" block.
//
// ⛔ CELL NUMBERING STAYS CHAPTER-SCOPED (F7b(i)). The number on a card is its position among
//    the chapter's cells for its `lesson` — the same number the book's walkthrough refers to.
import type { CodeCell, SubBlock, TheoryBlock } from '../../data/types';

/** lessonCodeCells — ⛔ scans the WHOLE CHAPTER (a walkthrough spans several lessons). */
export function lessonCodeCells(chapterBlocks: TheoryBlock[], lesson: string): CodeCell[] {
  return chapterBlocks
    .flatMap((item) => (item && Array.isArray(item.blocks) ? item.blocks : []))
    .filter(
      (sub: SubBlock) =>
        sub && sub.type === 'code_cells' && sub.lesson === lesson && Array.isArray(sub.cells),
    )
    .flatMap((sub: SubBlock) => sub.cells ?? [])
    .filter((cell) => cell && typeof cell.id === 'string' && typeof cell.source === 'string');
}

/** The 1-based CHAPTER-scoped position (the legacy's `all.findIndex(...) + 1`). */
export function cellOrdinal(cell: CodeCell, ordered: CodeCell[]): number | null {
  const at = ordered.findIndex((entry) => entry.id === cell.id);
  if (at >= 0) return at + 1;
  return typeof cell.ordinal === 'number' ? cell.ordinal : null;
}

/**
 * eduCopyText (aws-quiz-app/js/rich-text-viewer.js, R24) — the SAME routine as the legacy's, so a
 * Copy behaves identically on both ports. ⛔ :8792 is plain HTTP on the LAN: `navigator.clipboard`
 * exists only in a secure context, so the textarea + execCommand('copy') fallback is the path that
 * actually runs for the user, not an edge case. Focus is restored afterwards, as the legacy does.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const active = document.activeElement as HTMLElement | null;
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  if (active && typeof active.focus === 'function') active.focus();
  return ok;
}
