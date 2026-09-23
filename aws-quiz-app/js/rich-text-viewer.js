// Maths is lifted OUT before Markdown runs and put back after. Measured 16-09-26 with
// the same marked version: "\\" line breaks became "\" (multi-line cases/aligned
// collapsed to one line) and "V^*(s) ... Q^*(s,a)" became "V^<em>(s) ... Q^</em>" --
// every Bellman equation in the RL chapter would have rendered wrong.
// Code is left alone: a "$" inside a code block is not maths.
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:[^$\n\\]|\\.)+?(?<!\s)\$/g;
const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function protectMath(raw) {
    const store = [];
    const out = [];
    let last = 0;
    // Walk code spans first so maths is only looked for OUTSIDE them.
    raw.replace(CODE_PATTERN, (code, offset) => {
        out.push(liftMath(raw.slice(last, offset), store), code);
        last = offset + code.length;
        return code;
    });
    out.push(liftMath(raw.slice(last), store));
    return { text: out.join(''), store };
}

function liftMath(segment, store) {
    return segment.replace(MATH_PATTERN, match => {
        store.push(match);
        // Letters and digits only: nothing Markdown can read as syntax.
        return `KATEXSLOT${store.length - 1}END`;
    });
}

function restoreMath(html, store) {
    return html.replace(/KATEXSLOT(\d+)END/g, (_, index) => escapeHtml(store[Number(index)]));
}

// --- Copy button for code listings (ruling R24, 23-09-26) --------------------
// The in-app code runner is gone; every code listing gets a Copy button instead,
// so the reader can paste it into a local terminal (ml/study/geron-lab).
// :8767 is served over plain HTTP on the LAN/VPN. That is NOT a secure context,
// so navigator.clipboard is UNDEFINED there -- the textarea + execCommand('copy')
// fallback is the path that actually runs for the user, not an edge case.
async function eduCopyText(text) {
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(text); return true; } catch (error) { /* fall through */ }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    const active = document.activeElement;
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    area.remove();
    if (active && typeof active.focus === 'function') active.focus();
    return ok;
}

// Wires a button so it copies getText() and says "Copied" (or "Copy failed") for 1.5 s.
// The label lives in a child <span data-copy-label> so an icon can sit beside it.
function eduWireCopyButton(button, getText) {
    button.type = 'button';
    button.setAttribute('data-copy', '');
    button.setAttribute('aria-label', 'Copy code');
    let timer = 0;
    button.addEventListener('click', async () => {
        const ok = await eduCopyText(getText());
        const label = button.querySelector('[data-copy-label]') || button;
        label.textContent = ok ? 'Copied' : 'Copy failed';
        button.setAttribute('data-copy-state', ok ? 'copied' : 'failed');
        clearTimeout(timer);
        timer = setTimeout(() => {
            label.textContent = 'Copy';
            button.removeAttribute('data-copy-state');
        }, 1500);
    });
    return button;
}

// The exact code of a rendered <pre>: its <code> text, minus the one trailing
// newline marked appends. The button is a SIBLING of the <pre>, never inside it,
// so its own label can never leak into the copied text.
function eduCodeText(pre) {
    const code = pre.querySelector('code') || pre;
    return code.textContent.replace(/\n$/, '');
}

class RichTextViewer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
    }

    static get observedAttributes() {
        return ['content'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'content' && oldValue !== newValue) {
            this.render();
        }
    }

    render() {
        const rawContent = decodeURIComponent(this.getAttribute('content') || '');
        
        // 1. Parse Markdown safely
        let htmlContent = rawContent;
        if (typeof marked !== 'undefined') {
            const { text, store } = protectMath(rawContent);
            htmlContent = restoreMath(marked.parse(text), store);
        }

        // 2. Inject HTML and Styles
        this.shadowRoot.innerHTML = `
            <style>
                @import url('https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css');
                
                :host {
                    display: block;
                    font-family: inherit;
                    line-height: inherit;   /* let the reading scale own this */
                }
                
                /* Minimal markdown styling */
                p { margin-bottom: 1em; }
                code { background: rgba(255, 255, 255, 0.1); padding: 0.2em 0.4em; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
                pre { background: #111827; padding: 1em; overflow-x: auto; border-radius: 8px; border: 1px solid #374151; }
                pre code { background: transparent; padding: 0; }
                /* Copy button (R24). The <pre> sits in a relative wrapper and the button
                   is its sibling, so the copied text is the code and only the code. The
                   extra top padding gives the button its own strip above the first line. */
                .code-wrap { position: relative; }
                .code-wrap > pre { padding-top: 2.75em; }
                .copy-btn { position: absolute; top: 0.5em; right: 0.5em; min-height: 32px; padding: 0 0.75em;
                            font: 600 0.8rem/1 system-ui, sans-serif; color: #d1d5db; background: #1f2937;
                            border: 1px solid #374151; border-radius: 6px; cursor: pointer; }
                .copy-btn:hover { color: #fff; background: #374151; }
                .copy-btn:focus-visible { outline: 2px solid #ef5b5b; outline-offset: 2px; }
                .copy-btn[data-copy-state="copied"] { color: #6ee7b7; border-color: #065f46; }
                ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 1em; }
                ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 1em; }
                h1, h2, h3, h4 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; color: #fff; }
                a { color: #ef5b5b; text-decoration: underline; }
                blockquote { border-left: 4px solid #ef5b5b; padding-left: 1em; color: #9ca3af; margin-left: 0; }

                /* Figures, tables and inline SVG had NO rules at all until
                   16-09-26. marked already emitted them, so a markdown image or
                   table rendered unbounded and borderless -- which is part of
                   why the theory read as an unbroken wall of prose. */
                img, svg { max-width: 100%; height: auto; display: block; }
                img { margin: 1.25em auto; border-radius: 8px; border: 1px solid #374151; background: #111827; }
                figure { margin: 1.5em 0; }
                figcaption { margin-top: 0.6em; font-size: 0.85em; color: #9ca3af; text-align: center; font-style: italic; }
                table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.92em; display: block; overflow-x: auto; }
                th, td { border: 1px solid #374151; padding: 0.55em 0.75em; text-align: left; vertical-align: top;
                         overflow-wrap: normal; word-break: normal; min-width: 6.5em; }
                /* The lesson wrapper sets overflow-wrap:anywhere (long inline code on phones); inside a
                   table that split words letter by letter, so cells keep whole words and the table
                   scrolls sideways in its own box instead (17-09-26). */
                th { background: #1f2937; color: #fff; font-weight: 600; }
                tr:nth-child(even) td { background: rgba(255, 255, 255, 0.02); }
                hr { border: 0; border-top: 1px solid #374151; margin: 2em 0; }
                /* A long display formula scrolls inside its own box; the container clips what is
                   left (KaTeX's hidden MathML copy still counts toward page width), so a phone
                   never scrolls the whole lesson sideways (17-09-26). */
                .katex-display { overflow-x: auto; overflow-y: hidden; max-width: 100%; padding: 0.25em 0; }
                li { min-width: 0; }
                .content-container { max-width: 100%; overflow-x: clip; }
            </style>
            <div class="content-container">${htmlContent}</div>
        `;

        // 2b. A Copy button on every fenced code listing (R24).
        this.shadowRoot.querySelectorAll('.content-container pre').forEach(pre => {
            const wrap = document.createElement('div');
            wrap.className = 'code-wrap';
            pre.replaceWith(wrap);
            const button = document.createElement('button');
            button.className = 'copy-btn';
            button.innerHTML = '<span data-copy-label>Copy</span>';
            eduWireCopyButton(button, () => eduCodeText(pre));
            wrap.append(pre, button);
        });

        // 3. Scan and render LaTeX inside the newly created DOM
        if (typeof renderMathInElement !== 'undefined') {
            const container = this.shadowRoot.querySelector('.content-container');
            renderMathInElement(container, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                ],
                throwOnError: false
            });
        }
    }
}

customElements.define('rich-text-viewer', RichTextViewer);
