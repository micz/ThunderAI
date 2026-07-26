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

        // Convert Markdown to DOM nodes using the markdown-it library
        const md = window.markdownit();
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
