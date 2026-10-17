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

// StreamingMessage owns the streaming/parsing state for ONE bot response
// (one chat turn). It is a plain class — no custom element, no DOM ownership.
// It accumulates raw tokens and thinking tokens, applies the unterminated
// <think> guard, extracts inline <think>...</think> blocks (via the shared
// stripThinkTags() helper in js/mzta-utils.js), and renders the WHOLE response
// so far through ONE path on each flush.
//
// ── One render path, no router ───────────────────────────────────────────────
//
// markdown IS a superset that admits inline and block HTML (CommonMark), so there
// is no markdown-vs-HTML decision to make: every answer goes through
//
//     renderResponse(raw) = sanitize(markdownit({html:true, breaks:true}).render(raw))
//
//   breaks:true  keeps the model's '\n' as a real <br> - this is a mail composer,
//                not a markdown document, so a newline the model wrote is a
//                newline the user expects, in the chat AND in the inserted mail.
//   html:true    lets inline HTML (<b>) render instead of being escaped. That is
//                exactly the hybrid fix: "Ciao <b>Mario</b>\ngrazie" becomes
//                "<p>Ciao <b>Mario</b><br>grazie</p>" - bold rendered AND the line
//                break kept. The old router forced such an answer down one of two
//                pure branches, each of which lost half of it.
//
// One exception to "a '\n' is a <br>": a model that echoes the <br> of an HTML
// placeholder ({%selected_html%}) usually writes a newline after it too, and
// "Ciao,<br>\ngrazie" would render as "Ciao,<br><br>\ngrazie" - a blank line in
// the mail. The break right after a raw <br> is therefore turned back into a plain
// "\n" by a core rule (collapseEchoedBrBreaks), see getMarkdownIt().
//
// html:true disables markdown-it's escaping, so the output is now UNTRUSTED model
// HTML on its way into outgoing mail. It MUST cross the sanitizer - the same ONE
// allowlist walk everything else uses (js/mzta-richtext.js). Code fences are still
// safe: markdown-it escapes HTML inside code blocks regardless of html:true, so
// "how do I center a <div>?" still shows the markup as text.
//
// ── Streaming: re-render the whole accumulated raw each time ──────────────────
//
// A flush routinely lands mid-tag ("<p>Distinti sal") or mid-inline-tag
// ("<b>Mar" | "io</b>"), so segments cannot be rendered and appended
// independently - the whole accumulated raw text is re-rendered each flush and
// the result REPLACES _fullTextHTML (cumulative). Re-parsing the whole raw text,
// not concatenating per-segment output, is what keeps every element - and every
// raw tag split across a segment boundary - whole. To keep that O(n) re-render
// from becoming O(n^2) over a response it is coalesced to roughly every
// HTML_RENDER_CHUNK characters of new text, plus always on the final flush; in
// between, the live token spans messagesArea appends show the text arriving.
//
// `window.markdownit` is the global from markdown-it.min.js, loaded as a classic
// script in index.html before the module scripts.

import { stripThinkTags } from '../js/mzta-utils.js';
import { sanitizeBlockHtml } from '../js/mzta-richtext.js';

// The <think> probes used by flush(). Hoisted like every other regex in this file:
// flush() runs on every '\n' of a response, so nothing it needs should be rebuilt
// per call. Presence is all that is asked, hence .test() and no capture groups.
const OPEN_THINK_RE = /<think>/i;
const CLOSE_THINK_RE = /<\/think>/i;

// One markdown-it instance for the whole module, built on first use.
//
// It used to be constructed inside flush(), i.e. once per '\n' of every response -
// a fresh rule chain, plugin list and normalizer per line, which is most of what
// made streaming feel slow. The options are invariant and render() keeps no state
// between calls, so a single shared instance is equivalent.
//
// Lazy rather than eager because `window.markdownit` comes from markdown-it.min.js,
// a classic script in index.html; by the time flush() runs it is certainly there,
// but module evaluation order relative to it is not something to rely on.
let _md = null;
function getMarkdownIt() {
    if (_md === null) {
        _md = window.markdownit({ html: true, breaks: true });
        _md.core.ruler.after('inline', 'mzta_echoed_br', collapseEchoedBrBreaks);
        _md.core.ruler.after('block', 'mzta_html_block_lines', breakHtmlBlockLines);
    }
    return _md;
}

// ── Raw HTML blocks: the model's newlines between two pieces of text ──────────
//
// A line that OPENS with a block-level tag ("<div>Ciao\ngrazie</div>"), or with
// any complete tag alone on its line ("<br>" then text lines), is an html_block:
// markdown-it passes it through raw and breaks:true never applies, so the
// model's newlines inside it were HTML whitespace and the lines reached the chat
// and the mail welded ("Ciao grazie"). This rule gives such a block the same
// reading breaks:true gives a paragraph - a newline the model wrote is a line
// break - but only where the newline really sits between two pieces of text on
// one line, which is what keeps HTML's own formatting out of it:
//
//   before   text, possibly through inline tags ("Ciao <b>Mario</b>\n"); NOT a
//            block tag or a <br>, which end their line already - so "<p>\n",
//            "</li>\n" and the echoed "Ciao,<br>\ngrazie" are left alone;
//   after    text or an inline opening tag, RIGHT after the newline. A newline
//            followed by indentation is pretty-printing ("<p>\n  Ciao\n  grazie")
//            and stays whitespace, as a browser shows it.
//
// The content of <pre>, <textarea>, <script>, <style>, <xmp>, <listing>,
// <plaintext> and <code>, and comments, is never touched. It works on the
// token's content, inside the parser - not a pass over the rendered output, which
// would also see the "<br>\n" markdown-it writes itself.
function breakHtmlBlockLines(state) {
    for (const token of state.tokens) {
        if (token.type === 'html_block') { token.content = htmlBlockWithLineBreaks(token.content); }
    }
}

// A comment, or a tag (quoted attribute values may hold '>'). Captured, so split()
// alternates text (even indexes) and markup (odd indexes).
const HTML_PART_RE = /(<!--[\s\S]*?-->|<\/?[A-Za-z][^"'>]*(?:(?:"[^"]*"|'[^']*')[^"'>]*)*>)/;
const HTML_INLINE_TAG_RE = /^<\/?(?:a|abbr|b|bdi|bdo|big|cite|code|data|del|dfn|em|font|i|ins|kbd|mark|q|s|samp|small|span|strike|strong|sub|sup|time|tt|u|var)\b/i;
// Elements whose content is left exactly as written: whitespace is meaningful
// (pre & co.), or is not text at all (script, style).
const HTML_RAW_OPEN_RE = /^<(pre|textarea|script|style|xmp|listing|plaintext|code)\b/i;
// A newline, with the trailing spaces of its line.
const HTML_NEWLINE_RE = /[ \t]*\n/g;

function htmlBlockWithLineBreaks(html) {
    const parts = html.split(HTML_PART_RE);
    // Whether the next non-comment part starts, right away, with text or an
    // inline opening tag.
    const textFollows = (from) => {
        for (let j = from; j < parts.length; j++) {
            const part = parts[j];
            if (j % 2 === 1) {
                if (part.startsWith('<!--')) { continue; }
                return HTML_INLINE_TAG_RE.test(part) && !part.startsWith('</');
            }
            if (part !== '') { return /^\S/.test(part); }
        }
        return false;
    };
    let lineHasText = false;     // text since the last block tag / <br> / newline
    let rawClose = null;         // inside a raw element: the closing tag awaited
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i % 2 === 1) {
            if (rawClose) {
                if (part.toLowerCase().startsWith(rawClose)) {
                    // </code> closes inline content; the others close a block.
                    lineHasText = (rawClose === '</code');
                    rawClose = null;
                }
                continue;
            }
            if (part.startsWith('<!--')) { continue; }
            const raw = part.match(HTML_RAW_OPEN_RE);
            if (raw) { rawClose = '</' + raw[1].toLowerCase(); continue; }
            if (!HTML_INLINE_TAG_RE.test(part)) { lineHasText = false; }
            continue;
        }
        if (rawClose || part === '') { continue; }
        parts[i] = part.replace(HTML_NEWLINE_RE, (nl, offset) => {
            const before = part.slice(0, offset);
            const lastLine = before.slice(before.lastIndexOf('\n') + 1);
            const hasBefore = before.includes('\n') ? /\S/.test(lastLine) : (lineHasText || /\S/.test(before));
            const after = part.slice(offset + nl.length);
            const hasAfter = (after !== '') ? /^\S/.test(after) : textFollows(i + 1);
            return (hasBefore && hasAfter) ? '<br>\n' : nl;
        });
        const tail = part.slice(part.lastIndexOf('\n') + 1);
        lineHasText = part.includes('\n') ? /\S/.test(tail) : (lineHasText || /\S/.test(part));
    }
    return parts.join('');
}

// A raw <br> tag the model wrote, as markdown-it isolates it in an html_inline token.
const ECHOED_BR_RE = /^<br\s*\/?>$/i;

// Core rule, after 'inline': a softbreak (or a hardbreak, "<br>  \n") right after a
// raw <br> is the newline the model wrote after that <br>, not a second line break.
// It becomes a "\n" text token - plain HTML whitespace, so the output is exactly
// the "<br>\n" markdown-it writes for a bare newline. NOT dropped: whatever later
// drops the <br> itself (a mail client's own HTML-to-text conversion) still finds
// whitespace between the two lines instead of welding them ("a<br>b" -> "ab").
// Code spans, code blocks and raw HTML blocks are tokens of their own, so a <br>
// written inside them is never looked at here (raw HTML blocks have their own
// rule, breakHtmlBlockLines).
function collapseEchoedBrBreaks(state) {
    for (const token of state.tokens) {
        if (token.type !== 'inline' || !token.children) { continue; }
        const children = token.children;
        for (let i = 1; i < children.length; i++) {
            const child = children[i];
            const prev = children[i - 1];
            if ((child.type === 'softbreak' || child.type === 'hardbreak') &&
                prev.type === 'html_inline' && ECHOED_BR_RE.test(prev.content)) {
                const text = new state.Token('text', '', 0);
                text.content = '\n';
                children[i] = text;
            }
        }
    }
}

// The ONE render path. markdown-it (html:true) may pass raw model HTML through, so
// its output is untrusted and MUST cross the sanitizer before it is shown or
// inserted into mail. allowBlocks:true - a whole answer, block + inline.
function renderResponse(raw) {
    return sanitizeBlockHtml(getMarkdownIt().render(raw));
}

// How much new raw text must accrue before the whole answer is re-rendered.
//
// A flush routinely lands mid-tag, so the whole response is re-rendered each time
// - O(n) per flush, O(n^2) over a response, on top of the DOMParser pass
// messagesArea does on the result. Rendering every ~2 KB instead of every '\n'
// keeps the output identical (the final flush always renders everything) while
// making the cost proportional to the answer's size rather than to its line count.
// Between renders the live token spans messagesArea appends still show the text
// arriving.
const HTML_RENDER_CHUNK = 2048;

export class StreamingMessage {

    constructor() {
        // Raw text of the CURRENT accumulating segment (reset on each flush,
        // mirroring the original per-element token collection).
        this._segmentText = '';
        // Thinking tokens fed by the worker (any provider that exposes reasoning
        // in a dedicated stream field). A RUNNING TOTAL for the whole response,
        // never drained: every render is cumulative (rebuilds the whole element,
        // thinking block included), so each flush hands back the WHOLE thinking and
        // messagesArea replaces the block with it. Draining per flush would blank
        // the reasoning on the second render of a thinking-then-long answer.
        this._thinkingAccumulator = '';
        // Inline <think>...</think> reasoning, accumulated across flushes into a
        // running total for the same reason as _thinkingAccumulator.
        this._inlineThinking = '';
        // Rendered HTML accrued across flushes for this whole response.
        this._fullTextHTML = '';
        // Raw (un-rendered, think-stripped) text of the WHOLE response, since each
        // flush re-renders everything rather than appending a fragment.
        this._htmlRawText = '';
        // Characters appended to _htmlRawText since the last render. Drives the
        // HTML_RENDER_CHUNK coalescing in flush().
        this._htmlPendingChars = 0;
    }

    handleNewToken(token) {
        this._segmentText += token;
    }

    handleNewThinkingToken(token) {
        this._thinkingAccumulator += token;
    }

    // Whether any reasoning arrived through newThinkingToken. A response made only of
    // thinking tokens has no content token to open its accumulating element, so the
    // caller asks this before the final flush.
    hasThinking() {
        return this._thinkingAccumulator !== '';
    }

    // Immutable snapshot of the HTML accrued so far. Plain string (never a live
    // reference to internal state).
    getFullTextHTMLSnapshot() {
        return String(this._fullTextHTML);
    }

    // Flush the current segment: re-render the WHOLE accumulated raw text.
    //
    // Returns null when the flush is deferred (an unterminated <think> block is
    // present mid-stream) — in that case NOTHING is consumed, exactly as before.
    //
    // Otherwise returns an immutable snapshot object:
    //   { html:         the whole rendered+sanitized answer so far (string),
    //     thinkingText: combined thinking content (string),
    //     fullTextHTML: snapshot of the HTML accrued across the whole response,
    //     cumulative:   always true — `html` is the WHOLE answer, so the caller
    //                   reuses the one accumulating element instead of retiring it
    //                   per flush,
    //     deferred:     when true, `html` holds nothing to render and the caller must
    //                   leave the accumulating element's DOM as it is, and keep the live
    //                   "Thinking..." indicator. Set between coalesced renders;
    //                   `thinkingText` is empty (any thinking is held back in the
    //                   accumulator for the next non-deferred flush). }
    //
    // `final` is set by the caller's last flush of the response; it forces a render
    // even if less than HTML_RENDER_CHUNK has accrued, so the finished answer is
    // always complete.
    flush(final = false) {
        let fullText = this._segmentText;

        // If an unterminated <think> block is present (mid-stream), defer the
        // render until the closing tag arrives — tokens stay in the DOM as raw
        // fading spans, but the partial <think> content is never sent through the
        // renderer or promoted to the final thinking block.
        if (!this.thinkingSeparated && OPEN_THINK_RE.test(fullText) && !CLOSE_THINK_RE.test(fullText)) {
            return null;
        }

        // Extract inline <think>...</think> blocks (Ollama / OpenAI Comp) and strip
        // them from fullText. Unterminated blocks are handled by the guard above,
        // never here, so truncation is left off. The extracted reasoning is added to
        // the running inline-thinking total (this segment is only ever seen once,
        // since _segmentText is cleared below).
        // No leading trim (third argument left off): this is a SEGMENT, not the whole
        // response, so the space opening it is interior to the answer once appended to
        // _htmlRawText below. Trimming it welds the last word of the previous segment to
        // the first word of this one ("the" + " body" -> "thebody").
        const stripped = this.thinkingSeparated ? { text: fullText, thinking: '' } : stripThinkTags(fullText);
        if (stripped.thinking) {
            this._inlineThinking += (this._inlineThinking ? '\n' : '') + stripped.thinking;
        }
        fullText = stripped.text;

        // Combined thinking content: worker-side running total (Anthropic / Ollama /
        // Gemini / OpenAI Comp / OpenAI Responses) + inline running total (<think>
        // tags). The WHOLE thing, every render - not drained.
        let combinedThinking = this._thinkingAccumulator;
        if (this._inlineThinking) {
            combinedThinking += (combinedThinking ? '\n' : '') + this._inlineThinking;
        }

        // Accumulate this (think-stripped) segment into the whole-response raw
        // text. The render is over the whole thing, not this segment.
        this._htmlRawText += fullText;
        this._htmlPendingChars += fullText.length;
        this._segmentText = '';

        // Not enough new text to be worth re-rendering the whole answer yet.
        // Nothing is lost: the text is already in _htmlRawText, and `deferred`
        // tells the caller to leave the live token spans on screen rather than
        // repainting - which is what keeps the answer visibly streaming between
        // renders.
        //
        // thinkingText is empty here: on a deferred flush the caller returns early
        // and renders no thinking block, keeping the live "Thinking..." indicator
        // instead. The reasoning is safe in the running totals and the next
        // non-deferred flush hands back the whole of it.
        if (!final && this._htmlPendingChars < HTML_RENDER_CHUNK) {
            return {
                html: '',
                thinkingText: '',
                fullTextHTML: this.getFullTextHTMLSnapshot(),
                cumulative: true,
                deferred: true,
            };
        }

        // Re-render the whole accumulated raw text and REPLACE _fullTextHTML: a raw
        // tag split across a segment boundary ("<b>Mar" | "io</b>") is only whole
        // when the whole text is re-parsed, never when per-segment output is
        // concatenated.
        this._fullTextHTML = renderResponse(this._htmlRawText);
        this._htmlPendingChars = 0;
        return {
            html: this._fullTextHTML,
            thinkingText: combinedThinking,
            fullTextHTML: this.getFullTextHTMLSnapshot(),
            // `html` is the WHOLE response, not this segment. The caller must keep
            // reusing the same accumulating element, or the answer would be
            // re-rendered once per flush and pile up on screen.
            cumulative: true,
        };
    }
}
