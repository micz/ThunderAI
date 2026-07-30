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

import { SHARED_BASE_CSS, BUTTON_CSS } from './sharedStyles.js';
import { buildCheckIcon, buildRevertIcon, buildHunkMarkerIcon, buildUseAnswerIcon } from './svgIcons.js';

// <diff-picker> replaces the read-only diff viewer for prompts with
// use_diff_viewer == "1": the user accepts or rejects each change individually
// and the composed result is what gets written back into the email.
//
// The important reason this is a custom element and not inline markup is the
// same one documented at the top of splitButton.js: the keyboard-navigation
// handler is registered in connectedCallback() and removed in
// disconnectedCallback(), so handlers cannot accumulate across chat turns.
//
// PLAIN TEXT ONLY. Both sides are normalized into plain text with \n line
// breaks, diffed, recomposed as plain text, and turned back into <br> markup
// only at the moment the result is handed to the insertion path. The HTML
// formatting of the AI answer (bold, lists) does NOT survive the picker. That
// is a deliberate trade: the hunk model needs a single linear text to be
// correct, and the original side arrives as plain text anyway (see
// getMailBody() in js/mzta-menus.js, where selection/text go through
// cleanupNewlines()). Note the loss only happens on the picker path - a user
// who never opens the picker still gets the formatted HTML from
// handleUseThisAnswerButtonClick()'s fullTextHTMLAtAssignment.
//
// `Diff` is the global from js/lib/diff.js, loaded as a classic script in
// index.html before the module scripts. It is only touched at call time.

// Granularity -> jsdiff function.
//
// NEVER Diff.diffWords(). It cannot satisfy the composeResult invariant below:
// WordDiff overrides equals() (compares trimmed tokens), join() (strips leading
// whitespace) and postProcess() -> dedupeWhitespaceInChangeObjects(), whose own
// doc comment concedes it has "no way to avoid losing information about the
// texts' original whitespace". Measured consequences on real proofreads:
// rejecting every change invented a blank line and a trailing space, and a
// whitespace-only rewrite reported zero changes at all.
//
// diffWordsWithSpace and diffSentences declare only tokenize() and inherit the
// base-class identity join() and no-op postProcess(), so the parts they emit
// partition both inputs exactly - which is what makes the invariant hold.
const DIFF_FNS = {
    words:     (o, n) => Diff.diffWordsWithSpace(o, n),
    sentences: (o, n) => Diff.diffSentences(o, n),
};

// Both sides pass through this before diffing.
//
// diffWordsWithSpace is whitespace-exact, which is what the invariant needs,
// but it also means every cosmetic whitespace difference becomes a hunk the
// user has to look at. Normalizing both sides first keeps that noise out of
// the hunk list. The invariant is therefore stated against the NORMALIZED
// original, which is what ends up in the email regardless.
export function normalizeForDiff(text) {
    if (text == null) { return ''; }
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Turn two plain-text strings into a hunk list.
//
//   Hunk = {
//     id: number,                                  // stable, sequential
//     type: 'context' | 'replace' | 'insert' | 'delete',
//     oldText: string,                             // '' for insert
//     newText: string,                             // '' for delete
//     state: 'accepted' | 'rejected'               // ignored for context
//   }
//
// Every non-context hunk defaults to 'accepted', so a user who touches nothing
// gets exactly what they got before the picker existed.
export function buildHunks(originalText, newText, granularity = 'words') {
    const oldStr = normalizeForDiff(originalText);
    const newStr = normalizeForDiff(newText);

    const diffFn = DIFF_FNS[granularity] || DIFF_FNS.words;
    const parts = diffFn(oldStr, newStr);
    // The base diff() returns undefined when a maxEditLength/timeout option
    // aborts the search. No options are passed today, but a bare .length on
    // undefined would be a hard crash if that ever changes.
    if (!parts) { return null; }

    const hunks = [];
    let id = 0;
    let i = 0;
    while (i < parts.length) {
        if (!parts[i].added && !parts[i].removed) {
            // Context. Carried in both sides so composeResult can read it
            // uniformly without special-casing which one to emit.
            hunks.push({
                id: id++,
                type: 'context',
                oldText: parts[i].value,
                newText: parts[i].value,
                state: 'accepted',
            });
            i++;
            continue;
        }
        // Collapse a maximal run of consecutive insert/delete parts into one
        // hunk. jsdiff emits at most one delete followed by one insert per run
        // - addToPath() merges same-type components, so two consecutive added
        // or two consecutive removed parts are structurally impossible - but
        // accumulating the whole run keeps this correct for any order and any
        // run length, and costs nothing.
        let del = '';
        let ins = '';
        while (i < parts.length && (parts[i].added || parts[i].removed)) {
            if (parts[i].added) { ins += parts[i].value; }
            else                { del += parts[i].value; }
            i++;
        }
        hunks.push({
            id: id++,
            type: (del !== '' && ins !== '') ? 'replace' : (ins !== '' ? 'insert' : 'delete'),
            oldText: del,
            newText: ins,
            state: 'accepted',
        });
    }
    return hunks;
}

// Walk the hunks and emit the text the user has chosen.
//
// THE CORRECTNESS CONTRACT OF THE WHOLE FEATURE:
//   composeResult(all accepted) === normalizeForDiff(newText)
//   composeResult(all rejected) === normalizeForDiff(originalText)
// It follows from the parts partitioning both inputs exactly (see DIFF_FNS)
// plus buildHunks being a lossless regroup of those parts.
export function composeResult(hunks) {
    if (!hunks) { return ''; }
    let out = '';
    for (const h of hunks) {
        if (h.type === 'context')        { out += h.oldText; }
        else if (h.state === 'accepted') { out += h.newText; }
        else                             { out += h.oldText; }
    }
    return out;
}

export function hasChanges(hunks) {
    return !!hunks && hunks.some(h => h.type !== 'context');
}

export function countChanges(hunks) {
    let total = 0;
    let accepted = 0;
    for (const h of (hunks || [])) {
        if (h.type === 'context') { continue; }
        total++;
        if (h.state === 'accepted') { accepted++; }
    }
    return { accepted, total };
}

// & must be replaced first, or the entities produced below get double-escaped.
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Plain text -> a fragment with real <br> elements. The \n-keyed twin of
// textWithBrToFragment() in messagesArea.js: the picker is plain-text only, so
// its line breaks arrive as \n and never as markup.
function textWithNewlinesToFragment(text) {
    const fragment = document.createDocumentFragment();
    const segments = String(text).split('\n');
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

const pickerTemplate = document.createElement('template');

const pickerStyle = document.createElement('style');
pickerStyle.textContent = SHARED_BASE_CSS + BUTTON_CSS + `
    :host {
      display: block;
    }

    /* Sticky sticks to the nearest scrolling ancestor, which is #messages in
       <messages-area>'s shadow root. Shadow boundaries do not block it. */
    .picker-toolbar {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 7px 8px;
      margin-bottom: 9px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
    }

    .picker-counter {
      font-size: .78125rem;
      font-weight: 600;
      color: var(--ink-2);
      margin-right: auto;
      padding: 0 3px;
    }

    .picker-toolbar button {
      font-size: .78125rem;
      padding: 5px 9px;
    }

    .picker-use-btn {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      font-weight: 650;
    }
    .picker-use-btn:hover:not(:disabled) {
      background: var(--accent-dark);
      border-color: var(--accent-dark);
    }

    .picker-body {
      line-height: 1.5;
      white-space: normal;
    }

    .picker-note {
      font-size: .71875rem;
      color: var(--ink-3);
      margin: 0 0 9px;
    }

    /* Interactive hunks. Colours mirror the .added/.removed pair the read-only
       viewer used, so the picker reads as the same feature. The rules have to
       live here: only the custom properties cross the shadow boundary. */
    .hunk {
      position: relative;
      cursor: pointer;
      border-radius: 3px;
      padding: 0 1px;
      transition: box-shadow .12s ease;
    }
    .hunk.is-accepted {
      background-color: var(--ok-bg);
      color: var(--ok-ink);
    }
    .hunk.is-rejected {
      background-color: var(--err-bg);
      color: var(--err-ink);
      text-decoration: line-through;
    }
    .hunk:hover {
      box-shadow: 0 0 0 2px var(--border-strong);
    }
    .hunk.is-current {
      box-shadow: 0 0 0 2px var(--accent);
    }

    /* An accepted delete or a rejected insert has nothing to show. The marker
       keeps the hunk in the flow so it stays clickable and focusable instead
       of vanishing. */
    .hunk-marker {
      display: inline-flex;
      vertical-align: middle;
      opacity: .75;
    }

    /* The accept/revert affordance, revealed on hover and on focus. Absolutely
       positioned so it never disturbs the inline flow of the prose around it. */
    .hunk-action {
      position: absolute;
      top: -9px;
      right: -7px;
      display: none;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: 50%;
      color: var(--ink-2);
      cursor: pointer;
      line-height: 0;
    }
    .hunk:hover .hunk-action,
    .hunk:focus-visible .hunk-action,
    .hunk-action:focus-visible {
      display: inline-flex;
    }
    .hunk-action:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    /* EDIT mode (phase 2) lands here. */
    .picker-editor {
      display: none;
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      font-size: .875rem;
      line-height: 1.5;
      color: var(--ink);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      padding: 8px 10px;
      resize: vertical;
    }
`;
pickerTemplate.content.appendChild(pickerStyle);

const pickerRoot = document.createElement('div');
pickerRoot.className = 'picker-root';
pickerTemplate.content.appendChild(pickerRoot);

class DiffPicker extends HTMLElement {

    constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(pickerTemplate.content.cloneNode(true));

        this._root = shadowRoot.querySelector('.picker-root');
        this._granularity = 'words';
        this._originalText = '';
        this._newText = '';
        this._hunks = [];
        // Aligned 1:1 with _hunks, context entries included, so an index is
        // never recomputed and _renderHunk can stay a pure index lookup.
        this._hunkEls = [];
        // Indices of the interactive (non-context) hunks, for j/k navigation.
        this._interactive = [];
        this._currentIdx = -1;
        this._useAnswerHandler = null;

        this._buildChrome();

        // Bound so the exact same reference can be added in connectedCallback
        // and removed in disconnectedCallback.
        this._onKeydown = this._onKeydown.bind(this);
    }

    connectedCallback() {
        this.addEventListener('keydown', this._onKeydown);
    }

    disconnectedCallback() {
        this.removeEventListener('keydown', this._onKeydown);
    }

    // Static chrome, built once: the toolbar, the review body and the (phase 2)
    // editor. setContent() only ever refills the body.
    _buildChrome() {
        const toolbar = document.createElement('div');
        toolbar.className = 'picker-toolbar';
        toolbar.setAttribute('role', 'group');
        toolbar.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_picker_toolbar'));

        this._counterEl = document.createElement('span');
        this._counterEl.className = 'picker-counter';
        // Announce the new count without moving focus off the toggled hunk.
        this._counterEl.setAttribute('aria-live', 'polite');
        toolbar.appendChild(this._counterEl);

        this._prevBtn = this._makeToolbarButton('apiwebchat_picker_prev', 'mzta-btn-tertiary');
        this._prevBtn.addEventListener('click', () => this._moveCurrent(-1));
        toolbar.appendChild(this._prevBtn);

        this._nextBtn = this._makeToolbarButton('apiwebchat_picker_next', 'mzta-btn-tertiary');
        this._nextBtn.addEventListener('click', () => this._moveCurrent(1));
        toolbar.appendChild(this._nextBtn);

        this._acceptAllBtn = this._makeToolbarButton('apiwebchat_picker_accept_all', 'mzta-btn-secondary');
        this._acceptAllBtn.addEventListener('click', () => this._setAllStates('accepted'));
        toolbar.appendChild(this._acceptAllBtn);

        this._rejectAllBtn = this._makeToolbarButton('apiwebchat_picker_reject_all', 'mzta-btn-secondary');
        this._rejectAllBtn.addEventListener('click', () => this._setAllStates('rejected'));
        toolbar.appendChild(this._rejectAllBtn);

        // The picker lives in its own transcript turn, below the answer that
        // owns the action bar. Without this the user would have to scroll back
        // up to a different turn to apply the choices they just made here.
        this._useBtn = this._makeToolbarButton('apiwebchat_use_this_answer', 'mzta-btn-secondary');
        this._useBtn.classList.add('picker-use-btn');
        this._useBtn.insertBefore(buildUseAnswerIcon(13), this._useBtn.firstChild);
        this._useBtn.addEventListener('click', () => {
            if (this._useAnswerHandler) { this._useAnswerHandler(); }
        });
        toolbar.appendChild(this._useBtn);

        this._toolbar = toolbar;
        this._root.appendChild(toolbar);

        this._noteEl = document.createElement('p');
        this._noteEl.className = 'picker-note';
        this._noteEl.hidden = true;
        this._root.appendChild(this._noteEl);

        this._bodyEl = document.createElement('div');
        this._bodyEl.className = 'picker-body';
        this._root.appendChild(this._bodyEl);

        this._editor = document.createElement('textarea');
        this._editor.className = 'picker-editor';
        this._root.appendChild(this._editor);
    }

    _makeToolbarButton(i18nKey, cls) {
        const btn = document.createElement('button');
        btn.classList.add(cls);
        const label = browser.i18n.getMessage(i18nKey);
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        btn.appendChild(labelEl);
        btn.setAttribute('aria-label', label);
        btn.title = label;
        return btn;
    }

    // Must be called before setContent().
    setGranularity(granularity) {
        this._granularity = (granularity === 'sentences') ? 'sentences' : 'words';
    }

    // Wire the toolbar's "use this answer" button. The handler is invoked with
    // no arguments; it is expected to read composeResultHTML() itself, so it
    // always sees the latest state.
    setUseAnswerHandler(handler) {
        this._useAnswerHandler = handler;
    }

    setContent(originalText, newText) {
        this._originalText = originalText == null ? '' : String(originalText);
        this._newText = newText == null ? '' : String(newText);
        this._rebuild(this._newText);
    }

    // Build (or rebuild) the hunk list and render it. Phase 2's EDIT -> REVIEW
    // round-trip comes back through here with the edited text.
    _rebuild(newText) {
        this._hunks = buildHunks(this._originalText, newText, this._granularity);
        this._currentIdx = -1;

        if (this._hunks === null) {
            // The diff aborted. Nothing trustworthy to show, and composing a
            // result would be a guess, so say so and fall back to the answer.
            this._hunks = [{
                id: 0,
                type: 'context',
                oldText: normalizeForDiff(newText),
                newText: normalizeForDiff(newText),
                state: 'accepted',
            }];
            this._showNote('apiwebchat_picker_diff_failed');
        } else if (!hasChanges(this._hunks)) {
            // A single context hunk would otherwise render as a bare paragraph
            // under a "0 of 0 changes accepted" toolbar.
            this._showNote('apiwebchat_picker_no_changes');
        } else {
            this._noteEl.hidden = true;
            this._noteEl.textContent = '';
        }

        this._renderAll();
        this._updateCounter();
    }

    _showNote(i18nKey) {
        this._noteEl.textContent = browser.i18n.getMessage(i18nKey);
        this._noteEl.hidden = false;
    }

    _renderAll() {
        this._bodyEl.textContent = '';
        this._hunkEls = [];
        this._interactive = [];

        this._hunks.forEach((hunk, index) => {
            const span = document.createElement('span');
            if (hunk.type !== 'context') {
                // Set once, never touched by _renderHunk: this is what lets a
                // toggle preserve focus and tab order.
                span.tabIndex = 0;
                span.setAttribute('role', 'button');
                span.dataset.hunkIndex = String(index);
                span.addEventListener('click', (e) => {
                    e.preventDefault();
                    this._currentIdx = index;
                    this._toggleHunk(index);
                });
                this._interactive.push(index);
            }
            this._hunkEls.push(span);
            this._bodyEl.appendChild(span);
            this._renderHunk(index);
        });
    }

    // Repaint ONE hunk in place. The span element identity never changes, so
    // focus, tab order and hover survive a toggle - which is the whole point
    // of not rebuilding the view.
    _renderHunk(index) {
        const hunk = this._hunks[index];
        const span = this._hunkEls[index];

        span.textContent = '';
        span.className = '';

        if (hunk.type === 'context') {
            span.appendChild(textWithNewlinesToFragment(hunk.oldText));
            return;
        }

        const accepted = hunk.state === 'accepted';
        const shown = accepted ? hunk.newText : hunk.oldText;

        span.classList.add('hunk', accepted ? 'is-accepted' : 'is-rejected');
        span.setAttribute('aria-pressed', accepted ? 'true' : 'false');
        const label = this._hunkLabel(hunk);
        span.setAttribute('aria-label', label);
        span.title = label;

        if (shown === '') {
            // Accepted delete, or rejected insert: the side in force is empty.
            const marker = document.createElement('span');
            marker.className = 'hunk-marker';
            marker.setAttribute('aria-hidden', 'true');
            marker.appendChild(buildHunkMarkerIcon());
            span.appendChild(marker);
        } else {
            span.appendChild(textWithNewlinesToFragment(shown));
        }

        span.appendChild(this._buildHunkAction(index, accepted));
    }

    _buildHunkAction(index, accepted) {
        const btn = document.createElement('button');
        btn.className = 'hunk-action';
        btn.type = 'button';
        // -1: the hunk span itself is the tab stop. Reaching the icon via Tab
        // would double every stop in a long email.
        btn.tabIndex = -1;
        const label = browser.i18n.getMessage(
            accepted ? 'apiwebchat_picker_reject_change' : 'apiwebchat_picker_accept_change');
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.appendChild(accepted ? buildRevertIcon(11) : buildCheckIcon(11));
        btn.addEventListener('click', (e) => {
            // Without this the click also lands on the parent span and the
            // hunk toggles twice, back to where it started.
            e.stopPropagation();
            e.preventDefault();
            this._currentIdx = index;
            this._toggleHunk(index);
        });
        return btn;
    }

    _hunkLabel(hunk) {
        const accepted = hunk.state === 'accepted';
        switch (hunk.type) {
            case 'insert':
                return browser.i18n.getMessage(accepted
                    ? 'apiwebchat_picker_hunk_insert_accepted'
                    : 'apiwebchat_picker_hunk_insert_rejected', [hunk.newText]);
            case 'delete':
                return browser.i18n.getMessage(accepted
                    ? 'apiwebchat_picker_hunk_delete_accepted'
                    : 'apiwebchat_picker_hunk_delete_rejected', [hunk.oldText]);
            default:
                return browser.i18n.getMessage(accepted
                    ? 'apiwebchat_picker_hunk_replace_accepted'
                    : 'apiwebchat_picker_hunk_replace_rejected', [hunk.oldText, hunk.newText]);
        }
    }

    _toggleHunk(index) {
        const hunk = this._hunks[index];
        if (!hunk || hunk.type === 'context') { return; }

        // _renderHunk clears the span's children, which blurs a focused
        // DESCENDANT (the icon button). The span itself keeps focus, since it
        // is the same node throughout.
        const span = this._hunkEls[index];
        const active = this.shadowRoot.activeElement;
        const hadInnerFocus = !!active && active !== span && span.contains(active);

        hunk.state = (hunk.state === 'accepted') ? 'rejected' : 'accepted';
        this._renderHunk(index);
        this._updateCounter();

        if (hadInnerFocus) {
            span.querySelector('.hunk-action')?.focus();
        }
    }

    // Bulk change: set every state first, then repaint once per hunk, then a
    // single counter update. Routing through _toggleHunk would redo the
    // counter and the labels N times.
    _setAllStates(state) {
        let changed = false;
        this._hunks.forEach((hunk, index) => {
            if (hunk.type === 'context' || hunk.state === state) { return; }
            hunk.state = state;
            this._renderHunk(index);
            changed = true;
        });
        if (changed) { this._updateCounter(); }
    }

    _updateCounter() {
        const { accepted, total } = countChanges(this._hunks);
        const empty = (total === 0);

        this._counterEl.textContent = empty
            ? ''
            : browser.i18n.getMessage('apiwebchat_picker_counter', [String(accepted), String(total)]);

        // With nothing to pick, every control except "use this answer" is
        // meaningless - and "0 of 0 changes accepted" reads like a bug.
        this._counterEl.hidden = empty;
        this._prevBtn.hidden = empty;
        this._nextBtn.hidden = empty;
        this._acceptAllBtn.hidden = empty;
        this._rejectAllBtn.hidden = empty;

        this._acceptAllBtn.disabled = (accepted === total);
        this._rejectAllBtn.disabled = (accepted === 0);
    }

    // Move focus to the next/previous interactive hunk, clamping at the ends.
    _moveCurrent(delta) {
        if (this._interactive.length === 0) { return; }

        let pos = this._interactive.indexOf(this._currentIdx);
        if (pos === -1) {
            pos = (delta > 0) ? -1 : this._interactive.length;
        }
        const next = pos + delta;
        if (next < 0 || next >= this._interactive.length) { return; }

        if (this._currentIdx >= 0) {
            this._hunkEls[this._currentIdx]?.classList.remove('is-current');
        }
        this._currentIdx = this._interactive[next];
        const span = this._hunkEls[this._currentIdx];
        span.classList.add('is-current');
        span.focus();
        span.scrollIntoView({ block: 'nearest' });
    }

    _onKeydown(e) {
        // Never shadow a browser or OS shortcut.
        if (e.ctrlKey || e.metaKey || e.altKey) { return; }
        // Phase 2's textarea must keep every key, j and k included.
        const target = e.composedPath()[0];
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) { return; }

        switch (e.key) {
            case ' ':
            case 'Enter': {
                // Only when a hunk is focused: the toolbar buttons need Space
                // and Enter for themselves.
                const span = this.shadowRoot.activeElement;
                const idx = span?.dataset?.hunkIndex;
                if (idx === undefined) { return; }
                e.preventDefault();   // Space would scroll the transcript
                this._currentIdx = Number(idx);
                this._toggleHunk(Number(idx));
                break;
            }
            case 'j':
                e.preventDefault();
                this._moveCurrent(1);
                break;
            case 'k':
                e.preventDefault();
                this._moveCurrent(-1);
                break;
        }
    }

    composeResultText() {
        return composeResult(this._hunks);
    }

    composeResultHTML() {
        // Escape BEFORE substituting <br>, or the tags this adds get escaped
        // along with the text.
        return escapeHtml(this.composeResultText())
            .replace(/\r\n/g, '\n')
            .replace(/\n/g, '<br>');
    }
}

customElements.define('diff-picker', DiffPicker);
