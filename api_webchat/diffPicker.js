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
import {
    buildHunkMarkerIcon,
    buildUseAnswerIcon,
    buildChevronLeftIcon,
    buildChevronRightIcon,
    buildCircleCheckIcon,
    buildCheckMarkIcon,
    buildCrossIcon,
    buildPencilIcon,
    buildOverflowIcon,
} from './svgIcons.js';

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
//
// Blank lines are collapsed to a single \n because the two sides do not arrive
// equally faithful: the original comes from prompt_info.selection_text /
// body_text, which cleanupNewlines() has already flattened with \n{2,} -> \n,
// while the answer side keeps its \n\n through htmlToPlainText(). Capping at
// \n\n would leave that asymmetry in place and manufacture a hunk out of every
// paragraph break on multi-paragraph mail - changes the user has no reason to
// review. Aligning to the lossier side is what removes them. [#855]
export function normalizeForDiff(text) {
    if (text == null) { return ''; }
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n')
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

    /* The UA's [hidden]{display:none} loses to any class rule that sets display
       - and .mzta-btn-* / .picker-* all do. Without this, setting .hidden on an
       element in this component is silently a no-op. One rule here rather than a
       :not([hidden]) guard on each selector: hiding by property is how the whole
       component drives visibility. */
    [hidden] {
      display: none !important;
    }

    /* ---- Toolbar -----------------------------------------------------------
       Two tiers inside one bordered container: a CONTEXT STRIP (what state the
       review is in, and at what granularity) above an ACTIONS ROW (navigate,
       bulk, commit). The split exists because the flat single row gave a
       destructive "Reject all" the same visual weight as the primary CTA and
       wrapped into three ragged lines as soon as the window narrowed.

       Sticky sticks to the nearest scrolling ancestor, which is #messages in
       <messages-area>'s shadow root. Shadow boundaries do not block it.

       The reflow is driven by a CONTAINER query, not a media query: the picker
       sits inside the transcript column (max-width 768px in styles.css), so the
       window width is not what decides whether the row fits. container-type
       inline-size is safe here because only the inline axis is queried - the
       picker's height still comes from its content. */
    .picker-toolbar {
      position: sticky;
      top: 0;
      z-index: 5;
      container-type: inline-size;
      container-name: picker-toolbar;
      margin-bottom: 9px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      /* NOT overflow:hidden, however much the context strip's background wants
         clipping into the rounded corners: the overflow menu hangs below the
         actions row and would be cut off. The strip rounds its own top corners
         instead. */
    }

    .picker-context {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
      /* -1px so the fill meets the container's own border rather than leaving a
         hairline of --surface between the two curves. */
      border-radius: calc(var(--r-lg) - 1px) calc(var(--r-lg) - 1px) 0 0;
    }
    /* With the strip gone (EDIT mode) the actions row is the top of the
       container and inherits the rounding. */
    .picker-context[hidden] + .picker-actions {
      border-radius: calc(var(--r-lg) - 1px) calc(var(--r-lg) - 1px) 0 0;
    }

    /* On the wide layout the strip is ONE flex line: icon, label, progress and
       the granularity toggle are all siblings in it. .picker-status exists only
       so the narrow layout can group the first three onto their own line, so
       here it must be transparent to the layout - display:contents promotes its
       children into the strip's flex line, which a plain div would instead
       swallow into a single item (collapsing the progress bar and eating the
       strip's gap). The narrow rules below turn it back into a real flex row. */
    .picker-status {
      display: contents;
    }

    .picker-status-icon {
      display: inline-flex;
      flex-shrink: 0;
      color: var(--ok-ink);
    }

    .picker-counter {
      font-size: .78125rem;
      font-weight: 600;
      color: var(--ink);
      /* The status text yields before the progress bar and the granularity
         toggle do: it is the only element here that can be truncated without
         losing an affordance. */
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Progress and the flexible spacer are the only things that absorb width -
       every control is flex-shrink:0 so no label ever wraps. */
    .picker-progress {
      flex: 1;
      min-width: 16px;
      height: 5px;
      border-radius: var(--r-pill);
      background: var(--border);
      overflow: hidden;
    }
    .picker-progress-fill {
      height: 100%;
      width: 0;
      background: var(--ok-ink);
      transition: width .12s ease;
    }

    .picker-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 11px 12px;
    }
    .picker-actions > * {
      white-space: nowrap;
      flex-shrink: 0;
    }
    .picker-spacer {
      flex: 1;
      /* The one exception to the rule above. */
      flex-shrink: 1;
      min-width: 0;
    }

    /* Granularity toggle: two mutually exclusive options rendered as one
       segmented control, so it reads as a single setting with two positions
       rather than two unrelated buttons. */
    .picker-gran {
      display: inline-flex;
      flex-shrink: 0;
      align-items: stretch;
      gap: 2px;
      padding: 2px;
      background: var(--hover);
      border-radius: var(--r-sm);
    }
    .picker-gran button {
      border: none;
      border-radius: calc(var(--r-sm) - 2px);
      margin: 0;
      padding: 4px 10px;
      background: transparent;
      color: var(--ink-2);
      font-size: .75rem;
      font-weight: 550;
    }
    /* Raised, not filled with the accent: this is a view setting sitting next
       to the primary CTA, and two accent-filled controls in the same bar read
       as two equally important actions. */
    .picker-gran button[aria-checked="true"] {
      background: var(--surface);
      color: var(--ink);
      font-weight: 600;
      box-shadow: 0 1px 2px var(--shadow);
    }
    .picker-gran button:hover:not(:disabled):not([aria-checked="true"]) {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--ink);
    }

    /* Prev / counter / next as one bordered pill: they are one control with
       three parts, and separate buttons read as unrelated actions. */
    .picker-stepper {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      background: var(--surface);
      overflow: hidden;
    }
    .picker-stepper button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--ink-2);
      cursor: pointer;
      font: inherit;
      transition: background .12s ease, color .12s ease;
    }
    .picker-stepper button:hover:not(:disabled) {
      background: var(--hover);
      color: var(--ink);
    }
    .picker-stepper button:disabled {
      opacity: .4;
      cursor: default;
    }
    .picker-step-prev {
      border-right: 1px solid var(--border);
    }
    .picker-step-next {
      border-left: 1px solid var(--border);
    }
    .picker-step-label {
      padding: 0 10px;
      font-size: .78125rem;
      font-weight: 550;
      color: var(--ink);
      white-space: nowrap;
    }

    /* Icon-only, so height comes from the box and not from a text line: matches
       the 34px stepper rather than the 26px .mzta-btn-icon used elsewhere. */
    .picker-overflow-btn {
      width: 34px;
      height: 34px;
      border-radius: var(--r-md);
    }

    .picker-reject-btn {
      height: 34px;
      padding: 0 12px;
      font-size: .78125rem;
    }
    /* Destructive, so it surfaces its danger tint on hover only - resting, it
       must not compete with the CTA. */
    .picker-reject-btn:hover:not(:disabled) {
      background: var(--err-bg);
      border-color: var(--err-border);
      color: var(--err-ink);
    }

    .picker-use-btn {
      height: 34px;
      padding: 0 14px;
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      font-size: .8125rem;
      font-weight: 650;
    }
    .picker-use-btn:hover:not(:disabled) {
      background: var(--accent-dark);
      border-color: var(--accent-dark);
    }

    /* ---- Overflow menu -----------------------------------------------------
       Holds the actions that do not earn permanent space: "Accept all" and
       "Edit manually" always, plus "Reject all" once the bar is too narrow to
       keep it inline. */
    .picker-overflow {
      position: relative;
      display: inline-flex;
    }
    .picker-menu {
      position: absolute;
      top: calc(100% + 5px);
      left: 0;
      z-index: 6;
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 222px;
      /* Padding and border inside the 222px: shadow roots get no page-level
         reset, so the default content-box would make this 234px wide and the
         right-edge anchoring below would compute against the wrong number. */
      box-sizing: border-box;
      padding: 5px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      box-shadow: 0 8px 24px var(--shadow);
    }
    .picker-menu[hidden] {
      display: none;
    }
    /* Anchored to a button that can sit at the right edge on narrow layouts,
       where a left-anchored popover would overflow the container. */
    .picker-menu.is-right {
      left: auto;
      right: 0;
    }
    .picker-menu button {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 9px;
      border: none;
      border-radius: var(--r-sm);
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: .8125rem;
      text-align: left;
      cursor: pointer;
      transition: background .12s ease, color .12s ease;
    }
    .picker-menu button:hover:not(:disabled) {
      background: var(--hover);
    }
    .picker-menu button:disabled {
      color: var(--ink-3);
      cursor: default;
    }
    .picker-menu button svg {
      flex-shrink: 0;
    }
    .picker-menu .picker-menu-danger:not(:disabled) {
      color: var(--err-ink);
    }
    .picker-menu .picker-menu-danger:hover:not(:disabled) {
      background: var(--err-bg);
    }

    /* ---- Narrow layout ----------------------------------------------------
       One column, 44px touch targets, bulk actions all in the overflow menu.
       Keyed on the toolbar's own inline size, so it is the column width that
       decides - not the window's. */
    @container picker-toolbar (max-width: 419px) {
      .picker-context {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        padding: 10px 12px;
      }
      .picker-status {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .picker-gran {
        border-radius: var(--r-md);
      }
      .picker-gran button {
        flex: 1;
        justify-content: center;
        padding: 7px 0;
        font-size: .78125rem;
        border-radius: var(--r-sm);
      }
      .picker-actions {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        padding: 12px;
      }
      .picker-actions-nav {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .picker-stepper {
        flex: 1;
        border-radius: var(--r-md);
      }
      .picker-stepper button {
        width: 46px;
        height: 44px;
      }
      .picker-step-label {
        flex: 1;
        text-align: center;
        font-size: .8125rem;
      }
      .picker-overflow-btn {
        width: 44px;
        height: 44px;
      }
      .picker-use-btn {
        justify-content: center;
        width: 100%;
        height: 44px;
        font-size: .875rem;
      }
      /* Nothing to absorb in a column, and it would add a phantom gap row. */
      .picker-spacer {
        display: none;
      }
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

    /* The two modes are mutually exclusive, driven by one attribute on the host
       so a single write swaps the whole view and the two can never both show. */
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
      /* Vertical only: a horizontal resize inside a flex column fights the
         layout, and the text wraps anyway. */
      resize: vertical;
    }
    :host([mode="edit"]) .picker-body {
      display: none;
    }
    :host([mode="edit"]) .picker-editor {
      display: block;
    }

    /* Checked while editing. A tick and not the accent fill the old inline
       button used: inside a menu an accent-filled row reads as the primary
       action of the whole toolbar, which EDIT is not. */
    .picker-mode-btn[aria-checked="true"] {
      font-weight: 650;
      color: var(--accent-soft-ink);
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
        // 'review' (pick per change) or 'edit' (free-text textarea).
        this._mode = 'review';
        this._menuOpen = false;
        // Whether the bulk actions are suppressed by state (zero changes, or
        // EDIT mode) as opposed to by layout. Set by _updateCounter, read by
        // _syncRejectAllPlacement; seeded here because a ResizeObserver can fire
        // before the first _updateCounter of a freshly built picker.
        this._bulkHidden = false;

        this._buildChrome();

        // Bound so the exact same reference can be added in connectedCallback
        // and removed in disconnectedCallback.
        this._onKeydown = this._onKeydown.bind(this);
        this._onEditorResize = this._onEditorResize.bind(this);
        this._onToolbarResize = this._onToolbarResize.bind(this);
        this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
        // Which side of the @container breakpoint the last measurement fell on,
        // so a resize that does not cross it costs nothing.
        this._wasNarrow = null;
    }

    connectedCallback() {
        this.addEventListener('keydown', this._onKeydown);
        // On the document, not the host: a click anywhere outside the menu has
        // to close it, and clicks outside the picker never reach the host. Same
        // add-here / remove-in-disconnectedCallback discipline as the keydown
        // handler, so nothing accumulates across chat turns.
        document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
        // The user dragging the textarea's resize handle changes the picker's
        // height with no mutation and no scroll event, so nothing else would
        // notice that the transcript geometry moved.
        if (typeof ResizeObserver !== 'undefined') {
            this._editorObs = new ResizeObserver(this._onEditorResize);
            this._editorObs.observe(this._editor);
            // The container query restyles the toolbar on its own, but the two
            // decisions CSS cannot make - which stepper label to use, and which
            // copy of "Reject all" is live - are measured, so they need a signal
            // when the width crosses the breakpoint. Also delivers the first
            // measurement: at _buildChrome time the toolbar has no width yet.
            this._toolbarObs = new ResizeObserver(this._onToolbarResize);
            this._toolbarObs.observe(this._toolbar);
        }
    }

    disconnectedCallback() {
        this.removeEventListener('keydown', this._onKeydown);
        document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
        this._editorObs?.disconnect();
        this._editorObs = null;
        this._toolbarObs?.disconnect();
        this._toolbarObs = null;
    }

    // Click-outside dismissal. composedPath() and not .contains(): the menu is
    // inside a shadow root, so the event target seen at document level is the
    // host and .contains() would report every click on the picker as inside the
    // menu.
    _onDocumentPointerDown(e) {
        if (!this._menuOpen) { return; }
        if (e.composedPath().includes(this._overflowEl)) { return; }
        this._setMenuOpen(false);
    }

    // Static chrome, built once: the toolbar, the review body and the editor.
    // setContent() only ever refills the body.
    //
    // The toolbar is TWO TIERS inside one container - a context strip (status,
    // progress, granularity) above an actions row (stepper, overflow, bulk,
    // CTA). The flat single row it replaces wrapped into three ragged lines in a
    // narrow window and gave the destructive "Reject all" the same weight as the
    // primary CTA. Reflow to a single column is CSS-only (a container query), so
    // there is exactly one DOM shape to reason about at any width.
    _buildChrome() {
        const toolbar = document.createElement('div');
        toolbar.className = 'picker-toolbar';
        toolbar.setAttribute('role', 'group');
        toolbar.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_picker_toolbar'));

        toolbar.appendChild(this._buildContextStrip());
        toolbar.appendChild(this._buildActionsRow());

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
        this._editor.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_picker_editor'));
        this._root.appendChild(this._editor);

        // Sets the mode button's label and aria-pressed for the initial REVIEW
        // state; without it the button would render with no text.
        this._paintMode();
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

    // Icon-only button. The label goes to title + aria-label only, so the glyph
    // is never the sole affordance for a screen reader or on hover.
    _makeIconButton(i18nKey, icon, cls) {
        const btn = document.createElement('button');
        btn.type = 'button';
        if (cls) { btn.classList.add(cls); }
        btn.appendChild(icon);
        const label = browser.i18n.getMessage(i18nKey);
        btn.setAttribute('aria-label', label);
        btn.title = label;
        return btn;
    }

    // Row 1: what state the review is in, and at what granularity. No action
    // that changes the text lives here - only status and one view setting.
    _buildContextStrip() {
        const strip = document.createElement('div');
        strip.className = 'picker-context';

        // Wrapper so the narrow layout can keep icon + label + progress on one
        // line while the granularity toggle drops to a second.
        const status = document.createElement('div');
        status.className = 'picker-status';

        this._statusIconEl = document.createElement('span');
        this._statusIconEl.className = 'picker-status-icon';
        this._statusIconEl.setAttribute('aria-hidden', 'true');
        this._statusIconEl.appendChild(buildCircleCheckIcon(15));
        status.appendChild(this._statusIconEl);

        this._counterEl = document.createElement('span');
        this._counterEl.className = 'picker-counter';
        // Announce the new count without moving focus off the toggled hunk.
        this._counterEl.setAttribute('aria-live', 'polite');
        status.appendChild(this._counterEl);

        // A second, visual reading of the same number the counter announces, so
        // it is aria-hidden: a progressbar role here would make every toggle
        // announce twice.
        this._progressEl = document.createElement('div');
        this._progressEl.className = 'picker-progress';
        this._progressEl.setAttribute('aria-hidden', 'true');
        this._progressFillEl = document.createElement('div');
        this._progressFillEl.className = 'picker-progress-fill';
        this._progressEl.appendChild(this._progressFillEl);
        status.appendChild(this._progressEl);

        strip.appendChild(status);
        this._statusEl = status;

        this._granEl = this._buildGranularityToggle();
        strip.appendChild(this._granEl);

        this._contextEl = strip;
        return strip;
    }

    // Row 2: navigate, then the actions that change the text, with the primary
    // CTA last and alone on the right.
    _buildActionsRow() {
        const row = document.createElement('div');
        row.className = 'picker-actions';

        // Stepper and overflow stay adjacent in a wrapper so the narrow layout
        // gets them side by side on one line instead of stacked.
        const nav = document.createElement('div');
        nav.className = 'picker-actions-nav';

        nav.appendChild(this._buildStepper());
        nav.appendChild(this._buildOverflow());
        row.appendChild(nav);
        this._navEl = nav;

        const spacer = document.createElement('div');
        spacer.className = 'picker-spacer';
        row.appendChild(spacer);

        // Inline at comfortable widths, in the overflow menu when narrow - the
        // one bulk action worth reaching without opening a menu, because
        // rejecting everything is how a user backs out of a bad suggestion.
        this._rejectAllBtn = this._makeToolbarButton('apiwebchat_picker_reject_all', 'mzta-btn-secondary');
        this._rejectAllBtn.classList.add('picker-reject-btn');
        this._rejectAllBtn.addEventListener('click', () => this._setAllStates('rejected'));
        row.appendChild(this._rejectAllBtn);

        // The picker lives in its own transcript turn, below the answer that
        // owns the action bar. Without this the user would have to scroll back
        // up to a different turn to apply the choices they just made here.
        this._useBtn = this._makeToolbarButton('apiwebchat_use_this_answer', 'mzta-btn-secondary');
        this._useBtn.classList.add('picker-use-btn');
        this._useBtn.insertBefore(buildUseAnswerIcon(15), this._useBtn.firstChild);
        this._useBtn.addEventListener('click', () => {
            if (this._useAnswerHandler) { this._useAnswerHandler(); }
        });
        row.appendChild(this._useBtn);

        this._actionsEl = row;
        return row;
    }

    // Previous / position / next as one bordered pill: three parts of a single
    // control, which two separate buttons around a floating counter did not
    // convey. The label doubles as the position readout the old toolbar spent a
    // separate counter on.
    _buildStepper() {
        const stepper = document.createElement('div');
        stepper.className = 'picker-stepper';

        this._prevBtn = this._makeIconButton(
            'apiwebchat_picker_prev', buildChevronLeftIcon(15), 'picker-step-prev');
        this._prevBtn.addEventListener('click', () => this._moveCurrent(-1));
        stepper.appendChild(this._prevBtn);

        this._stepLabelEl = document.createElement('span');
        this._stepLabelEl.className = 'picker-step-label';
        stepper.appendChild(this._stepLabelEl);

        this._nextBtn = this._makeIconButton(
            'apiwebchat_picker_next', buildChevronRightIcon(15), 'picker-step-next');
        this._nextBtn.addEventListener('click', () => this._moveCurrent(1));
        stepper.appendChild(this._nextBtn);

        this._stepperEl = stepper;
        return stepper;
    }

    // "Accept all" and "Edit manually" are real actions but not ones worth
    // permanent width: one is a single click away from being undone, the other
    // is an escape hatch. They live behind the "..." button, along with
    // "Reject all" once the layout is too narrow to keep it inline.
    _buildOverflow() {
        const wrap = document.createElement('div');
        wrap.className = 'picker-overflow';

        this._overflowBtn = this._makeIconButton(
            'apiwebchat_picker_more_actions', buildOverflowIcon(16),
            'mzta-btn-icon');
        this._overflowBtn.classList.add('picker-overflow-btn');
        this._overflowBtn.setAttribute('aria-expanded', 'false');
        this._overflowBtn.setAttribute('aria-haspopup', 'true');
        this._overflowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._setMenuOpen(!this._menuOpen);
        });
        wrap.appendChild(this._overflowBtn);

        const menu = document.createElement('div');
        menu.className = 'picker-menu';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;

        this._acceptAllBtn = this._makeMenuItem(
            'apiwebchat_picker_accept_all', buildCheckMarkIcon(15),
            () => this._setAllStates('accepted'));
        menu.appendChild(this._acceptAllBtn);

        // The same action as the inline button, not a mirror of its state: only
        // one of the two is ever visible, so there is no state to keep in sync
        // beyond the disabled flag _updateCounter sets on both.
        this._menuRejectAllBtn = this._makeMenuItem(
            'apiwebchat_picker_reject_all', buildCrossIcon(15),
            () => this._setAllStates('rejected'));
        this._menuRejectAllBtn.classList.add('picker-menu-danger');
        menu.appendChild(this._menuRejectAllBtn);

        this._modeBtn = this._makeMenuItem(
            'apiwebchat_picker_edit', buildPencilIcon(15),
            () => this._toggleMode());
        this._modeBtn.classList.add('picker-mode-btn');
        // menuitemcheckbox, not menuitem: EDIT is a state you are in, and the
        // item both reports and leaves it. The CSS held-down styling the old
        // inline button had is gone with it - inside a menu, a checked item is
        // conveyed by the role, and an accent-filled menu row would read as the
        // primary action of the whole toolbar.
        this._modeBtn.setAttribute('role', 'menuitemcheckbox');
        menu.appendChild(this._modeBtn);

        wrap.appendChild(menu);
        this._menuEl = menu;
        this._menuOpen = false;
        this._overflowEl = wrap;
        return wrap;
    }

    _makeMenuItem(i18nKey, icon, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.appendChild(icon);
        const label = browser.i18n.getMessage(i18nKey);
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        btn.appendChild(labelEl);
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.addEventListener('click', () => {
            // Every item here is a one-shot action, so the menu has done its
            // job the moment one fires.
            this._setMenuOpen(false);
            onClick();
        });
        return btn;
    }

    _setMenuOpen(open) {
        const wanted = !!open;
        if (wanted === this._menuOpen) { return; }
        this._menuOpen = wanted;
        this._menuEl.hidden = !wanted;
        this._overflowBtn.setAttribute('aria-expanded', wanted ? 'true' : 'false');
        if (wanted) {
            // Anchored left by default, but on the narrow layout the button sits
            // at the right edge and a left-anchored popover would overflow.
            // Measured rather than keyed off the breakpoint, so it stays right
            // whatever the container query ends up doing.
            const btnRect = this._overflowBtn.getBoundingClientRect();
            const barRect = this._toolbar.getBoundingClientRect();
            const fitsLeft = (btnRect.left + 222) <= barRect.right;
            this._menuEl.classList.toggle('is-right', !fitsLeft);
            this._menuEl.querySelector('button:not(:disabled)')?.focus();
        }
        // The picker grows by the menu's height only if the transcript cannot
        // clip it; telling the transcript its geometry may have moved is
        // cheap and read-only on the other side.
        this._notifyResize();
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

    // ---- REVIEW / EDIT modes ------------------------------------------------
    //
    // Picking per change covers the common case, but not "the suggestion is
    // nearly right and I want to fix one word myself". EDIT mode is that escape
    // hatch: a plain textarea over the current composition.
    //
    // A <textarea> and not contenteditable, deliberately: contenteditable would
    // accept pasted rich text and quietly break the plain-text-only contract the
    // whole hunk model rests on.

    _toggleMode() {
        this._setMode(this._mode === 'review' ? 'edit' : 'review');
    }

    _setMode(mode) {
        const wanted = (mode === 'edit') ? 'edit' : 'review';
        if (wanted === this._mode) { return; }

        if (wanted === 'edit') {
            // Measure BEFORE hiding: offsetHeight of a display:none element is
            // 0. Opening the editor at the height the review view had keeps the
            // transcript from jumping under the user's cursor - and because the
            // two views then start the same size, there is no scroll position to
            // restore afterwards.
            const h = this._bodyEl.offsetHeight;
            this._editor.value = composeResult(this._hunks);
            if (h > 0) { this._editor.style.height = h + 'px'; }
            this._mode = 'edit';
            this.setAttribute('mode', 'edit');
            // Warn before the reset happens, not after: coming back re-diffs and
            // discards the choices, which is surprising if unannounced.
            this._showNote('apiwebchat_picker_edit_hint');
        } else {
            // Re-diff the edited text against the ORIGINAL. This resets every
            // choice to accepted - see the comment on _rebuild. _rebuild also
            // resets the note, clearing the edit hint.
            this._mode = 'review';
            this.removeAttribute('mode');
            this._rebuild(this._editor.value);
        }

        this._paintMode();
        this._notifyResize();
    }

    _paintMode() {
        const editing = (this._mode === 'edit');
        const label = browser.i18n.getMessage(
            editing ? 'apiwebchat_picker_review' : 'apiwebchat_picker_edit');
        // The button is both a state indicator and the way out of that state,
        // so its label has to name the destination, not the current mode.
        // Only the <span> is retargeted - clearing textContent would take the
        // icon with it, and the icon is built once.
        this._modeBtn.querySelector('span').textContent = label;
        this._modeBtn.setAttribute('aria-label', label);
        this._modeBtn.title = label;
        this._modeBtn.setAttribute('aria-checked', editing ? 'true' : 'false');
        // Everything that operates on hunks is meaningless over free text.
        this._updateCounter();
    }

    // Tell the transcript its geometry moved. A composed CustomEvent and not a
    // direct call: <messages-area> imports this module, so a reference the other
    // way would invert the dependency. Without composed:true the event would not
    // cross the shadow boundary at all.
    _notifyResize() {
        this.dispatchEvent(new CustomEvent('mzta-picker-resize', {
            bubbles: true,
            composed: true,
        }));
    }

    _onEditorResize() {
        if (this._mode !== 'edit') { return; }
        this._notifyResize();
    }

    // Only the breakpoint crossing matters, not every pixel: a window drag fires
    // this continuously, and repainting the label on each frame would be work for
    // an identical result. Deliberately does NOT _notifyResize() - the transcript
    // observed this resize itself.
    _onToolbarResize() {
        const narrow = this._isNarrow();
        if (narrow === this._wasNarrow) { return; }
        this._wasNarrow = narrow;
        this._updateStepper(this._stepperEl.hidden);
        this._syncRejectAllPlacement();
        // An open popover anchored for the other layout would now hang off the
        // edge, and there is no sensible place to re-anchor it mid-drag.
        this._setMenuOpen(false);
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
        // New content always arrives for review: opening straight into the
        // editor would hide the changes the button was clicked to see.
        this._mode = 'review';
        this.removeAttribute('mode');
        this._editor.value = '';
        this._rebuild(this._newText);
        this._paintMode();
    }

    // Build (or rebuild) the hunk list and render it. The EDIT -> REVIEW
    // round-trip comes back through here with the edited text.
    //
    // Rebuilding from scratch RESETS every hunk to 'accepted', discarding
    // accept/reject decisions made before. That is the design, not an oversight:
    // the hunks are recomputed against different text (or at a different
    // granularity), so old decisions have no counterpart to map onto, and
    // inventing one would silently misrepresent what the user chose.
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
        // Hidden with nothing to pick ("0 of 0 changes accepted" reads like a
        // bug) and in EDIT mode, where there are no hunks to operate on: the
        // counter would report a state the visible text no longer reflects.
        const editing = (this._mode === 'edit');
        const hide = editing || (total === 0);
        const allAccepted = (total > 0 && accepted === total);

        // "All N changes accepted" for the finished state, rather than "N of N":
        // the default IS everything accepted, so the very first thing the user
        // reads should say the review is complete, not read like a tally.
        this._counterEl.textContent = hide
            ? ''
            : (allAccepted
                ? browser.i18n.getMessage('apiwebchat_picker_counter_all', [String(total)])
                : browser.i18n.getMessage('apiwebchat_picker_counter', [String(accepted), String(total)]));

        // The bar is the same number again, visually. Empty rather than hidden
        // when there is nothing to show, so the strip's layout does not shift.
        this._progressFillEl.style.width = (total > 0 && !editing)
            ? ((accepted / total) * 100) + '%'
            : '0%';

        this._statusEl.hidden = hide;
        // The granularity toggle survives the zero-changes state (switching to
        // sentences is a reasonable thing to try when words found nothing) but
        // not EDIT mode, where re-diffing would throw away what the user typed.
        this._granEl.hidden = editing;
        // In EDIT mode both children are gone, so the strip would render as a
        // bare tinted band with a bottom border. Zero-changes keeps it: the
        // toggle is still in there.
        this._contextEl.hidden = editing;

        this._updateStepper(hide);

        this._acceptAllBtn.hidden = hide;
        this._acceptAllBtn.disabled = (accepted === total);
        this._rejectAllBtn.disabled = (accepted === 0);
        this._menuRejectAllBtn.disabled = (accepted === 0);
        // Remembered so the layout-driven swap below has the state answer
        // without recomputing the counts.
        this._bulkHidden = hide;
        this._syncRejectAllPlacement();
        // With every bulk action gone there is nothing left in the menu but
        // "Edit manually", which is reason enough to keep it - it is the only
        // way out of the zero-changes state other than the CTA.
    }

    // The stepper's label doubles as the position readout. It reports the
    // CURRENT change, so before the user has navigated anywhere there is no
    // position yet - the label then shows the total alone rather than inventing
    // a "1 of N" the arrows have not actually reached.
    _updateStepper(hide) {
        this._stepperEl.hidden = hide;
        const count = this._interactive.length;
        if (hide || count === 0) {
            this._stepLabelEl.textContent = '';
            return;
        }

        const pos = this._interactive.indexOf(this._currentIdx);
        // The long form only fits the narrow layout, where the stepper spans the
        // row; at the wide breakpoint it competes with the CTA for width.
        const narrow = this._isNarrow();
        if (pos === -1) {
            // No current change yet - the user has not navigated. "0 / 9" would
            // claim a position that does not exist and reads like a count of
            // zero, so show the total on its own until the first move.
            this._stepLabelEl.textContent = narrow
                ? browser.i18n.getMessage('apiwebchat_picker_step_total', [String(count)])
                : String(count);
        } else {
            const key = narrow ? 'apiwebchat_picker_step_long' : 'apiwebchat_picker_step_short';
            this._stepLabelEl.textContent =
                browser.i18n.getMessage(key, [String(pos + 1), String(count)]);
        }

        // Clamped, not wrapping: reaching the last change and landing back on
        // the first would lose the user's place in a long answer.
        this._prevBtn.disabled = (pos <= 0);
        this._nextBtn.disabled = (pos === count - 1);
    }

    // "Reject all" is inline when the actions row has room for it and in the
    // overflow menu when it does not - never in both, or the same action would
    // appear twice. The container query handles the layout but cannot move a
    // node between two parents, so which copy is live is decided here.
    //
    // _bulkHidden wins over the layout: a toolbar with nothing to reject shows
    // the action in neither place.
    _syncRejectAllPlacement() {
        const narrow = this._isNarrow();
        this._rejectAllBtn.hidden = this._bulkHidden || narrow;
        this._menuRejectAllBtn.hidden = this._bulkHidden || !narrow;
    }

    // Mirrors the @container breakpoint in the stylesheet. Measured, because CSS
    // can restyle at a breakpoint but cannot swap text or move a node, and those
    // two decisions have to agree with the layout. Before the picker is in the
    // document the width is 0, which would read as narrow; the wide layout is the
    // right assumption there, and _updateCounter runs again on every state
    // change once connected.
    _isNarrow() {
        const width = this._toolbar.getBoundingClientRect().width;
        return width > 0 && width <= 419;
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
        // The stepper label IS the position readout, so it has to follow every
        // move - including the j/k keyboard path, which comes through here too.
        this._updateStepper(false);
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
        // Before every other guard: the menu is reachable in EDIT mode too, and
        // an open popover has to be dismissable from the keyboard wherever focus
        // sits. Escape is not text, so the textarea has no claim on it either.
        if (e.key === 'Escape' && this._menuOpen) {
            e.preventDefault();
            this._setMenuOpen(false);
            this._overflowBtn.focus();
            return;
        }
        // The textarea keeps every key, j and k included: they are text there.
        const target = e.composedPath()[0];
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) { return; }
        // Nothing to navigate or toggle in EDIT mode. Belt and braces: the guard
        // above already covers the textarea itself, but focus can sit on a
        // toolbar button while editing.
        if (this._mode === 'edit') { return; }

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
            // ArrowRight/Left alongside j/k: the stepper reads as a left/right
            // control, so the arrows are what a user tries first. Safe to claim
            // here - the picker has no horizontally scrollable content and no
            // text input in REVIEW mode.
            case 'j':
            case 'ArrowRight':
                e.preventDefault();
                this._moveCurrent(1);
                break;
            case 'k':
            case 'ArrowLeft':
                e.preventDefault();
                this._moveCurrent(-1);
                break;
        }
    }

    // The single source of truth for what the user has chosen, in either mode.
    // In EDIT it is the textarea verbatim, so "Use this answer" and Copy work
    // straight from the editor without forcing a trip back through REVIEW.
    composeResultText() {
        if (this._mode === 'edit') { return this._editor.value; }
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
