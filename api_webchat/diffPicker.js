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
import { buildHunkMarkerIcon, buildUseAnswerIcon } from './svgIcons.js';

// <diff-picker> replaces the read-only diff viewer for prompts with
// use_diff_viewer == "1": the user chooses, per change, which version to keep,
// and the composed result is what gets written back into the email.
//
// BOTH versions of every change are shown at once - the original in red, the
// answer's replacement in green - and clicking one keeps it. The other stays on
// screen, dimmed, so the comparison never disappears and switching back is one
// click. Showing only the version in force was tried first and dropped: with one
// side hidden the user cannot see what they are choosing between, which is the
// whole point of reviewing a proofread.
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

    /* Granularity toggle: two mutually exclusive options rendered as one
       segmented control, so it reads as a single setting with two positions
       rather than two unrelated buttons. */
    .picker-gran {
      display: inline-flex;
      align-items: stretch;
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      overflow: hidden;
    }
    .picker-gran button {
      border: none;
      border-radius: 0;
      margin: 0;
      background: transparent;
      color: var(--ink-2);
      font-weight: 500;
    }
    .picker-gran button + button {
      border-left: 1px solid var(--border);
    }
    /* Not --surface-2: that is the toolbar's own background, so the hover
       would be invisible. Tinting toward the accent works in both themes. */
    .picker-gran button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--ink);
    }
    /* The selected position, not a hover/active flicker: it has to stay
       visibly held down. */
    .picker-gran button[aria-checked="true"] {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      font-weight: 650;
    }
    .picker-gran button[aria-checked="true"]:hover:not(:disabled) {
      background: var(--accent-dark);
      color: #fff;
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

    /* A change shows BOTH versions at once: the red original and the green
       replacement, side by side. Clicking one keeps it. The colours mirror the
       .added/.removed pair the read-only viewer used, so the picker still reads
       as the same feature. The rules have to live here: only the custom
       properties cross the shadow boundary. */
    .hunk {
      display: inline;
      border-radius: 3px;
      /* Keep the pair together: a change must never be split across lines with
         the original at the end of one and the replacement at the start of the
         next, which reads as two unrelated edits. */
      white-space: nowrap;
    }
    /* The text inside a side still has to wrap normally - only the grouping of
       the two sides is nowrap. */
    .hunk-side {
      white-space: normal;
    }
    .hunk.is-current {
      box-shadow: 0 0 0 2px var(--accent);
    }

    /* One of the two versions. Both are always on screen; the one currently in
       force is fully coloured, the other is dimmed and struck through, so the
       comparison stays readable and switching back is one click away. */
    .hunk-side {
      display: inline;
      cursor: pointer;
      border-radius: 3px;
      padding: 0 2px;
      transition: opacity .12s ease, box-shadow .12s ease;
    }
    .hunk-side-old {
      background-color: var(--err-bg);
      color: var(--err-ink);
    }
    .hunk-side-new {
      background-color: var(--ok-bg);
      color: var(--ok-ink);
    }
    /* Not chosen: still legible, clearly not what will be inserted. */
    .hunk-side.is-inactive {
      opacity: .5;
      text-decoration: line-through;
    }
    .hunk-side.is-active {
      font-weight: 600;
    }
    .hunk-side:hover {
      opacity: 1;
      box-shadow: 0 0 0 2px var(--border-strong);
    }
    .hunk-side:focus-visible {
      opacity: 1;
    }

    /* A pure insertion has no original, and a pure deletion has no replacement.
       The placeholder stands in for that empty side so the gesture stays the
       same everywhere: click the version you want to keep. */
    .hunk-side.is-empty {
      opacity: .55;
      text-decoration: none;
      padding: 0 3px;
    }
    .hunk-side.is-empty.is-active {
      opacity: 1;
    }
    .hunk-marker {
      display: inline-flex;
      vertical-align: middle;
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
        // Same indexing: {old, new} side elements per change, null for context.
        this._sideEls = [];
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

        this._granEl = this._buildGranularityToggle();
        toolbar.appendChild(this._granEl);

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

    // Word-level or sentence-level comparison, switchable while reviewing.
    //
    // Both are genuinely useful and which one is right is not knowable in
    // advance: word granularity suits an in-place grammar fix, but a prompt that
    // rewrites whole sentences produces dozens of interleaved micro-hunks at
    // word level and a handful of readable ones at sentence level. So the choice
    // belongs to the user, at the moment they can see the result.
    _buildGranularityToggle() {
        const group = document.createElement('span');
        group.className = 'picker-gran';
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_picker_granularity'));

        this._granBtns = {};
        for (const g of ['words', 'sentences']) {
            const btn = this._makeToolbarButton(
                g === 'words' ? 'apiwebchat_picker_granularity_words'
                              : 'apiwebchat_picker_granularity_sentences',
                'mzta-btn-tertiary');
            // radio, not a pressed button: the two positions are mutually
            // exclusive, and aria-pressed would announce them as independent.
            btn.setAttribute('role', 'radio');
            btn.dataset.granularity = g;
            btn.addEventListener('click', () => this._changeGranularity(g));
            group.appendChild(btn);
            this._granBtns[g] = btn;
        }
        // Paint here too, not only from setGranularity(): a picker left at the
        // default would otherwise show neither position as selected.
        this._paintGranularity();
        return group;
    }

    // Re-diff at the new granularity.
    //
    // This rebuilds the hunk list from scratch, which DISCARDS every accept /
    // reject decision already made - all changes go back to accepted. There is
    // no correct alternative: one sentence-level hunk spans several word-level
    // ones, so the decisions have no meaning across the boundary and any attempt
    // to carry them over would silently invent choices the user never made.
    // Losing them visibly is better than corrupting them invisibly.
    _changeGranularity(granularity) {
        const wanted = (granularity === 'sentences') ? 'sentences' : 'words';
        if (wanted === this._granularity) { return; }
        this._granularity = wanted;
        this._paintGranularity();
        // From _newText, not from the current composition: the granularity
        // switch re-compares the ORIGINAL against the ANSWER. Feeding the
        // composed text back in would make the answer's rejected parts
        // unreachable, turning a view setting into a destructive edit.
        this._rebuild(this._newText);
    }

    _paintGranularity() {
        for (const [g, btn] of Object.entries(this._granBtns || {})) {
            btn.setAttribute('aria-checked', g === this._granularity ? 'true' : 'false');
        }
    }

    // Sets the initial granularity. Safe before setContent(); afterwards the
    // toolbar toggle is the way in, since this does not re-diff.
    setGranularity(granularity) {
        this._granularity = (granularity === 'sentences') ? 'sentences' : 'words';
        this._paintGranularity();
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
        this._sideEls = [];
        this._interactive = [];

        this._hunks.forEach((hunk, index) => {
            const span = document.createElement('span');
            this._hunkEls.push(span);
            this._sideEls.push(null);
            this._bodyEl.appendChild(span);

            if (hunk.type === 'context') {
                span.appendChild(textWithNewlinesToFragment(hunk.oldText));
                return;
            }

            span.classList.add('hunk');
            // Both versions are built ONCE here, never rebuilt: a toggle only
            // reassigns their active/inactive classes. That is what keeps focus,
            // tab order and hover intact across a choice.
            const oldSide = this._buildSide(index, 'old');
            const newSide = this._buildSide(index, 'new');
            span.appendChild(oldSide);
            span.appendChild(newSide);
            this._sideEls[index] = { old: oldSide, new: newSide };
            this._interactive.push(index);

            this._renderHunk(index);
        });
    }

    // One of the two versions of a change. `which` is 'old' (the original, red)
    // or 'new' (the answer's replacement, green). Clicking it keeps that side.
    _buildSide(index, which) {
        const hunk = this._hunks[index];
        const text = (which === 'old') ? hunk.oldText : hunk.newText;

        const side = document.createElement('span');
        side.classList.add('hunk-side', which === 'old' ? 'hunk-side-old' : 'hunk-side-new');
        side.tabIndex = 0;
        side.setAttribute('role', 'radio');
        side.dataset.hunkIndex = String(index);
        side.dataset.side = which;

        if (text === '') {
            // A pure insertion has no original and a pure deletion has no
            // replacement. The placeholder gives that empty side something to
            // click, so choosing "keep nothing here" works like every other
            // choice instead of being a special gesture.
            side.classList.add('is-empty');
            const marker = document.createElement('span');
            marker.className = 'hunk-marker';
            marker.setAttribute('aria-hidden', 'true');
            marker.appendChild(buildHunkMarkerIcon());
            side.appendChild(marker);
        } else {
            side.appendChild(textWithNewlinesToFragment(text));
        }

        side.addEventListener('click', (e) => {
            e.preventDefault();
            this._currentIdx = index;
            this._chooseSide(index, which);
        });
        return side;
    }

    // Repaint ONE hunk in place: flip which of its two sides is active. The
    // side elements themselves are never rebuilt, only reclassified.
    _renderHunk(index) {
        const hunk = this._hunks[index];
        if (hunk.type === 'context') { return; }

        const sides = this._sideEls[index];
        if (!sides) { return; }

        const accepted = hunk.state === 'accepted';
        this._paintSide(sides.old, hunk, 'old', !accepted);
        this._paintSide(sides.new, hunk, 'new', accepted);
    }

    _paintSide(side, hunk, which, isActive) {
        side.classList.toggle('is-active', isActive);
        side.classList.toggle('is-inactive', !isActive);
        // radio semantics: exactly one of the pair is checked at any time.
        side.setAttribute('aria-checked', isActive ? 'true' : 'false');
        const label = this._sideLabel(hunk, which, isActive);
        side.setAttribute('aria-label', label);
        side.title = label;
    }

    _sideLabel(hunk, which, isActive) {
        const empty = (which === 'old' ? hunk.oldText : hunk.newText) === '';
        let key;
        if (empty) {
            // "keep nothing": rejecting an insertion, or accepting a deletion.
            key = isActive ? 'apiwebchat_picker_side_empty_active' : 'apiwebchat_picker_side_empty_inactive';
            return browser.i18n.getMessage(key);
        }
        if (which === 'old') {
            key = isActive ? 'apiwebchat_picker_side_old_active' : 'apiwebchat_picker_side_old_inactive';
            return browser.i18n.getMessage(key, [hunk.oldText]);
        }
        key = isActive ? 'apiwebchat_picker_side_new_active' : 'apiwebchat_picker_side_new_inactive';
        return browser.i18n.getMessage(key, [hunk.newText]);
    }

    // Keep the given side of a change. Idempotent: clicking the side already in
    // force does nothing, which is what "click the version you want" implies.
    _chooseSide(index, which) {
        const hunk = this._hunks[index];
        if (!hunk || hunk.type === 'context') { return; }

        const wanted = (which === 'new') ? 'accepted' : 'rejected';
        if (hunk.state === wanted) { return; }

        hunk.state = wanted;
        this._renderHunk(index);
        this._updateCounter();
    }

    // Flip a change to its other version. Used by the keyboard toggle, where
    // there is no "which side did you click" to go on.
    _toggleHunk(index) {
        const hunk = this._hunks[index];
        if (!hunk || hunk.type === 'context') { return; }
        this._chooseSide(index, hunk.state === 'accepted' ? 'old' : 'new');
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

    // Move focus to the next/previous change, clamping at the ends. Focus lands
    // on the side currently in force, so Space/Enter flips away from what is
    // there rather than from an arbitrary one of the two.
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
        this._focusActiveSide(this._currentIdx);
        span.scrollIntoView({ block: 'nearest' });
    }

    _focusActiveSide(index) {
        const sides = this._sideEls[index];
        if (!sides) { return; }
        const accepted = this._hunks[index].state === 'accepted';
        (accepted ? sides.new : sides.old).focus();
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
                // Only when one side of a change is focused: the toolbar buttons
                // need Space and Enter for themselves.
                const side = this.shadowRoot.activeElement;
                const idx = side?.dataset?.hunkIndex;
                if (idx === undefined) { return; }
                e.preventDefault();   // Space would scroll the transcript
                const index = Number(idx);
                this._currentIdx = index;
                // Enter/Space on a side means "keep this one". On the side
                // already in force that would be a no-op, so flip instead -
                // otherwise the key would appear dead.
                const wanted = side.dataset.side;
                const current = (this._hunks[index].state === 'accepted') ? 'new' : 'old';
                if (wanted === current) {
                    this._toggleHunk(index);
                    // The chosen side changed, so move focus onto it to keep
                    // the "focus follows the active version" rule.
                    this._focusActiveSide(index);
                } else {
                    this._chooseSide(index, wanted);
                }
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
