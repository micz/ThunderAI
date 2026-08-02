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
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

import { prefs_default } from '../options/mzta-options-default.js';
import './splitButton.js';   // registers the <split-button> custom element
import './diffPicker.js';    // registers the <diff-picker> custom element
import { renderThinkingBlock } from './thinkingBlock.js';
import { StreamingMessage } from './streamingMessage.js';
import { SHARED_BASE_CSS, BUTTON_CSS } from './sharedStyles.js';
import {
    buildSparkleIcon, buildCopyIcon, buildCheckIcon, buildDiffIcon,
    buildSaveIcon, buildUseAnswerIcon, buildScrollToBottomIcon,
} from './svgIcons.js';
const messagesAreaTemplate = document.createElement('template');

const messagesAreaStyle = document.createElement('style');
messagesAreaStyle.textContent = SHARED_BASE_CSS + BUTTON_CSS + `
    /* Exactly one box here scrolls, and it is #messages. The host must not:
       a wheel event over #messages bubbles up to it, so if both declared
       overflow the transcript could end up scrolling in a box whose scrollTop
       the stick-to-bottom logic below never reads. position:relative makes it
       the containing block of the floating "scroll to latest" button. */
    :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        position: relative;
    }
    #messages {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        padding: 18px 18px 8px;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        /* Firefox scroll anchoring fights the logic below: it tries to hold the
           visual position while content grows, but flushAccumulatingMessage()
           tears down and rebuilds the subtree an anchor may have picked, which
           shows up as micro-jumps. While sticky we set scrollTop ourselves. */
        overflow-anchor: none;
        box-sizing: border-box;
    }

    /* Reserves the scrollback that lets the anchored prompt actually reach the
       top of the viewport. Without it the transcript simply is not tall enough
       to scroll that far while the answer is still short, and the prompt would
       creep up only as the answer happened to grow. Height is set inline by
       _updateAnchorSpacer() and the node is removed once no exchange is pinned,
       so it never leaves dead space at the end of a finished conversation.
       flex-shrink:0 matters: #messages is a flex column and would otherwise
       collapse it. */
    #anchorSpacer {
        flex: 0 0 auto;
        width: 100%;
    }

    /* ---- turns ----
       Every exchange is wrapped in a .turn. The wrapper is what makes the
       per-answer toolbar possible: :hover / :focus-within need a single
       element enclosing the answer and its buttons. */
    .turn {
        margin-bottom: 18px;
        animation: mztaTurnIn .18s ease-out;
    }
    @keyframes mztaTurnIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .turn-user {
        display: flex;
        justify-content: flex-end;
    }
    .turn-user .bubble {
        max-width: 78%;
        background: var(--accent);
        color: #fff;
        padding: 10px 14px;
        border-radius: var(--r-bubble) var(--r-bubble) 4px var(--r-bubble);
        font-size: .875rem;
        line-height: 1.45;
    }

    .turn-bot {
        display: flex;
        gap: 11px;
    }
    .turn-head {
        flex-shrink: 0;
        width: 26px;
        height: 26px;
        border-radius: 8px;
        background: var(--accent-soft);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 2px;
    }
    .turn-body {
        flex: 1;
        min-width: 0;
    }
    .turn-name {
        font-size: .8125rem;
        font-weight: 650;
        color: var(--ink-2);
        margin-bottom: 5px;
    }
    .turn-error .turn-head {
        background: var(--err-bg);
        color: var(--err-ink);
    }
    .turn-error .turn-name {
        color: var(--err-ink);
    }

    .message {
        margin: 0;
        font-size: .875rem;
        line-height: 1.55;
        color: var(--ink);
    }
    .message p{
        margin: 0 0 10px;
        padding: 0;
    }
    .message p:last-child{
        margin-bottom: 0;
    }
    .token {
        display: inline;
        opacity: 0;
        animation: fadeIn 1000ms forwards;
    }
    @keyframes fadeIn {
        to {
            opacity: 1;
        }
    }

    /* ---- rendered markdown ---- */
    .message code {
        font-family: var(--font-mono);
        background: var(--code-bg);
        padding: 2px 6px;
        border-radius: 5px;
        font-size: .9em;
    }
    .message pre {
        background: var(--code-bg);
        padding: 10px 12px;
        border-radius: var(--r-md);
        overflow-x: auto;
    }
    .message pre code {
        background: none;
        padding: 0;
    }
    .message blockquote {
        margin: 0 0 10px;
        padding-left: 12px;
        border-left: 3px solid var(--border-strong);
        color: var(--ink-2);
    }
    .message ul, .message ol {
        margin: 0 0 10px;
        padding-left: 22px;
    }
    .message a {
        color: var(--accent);
    }
    .message table {
        border-collapse: collapse;
        margin-bottom: 10px;
    }
    .message th, .message td {
        border: 1px solid var(--border);
        padding: 5px 9px;
        text-align: left;
    }
    .message th {
        background: var(--surface-2);
    }

    /* ---- action bar (newest answer only) ---- */
    .action-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
    }
    /* Resting outline so the button reads as a control before hover. The
       tertiary base keeps a transparent 1px border, so this only recolors it
       and adds no layout shift. --border is too faint to register against the
       transcript background (the tertiary family has no --surface fill of its
       own), hence --border-strong at rest and a further step on hover.
       border-color is not in the tertiary transition, so it is added here. */
    .action-bar .close_btn {
        margin-left: auto;
        border-color: var(--border-strong);
        transition: background .12s ease, color .12s ease, border-color .12s ease;
    }
    .action-bar .close_btn:hover {
        border-color: var(--ink-3);
    }

    /* ---- light toolbar (earlier answers only) ---- */
    .turn-tools {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        opacity: .55;
        transition: opacity .12s ease;
    }
    .turn-bot:hover .turn-tools,
    .turn-bot:focus-within .turn-tools {
        opacity: 1;
    }

    .error{
        background: var(--err-bg);
        color: var(--err-ink);
        border: 1px solid var(--err-border);
        border-radius: var(--r-md);
        padding: 8px 12px;
    }
    .info{
        background: var(--info-bg);
        color: var(--info-ink);
        border: 1px solid var(--info-border);
        border-radius: var(--r-md);
        padding: 8px 12px;
        font-size: .78125rem;
        line-height: 1.5;
    }
    .info_obj{
        font-weight: 600;
    }
    .sel_info{
        font-size: .71875rem;
        color: var(--ink-3);
        margin: 9px 0 0;
        display: none;
    }

    /* The diff .added/.removed rules used to live here, because the read-only
       diff viewer appended its nodes straight into this shadow root. The
       interactive <diff-picker> that replaced it has its own shadow root and
       declares its own equivalents, so nothing here styles a diff any more. */

    /* Thinking block styles */
    details.thinking-block {
        border-left: 3px solid var(--border-strong);
        background: var(--surface-2);
        padding: 0.3em 0.6em;
        margin: 0 0 0.6em 0;
        font-size: 0.9em;
        color: var(--ink-2);
        border-radius: 4px;
    }
    details.thinking-block > summary {
        cursor: pointer;
        font-weight: 600;
    }
    details.thinking-block .thinking-content {
        white-space: pre-wrap;
        margin-top: 0.3em;
    }

    /* Live "Thinking..." indicator, shown while thinking tokens are streaming
       in and removed as soon as flushAccumulatingMessage() renders the real
       details.thinking-block. Styled as the same family as that block so the
       swap does not read as a layout change: the spinner sits where the
       <summary> disclosure triangle will be, and the label keeps its x position.
       The motion lives in the animated SVG, so the row itself is static.
       The label gets an explicit line-height so its line box matches the 16px
       spinner: with the default (normal) line-height the box is taller than the
       glyphs and its asymmetric leading made the centered spinner read as
       sitting slightly low next to the word. */
    .thinking-live {
        display: flex;
        align-items: center;
        gap: 0.35em;
        line-height: 16px;
        border-left: 3px solid var(--border-strong);
        background: var(--surface-2);
        padding: 0.3em 0.6em;
        margin: 0 0 0.6em 0;
        font-size: 0.9em;
        font-weight: 600;
        color: var(--ink-2);
        border-radius: 4px;
    }
    .thinking-live .thinking-spinner {
        flex: none;
        width: 16px;
        height: 16px;
        display: block;
    }

    /* ---- jump to latest ----
       Shown exactly while auto-follow is off, i.e. whenever the transcript is
       no longer tracking new content. Absolute against the host, so it stays
       inside #appContainer's 768px column without any viewport math. */
    #jumpToLatest {
        position: absolute;
        right: 18px;
        bottom: 14px;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: var(--r-pill);
        background: var(--surface);
        color: var(--ink-2);
        box-shadow: 0 2px 8px var(--shadow);
        cursor: pointer;
        transition: background .12s ease, border-color .12s ease;
    }
    #jumpToLatest:hover {
        border-color: var(--border-strong);
        background: var(--hover);
        color: var(--ink);
    }
    /* Required: display:flex above would otherwise beat the UA [hidden] rule. */
    #jumpToLatest[hidden] {
        display: none;
    }

    /* The token fade-in and the turn slide are decorative: with reduced motion
       the SHARED_BASE_CSS override collapses their duration, so make sure they
       still settle on the visible end state rather than at opacity 0. */
    @media (prefers-reduced-motion: reduce) {
        .token { opacity: 1; }
    }

    /* ---- narrow windows ---- */
    @media (max-width: 520px) {
        .turn-user .bubble {
            max-width: 88%;
        }
        .action-bar .close_btn {
            margin-left: 0;
            width: 100%;
            justify-content: center;
        }
        /* Secondary actions collapse to their icon; the label stays available
           to assistive tech through aria-label. */
        .action-bar .mzta-btn-secondary {
            min-width: 36px;
            justify-content: center;
        }
        .action-bar .mzta-btn-secondary .btn-label {
            display: none;
        }
    }
`;
messagesAreaTemplate.content.appendChild(messagesAreaStyle);

const messagesDiv = document.createElement('div');
messagesDiv.id = 'messages';
messagesAreaTemplate.content.appendChild(messagesDiv);

// Label and icon are set per instance in the constructor: the icon builders
// return live DOM nodes, which cannot be shared across template clones.
const jumpButton = document.createElement('button');
jumpButton.id = 'jumpToLatest';
jumpButton.type = 'button';
jumpButton.hidden = true;
messagesAreaTemplate.content.appendChild(jumpButton);

class MessagesArea extends HTMLElement {

    fullTextHTML = "";
    llmName = "LLM";

    // Slack that still counts as "at the bottom". One line of body text
    // (.875rem * 1.55 ~ 22px) is the useful unit: it absorbs the sub-pixel
    // rounding of scrollHeight at the various font zoom levels, and the few
    // pixels a token can add between the write and the scroll event it fires.
    static BOTTOM_SLACK_PX = 24;

    // Fraction of the viewport the anchored prompt is allowed to keep when it
    // is too tall to leave the answer a comfortable share. Beyond that we push
    // the prompt up until it holds a third and the answer gets the other two.
    static PROMPT_MAX_VIEWPORT_SHARE = 1 / 3;

    constructor() {
        super();
        this.accumulatingMessageEl = null;
        // Owns the streaming/parsing state for the current bot response. A new
        // instance is created per response (see handleNewToken) and finalized in
        // handleTokensDone, so each turn's flushed HTML snapshot is isolated.
        this._streaming = null;
        this.hideThinking = false;
        // Live "Thinking..." placeholder element, while it is on screen.
        this.thinkingLiveEl = null;
        // Wrapper of the turn currently being built. It must survive every
        // flush: a single response flushes on each '\n', so clearing it there
        // would start a fresh wrapper (and a second avatar) mid-answer. Only
        // appendUserMessage() and handleTokensDone() reset it.
        this._currentTurnEl = null;
        // Turn that currently owns the full action bar. When a newer answer
        // arrives its bar is removed, leaving only the light toolbar behind,
        // so a long conversation never accumulates identical bars.
        this._lastFullBarTurn = null;

        // ---- following the conversation ----
        // True while the transcript should follow new content. It goes off as
        // soon as the user scrolls away from the bottom, and back on when they
        // return there or press the jump button. A long answer must not drag
        // the view along while it is being read.
        this._stickToBottom = true;
        // The user turn the current exchange is pinned to, if any. While set,
        // following aims at "prompt at the top of the viewport" instead of at
        // the bottom of the transcript: the answer then grows downwards into a
        // still view rather than dragging the reader along. Cleared when the
        // anchor target has been reached (the transcript is long enough that
        // the anchor no longer constrains anything) or when the user takes over.
        this._anchorTurnEl = null;
        // Spacer reserving the scrollback the anchor needs; see
        // _updateAnchorSpacer(). Exists only while an exchange is pinned.
        this._anchorSpacer = null;
        // Cached #messages padding-top, in px. Invalidated on resize, which is
        // also when font zoom changes it.
        this._padTopPx = null;
        // Raised right before every programmatic scrollTop write and consumed
        // by the scroll event it provokes: setting scrollTop fires a 'scroll'
        // event indistinguishable from a user gesture, so without this latch
        // the handler would read its own scroll and could unstick itself.
        this._programmaticScroll = false;
        // Handle of the rAF coalescing the per-token writes (_requestScroll).
        this._scrollRaf = 0;
        // Handle of the rAF coalescing the deferred jump button re-read
        // (_confirmJumpButton).
        this._confirmRaf = 0;
        this._onMessagesScroll = this._onMessagesScroll.bind(this);
        this._onUserScrollIntent = this._onUserScrollIntent.bind(this);
        this._onPickerResize = this._onPickerResize.bind(this);

        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(messagesAreaTemplate.content.cloneNode(true));

        this.messages = shadowRoot.querySelector('#messages');

        this._jumpButton = shadowRoot.querySelector('#jumpToLatest');
        const jumpLabel = browser.i18n.getMessage("apiwebchat_scroll_to_latest");
        this._jumpButton.setAttribute('aria-label', jumpLabel);
        this._jumpButton.title = jumpLabel;
        this._jumpButton.appendChild(buildScrollToBottomIcon(16));
        this._jumpButton.addEventListener('click', () => this.scrollToBottom());
    }

    // The listeners live here rather than in the constructor so they are
    // symmetrical with disconnectedCallback. <messages-area> is already in the
    // markup when this module is evaluated, so this runs during upgrade,
    // before controller.js calls init().
    connectedCallback() {
        this.messages.addEventListener('scroll', this._onMessagesScroll, { passive: true });
        // Gesture-level unstick. The scroll listener alone is nearly enough,
        // but during a fast stream a wheel-up can be overwritten by the next
        // token's write before the browser dispatches the scroll event.
        this.messages.addEventListener('wheel', this._onUserScrollIntent, { passive: true });
        this.messages.addEventListener('keydown', this._onUserScrollIntent, { passive: true });
        // <diff-picker> switching to its editor, or the user dragging the
        // textarea's resize handle, changes the transcript's height with no
        // mutation and no scroll event. One delegated listener here, not one per
        // picker: the event bubbles and is composed, so it reaches this element
        // from inside any picker's shadow root and there is nothing to tear down
        // per turn.
        this.messages.addEventListener('mzta-picker-resize', this._onPickerResize, { passive: true });
        // Window resizing and font zoom change scrollHeight without firing a
        // scroll event: realign if we are still following.
        this._resizeObs = new ResizeObserver(() => {
            this._padTopPx = null;
            this._scrollIfSticky();
            // Also when not following: growing the viewport can bring the bottom
            // into view without any scroll event, and _scrollIfSticky() does
            // nothing in that state so no frame would run to notice.
            this._updateJumpButton();
        });
        this._resizeObs.observe(this.messages);
        // Content growing does NOT resize #messages: it is a flex item with a
        // height decided by the column and overflow:auto, so its own border box
        // never moves and the observer above never fires for it. The transcript's
        // height nevertheless decides whether there is anything below the fold,
        // and it can grow with no scroll event and no frame of ours in flight -
        // most visibly in handleTokensDone(), which appends the action bar after
        // an await while the user sits at an anchored prompt with following
        // already off, so the _scrollIfSticky() next to it is a no-op. Observing
        // the turns is what turns that growth into a button refresh.
        this._contentObs = new ResizeObserver(() => {
            // Read-only: never write layout from here. See the note on
            // _updateJumpButton() for why this cannot loop.
            this._updateJumpButton();
        });
    }

    disconnectedCallback() {
        this.messages.removeEventListener('scroll', this._onMessagesScroll);
        this.messages.removeEventListener('wheel', this._onUserScrollIntent);
        this.messages.removeEventListener('keydown', this._onUserScrollIntent);
        this.messages.removeEventListener('mzta-picker-resize', this._onPickerResize);
        this._resizeObs?.disconnect();
        this._contentObs?.disconnect();
        if (this._scrollRaf) {
            cancelAnimationFrame(this._scrollRaf);
            this._scrollRaf = 0;
        }
        if (this._confirmRaf) {
            cancelAnimationFrame(this._confirmRaf);
            this._confirmRaf = 0;
        }
    }

    _distanceFromBottom() {
        return this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight;
    }

    _isNearBottom() {
        return this._distanceFromBottom() <= MessagesArea.BOTTOM_SLACK_PX;
    }

    _onMessagesScroll() {
        if (this._programmaticScroll) {
            // Our own write echoing back: consume the latch, leave the state.
            this._programmaticScroll = false;
            return;
        }
        const nearBottom = this._isNearBottom();
        // The user going all the way down themselves is an explicit "follow the
        // answer" - drop the anchor so the view resumes tracking the bottom.
        if (nearBottom) { this._setAnchor(null); }
        this._setStickToBottom(nearBottom);
        // Unconditional: the two setters above are no-ops when the state is
        // already what they are being set to, but the geometry the button
        // reflects has just changed regardless.
        this._updateJumpButton();
    }

    // A picker changed its own height (mode switch, or a manual textarea drag).
    //
    // Read-only, exactly like _contentObs: refresh the jump button and nothing
    // else. Deliberately NOT scrollToBottom() - that does _setAnchor(null) and
    // sticks to the bottom, yanking the user away from what they were editing,
    // which is the opposite of leaving their position alone. _scrollIfSticky() is
    // wrong here too: this is not new content arriving, it is the same content
    // changing size under the user's own hands.
    _onPickerResize() {
        this._updateJumpButton();
    }

    // Pure state. The jump button no longer keys off this flag - it is decided
    // on the live geometry by _updateJumpButton(), which the scroll handler,
    // _scrollNow() and the resize observer each drive at the points where the
    // geometry can actually have changed.
    _setStickToBottom(stick) {
        this._stickToBottom = stick;
    }

    _onUserScrollIntent(event) {
        if (event.type === 'wheel') {
            if (event.deltaY < 0) { this._unfollow(); }
            return;
        }
        // keydown. #messages is not focusable today so these never arrive, but
        // the branch costs nothing and works the day a tabindex is added.
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            this._unfollow();
        }
    }

    // The user reads back: stop following, and forget the anchor so we do not
    // pull them forward to it on the next token.
    _unfollow() {
        this._setAnchor(null);
        this._setStickToBottom(false);
    }

    _setAnchor(turnEl) {
        if (this._anchorTurnEl === turnEl) { return; }
        this._anchorTurnEl = turnEl;
        this._updateAnchorSpacer();
        this._updateJumpButton();
    }

    // Size (or remove) the spacer that makes the anchor position reachable.
    // While an exchange is pinned, everything from the prompt down must be able
    // to fill a whole viewport, otherwise scrollTop simply cannot go far enough
    // to put the prompt at the top. The spacer takes up the shortfall and
    // shrinks to nothing as the answer grows into it.
    _updateAnchorSpacer() {
        if (!this._anchorTurnEl || !this._anchorTurnEl.isConnected) {
            this._anchorSpacer?.remove();
            this._anchorSpacer = null;
            return;
        }
        if (!this._anchorSpacer) {
            this._anchorSpacer = document.createElement('div');
            this._anchorSpacer.id = 'anchorSpacer';
            this._anchorSpacer.setAttribute('aria-hidden', 'true');
        }
        // Always last, so appends that landed after a previous sizing (the
        // answer turn, the action bar) do not end up below the reserved space.
        if (this.messages.lastElementChild !== this._anchorSpacer) {
            this.messages.appendChild(this._anchorSpacer);
        }
        // The spacer's current height is subtracted arithmetically rather than by
        // collapsing it to 0 and re-measuring: shrinking the content mid-frame
        // lets the browser clamp scrollTop, which would throw away the very
        // position we are trying to hold.
        const reserved = this._anchorSpacer.offsetHeight;
        const rootTop = this.messages.getBoundingClientRect().top;
        const promptTop = this._anchorTurnEl.getBoundingClientRect().top - rootTop
            + this.messages.scrollTop;
        const realContentBelowPrompt = this.messages.scrollHeight - reserved - promptTop;
        const shortfall = this.messages.clientHeight - realContentBelowPrompt;
        const height = shortfall > 0 ? Math.ceil(shortfall) : 0;
        // Skip no-op writes: this runs on every frame of a stream and each write
        // to style.height dirties layout even when the value is unchanged.
        if (height !== reserved) { this._anchorSpacer.style.height = `${height}px`; }
    }

    // Visible whenever there is content below the fold. This is decided on the
    // real geometry, not on the follow flags: while an exchange is anchored the
    // view is deliberately held at the prompt and the button is how the user
    // says "take me to the end" - but a short answer leaves the anchored view
    // already at the true bottom, and then there is nothing to jump to. Asking
    // the scroller settles both cases with one rule.
    //
    // Must stay free of layout writes. #jumpToLatest is position:absolute
    // against the host, outside #messages, so toggling it cannot resize any
    // observed turn - which is the invariant that keeps _contentObs from
    // feeding itself. Reserving space for the button by writing padding here
    // (or setting an attribute a CSS rule keys off) would put a layout write
    // inside the geometry that decides the button's own visibility: a textbook
    // ResizeObserver oscillation.
    _updateJumpButton() {
        this._jumpButton.hidden = this._isNearBottom();
    }

    // One deferred re-read of the geometry, coalesced. _updateJumpButton() is
    // always right for the DOM as it stands when it runs; this covers the window
    // where the DOM is about to change again within the same task. Strictly
    // read-only and self-cancelling, so it cannot feed itself - and it must
    // never call _scrollNow()/_requestScroll(), which would build a
    // measure-then-scroll loop together with _contentObs.
    _confirmJumpButton() {
        if (this._confirmRaf) { return; }
        this._confirmRaf = requestAnimationFrame(() => {
            this._confirmRaf = 0;
            this._updateJumpButton();
        });
    }

    // Open a model turn: wrapper + avatar + model name, and return the column
    // the answer body goes into. `variant` is 'bot' or 'error'.
    _beginBotTurn(labelText, variant = 'bot') {
        const turn = document.createElement('div');
        turn.classList.add('turn', 'turn-bot');
        if (variant === 'error') {
            turn.classList.add('turn-error');
        }

        const head = document.createElement('div');
        head.classList.add('turn-head');
        head.appendChild(buildSparkleIcon());
        turn.appendChild(head);

        const body = document.createElement('div');
        body.classList.add('turn-body');
        const name = document.createElement('div');
        name.classList.add('turn-name');
        name.textContent = labelText;
        body.appendChild(name);
        turn.appendChild(body);

        this._appendTurn(turn);
        this._currentTurnEl = turn;
        return body;
    }

    // Open a user turn ('user' = accent bubble, 'info' = full-width notice).
    _beginUserTurn(type) {
        const turn = document.createElement('div');
        turn.classList.add('turn', type === 'info' ? 'turn-info' : 'turn-user');
        this._appendTurn(turn);
        return turn;
    }

    // Turns always go before the anchor spacer, never after it: appending past
    // the reserved space would render the answer below a viewport-sized gap for
    // the one frame before _updateAnchorSpacer() puts the order right again.
    _appendTurn(turn) {
        this.messages.insertBefore(turn, this._anchorSpacer);
        // Any later growth inside this turn (the action bar appended after an
        // await, the diff viewer, a thinking block expanding) has to reach
        // _updateJumpButton(): see _contentObs in connectedCallback().
        this._contentObs?.observe(turn);
    }

    // The column of the current model turn, opening one if needed.
    _ensureBotTurnBody() {
        if (!this._currentTurnEl) {
            return this._beginBotTurn(this.llmName);
        }
        return this._currentTurnEl.querySelector('.turn-body');
    }

    createNewAccumulatingMessage() {
        const body = this._ensureBotTurnBody();
        this.accumulatingMessageEl = document.createElement('div');
        this.accumulatingMessageEl.classList.add('message', 'bot');
        body.appendChild(this.accumulatingMessageEl);
    }

    // Live "Thinking..." indicator. It lives in the turn body, as a sibling of
    // the accumulating message rather than inside it, so the flush cycle that
    // rebuilds that element can neither orphan nor duplicate it. Idempotent:
    // the append also moves an already attached node, which keeps the indicator
    // last when thinking resumes after a segment has been rendered.
    _showThinkingIndicator() {
        const body = this._ensureBotTurnBody();
        if (!this.thinkingLiveEl) {
            this.thinkingLiveEl = document.createElement('div');
            this.thinkingLiveEl.classList.add('thinking-live');
            // The spinner takes the slot the <summary> disclosure triangle will
            // occupy once the collapsible block replaces this row. The SVG is
            // self-animated, so nothing here needs a CSS animation.
            // This is the thinking-specific asset, deliberately not the shared
            // mzta-loading.svg the status pill in messageInput.js uses, so the
            // reasoning phase reads as distinct from a generic "loading". Its
            // colour is baked into the file: an <img> cannot inherit
            // currentColor, so the icon does not follow --ink-2 like the label.
            const spinner = document.createElement('img');
            spinner.classList.add('thinking-spinner');
            spinner.src = '../images/mzta-thinking.svg';
            spinner.alt = '';
            const label = document.createElement('span');
            label.textContent = (browser.i18n.getMessage('prefs_OptionText_thinking_summary') || 'Thinking') + '...';
            this.thinkingLiveEl.appendChild(spinner);
            this.thinkingLiveEl.appendChild(label);
        }
        body.appendChild(this.thinkingLiveEl);
    }

    _removeThinkingIndicator() {
        if (this.thinkingLiveEl) {
            this.thinkingLiveEl.remove();
            this.thinkingLiveEl = null;
        }
    }

    init(worker) {
        this.worker = worker;
    }

    setLLMName(llmName) {
        this.llmName = llmName;
    }

    setHideThinking(val) {
        this.hideThinking = !!val;
    }

    _ensureStreaming() {
        if (!this._streaming) {
            this._streaming = new StreamingMessage();
        }
        return this._streaming;
    }

    handleNewThinkingToken(token) {
        // Thinking tokens can arrive before the first content token (e.g. Anthropic
        // extended thinking), so ensure the streaming state exists.
        this._ensureStreaming().handleNewThinkingToken(token);
        // Live feedback while the reasoning streams in: the collapsible block
        // only materializes at flush time, so without this the user would sit
        // in front of an empty turn for the whole thinking phase.
        this._showThinkingIndicator();
        this._scrollIfSticky();
    }

    async handleTokensDone(promptData = null) {
        this.flushAccumulatingMessage();
        // A response made only of thinking tokens never creates an accumulating
        // message, so the flush above is a no-op and would leave the indicator
        // spinning forever.
        this._removeThinkingIndicator();
        await this.addActionButtons(promptData);
        // The exchange is over, so the anchor has nothing left to hold: its job
        // was to keep the view still while the answer streamed into it. Dropping
        // it here is what lets the follow below reach the REAL bottom.
        // _followTarget() otherwise clamps to the anchored position ("prompt at
        // the top", or the answer's top a third down), and stops there - which
        // in reply mode falls short of the action bar, because that bar is the
        // tallest of the lot (two-line split button + visible .sel_info) and all
        // of it lives below the anchored target. That is the "it never scrolls
        // far enough to show the whole button bar" symptom, and it is why this
        // has to happen before the follow, not after it.
        this._setAnchor(null);
        // The final flush and the action bar both grow the transcript. Only
        // follow if the user is still at the bottom: if they scrolled up to
        // read a long answer, do not yank them down to the buttons.
        this._scrollIfSticky();
        // Response finished: retire this turn's streaming state so the next
        // response starts a fresh instance with its own isolated HTML snapshot,
        // and close the turn wrapper.
        this._streaming = null;
        this._currentTurnEl = null;
    }

    appendUserMessage(messageText, type="user") {
        this.fullTextHTML = "";
        this._streaming = null;   // new turn: reset any streaming state
        this._removeThinkingIndicator();
        // A user message ends the previous model turn, so the next token
        // opens a fresh one.
        this._currentTurnEl = null;
        // console.log("[ThunderAI] appendUserMessage: " + messageText);
        const turn = this._beginUserTurn(type);

        const messageElement = document.createElement('div');
        messageElement.classList.add(type === 'info' ? 'message' : 'bubble', type);
        // Replace \n with <br> for correct HTML display
        if (type === "info") {
            messageElement.appendChild(htmlStringToFragment(messageText));
        } else {
            messageElement.appendChild(textWithBrToFragment(messageText));
        }
        turn.appendChild(messageElement);
        // Pin the exchange to this prompt: the view scrolls until the prompt is
        // at the top and then holds, so the answer fills a still window instead
        // of dragging the reader down line by line. 'info' turns are notices,
        // not prompts, and keep the plain bottom-following behaviour.
        this._setAnchor(type === 'info' ? null : turn);
        this._resumeFollowing();
    }

    appendBotMessage(messageText, type="bot") {
        // console.log("[ThunderAI] appendBotMessage: " + messageText);

        this.fullTextHTML = messageText;

        // Terminal message (typically an error): it may abort a stream that was
        // still thinking, so the indicator must not survive into the new turn.
        this._removeThinkingIndicator();

        const label = this.llmName + (type=='error' ? " - " + browser.i18n.getMessage("apiwebchat_error") : "");
        const body = this._beginBotTurn(label, type);

        const messageElement = document.createElement('div');
        messageElement.classList.add('message', type);
        messageElement.textContent = messageText;
        body.appendChild(messageElement);
        // This is a terminal message (typically an error), not a streaming
        // turn: close it so the next answer starts its own.
        this._currentTurnEl = null;
        this.scrollToBottom();
    }

    handleNewToken(token) {
        if (!this.accumulatingMessageEl) {
            this.createNewAccumulatingMessage();
        }

        // Feed the raw token to the streaming state (source of truth for parsing)
        // and also render the fading token span for live display.
        this._ensureStreaming().handleNewToken(token);

        const newTokenElement = document.createElement('span');
        newTokenElement.classList.add('token');
        newTokenElement.textContent = token;
        this.accumulatingMessageEl.appendChild(newTokenElement);

        this._scrollIfSticky();

        if (token === '\n') {
            this.flushAccumulatingMessage();
        }
    }

    // Force the real bottom and re-arm following, dropping any prompt anchor.
    // This is what the call sites that represent an explicit user action use.
    scrollToBottom() {
        this._setAnchor(null);
        this._setStickToBottom(true);
        this._requestScroll();
    }

    // Re-arm following without touching the anchor: used by the call sites that
    // are part of building a turn rather than an explicit "go to the end".
    _resumeFollowing() {
        this._setStickToBottom(true);
        this._requestScroll();
    }

    // Scroll only if the user has not moved away. This is the streaming path.
    _scrollIfSticky() {
        if (this._stickToBottom) { this._requestScroll(); }
    }

    // Coalesce to one write per animation frame. Two wins: a fast stream stops
    // doing a layout-flushing scrollTop write per token, and the write lands
    // after the flush a '\n' token triggers - flushAccumulatingMessage() swaps
    // token spans for rendered markdown and so changes the content height,
    // which the old scroll-then-flush order left unaccounted for.
    _requestScroll() {
        if (this._scrollRaf) { return; }
        this._scrollRaf = requestAnimationFrame(() => {
            this._scrollRaf = 0;
            this._scrollNow();
        });
    }

    // Where following should land right now. Without an anchor this is the plain
    // bottom of the transcript. With one it is the position that puts the
    // anchored prompt at the top of the viewport - but never past the bottom of
    // the content, and never backwards: the view only ever moves down, so a
    // growing answer cannot push the prompt back into view.
    _followTarget() {
        const bottom = this.messages.scrollHeight - this.messages.clientHeight;
        if (!this._anchorTurnEl || !this._anchorTurnEl.isConnected) { return bottom; }

        const clientHeight = this.messages.clientHeight;
        // Measure with rects rather than offsetTop: the turns' offsetParent is
        // the host (#messages is position:static), so offsetTop silently means
        // something different from "distance into the scrolled content". A rect
        // delta against #messages' own rect is unambiguous, and adding scrollTop
        // converts it to the absolute scroll offset of the prompt.
        const rootTop = this.messages.getBoundingClientRect().top;
        const scrollTop = this.messages.scrollTop;
        const offsetOf = (el) => el.getBoundingClientRect().top - rootTop + scrollTop;

        // Back off by the padding so the prompt is not glued to the very edge.
        // Cached: this runs on every animation frame of a stream, and
        // getComputedStyle there would flush style for nothing.
        if (this._padTopPx === null) {
            this._padTopPx = parseFloat(getComputedStyle(this.messages).paddingTop) || 0;
        }
        let target = offsetOf(this._anchorTurnEl) - this._padTopPx;

        // A prompt taller than its allowance would leave the answer less than
        // two thirds of the window: keep scrolling until the answer's own top
        // sits one third down, giving the prompt a third and the answer the rest.
        const answerEl = this._anchorTurnEl.nextElementSibling;
        if (answerEl && answerEl !== this._anchorSpacer) {
            const answerTop = offsetOf(answerEl)
                - (clientHeight * MessagesArea.PROMPT_MAX_VIEWPORT_SHARE);
            if (answerTop > target) { target = answerTop; }
        }

        // Clamping to `bottom` is what makes a short answer a no-op: the whole
        // exchange already fits, so there is nothing left to scroll to and the
        // anchor is satisfied for good.
        target = Math.min(target, bottom);
        // Never backwards. Once the anchor position is reached the view holds
        // still and the answer streams into it; the user stays in control of
        // going further down (which re-arms plain bottom-following, see
        // _onMessagesScroll).
        return Math.max(target, this.messages.scrollTop);
    }

    _scrollNow() {
        // Re-reserve first: the answer has grown since the last frame, so the
        // shortfall the spacer covers has shrunk, and _followTarget clamps to a
        // scrollHeight that must already account for it.
        this._updateAnchorSpacer();
        const target = this._followTarget();
        // Only latch when the write actually changes the value: when we are
        // already at the bottom (the common case) no scroll event is fired, and
        // a latch left raised would swallow the user's NEXT real scroll.
        if (Math.abs(this.messages.scrollTop - target) < 1) {
            // No write, so no scroll event either - but the content around us
            // has grown since the last frame, so this is the only chance to
            // notice that the bottom is now (or no longer) in view.
            this._updateJumpButton();
            // ...and again once the browser has laid out. Everything above reads
            // geometry synchronously, which is right for whatever the DOM held at
            // that instant - but an append made earlier in this same task (the
            // action bar, the diff viewer) can still be pending style resolution,
            // and _setAnchor(null) has just removed the spacer, which lets the
            // browser clamp scrollTop on its own afterwards. That clamp is what
            // brings us here with scrollTop already equal to the target: deciding
            // "we are at the bottom" on that snapshot is how the button was left
            // advertising a jump it had already made.
            this._confirmJumpButton();
            return;
        }
        this._programmaticScroll = true;
        // Always instant, never behavior:'smooth': smooth scrolling emits a
        // long tail of scroll events the latch cannot pair one-to-one with its
        // writes, and would unstick mid-animation.
        this.messages.scrollTop = target;
        // The latch above makes _onMessagesScroll skip its own update, so the
        // post-write geometry has to be read here.
        this._updateJumpButton();
        // Same reasoning as on the early-return path above: the write lands on
        // the geometry as it is now, which a pending append can still change.
        this._confirmJumpButton();
    }

    // click callcback for the "use this answer" button
    //
    // `ownerTurn` is the turn whose action bar this button belongs to. When a
    // <diff-picker> has been opened on that turn it owns the result, and its
    // composed text wins over the raw answer.
    handleUseThisAnswerButtonClick(promptData, replyType, fullTextHTMLAtAssignment, ownerTurn = null){
        return async () => {
            if(promptData.mailMessageId == -1) {    // we are using the reply from the compose window!
                promptData.action = "2"; // replace text
            }
            let finalText = null;
            const picker = ownerTurn?._mztaPicker;
            if(picker) {
                // Read the picker NOW, not when the bar was built, so the click
                // picks up every accept/reject the user has made since.
                //
                // Deliberately NOT through removeAloneBRs(): the picker emits
                // plain text turned into <br>-separated markup with no <p>
                // wrapper, and removeAloneBRs strips every <br> that has no <p>
                // ancestor - which would be all of them, collapsing the whole
                // message into a single run-together line.
                //
                // The mouse-selection override is skipped too: two mechanisms
                // competing over the same output is confusing, and the picker is
                // the explicit one. Turns without a picker keep it untouched.
                try {
                    finalText = picker.composeResultHTML();
                } catch(e) {
                    // Never send an empty body because the picker threw.
                    console.error("[ThunderAI] diff picker failed to compose the result, falling back to the full answer.", e);
                    finalText = null;
                }
            }
            if(finalText === null) {
                finalText = removeAloneBRs(fullTextHTMLAtAssignment);
                const selectedHTML = this.getCurrentSelectionHTML();
                if(selectedHTML != "") {
                    finalText = removeAloneBRs(selectedHTML);
                }
            }

            switch(promptData.action) {
                case "1":     // do reply
                    // console.log("[ThunderAI] (do reply) fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
                    await browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: finalText, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId, replyType: replyType});
                    browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
                    break;
                case "2":     // replace text
                    //  console.log("[ThunderAI] (replace text) fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
                    await browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: finalText, tabId: promptData.tabId, mailMessageId: promptData.mailMessageId});
                    browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
                    break;
            }
        }
    }

    async addActionButtons(promptData = null) {
        // `promptData` is a module-level variable in controller.js, set once by the
        // `api_send` command. Its action/tabId/mailMessageId are intentionally stable
        // for the whole session (the webchat window is bound to that message/tab and
        // that action). What varies per turn is the answer text, which each turn's
        // buttons snapshot into `fullTextHTMLAtAssignment` below — so every turn's
        // buttons stay clickable and tied to their own response.
        if(promptData == null) { return; }
        const turn = this._currentTurnEl;
        if(turn == null) { return; }
        const turnBody = turn.querySelector('.turn-body');

        // Only the newest answer keeps the full bar: strip the previous one
        // first, so two full bars never coexist.
        this._degradeFullActionBar();

        const fullTextHTMLAtAssignment = this.fullTextHTML.trim().replace(/^"|"$/g, '').replace(/^<p>&quot;/, '<p>').replace(/&quot;<\/p>$/, '</p>'); // strip quotation marks
        //console.log(">>>>>>>>>>>> fullTextHTMLAtAssignment: " + fullTextHTMLAtAssignment);
        let reply_type_pref = await browser.storage.sync.get({ reply_type: prefs_default.reply_type });

        // Remember what the compact toolbar will need. It is only built when
        // this answer stops being the newest one (see _degradeFullActionBar):
        // showing both at once would repeat every action twice.
        turn._mztaToolsArgs = {
            promptData: promptData,
            replyType: reply_type_pref.reply_type,
            text: fullTextHTMLAtAssignment,
        };

        const actionButtons = document.createElement('div');
        actionButtons.classList.add('action-bar');
        // selection info
        const selectionInfo = document.createElement('p');
        selectionInfo.textContent = browser.i18n.getMessage("apiwebchat_selection_info");
        selectionInfo.classList.add('sel_info');

        // "use this answer" split button
        const splitButton = this._buildUseThisAnswerButton(promptData, reply_type_pref, fullTextHTMLAtAssignment, turn);

        const closeButton = document.createElement('button');
        closeButton.textContent = browser.i18n.getMessage("chatgpt_win_close");
        closeButton.classList.add('close_btn', 'mzta-btn-tertiary');
        closeButton.addEventListener('click', async () => {
            browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});    // close window
        });
        if(promptData.action != "0") {
            actionButtons.appendChild(splitButton);
            selectionInfo.style.display = "block"; // show selection info
        }

        // copy button
        actionButtons.appendChild(this._buildCopyButton(fullTextHTMLAtAssignment, false, turn));

        // Save as Summary button (only shown for summary webchat sessions)
        const saveSummaryButton = this._buildSaveSummaryButton(promptData, fullTextHTMLAtAssignment);
        if(saveSummaryButton) {
            actionButtons.appendChild(saveSummaryButton);
            selectionInfo.style.display = "block";
        }

        // diff viewer button
        const diffvButton = this._buildDiffButton(promptData, fullTextHTMLAtAssignment, turn, reply_type_pref.reply_type);
        if(diffvButton) {
            actionButtons.appendChild(diffvButton);
        }

        actionButtons.appendChild(closeButton);
        turnBody.appendChild(actionButtons);
        turnBody.appendChild(selectionInfo);
        this._lastFullBarTurn = turn;
        // No scroll here: handleTokensDone does it, and covers the paths where
        // this method returns early (no promptData / no turn). The jump button is
        // a different matter. This append is the largest single content growth of
        // the whole exchange - in reply mode the split button carries a second
        // text line and .sel_info becomes visible - it lands after the await
        // above, and the _scrollIfSticky() that follows in handleTokensDone is a
        // no-op while the user sits at the anchored prompt. Refresh here so the
        // button's state is never left over from before the bar existed.
        this._updateJumpButton();
    }

    // Swap the full action bar of the previously-newest answer for the compact
    // icon toolbar. The two are mutually exclusive: while an answer owns the
    // full bar it needs no toolbar, since every icon there would just duplicate
    // a button already spelled out next to it.
    _degradeFullActionBar() {
        const turn = this._lastFullBarTurn;
        if(!turn) { return; }
        const bar = turn.querySelector('.action-bar');
        const hint = turn.querySelector('.sel_info');
        // Built now rather than up front, but from the arguments captured when
        // the bar was created, so the toolbar stays bound to this turn's own
        // answer text and not to whatever is on screen later.
        const args = turn._mztaToolsArgs;
        if(bar && args) {
            bar.replaceWith(this._buildTurnTools(args.promptData, args.replyType, args.text, turn));
        } else if(bar) {
            bar.remove();
        }
        if(hint) { hint.remove(); }
        delete turn._mztaToolsArgs;
        // turn._mztaPicker is deliberately NOT deleted, unlike _mztaToolsArgs
        // above: this answer's picker stays on screen in its own turn, and the
        // compact toolbar being built right now has to keep handing back that
        // picker's current state.
        this._lastFullBarTurn = null;
    }

    // Icon-only toolbar shown on every earlier answer, faint until the turn is
    // hovered or focused. Shares the click handlers of the full bar.
    _buildTurnTools(promptData, replyType, fullTextHTMLAtAssignment, ownerTurn = null) {
        const tools = document.createElement('div');
        tools.classList.add('turn-tools');
        tools.setAttribute('role', 'group');
        tools.setAttribute('aria-label', browser.i18n.getMessage("apiwebchat_turn_tools"));

        tools.appendChild(this._buildCopyButton(fullTextHTMLAtAssignment, true, ownerTurn));

        if(promptData.action != "0") {
            const useBtn = this._makeIconButton(
                buildUseAnswerIcon(13),
                browser.i18n.getMessage("apiwebchat_use_this_answer"),
            );
            useBtn.addEventListener('click',
                this.handleUseThisAnswerButtonClick(promptData, replyType, fullTextHTMLAtAssignment, ownerTurn));
            tools.appendChild(useBtn);
        }

        return tools;
    }

    // Shared shape for the 26x26 icon buttons of the light toolbar.
    _makeIconButton(icon, label) {
        const btn = document.createElement('button');
        btn.classList.add('mzta-btn-icon');
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.appendChild(icon);
        return btn;
    }

    // "Copy": puts the answer on the clipboard WITHOUT closing the window, and
    // confirms with a check for 1.5s. Like the other action buttons it honours
    // a text selection and copies only that part. `iconOnly` builds the
    // light-toolbar form. When a <diff-picker> owns this turn, Copy follows it
    // rather than the raw answer, so it agrees with what "use this answer"
    // would insert.
    _buildCopyButton(fullTextHTMLAtAssignment, iconOnly = false, ownerTurn = null) {
        const label = browser.i18n.getMessage("apiwebchat_copy");
        let button;
        let labelEl = null;

        if(iconOnly) {
            button = this._makeIconButton(buildCopyIcon(13), label);
        } else {
            button = document.createElement('button');
            button.classList.add('copy_btn', 'mzta-btn-secondary');
            button.setAttribute('aria-label', label);
            button.appendChild(buildCopyIcon());
            labelEl = document.createElement('span');
            labelEl.classList.add('btn-label');
            labelEl.textContent = label;
            button.appendChild(labelEl);
        }

        let resetTimeout = null;
        button.addEventListener('click', async () => {
            const selectedText = this.getCurrentSelectionText();
            let plainText;
            if(selectedText !== '') {
                // An explicit selection still wins, as it always has.
                plainText = selectedText;
            } else if(ownerTurn?._mztaPicker) {
                plainText = ownerTurn._mztaPicker.composeResultText();
            } else {
                plainText = htmlToPlainText(fullTextHTMLAtAssignment);
            }
            const ok = await copyTextToClipboard(plainText);
            const feedback = ok
                ? browser.i18n.getMessage("apiwebchat_copied")
                : browser.i18n.getMessage("apiwebchat_copy_failed");

            button.textContent = '';
            button.appendChild(ok ? buildCheckIcon(iconOnly ? 13 : 15) : buildCopyIcon(iconOnly ? 13 : 15));
            if(!iconOnly) {
                labelEl.textContent = feedback;
                button.appendChild(labelEl);
            }
            button.setAttribute('aria-label', feedback);
            button.title = feedback;

            if(resetTimeout) { clearTimeout(resetTimeout); }
            resetTimeout = setTimeout(() => {
                button.textContent = '';
                button.appendChild(buildCopyIcon(iconOnly ? 13 : 15));
                if(!iconOnly) {
                    labelEl.textContent = label;
                    button.appendChild(labelEl);
                }
                button.setAttribute('aria-label', label);
                button.title = label;
            }, 1500);
        });

        return button;
    }

    // Build the "use this answer" <split-button>. When replying to a real message
    // (action=="1" && mailMessageId!=-1) it gets a reply-type info line plus a single
    // dropdown option offering the opposite reply type; otherwise it is a standalone
    // button. The <split-button> element owns the outside-click listener lifecycle.
    _buildUseThisAnswerButton(promptData, reply_type_pref, fullTextHTMLAtAssignment, ownerTurn = null) {
        const splitButton = document.createElement('split-button');
        const isReplyToMessage = (promptData.action == "1") && (promptData.mailMessageId != -1);

        splitButton.setMainButton({
            line1: browser.i18n.getMessage("apiwebchat_use_this_answer"),
            line2: isReplyToMessage
                ? (reply_type_pref.reply_type == 'reply_all' ? browser.i18n.getMessage("prefs_OptionText_reply_all") : browser.i18n.getMessage("prefs_OptionText_reply_sender"))
                : null,
            onClick: this.handleUseThisAnswerButtonClick(promptData, reply_type_pref.reply_type, fullTextHTMLAtAssignment, ownerTurn),
            standalone: !isReplyToMessage,
        });

        if (isReplyToMessage) {
            splitButton.setDropdownOption({
                label: reply_type_pref.reply_type == 'reply_all' ? browser.i18n.getMessage("prefs_OptionText_reply_sender") : browser.i18n.getMessage("prefs_OptionText_reply_all"),
                onClick: this.handleUseThisAnswerButtonClick(promptData, reply_type_pref.reply_type == 'reply_all' ? 'reply_sender' : 'reply_all', fullTextHTMLAtAssignment, ownerTurn),
            });
        }

        return splitButton;
    }

    // Build the "save as summary" button (only for summary webchat sessions). Returns
    // null when this session is not a summary session.
    //
    // Deliberately NOT wired to turn._mztaPicker like the "use this answer" and
    // "copy" buttons: a summary session and a diff-picker session are mutually
    // exclusive, since every prompt carrying headerMessageId/summaryTabId has
    // use_diff_viewer "0", so a picker can never exist on such a turn.
    _buildSaveSummaryButton(promptData, fullTextHTMLAtAssignment) {
        if(!(promptData.prompt_info?.headerMessageId && promptData.prompt_info?.summaryTabId)) {
            return null;
        }
        const saveSummaryButton = document.createElement('button');
        const saveLabel = browser.i18n.getMessage("webchat_save_as_summary");
        saveSummaryButton.classList.add('save_summary_btn', 'mzta-btn-secondary');
        saveSummaryButton.setAttribute('aria-label', saveLabel);
        saveSummaryButton.appendChild(buildSaveIcon());
        const saveLabelEl = document.createElement('span');
        saveLabelEl.classList.add('btn-label');
        saveLabelEl.textContent = saveLabel;
        saveSummaryButton.appendChild(saveLabelEl);
        saveSummaryButton.addEventListener('click', async () => {
            let finalText = removeAloneBRs(fullTextHTMLAtAssignment);
            const selectedHTML = this.getCurrentSelectionHTML();
            if(selectedHTML != "") {
                finalText = removeAloneBRs(selectedHTML);
            }
            await browser.runtime.sendMessage({
                command: "chatgpt_saveSummary",
                text: finalText,
                headerMessageId: promptData.prompt_info.headerMessageId,
                tabId: promptData.prompt_info.summaryTabId || promptData.tabId,
            });
            browser.runtime.sendMessage({command: "chatgpt_close", window_id: (await browser.windows.getCurrent()).id});
        });
        return saveSummaryButton;
    }

    // Build the "show differences" button. Returns null when the prompt did not
    // request the diff viewer. `ownerTurn` is this bar's own turn: the picker
    // renders in a turn of its own, but the result indirection has to land on
    // the turn that owns the action bar, and that is not necessarily
    // _currentTurnEl by the time the button is clicked.
    _buildDiffButton(promptData, fullTextHTMLAtAssignment, ownerTurn = null, replyType = null) {
        if(promptData.prompt_info?.use_diff_viewer != "1") {
            return null;
        }
        const diffvButton = document.createElement('button');
        const diffLabel = browser.i18n.getMessage("btn_show_differences");
        diffvButton.classList.add('diffv_btn', 'mzta-btn-secondary');
        diffvButton.setAttribute('aria-label', diffLabel);
        diffvButton.appendChild(buildDiffIcon());
        const diffLabelEl = document.createElement('span');
        diffLabelEl.classList.add('btn-label');
        diffLabelEl.textContent = diffLabel;
        diffvButton.appendChild(diffLabelEl);
        diffvButton.addEventListener('click', async () => {
            // htmlToPlainText, not stripHtmlTags: the latter DELETES <br> rather
            // than turning it into a line break, so the read-only viewer used to
            // diff a single run-together line against a multi-line original and
            // reported the whole answer as changed. It also decodes entities.
            const newText = htmlToPlainText(fullTextHTMLAtAssignment);
            let originalText = promptData.prompt_info?.selection_text;
            if((originalText == null) || (originalText == "")) {
                originalText = promptData.prompt_info?.body_text;
            }
            // The special-prompt shape built by js/mzta-utils-prompt.js carries
            // neither field. Those prompts all have use_diff_viewer "0" so we
            // never get here today, but one prompt-definition edit away this
            // would hand undefined to the tokenizer.
            if(originalText == null) { originalText = ""; }
            // Every current producer emits \n (see getMailBody in
            // js/mzta-menus.js, where the plain-text fields go through
            // cleanupNewlines while only the _html ones get <br>). Defensive, so
            // a prompt_info carrying markup cannot put literal <br> into the
            // picker's plain text.
            originalText = String(originalText).replace(/<br\s*\/?>/gi, '\n');

            this.appendDiffPicker(originalText, newText, ownerTurn, 'words', () =>
                this.handleUseThisAnswerButtonClick(promptData, replyType, fullTextHTMLAtAssignment, ownerTurn));
            diffvButton.disabled = true;
        });
        return diffvButton;
    }

    // Open the interactive change picker in a turn of its own.
    // `buildUseAnswerHandler` is a thunk so the picker gets its own "use this
    // answer" action without appendDiffPicker having to know the argument list.
    appendDiffPicker(originalText, newText, ownerTurn = null, granularity = 'words', buildUseAnswerHandler = null) {
        // Triggered by a button that may belong to an older answer, part-way
        // through a session. _beginBotTurn moves _currentTurnEl, so save and
        // restore it: the picker must not hijack the turn being streamed, nor
        // touch which answer owns the full action bar.
        const previousTurnEl = this._currentTurnEl;

        const body = this._beginBotTurn(browser.i18n.getMessage("apiwebchat_picker_title"));
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'bot');

        const picker = document.createElement('diff-picker');
        picker.setGranularity(granularity);   // before setContent: it picks the diff fn
        picker.setContent(originalText, newText);
        messageElement.appendChild(picker);
        body.appendChild(messageElement);

        this._currentTurnEl = previousTurnEl;

        if(ownerTurn) {
            // The picker now owns this turn's result. Read at click time, so the
            // user's latest toggles are what gets inserted.
            ownerTurn._mztaPicker = picker;
            // The picker sits below the answer that owns the action bar, so
            // give it its own way to apply the result instead of making the user
            // scroll back up to a different turn. The handler comes from the
            // caller's own closure rather than from turn._mztaToolsArgs, which
            // _degradeFullActionBar deletes once a newer answer arrives.
            if(buildUseAnswerHandler) {
                picker.setUseAnswerHandler(buildUseAnswerHandler());
            }
            // "Select part of the answer to use only that part" no longer
            // applies: the picker is the explicit mechanism now, and
            // handleUseThisAnswerButtonClick skips the selection override for
            // turns that have one.
            const hint = ownerTurn.querySelector('.sel_info');
            if(hint) { hint.style.display = "none"; }
        }

        this.scrollToBottom();
    }

    flushAccumulatingMessage() {
        if (this.accumulatingMessageEl) {
            // Delegate the token→HTML parsing pipeline to the streaming state.
            // A null result means the flush was deferred (unterminated <think>
            // mid-stream): leave the DOM tokens and accumulator untouched.
            const result = this._ensureStreaming().flush();
            if (result === null) {
                return;
            }

            // Thinking is over for this segment: drop the live indicator now
            // that the real block is about to be rendered, so the two are never
            // on screen together. Deliberately after the deferred-flush return
            // above, which must leave the indicator in place.
            this._removeThinkingIndicator();

            const { html, thinkingText, fullTextHTML } = result;

            // Keep the immutable snapshot readers (addActionButtons /
            // save-as-summary / diff) working: mirror the response-wide snapshot.
            this.fullTextHTML = fullTextHTML;

            // console.log(">>>>>>>>>>>>>>>> flushAccumulatingMessage this.fullTextHTML: " + this.fullTextHTML);

            // Create a new DOM parser
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            convertTextNodeNewlinesToBr(doc.body);

            // Remove existing tokens
            while (this.accumulatingMessageEl.firstChild) {
                this.accumulatingMessageEl.removeChild(this.accumulatingMessageEl.firstChild);
            }

            // Prepend thinking block (if any). hide_thinking controls the initial
            // open/collapsed state: true -> collapsed, false -> open. Users can always
            // toggle with a click.
            renderThinkingBlock(this.accumulatingMessageEl, thinkingText, this.hideThinking);

            // Append new nodes
            Array.from(doc.body.childNodes).forEach(node => {
                this.accumulatingMessageEl.appendChild(node);
            });

            this.accumulatingMessageEl = null;
        }
    }

    getCurrentSelectionHTML() {
        const selection = window.getSelection();
        // console.log(">>>>>>>>>>>>>>>> getCurrentSelectionHTML: " + JSON.stringify(selection.toString()));
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = document.createElement('div');
            container.appendChild(range.cloneContents());
            return container.innerHTML;
        }
        return '';
    }

    // Selected text as plain text. Taken straight from the Selection rather
    // than by stripping getCurrentSelectionHTML(), so entities in the rendered
    // answer (&amp;, &lt;, &nbsp;, …) come out as the characters the user can
    // actually see instead of their HTML escapes.
    getCurrentSelectionText() {
        const selection = window.getSelection();
        return selection ? selection.toString() : '';
    }

}

customElements.define('messages-area', MessagesArea);


// HTML → the text the user actually sees. Unlike a regex tag-strip this parses
// the markup, so entities are decoded (&amp; → &) instead of being copied as
// their escape sequences, and <br>/</p> become real line breaks. The diff
// button used to strip tags with a regex instead, which DELETED <br> rather
// than converting it and so fed the diff a single run-together line.
function htmlToPlainText(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    doc.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
    // Block-level boundaries would otherwise run together into one long line.
    doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote').forEach(el => {
        el.appendChild(document.createTextNode('\n'));
    });
    return (doc.body.textContent || '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Clipboard write with a fallback for the (unlikely) case the async API is
// unavailable or rejects. moz-extension: pages are a secure context and these
// handlers always run inside a click, so the first path normally succeeds.
async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            const helper = document.createElement('textarea');
            helper.value = text;
            helper.setAttribute('readonly', '');
            helper.style.position = 'fixed';
            helper.style.opacity = '0';
            document.body.appendChild(helper);
            helper.select();
            const ok = document.execCommand('copy');
            helper.remove();
            return ok;
        } catch (e2) {
            console.error("[ThunderAI] Unable to copy the answer to the clipboard:", e2);
            return false;
        }
    }
}

function textWithBrToFragment(text) {
    const fragment = document.createDocumentFragment();
    const segments = text.split(/<br\s*\/?>/gi);
    segments.forEach((segment, idx) => {
        if (segment.length > 0) {
            fragment.appendChild(document.createTextNode(segment));
        }
        if (idx < segments.length - 1) {
            fragment.appendChild(document.createElement('br'));
        }
    });
    return fragment;
}

function htmlStringToFragment(htmlString) {
//   console.log(">>>>>>>>>>>>>>>> htmlStringToFragment htmlString: " + htmlString);
  const normalizedHtml = htmlString.replace(/\n/g, '<br>');
//   console.log(">>>>>>>>>>>>>>>> htmlStringToFragment normalizedHtml: " + normalizedHtml);
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedHtml, 'text/html');
  const fragment = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach(node => fragment.appendChild(node));
  return fragment;
}

function convertTextNodeNewlinesToBr(element) {
    element.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.includes('\n') && node.textContent.trim() !== '') {
                const fragment = document.createDocumentFragment();
                node.textContent.split('\n').forEach((part, idx, arr) => {
                    fragment.appendChild(document.createTextNode(part));
                    if (idx < arr.length - 1) {
                        fragment.appendChild(document.createElement('br'));
                    }
                });
                node.parentNode.replaceChild(fragment, node);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            convertTextNodeNewlinesToBr(node);
        }
    });
}

function removeAloneBRs(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  const brElements = Array.from(doc.querySelectorAll('br'));

  brElements.forEach(br => {
    let current = br;
    let isInsideP = false;

    while (current.parentElement) {
      if (current.parentElement.tagName.toLowerCase() === 'p') {
        isInsideP = true;
        break;
      }
      current = current.parentElement;
    }

    if (!isInsideP) {
      br.remove();
    }
  });

  return doc.body.innerHTML;
}
