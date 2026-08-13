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
import { sanitizeBlockHtml } from './diffPicker.js';

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

// Is this response HTML?
//
// The prompts that send HTML to the model (they carry {%selected_html%} /
// {%mail_html_body_or_selected%}) get HTML back, and markdown-it runs with
// html:false, so it would escape the answer into visible "&lt;p&gt;" text - which
// is exactly what users saw. This is the test that routes such an answer to the
// sanitizer instead.
//
// The rule is a LEAD-IN followed by a BLOCK TAG. The lead-in is what makes this
// robust: an earlier version anchored the block tag at the very start of the
// response, and a single stray token ahead of it flipped the whole answer to the
// markdown path. That is not hypothetical - the same prompt, run twice, once
// opened "<li>" (rendered) and once "<br><li>" (every tag escaped), because the
// model had echoed a <br> from its input. Nothing about the answer differed but
// its first token, so the routing has to tolerate whatever noise precedes the
// real markup.
//
// Allowed in the lead-in, none of which says anything about the response's shape:
//   - whitespace
//   - <br> runs (echoed from an HTML mail body)
//   - an HTML comment, doctype or XML prolog
//   - a fragment of a stray sentence, as long as it is SHORT, sits on the
//     response's first line and carries no markdown syntax - see LEAD_IN_PROSE
//     below for why that bound exists.
//
// Still deliberately narrow in what COUNTS as the signal, because the cost of a
// false positive is a mangled normal answer:
//   - only a BLOCK tag counts. A markdown answer that merely mentions <b>
//     mid-sentence is not HTML.
//   - <br> alone never counts, on either side of this test: it is the one tag a
//     markdown answer is genuinely likely to contain, and normalizeEchoedBrTags()
//     already owns echoed <br> runs on the markdown path.
// Everything that is not clearly HTML keeps going through markdown-it untouched.
const BLOCK_TAG = '(?:p|div|ul|ol|li|h[1-6]|blockquote|pre|table|tr|td|th|tbody|thead)';

// The lead-in tolerated before the first block tag: whitespace, echoed <br>
// runs, comments, a doctype or an XML prolog.
const LEAD_IN = `(?:\\s|<br\\s*/?>|<!--[\\s\\S]*?-->|<![^>]*>|<\\?[^>]*\\?>)*`;
// Prose that may precede the markup, bounded on purpose. It buys the case where
// a model prefixes a few words - "Ecco il testo:" - to markup it was told to
// emit bare, which is a thing models do under exactly the "reply with only ..."
// style of prompt these features use. The exclusions ARE the rule, so there is
// no second check to keep in sync with this one:
//   - no '<', so it cannot skate past markup that should have been judged;
//   - no newline, so it stays on the response's first line;
//   - no markdown syntax character, so "**Nota:** <p>" stays markdown;
//   - 40 chars, i.e. a few words. A real markdown answer that opens with a
//     sentence long enough to matter is past the bound before its first tag.
const LEAD_IN_PROSE = `[^<\\n*_\`~#>\\[\\]|]{0,40}`;
// Around prose, only SAME-LINE lead-in may appear. LEAD_IN matches \s, newline
// included, so using it on either side of the prose would accept markdown whose
// SECOND line merely happens to start with a tag ("Riga uno\n<p>x</p>", and the
// mirror case "\nRiga uno<p>x</p>"). Blank horizontal space, <br> and comments
// are fine; a line break is not. The prose branch as a whole is therefore
// confined to one line - the response's first.
const LEAD_IN_SAME_LINE = `(?:[ \\t]|<br\\s*/?>|<!--[\\s\\S]*?-->)*`;
// Two shapes, kept as separate alternatives so the prose one cannot borrow a
// newline from the other:
//   1. lead-in (newlines allowed) then the tag  - "<br>\n<li>", "\n\n<p>"
//   2. same-line lead-in, short prose, same-line lead-in, then the tag
//      - "Ecco il testo: <p>", and nothing spanning a line break
const HTML_RESPONSE_RE = new RegExp(
    `^(?:${LEAD_IN}|${LEAD_IN_SAME_LINE}${LEAD_IN_PROSE}${LEAD_IN_SAME_LINE})<${BLOCK_TAG}\\b[^>]*>`, 'i');

// A closing block tag with no opener ahead of it, e.g. a response that begins
// "Distinti saluti.</p>". Only reachable on the FIRST flushed segment (the
// decision is sticky), so it cannot be triggered by the tail of an answer that
// already chose the markdown path - and a markdown answer has no reason to emit
// a bare closing block tag at all.
const ORPHAN_CLOSING_BLOCK_RE = new RegExp(`^[^<]*</${BLOCK_TAG}\\s*>`, 'i');

// Text that is nothing but lead-in: whitespace, <br> runs, comments. It carries
// no evidence either way, so a response that has produced only this so far is
// not yet decidable - see looksLikeHtmlResponse's null return.
const LEAD_IN_ONLY_RE = new RegExp(`^${LEAD_IN}$`, 'i');

// Decide whether a response is HTML.
//
// Returns true / false once there is evidence, or NULL while the response so far
// is all lead-in and could still turn out to be either. Null matters because the
// caller's decision is sticky and a flush fires on every '\n': a model that emits
// "<br>\n<li>..." hands this function a lone "<br>" first, and answering false
// there would lock the whole answer onto the markdown path over a tag that says
// nothing - the exact failure this rework exists to fix, just one segment later.
//
// Code regions are masked out first, for the same reason normalizeEchoedBrTags()
// masks them: an answer whose subject IS html - "how do I center a <div>?" -
// must keep going through markdown-it, so that the markup shows up as text in a
// code block instead of being sanitized into a real element. Without the mask a
// reply opening with a fenced block would be misread as HTML by its own example.
function looksLikeHtmlResponse(text) {
    // The mask keeps the ORIGINAL length, so offsets and the "first line" rules
    // above still mean what they say. Its filler is deliberately inert - digits
    // between two U+0000 - so a masked region can never itself look like markup.
    const masked = String(text).replace(CODE_REGIONS_RE, (match) =>
        CODE_MASK + '0'.repeat(Math.max(match.length - 2, 0)) + CODE_MASK);

    if (HTML_RESPONSE_RE.test(masked) || ORPHAN_CLOSING_BLOCK_RE.test(masked)) {
        return true;
    }

    // No block tag yet. If everything so far is lead-in, withhold the decision
    // and let the next segment settle it.
    if (LEAD_IN_ONLY_RE.test(masked)) { return null; }

    return false;
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
        // Whether THIS response is HTML. Decided once, on the first flushed
        // segment, and then STICKY for the rest of the response.
        //
        // Sticky because flush() runs per segment (tokens are flushed on every
        // '\n'), and a later segment of an HTML answer can easily start with a
        // bare text node - "Distinti saluti.</p>" - which on its own looks like
        // markdown. Re-deciding per segment would render one answer half one way
        // and half the other.
        this._isHtmlResponse = null;
        // Text flushed while _isHtmlResponse is still undecided. A response that
        // opens with a lone "<br>" carries no evidence either way, so the verdict
        // is withheld and the segments are judged together once the markup
        // arrives. Cleared as soon as the decision is made.
        this._undecidedText = '';
        // Raw (un-rendered) text of the whole response, accumulated only on the
        // HTML path, where each flush re-sanitizes everything rather than
        // appending a fragment. See flush().
        this._htmlRawText = '';
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
    // Flush the current segment.
    //
    // `final` is set by the caller's last flush of the response. It forces a
    // verdict on text that is still undecided: a response made of nothing but
    // lead-in ("<br>" and no more) would otherwise be held back forever and
    // never rendered. Such text has no block tag by definition, so markdown is
    // the right home for it.
    flush(final = false) {
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

        // Decide the response's shape once, then stay with it (see
        // _isHtmlResponse). looksLikeHtmlResponse may return null - "not enough
        // evidence yet" - in which case nothing is committed and the next
        // segment gets to decide. The whole response so far is what is judged,
        // not just this segment, so an inconclusive lead-in and the markup that
        // follows it are weighed together even when a '\n' split them apart.
        if (this._isHtmlResponse === null) {
            this._undecidedText += fullText;
            let verdict = this._undecidedText.trim() === ''
                ? null
                : looksLikeHtmlResponse(this._undecidedText);
            // Last chance: nothing more is coming, so settle it.
            if (verdict === null && final) { verdict = false; }
            if (verdict === null) {
                // Still undecided. Hold the text back rather than rendering it:
                // committing it to the markdown path now would have to be undone
                // if the next segment turns out to be markup, and the deferred
                // text is only ever a lead-in (whitespace, a <br>, a comment),
                // so nothing meaningful is kept off screen. The raw tokens are
                // already visible as fading spans meanwhile.
                //
                // The thinking text is NOT held back - it is independent of the
                // response's shape, and swallowing it would strand the thinking
                // indicator until the next flush.
                this._segmentText = '';
                return {
                    html: '',
                    thinkingText: combinedThinking,
                    fullTextHTML: this.getFullTextHTMLSnapshot(),
                };
            }
            this._isHtmlResponse = verdict;
            // Judged as a whole, so it must be rendered as a whole: put the
            // deferred lead-in back in front of this segment.
            fullText = this._undecidedText;
            this._undecidedText = '';
        }

        // HTML answer: sanitize instead of escaping, and skip markdown-it
        // entirely. Running both would be wrong in either order - markdown-it
        // escapes the tags, and re-parsing its output as markdown mangles the
        // markup.
        //
        // normalizeEchoedBrTags() is skipped too: it rewrites <br> runs into
        // newlines so that markdown-it does not escape them, and here there is no
        // markdown-it to protect them from - a <br> is simply a <br>.
        //
        // THE WHOLE RESPONSE SO FAR is re-sanitized on every flush, and the
        // result REPLACES _fullTextHTML instead of being appended to it. That is
        // the difference that matters on this path: segments break on '\n', which
        // for HTML falls wherever the model happened to wrap - frequently INSIDE
        // an element. Sanitizing "<ul><li>a" on its own makes DOMParser close the
        // tags, and the next segment "</li></ul>" would then be a stray closer;
        // appending those fragments would accumulate garbage. Re-parsing the
        // accumulated raw text keeps every element whole.
        if (this._isHtmlResponse) {
            this._htmlRawText += fullText;
            this._fullTextHTML = sanitizeBlockHtml(this._htmlRawText);
            this._segmentText = '';
            return {
                html: this._fullTextHTML,
                thinkingText: combinedThinking,
                fullTextHTML: this.getFullTextHTMLSnapshot(),
                // `html` is the WHOLE response, not this segment. The caller
                // normally retires the accumulating element after each flush and
                // starts a new one, which is right when each flush contributes
                // the next piece; here it must keep reusing the same element, or
                // the answer would be re-rendered once per flush and pile up on
                // screen.
                cumulative: true,
            };
        }

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
