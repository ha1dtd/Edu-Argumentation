// VS Code "Dark+"-style colours for Python code. 16-10-26 (user): "syntax highlight like vscode,
// the function have this color, attr have that color… so you can highlight the comments better".
// Built on the Lezer Python parser (the CodeMirror project's parser): it tells a function call
// from a variable from an attribute, which a regex highlighter cannot.
// Same file lives in lab/frontend/src/codeColours.ts (two separate apps, two builds) — keep both equal.
import { parser } from '@lezer/python';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';

const highlighter = tagHighlighter([
  { tag: [t.controlKeyword, t.moduleKeyword], class: 'tok-ctl' },
  { tag: [t.keyword, t.definitionKeyword, t.operatorKeyword, t.bool, t.null, t.self], class: 'tok-kw' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.meta], class: 'tok-fn' },
  { tag: [t.className, t.definition(t.className)], class: 'tok-cls' },
  { tag: [t.variableName, t.propertyName, t.local(t.variableName)], class: 'tok-var' },
  { tag: [t.string, t.special(t.string)], class: 'tok-str' },
  { tag: t.number, class: 'tok-num' },
  { tag: t.lineComment, class: 'tok-cmt' },
]);

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Highlighted HTML of `code` (text is escaped; only <span class="tok-…"> is added). */
export function highlightPython(code: string): string {
  let out = '';
  let at = 0;
  highlightTree(parser.parse(code), highlighter, (from, to, classes) => {
    if (from > at) out += escapeHtml(code.slice(at, from));
    const text = code.slice(from, to);
    // the build-along's own "# >>> ADD / CHANGE" instruction lines stand out from ordinary comments
    const cls = classes === 'tok-cmt' && text.startsWith('# >>>') ? 'tok-cmt tok-marker' : classes;
    out += `<span class="${cls}">${escapeHtml(text)}</span>`;
    at = to;
  });
  return out + escapeHtml(code.slice(at));
}

export const CODE_COLOURS_CSS = `
.tok-ctl{color:#c586c0}.tok-kw{color:#569cd6}.tok-fn{color:#dcdcaa}.tok-cls{color:#4ec9b0}
.tok-var{color:#9cdcfe}.tok-str{color:#ce9178}.tok-num{color:#b5cea8}.tok-cmt{color:#6a9955}
.tok-marker{color:#f0b429;font-weight:600}
`;
