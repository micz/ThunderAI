/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 *  Live {%placeholder%} highlighting for a plain <textarea>.
 *
 *  The textarea stays the single source of truth: it keeps native undo/redo,
 *  IME, spellcheck and selection, and the save/read logic keeps using
 *  textarea.value untouched. Highlighting is painted on a mirror element
 *  ("backdrop") sitting *behind* a transparent textarea, so the two must share
 *  identical text metrics — see the .editor-backdrop / .editor-highlights rules
 *  in the page CSS. Any font, padding or border change on one must be mirrored
 *  on the other, or the highlight drifts away from the text.
 */

// The one and only placeholder pattern. Shared with decoratePromptText() and
// decoratePlaceholderText() so read mode and edit mode can never disagree on
// what counts as a token. Non-greedy, and tolerant of inner '%' so that values
// like {%additional_text:50%%} match too.
// Note: carries /g, therefore lastIndex state — always reset before reuse.
export const PLACEHOLDER_RE = /\{%\s*(.*?)\s*%\}/g;

// Zero-width space appended to the mirror so a trailing newline keeps its
// height and the last line can still be scrolled to.
const TRAILING_PAD = '​';

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
}

/*
 *  Splits text into a flat list of parts:
 *    { text }                        plain text
 *    { text, inner }                 a complete {%...%} token
 *    { text, inner: null, open:true} a trailing unterminated '{%'
 *  Single pass, so the caret-anchor and plain renders can never disagree.
 */
function tokenize(text) {
    const parts = [];
    let last = 0;
    PLACEHOLDER_RE.lastIndex = 0;
    let match;
    while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
        if (match.index > last) parts.push({ text: text.slice(last, match.index) });
        parts.push({ text: match[0], inner: match[1] });
        last = match.index + match[0].length;
    }
    const rest = text.slice(last);
    // An unterminated '{%' can only be in the tail, since every complete token
    // was already consumed above.
    const openAt = rest.indexOf('{%');
    if (openAt === -1) {
        if (rest) parts.push({ text: rest });
    } else {
        if (openAt > 0) parts.push({ text: rest.slice(0, openAt) });
        parts.push({ text: rest.slice(openAt), inner: null, open: true, offset: last + openAt });
    }
    return parts;
}

/*
 *  Attach live highlighting to a textarea.
 *
 *  textarea  the <textarea> to decorate; must live inside a container holding
 *            .editor-backdrop > .editor-highlights (see the page markup).
 *  options   { getTokenState } — optional callback invoked per token as
 *            getTokenState(inner, raw); `inner` is null for an unterminated
 *            token. Returns falsy to render a normal chip, or
 *            { invalid: true, title } to render a warning chip. When omitted,
 *            every complete token renders as a normal chip and unterminated
 *            ones stay unstyled.
 *
 *  Returns a handle: { refresh(), getCaretRect(), setTokenStateResolver(),
 *  destroy() }. Calling it twice on the same textarea is a no-op that returns
 *  the existing handle — showItemRowEditor() re-runs on every edit-mode entry.
 */
export function attachEditorHighlight(textarea, options = {}) {
    if (!textarea) return null;
    if (textarea._mztaHighlight) return textarea._mztaHighlight;

    const container = textarea.closest('.autocomplete-container, .editor-wrap');
    const backdrop = container ? container.querySelector('.editor-backdrop') : null;
    const highlights = backdrop ? backdrop.querySelector('.editor-highlights') : null;
    // No mirror in the markup: nothing to paint on. Fail soft — the textarea
    // keeps working exactly as before.
    if (!highlights) return null;

    // Marks the wrapper as being in edit mode. The mirror and the field surface
    // are both keyed off this class, so that leaving edit mode — which only
    // sets display:none on the textarea, never on its siblings — cannot leave a
    // second, painted copy of the prompt text showing under the read-mode span.
    container.classList.add('editor-active');

    let getTokenState = options.getTokenState || null;

    function chip(part) {
        // Never warn about the token the user is still typing: that would flash
        // a warning on every keystroke while they type '{%mail_...'. The caret
        // is read live rather than taken from the render argument, because the
        // ordinary repaint path (refresh(), on every input) passes no offset.
        const caretInside = part.open
            && textarea.selectionStart >= part.offset
            && textarea.selectionEnd <= part.offset + part.text.length;
        if (part.open && (caretInside || !getTokenState)) return escapeHtml(part.text);

        const state = getTokenState ? getTokenState(part.inner, part.text) : null;
        const cls = (state && state.invalid) ? 'ph_chip_live ph_chip_invalid' : 'ph_chip_live';
        const title = (state && state.title) ? ' title="' + escapeAttr(state.title) + '"' : '';
        return '<span class="' + cls + '"' + title + '>' + escapeHtml(part.text) + '</span>';
    }

    // Renders textarea.value into the mirror. When caretOffset is a number, a
    // zero-width anchor span is planted at that character offset so the caret
    // can be located (used by the autocomplete to position itself).
    function render(caretOffset) {
        const value = textarea.value;
        const withCaret = typeof caretOffset === 'number';
        let html = '';
        let pos = 0;

        for (const part of tokenize(value)) {
            const start = pos;
            const end = pos + part.text.length;
            pos = end;

            // The anchor must land at an exact character offset. If it falls
            // inside this part, split the part around it; a token split this
            // way renders unchipped for that one measurement pass, which is
            // never painted (getCaretRect repaints immediately after).
            if (withCaret && caretOffset > start && caretOffset < end) {
                const cut = caretOffset - start;
                html += escapeHtml(part.text.slice(0, cut))
                     + '<span class="caret-anchor"></span>'
                     + escapeHtml(part.text.slice(cut));
                continue;
            }
            if (withCaret && caretOffset === start) html += '<span class="caret-anchor"></span>';
            html += (part.inner === undefined && !part.open)
                ? escapeHtml(part.text)
                : chip(part);
        }
        if (withCaret && caretOffset >= pos) html += '<span class="caret-anchor"></span>';

        highlights.innerHTML = html + TRAILING_PAD;
        syncScroll();
    }

    function syncScroll() {
        backdrop.scrollTop = textarea.scrollTop;
        backdrop.scrollLeft = textarea.scrollLeft;
    }

    function onInput() { render(); }

    // The textarea is user-resizable, so the mirror must follow its box. The
    // observer only reads scroll offsets and never writes layout, so it cannot
    // feed back into itself.
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(syncScroll);
        resizeObserver.observe(textarea);
    }

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('scroll', syncScroll);

    const handle = {
        // Repaint from the current value; call after programmatic changes or
        // when validity depends on something outside the textarea (e.g. the
        // prompt type selector changed).
        refresh() { render(); },

        // Viewport rect of the caret, for anchoring the autocomplete. Renders
        // once with an anchor, measures it, then repaints without it.
        getCaretRect() {
            render(textarea.selectionStart);
            const anchor = highlights.querySelector('.caret-anchor');
            const rect = anchor ? anchor.getBoundingClientRect() : null;
            render();
            return rect;
        },

        setTokenStateResolver(fn) { getTokenState = fn; render(); },

        destroy() {
            textarea.removeEventListener('input', onInput);
            textarea.removeEventListener('scroll', syncScroll);
            if (resizeObserver) resizeObserver.disconnect();
            resizeObserver = null;
            highlights.innerHTML = '';
            container.classList.remove('editor-active');
            delete textarea._mztaHighlight;
        },
    };

    textarea._mztaHighlight = handle;
    render();
    return handle;
}

// Returns the highlight handle attached to a textarea, if any.
export function getEditorHighlight(textarea) {
    return (textarea && textarea._mztaHighlight) || null;
}

/*
 *  Builds the getTokenState callback that flags invalid tokens.
 *
 *  find          the resolution predicate, i.e. placeholdersUtils.findPlaceholder.
 *                Injected rather than imported: this module is loaded by every
 *                editor page, and importing mzta-placeholders.js here would pull
 *                its whole dependency chain (options defaults, utils) with it.
 *  placeholders  list as returned by getPlaceholders(true). Captured by
 *                reference, so a page that refreshes its list in place gets the
 *                new one without re-attaching.
 *  getType       optional () => type, read on every token so a change to the
 *                prompt's type selector takes effect on the next refresh().
 *                Return null/undefined to skip type filtering entirely.
 *
 *  Using the same predicate extractPlaceholders() uses at runtime means the
 *  editor cannot disagree with what the prompt will actually resolve.
 */
export function makeTokenStateResolver(find, placeholders, getType = null) {
    return function (inner) {
        // inner === null means an unterminated '{%' with no closing '%}'.
        if (inner === null) {
            return {
                invalid: true,
                title: browser.i18n.getMessage('editor_placeholder_unterminated'),
            };
        }
        const type = getType ? getType() : null;
        const found = find(inner, placeholders,
            (type === null || type === undefined) ? null : type);
        if (found) return null;
        return {
            invalid: true,
            title: browser.i18n.getMessage('editor_placeholder_unknown'),
        };
    };
}
