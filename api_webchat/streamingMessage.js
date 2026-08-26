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
    if (_md === null) { _md = window.markdownit({ html: true, breaks: true }); }
    return _md;
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
        if (OPEN_THINK_RE.test(fullText) && !CLOSE_THINK_RE.test(fullText)) {
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
        const stripped = stripThinkTags(fullText);
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
