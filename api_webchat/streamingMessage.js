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
// stripThinkTags() helper in js/mzta-utils.js), renders markdown via markdown-it,
// and accrues the resulting HTML across the (possibly several) flushes a single
// response can produce (the accumulating element is flushed mid-stream on every '\n').
//
// A response can flush multiple times, so `fullTextHTML` accrues across flushes
// within the instance and is exposed only as an IMMUTABLE STRING SNAPSHOT via
// flush()'s return value / getFullTextHTMLSnapshot(). Callers snapshot this at
// button-build time; returning a live getter into mutable state would let a
// later turn corrupt an earlier turn's buttons — hence one instance per turn,
// never reused, and never a reference into internal mutable state.
//
// `window.markdownit` is the global from markdown-it.min.js, loaded as a classic
// script in index.html before the module scripts.

import { stripThinkTags } from '../js/mzta-utils.js';

// Fenced code blocks (``` / ~~~, any fence length, with or without an info
// string) and inline code spans (`…`, ``…``). Matched in this order so a
// backtick inside a fence is never mistaken for the start of a span.
const CODE_REGIONS_RE = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})([^\n]*)\n[\s\S]*?(?:\n[ \t]{0,3}\3[ \t]*(?=\n|$)|$)|(`+)[\s\S]*?\5/g;

// A run of literal <br> tags, whitespace between them included. The run is the
// unit on purpose: see normalizeEchoedBrTags().
const BR_RUN_RE = /(?:<br\s*\/?>\s*)+/gi;

// The model may echo literal <br> tags coming from an HTML mail body. markdown-it
// runs with html:false, so they would be escaped to &lt;br&gt; and shown as visible
// text. Rewrite them to newlines instead, before the render.
//
// The rewrite is done per RUN, not per tag, so the vertical space is decided here
// rather than falling out of markdown-it's blank-line collapsing:
//   one <br>            -> '\n'    (a line break; breaks:true renders it as <br>)
//   two or more <br>    -> '\n\n'  (exactly one paragraph break, hence one blank
//                                   line — whether the model wrote 2 or 8 of them)
// Without this, 2 <br> and 8 <br> both happened to produce one blank line only as
// a side effect of consecutive blank lines collapsing; the amount of space was not
// something the code decided.
//
// Code is masked out first: a <br> the user is asking the model ABOUT belongs in
// the code block as escaped text, exactly as markdown-it would render it. Both
// fenced blocks and inline spans are replaced by a placeholder that survives the
// rewrite untouched and is put back before the render. The placeholder uses U+0000,
// which cannot appear in a model response.
const CODE_MASK = '\u0000';
const CODE_MASK_RE = /\u0000(\d+)\u0000/g;

function normalizeEchoedBrTags(text) {
    const stash = [];
    const masked = text.replace(CODE_REGIONS_RE, (match) => {
        stash.push(match);
        return CODE_MASK + (stash.length - 1) + CODE_MASK;
    });

    const rewritten = masked.replace(BR_RUN_RE, (run) => {
        const count = (run.match(/<br\s*\/?>/gi) || []).length;
        return count > 1 ? '\n\n' : '\n';
    });

    return rewritten.replace(CODE_MASK_RE, (m, idx) => stash[Number(idx)] ?? m);
}

export class StreamingMessage {

    constructor() {
        // Raw text of the CURRENT accumulating segment (reset on each flush,
        // mirroring the original per-element token collection).
        this._segmentText = '';
        // Thinking tokens fed by the worker (any provider that exposes reasoning
        // in a dedicated stream field); reset on each flush,
        // mirroring the original this.thinkingAccumulator behavior.
        this._thinkingAccumulator = '';
        // Rendered HTML accrued across flushes for this whole response.
        this._fullTextHTML = '';
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

    // Flush the current segment. Ports the exact logic of the original
    // MessagesArea.flushAccumulatingMessage() token→HTML pipeline.
    //
    // Returns null when the flush is deferred (an unterminated <think> block is
    // present mid-stream) — in that case NOTHING is consumed, exactly as before.
    //
    // Otherwise returns an immutable snapshot object:
    //   { html:         markdown-rendered HTML for THIS segment (string),
    //     thinkingText: combined thinking content for this segment (string),
    //     fullTextHTML: snapshot of the HTML accrued across the whole response }
    flush() {
        let fullText = this._segmentText;

        // If an unterminated <think> block is present (mid-stream), defer the
        // markdown render until the closing tag arrives — tokens stay in the DOM
        // as raw fading spans, but the partial <think> content is never sent
        // through markdown-it or promoted to the final thinking block.
        const openThink = fullText.match(/<think>/i);
        const closeThink = fullText.match(/<\/think>/i);
        if (openThink && !closeThink) {
            return null;
        }

        // Extract inline <think>...</think> blocks (Ollama / OpenAI Comp) and strip them
        // from fullText. Unterminated blocks are handled by the guard above, never here,
        // so truncation is left off.
        const stripped = stripThinkTags(fullText);
        const inlineThinking = stripped.thinking;
        fullText = stripped.text;

        // Combined thinking content: worker-side (Anthropic / Ollama / Gemini /
        // OpenAI Comp / OpenAI Responses) + inline (<think> tags)
        let combinedThinking = this._thinkingAccumulator;
        if (inlineThinking) {
            combinedThinking += (combinedThinking ? '\n' : '') + inlineThinking;
        }
        this._thinkingAccumulator = '';

        fullText = normalizeEchoedBrTags(fullText);

        // Convert Markdown to DOM nodes using the markdown-it library.
        //
        // breaks:true is deliberate and is what makes the answer survive into the
        // mail. This is a mail composer, not a markdown document: a newline the
        // model wrote is a newline the user expects to see. With the default
        // breaks:false a single '\n' inside a paragraph renders as a bare newline
        // in the HTML, which is whitespace and collapses to a space — the break is
        // simply lost in `_fullTextHTML`, the snapshot the "use this answer" path
        // inserts into the message. With breaks:true markdown-it emits a real <br>,
        // so the chat and the mail show the same line structure.
        const md = window.markdownit({ breaks: true });
        const html = md.render(fullText);

        this._fullTextHTML += html;

        // This segment has been consumed.
        this._segmentText = '';

        return {
            html: html,
            thinkingText: combinedThinking,
            fullTextHTML: this.getFullTextHTMLSnapshot(),
        };
    }
}
