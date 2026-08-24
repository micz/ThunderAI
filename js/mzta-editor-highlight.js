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
 *            { invalid: true, severity, title } to render a warning chip.
 *            `severity` is 'error' (red — the token can never resolve) or
 *            'warn' (amber — it resolves, just not for this prompt type); any
 *            other value, including none, renders amber. When the callback is
 *            omitted, every complete token renders as a normal chip and
 *            unterminated ones stay unstyled.
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

    const doc = textarea.ownerDocument;

    function caretAnchor() {
        const span = doc.createElement('span');
        span.className = 'caret-anchor';
        return span;
    }

    // Returns a Node for a token part: either a chip <span> or a bare text node
    // when the token must stay unstyled.
    function chip(part) {
        // Never warn about the token the user is still typing: that would flash
        // a warning on every keystroke while they type '{%mail_...'. The caret
        // is read live rather than taken from the render argument, because the
        // ordinary repaint path (refresh(), on every input) passes no offset.
        const caretInside = part.open
            && textarea.selectionStart >= part.offset
            && textarea.selectionEnd <= part.offset + part.text.length;
        if (part.open && (caretInside || !getTokenState)) return doc.createTextNode(part.text);

        const state = getTokenState ? getTokenState(part.inner, part.text) : null;
        const span = doc.createElement('span');
        // Two invalid tiers: 'error' (red) for a token that can never resolve --
        // an unknown id, or an unterminated '{%' -- and 'warn' (amber) for a real
        // placeholder this prompt's type simply cannot use. .ph_chip_invalid
        // carries the shared geometry and the amber default, so a state with no
        // severity still renders exactly as it did before.
        span.className = 'ph_chip_live';
        if (state && state.invalid) {
            span.classList.add('ph_chip_invalid');
            span.classList.add(state.severity === 'error' ? 'ph_chip_error' : 'ph_chip_warn');
        }
        if (state && state.title) span.setAttribute('title', state.title);
        span.textContent = part.text;
        return span;
    }

    // Renders textarea.value into the mirror. When caretOffset is a number, a
    // zero-width anchor span is planted at that character offset so the caret
    // can be located (used by the autocomplete to position itself).
    function render(caretOffset) {
        const value = textarea.value;
        const withCaret = typeof caretOffset === 'number';
        const frag = doc.createDocumentFragment();
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
                frag.appendChild(doc.createTextNode(part.text.slice(0, cut)));
                frag.appendChild(caretAnchor());
                frag.appendChild(doc.createTextNode(part.text.slice(cut)));
                continue;
            }
            if (withCaret && caretOffset === start) frag.appendChild(caretAnchor());
            frag.appendChild((part.inner === undefined && !part.open)
                ? doc.createTextNode(part.text)
                : chip(part));
        }
        if (withCaret && caretOffset >= pos) frag.appendChild(caretAnchor());
        frag.appendChild(doc.createTextNode(TRAILING_PAD));

        highlights.replaceChildren(frag);
        syncScroll();
    }

    function syncScroll() {
        backdrop.scrollTop = textarea.scrollTop;
        backdrop.scrollLeft = textarea.scrollLeft;
    }

    function onInput() { render(); }

    /*
     *  Tooltips in edit mode.
     *
     *  The chips carry a `title`, but they live in the mirror, which is
     *  pointer-events:none (it must be: it sits under the textarea and would
     *  otherwise swallow clicks, selection and the caret). So the browser never
     *  hovers a chip and the native tooltip can never fire. Read mode has no such
     *  problem — there the chips ARE the hovered elements.
     *
     *  Fix: keep the title on the textarea instead, and swap it for whichever
     *  chip is under the pointer. document.elementsFromPoint() sees through the
     *  transparent textarea and returns the mirror node beneath it, so the
     *  mapping needs no offset arithmetic of its own.
     */
    let hoverTitle = '';
    function onMouseMove(e) {
        let title = '';
        // Only the chips carry a title, so the first one found under the pointer
        // is the answer. elementsFromPoint is cheap enough here: it runs on
        // mousemove over a single small element, not on every keystroke.
        for (const el of doc.elementsFromPoint(e.clientX, e.clientY)) {
            if (el.classList && el.classList.contains('ph_chip_live')) {
                title = el.getAttribute('title') || '';
                break;
            }
            // Stop at the mirror: anything below it is unrelated page chrome.
            if (el === highlights) break;
        }
        if (title === hoverTitle) return;   // avoid churning the attribute
        hoverTitle = title;
        if (title) textarea.setAttribute('title', title);
        else textarea.removeAttribute('title');
    }

    function onMouseLeave() {
        hoverTitle = '';
        textarea.removeAttribute('title');
    }

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
    textarea.addEventListener('mousemove', onMouseMove);
    textarea.addEventListener('mouseleave', onMouseLeave);

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
            textarea.removeEventListener('mousemove', onMouseMove);
            textarea.removeEventListener('mouseleave', onMouseLeave);
            textarea.removeAttribute('title');
            if (resizeObserver) resizeObserver.disconnect();
            resizeObserver = null;
            highlights.replaceChildren();
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
 *  Builds the getTokenState callback that flags invalid tokens, in two tiers:
 *
 *    severity 'error' (red)    unknown id, or an unterminated '{%' — no prompt
 *                              type can make either resolve
 *    severity 'warn'  (amber)  a real placeholder whose type this prompt cannot
 *                              use, e.g. a reading-only one in a composing prompt
 *
 *  Telling the two apart needs two questions, so `find` is called twice: once
 *  type-less ("does this id exist at all") and, only if that matched, once with
 *  the type ("is it usable here"). findPlaceholder() returns null for both cases
 *  and is deliberately left that way — extractPlaceholders() and
 *  decoratePromptText() depend on its current contract. The second call is
 *  therefore paid on valid tokens only, which is negligible next to the
 *  replaceChildren() the same repaint already performs unconditionally.
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
        // inner === null means an unterminated '{%' with no closing '%}'. Red: a
        // syntax error, not a context mismatch — no prompt type resolves it.
        if (inner === null) {
            return {
                invalid: true,
                severity: 'error',
                title: browser.i18n.getMessage('editor_placeholder_unterminated'),
            };
        }
        // Does the id exist at all? Asked type-less, and asked first: this is
        // what separates the red tier from the amber one.
        if (!find(inner, placeholders, null)) {
            return {
                invalid: true,
                severity: 'error',
                title: browser.i18n.getMessage('editor_placeholder_missing'),
            };
        }
        const type = getType ? getType() : null;
        return classifyPlaceholderType(find, placeholders, inner, type);
    };
}

/*
 *  The type half of the validity rule, shared by the live editor and by read
 *  mode so the two cannot drift apart. Assumes the id already exists.
 *
 *  Returns null when the token is fine for this prompt type, or an amber state.
 *  Never returns 'error': a missing id is the caller's concern.
 *
 *  The type-'0' arm is the reason this is not a plain findPlaceholder() call. A
 *  type-'0' prompt ("always") runs in BOTH contexts, so findPlaceholder()
 *  accepts every placeholder there -- correct for the runtime, which really does
 *  resolve a reading-only token when the prompt is launched while reading. For
 *  an editor that is still worth a warning: such a token works in only one of
 *  the two contexts the prompt runs in and stays empty in the other. So the
 *  '0' case is decided here by comparing the placeholder's own type, rather
 *  than delegated. This is a *highlighting* rule and deliberately does not
 *  touch findPlaceholder(), which the runtime shares.
 */
export function classifyPlaceholderType(find, placeholders, inner, type) {
    if (type === null || type === undefined) return null;
    const promptType = String(type);
    if (promptType === '0') {
        const found = find(inner, placeholders, null);
        // A placeholder with no type of its own counts as '0' (see
        // findPlaceholder), so it is unconditionally fine here.
        const phType = (found && found.type !== null && found.type !== undefined
            && String(found.type).trim() !== '') ? String(found.type) : '0';
        if (phType === '0') return null;
        return {
            invalid: true,
            severity: 'warn',
            title: browser.i18n.getMessage('editor_placeholder_partial_type'),
        };
    }
    if (find(inner, placeholders, promptType)) return null;
    // It exists, but this prompt's type cannot use it at all.
    return {
        invalid: true,
        severity: 'warn',
        title: browser.i18n.getMessage('editor_placeholder_wrong_type'),
    };
}
