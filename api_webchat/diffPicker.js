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
// The sanitizer + tag taxonomy live in the shared rich-text layer - ONE security
// boundary, ONE allowlist. This module used to define them; they moved so the
// webchat renderer and the picker cannot drift apart. The segmentation machinery
// below (blockTextOfHtml / segmentBlocks / sliceHtmlByText / normalizeBlockHtml)
// deliberately stayed here: blockTextOfHtml is the offset-space anchor
// sliceHtmlByText maps against, and its invariant must not change.
import {
    sanitizeInlineHtml,
    sanitizeBlockHtml,
    BLOCK_TAGS,
} from '../js/mzta-richtext.js';
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
// HTML ON BOTH SIDES. Both sides are segmented into blocks (see segmentBlocks),
// diffed within each paired block, and recomposed as HTML, so the chosen side's
// MARKUP comes with it - see the block-model rationale further down. This
// replaced an earlier plain-text-only model in which the answer's formatting did
// not survive the picker. The manual EDIT box is HTML too: a contenteditable
// whose every input path - the composition it opens on, a paste, a drop - is
// funnelled through the same allowlist as the answer itself, so formatting
// survives the REVIEW -> EDIT -> REVIEW round-trip without widening what markup
// can reach the DOM (see the REVIEW/EDIT section).
//
// The conversion back to plain text, when the target compose window is plain
// text, is NOT done here: it happens downstream where the window's format is
// known (isPlainTextCompose() + stripHtmlKeepLines() in mzta-background.js).
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

// (normalizeForDiff() used to live here, collapsing both sides to plain text
// before diffing. Its job now belongs to normalizeBlockHtml() + blockTextOfHtml,
// which normalize WITHIN a block: the blank-line collapse it did to keep every
// paragraph break from becoming a hunk is now structural - paragraph breaks are
// block boundaries and never reach the text diff at all. [#855])

// Pair up two block lists.
//
// Diff.diffArrays is safe here for the SAME structural reason diffWordsWithSpace
// is safe below: ArrayDiff declares only tokenize/join/removeEmpty and overrides
// neither postProcess nor equals, so the parts it emits partition both block
// lists exactly. (Diff.diffWords is banned at this level too - see DIFF_FNS.)
// The comparator includes HTML, not just text+tag. That matters for the
// invariant: for a context part jsdiff keeps only ONE side's objects and
// discards which block on the other side it matched, so a "context" block
// would carry the new side's markup and reject-all would emit the ANSWER'S
// formatting where the original's belonged. Requiring the html to match too
// means a context block is genuinely identical on both sides, and any
// markup-only difference falls through to a replace pair - where the two
// sides are kept separately and the user can actually choose between them.
function buildBlockPairs(oldBlocks, newBlocks) {
    // sep is compared for the SAME reason html is: for a context part jsdiff
    // keeps one side's objects and discards the other, so two blocks that differ
    // only in their trailing <br> would collapse to one and reject-all would emit
    // the ANSWER'S line structure. Comparing it sends that case to a replace pair,
    // where both sides survive and contextSide can choose between them.
    const parts = Diff.diffArrays(oldBlocks, newBlocks, {
        comparator: (a, b) => a.text === b.text && a.tag === b.tag && a.html === b.html
                              && (a.sep || null) === (b.sep || null),
    });
    if (!parts) { return null; }

    const pairs = [];
    let i = 0;
    while (i < parts.length) {
        if (!parts[i].added && !parts[i].removed) {
            for (const b of parts[i].value) {
                pairs.push({ kind: 'context', oldBlock: b, newBlock: b });
            }
            i++;
            continue;
        }
        // Gather a maximal run, exactly as the text-level loop does, so the
        // ordering of added/removed parts cannot matter.
        let removed = [];
        let added = [];
        while (i < parts.length && (parts[i].added || parts[i].removed)) {
            if (parts[i].added) { added = added.concat(parts[i].value); }
            else                { removed = removed.concat(parts[i].value); }
            i++;
        }
        // Pair positionally; the surplus on either side is a pure block
        // insert or delete.
        const n = Math.max(removed.length, added.length);
        for (let k = 0; k < n; k++) {
            const ob = removed[k] || null;
            const nb = added[k] || null;
            if (ob && nb)      { pairs.push({ kind: 'replace', oldBlock: ob, newBlock: nb }); }
            else if (nb)       { pairs.push({ kind: 'insert',  oldBlock: null, newBlock: nb }); }
            else               { pairs.push({ kind: 'delete',  oldBlock: ob, newBlock: null }); }
        }
    }
    return pairs;
}

// Turn two HTML strings into a list of composed blocks, each holding its own
// hunks.
//
//   Hunk = {
//     id: number,                                  // stable, sequential
//     type: 'context' | 'replace' | 'insert' | 'delete',
//     oldText: string,                             // '' for insert
//     newText: string,                             // '' for delete
//     oldHtml: string,                             // the same span, with markup
//     newHtml: string,
//     state: 'accepted' | 'rejected'               // ignored for context
//   }
//
//   ComposedBlock = { kind, tag, listType, hunks }
//
// Every non-context hunk defaults to 'accepted', so a user who touches nothing
// gets exactly what they got before the picker existed.
export function buildHunks(originalHtml, newHtml, granularity = 'words') {
    const oldBlocks = segmentBlocks(originalHtml);
    const newBlocks = segmentBlocks(newHtml);

    const pairs = buildBlockPairs(oldBlocks, newBlocks);
    if (!pairs) { return null; }

    const diffFn = DIFF_FNS[granularity] || DIFF_FNS.words;
    const blocks = [];
    let id = 0;

    for (const pair of pairs) {
        // A block present on only one side is one pickable unit: its whole text
        // on the side it exists, and the empty-side placeholder on the other.
        if (pair.kind === 'insert' || pair.kind === 'delete') {
            const b = pair.newBlock || pair.oldBlock;
            const isInsert = pair.kind === 'insert';
            blocks.push({
                kind: pair.kind,
                tag: b.tag,
                listType: b.listType,
                // The block exists on one side only, so the other side has no
                // junction to contribute.
                oldSep: isInsert ? null : b.sep,
                newSep: isInsert ? b.sep : null,
                hunks: [{
                    id: id++,
                    type: pair.kind,
                    oldText: isInsert ? '' : b.text,
                    newText: isInsert ? b.text : '',
                    oldHtml: isInsert ? '' : b.html,
                    newHtml: isInsert ? b.html : '',
                    state: 'accepted',
                }],
            });
            continue;
        }

        const ob = pair.oldBlock;
        const nb = pair.newBlock;

        // A context block still needs one hunk so composeResult can read it
        // uniformly. Both sides are IDENTICAL here - text, tag and html - which
        // buildBlockPairs' comparator guarantees, so taking everything from nb
        // is not a choice between them.
        if (pair.kind === 'context') {
            blocks.push({
                kind: 'context',
                tag: nb.tag,
                listType: nb.listType,
                // sep IS in the comparator, so a context pair matched on it too:
                // ob and nb are the same object and these two reads agree by
                // construction, exactly as they do for text, tag and html.
                oldSep: ob.sep,
                newSep: nb.sep,
                hunks: [{
                    id: id++,
                    type: 'context',
                    oldText: nb.text,
                    newText: nb.text,
                    oldHtml: nb.html,
                    newHtml: nb.html,
                    state: 'accepted',
                }],
            });
            continue;
        }

        // Paired block: the existing text-level diff, unchanged, inside it.
        const parts = diffFn(ob.text, nb.text);
        // The base diff() returns undefined when a maxEditLength/timeout option
        // aborts the search. No options are passed today, but a bare .length on
        // undefined would be a hard crash if that ever changes.
        if (!parts) { return null; }

        const hunks = [];
        // Running offsets into each side's plain text, so each hunk can ask
        // sliceHtmlByText for its own markup.
        let oldPos = 0;
        let newPos = 0;
        let i = 0;
        while (i < parts.length) {
            if (!parts[i].added && !parts[i].removed) {
                const v = parts[i].value;
                hunks.push({
                    id: id++,
                    type: 'context',
                    oldText: v,
                    newText: v,
                    oldHtml: sliceHtmlByText(ob.html, oldPos, oldPos + v.length, v),
                    newHtml: sliceHtmlByText(nb.html, newPos, newPos + v.length, v),
                    state: 'accepted',
                });
                oldPos += v.length;
                newPos += v.length;
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
                oldHtml: del === '' ? '' : sliceHtmlByText(ob.html, oldPos, oldPos + del.length, del),
                newHtml: ins === '' ? '' : sliceHtmlByText(nb.html, newPos, newPos + ins.length, ins),
                state: 'accepted',
            });
            oldPos += del.length;
            newPos += ins.length;
        }

        // Both separators are kept, unlike tag/listType which take the new side
        // unconditionally: composeResultBlocksHTML chooses between them at
        // compose time, so reject-all can reproduce the original's line
        // structure instead of the answer's.
        blocks.push({ kind: 'replace', tag: nb.tag, listType: nb.listType,
                      oldSep: ob.sep, newSep: nb.sep, hunks });
    }

    return blocks;
}

// Every hunk in document order, so the flat index the UI uses stays meaningful.
//
// Takes BLOCKS, not hunks. The two are easy to confuse - the picker holds both,
// _blocks and the flat _hunks derived from it - and passing the flat array here
// used to fail as "b.hunks is undefined" several frames down from the call that
// was actually wrong. Say so where the mistake is made instead.
export function flatHunks(blocks) {
    const out = [];
    for (const b of (blocks || [])) {
        if (!b || !b.hunks) {
            console.error('[ThunderAI] flatHunks: expected blocks, got something else', blocks);
            return out;
        }
        for (const h of b.hunks) { out.push(h); }
    }
    return out;
}

// Walk the blocks and emit the PLAIN TEXT the user has chosen.
//
// THE CORRECTNESS CONTRACT OF THE WHOLE FEATURE, at the HTML level:
//   composeResultHTML(all accepted) === renderBlocks(segmentBlocks(newHtml))
//   composeResultHTML(all rejected) === renderBlocks(segmentBlocks(originalHtml))
//
// It rests on three properties, each locally checkable:
//   P1  segmentBlocks is a normalization - segment/render is idempotent. The
//       invariant is stated against the segmented-and-rendered sides, not the
//       byte-exact input, exactly as it was stated against normalizeForDiff
//       rather than byte-exact whitespace before. For <br> it is now stronger
//       than idempotence - a true round trip, because the separator survives as
//       the block's sep (see makeBlock). _setMode('review') depends on that:
//       it decides "did the user edit anything" by string equality against a
//       canonical render.
//   P2  diffArrays partitions both block lists exactly (see buildBlockPairs).
//   P3  inside a paired block the existing text-level proof applies verbatim.
//
// A block that exists on only one side contributes nothing when its single
// hunk is rejected - which is what makes reject-all reproduce the original's
// block list and accept-all the answer's.
// Which side a CONTEXT hunk should contribute.
//
// Context means "the words are the same on both sides", not "the markup is".
// Inside a replace block the two sides can have marked the same words up
// differently, so a context hunk that always emitted the new side would make
// reject-all hand back the ANSWER'S formatting for text the user just rejected
// - breaking the invariant. It follows the block instead: if every changed hunk
// in the block is rejected, the block is showing the original and its context
// must be the original's too.
//
// A block with no changed hunks at all has two sides identical in text and
// html, so either answer is correct here. That now includes a replace pair the
// comparator split on the separator alone - same words, same markup, different
// trailing <br> - because the separator is not chosen here: it is settled once
// for the whole composition, in composeResultBlocksHTML.
function contextSide(block) {
    for (const h of block.hunks) {
        if (h.type === 'context') { continue; }
        if (h.state === 'accepted') { return 'new'; }
    }
    return block.hunks.some(h => h.type !== 'context') ? 'old' : 'new';
}

export function composeResult(blocks) {
    if (!blocks) { return ''; }
    const lines = [];
    for (const b of blocks) {
        const ctx = contextSide(b);
        let text = '';
        for (const h of b.hunks) {
            if (h.type === 'context')        { text += (ctx === 'old') ? h.oldText : h.newText; }
            else if (h.state === 'accepted') { text += h.newText; }
            else                             { text += h.oldText; }
        }
        // A block whose only hunk was rejected away leaves no line behind.
        if (text !== '') { lines.push(text); }
    }
    return lines.join('\n');
}

// The same walk, emitting HTML: each block's chosen hunks concatenated and
// wrapped in that block's own tag. The wrapper is emitted HERE and never lives
// inside a hunk, which is precisely why no accept/reject combination can
// unbalance a tag.
export function composeResultBlocksHTML(blocks) {
    if (!blocks) { return ''; }

    // Which side's LINE STRUCTURE the result carries. Unlike the per-block
    // choice of words, a separator joins two blocks, so it cannot be settled
    // block by block: an accepted hunk in one place and a rejected one in the
    // next would leave the junction between them undefined. It is decided once,
    // for the whole composition, by the same rule contextSide applies per block
    // - anything accepted means the user is building the answer's version, so
    // its line structure is the one being built. With nothing accepted the
    // original stands, which is what makes reject-all give the mail back
    // unchanged, <br> included.
    const anyAccepted = blocks.some(b => b.hunks.some(h => (h.type !== 'context') && (h.state === 'accepted')));
    const structure = anyAccepted ? 'new' : 'old';

    // Pass 1: compose each block's html. Blocks composing to nothing are
    // dropped here (a rejected insert, an accepted delete), so pass 2 sees only
    // what actually reaches the output.
    const rendered = [];
    for (const b of blocks) {
        const ctx = contextSide(b);
        let html = '';
        for (const h of b.hunks) {
            if (h.type === 'context')        { html += (ctx === 'old') ? h.oldHtml : h.newHtml; }
            else if (h.state === 'accepted') { html += h.newHtml; }
            else                             { html += h.oldHtml; }
        }
        if (html === '') { continue; }
        rendered.push({ tag: b.tag, listType: b.listType, html: html, sep: null,
                        _sep: (structure === 'old') ? (b.oldSep || null) : (b.newSep || null),
                        _kind: b.kind });
    }

    // Pass 2: a separator only survives if the block it joined to is still
    // there and belongs to the same side. A <br> that joined two lines in the
    // original says nothing about a block the answer inserted between them, so
    // a block absent from the chosen side ('insert' has no original, 'delete'
    // has no answer) ends the run rather than being joined across.
    const absent = (structure === 'old') ? 'insert' : 'delete';
    for (let i = 0; i < rendered.length - 1; i++) {
        if (rendered[i + 1]._kind !== absent) { rendered[i].sep = rendered[i]._sep; }
    }

    return renderBlocks(rendered);
}

export function hasChanges(blocks) {
    return flatHunks(blocks).some(h => h.type !== 'context');
}

export function countChanges(blocks) {
    let total = 0;
    let accepted = 0;
    for (const h of flatHunks(blocks)) {
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

// Sanitized HTML -> a fragment. Everything rendered through here has already
// been through sanitizeInlineHtml, which is the single choke point: nothing
// that skipped it may ever reach the DOM.
//
// (This replaced textWithNewlinesToFragment, the plain-text-only helper the
// picker used before it kept the answer's formatting.)
function htmlToFragment(html) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const fragment = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach(node => fragment.appendChild(node));
    return fragment;
}

// ---- HTML segmentation --------------------------------------------------
//
// The picker keeps the ANSWER'S FORMATTING, which the plain-text model it
// replaced could not. The whole design rests on one structural idea:
//
//   Split both sides into BLOCKS, pair the blocks, and run the existing
//   word/sentence diff INSIDE each paired block.
//
// A block's wrapper element is emitted whole by the composer and is never
// carried inside a hunk, and hunk boundaries only ever fall within one block.
// Therefore NO TAG CAN EVER CROSS A HUNK BOUNDARY, and no sequence of
// accept/reject choices can emit an opening tag without its closing tag. That
// is the property the rejected alternatives could not offer: diffing over a
// token stream with tags as tokens happily emits a hunk whose newText is
// "</strong> world <em>", because diffWordsWithSpace splits on whitespace and
// knows nothing about markup.
//
// The cost, stated rather than discovered: inline formatting INSIDE a changed
// hunk follows the side that is chosen, and is not independently pickable.
// Accepting a reworded sentence takes the answer's bolding with it; rejecting
// takes the original's. There is no "original words, answer's bold" state.

// BLOCK_TAGS, INLINE_ALLOWED, BLOCK_ALLOWED, SAFE_HREF and the sanitizer
// (sanitize / sanitizeInlineHtml / sanitizeBlockHtml) now live in
// js/mzta-richtext.js and are imported at the top of this file. BLOCK_TAGS here
// is still the SEGMENTATION set the code below reads - the shared module keeps
// it deliberately narrow (no ul/ol/tr/table) for exactly that reason.

// A block's plain text, derived FROM ITS NORMALIZED HTML.
//
// Deriving it rather than computing it separately from the source element is
// the point: sliceHtmlByText maps offsets in this text onto that html, so the
// two must agree exactly, character for character. Two independent projections
// that merely look equivalent would drift on the first odd input and every
// offset after the drift would be silently wrong.
//
// <br> projects to exactly one \n. No \n{2,} collapse is applied - by
// construction a block has no blank lines inside it, and the block list now
// carries the paragraph structure that used to be encoded as \n\n.
function blockTextOfHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode('\n')));
    return String(doc.body.textContent || '');
}

// sep records the JUNCTION that follows this block: 'br' means "this block is
// joined to the next one by a <br>, and both came out of the same wrapper".
// The last run of a wrapper always carries null. renderBlocks reads it to put
// the separator back, which is what makes segment -> render a true round trip
// for a <br>-separated body rather than a <p>-per-line normalization.
function makeBlock(el, tag, listType = null, sep = null) {
    const html = normalizeBlockHtml(sanitizeInlineHtml(el.innerHTML));
    return {
        tag: tag,
        listType: listType,
        text: blockTextOfHtml(html),
        html: html,
        sep: sep,
    };
}

// Split an element's children into runs separated by its DIRECT-CHILD <br>.
//
// A <br> that is a direct child of a block ENDS that block. In a mail body the
// line structure is frequently carried by <br> alone - Thunderbird's "Body Text"
// compose mode separates lines that way, and getMailInlineTextParts() in
// js/mzta-utils.js builds the html of a text/plain-only mail from the \n - so
// without this a whole body segments to ONE block while the markdown-it answer
// segments to one <p> per paragraph, and the block pairing is meaningless. [#829]
//
// Deliberately NOT done by adding 'br' to BLOCK_TAGS: that set doubles as "tags
// renderBlocks emits as a wrapper" (and is spread into BLOCK_ALLOWED), and <br>
// is void - it would come back out as <br>...</br>.
//
// The separator is not lost by being split on: pushBlocks records it as the
// block's sep, and renderBlocks re-joins the run and puts the <br> back. See
// makeBlock.
//
// Only direct children are split on. A <br> nested inside an inline element
// (<em>a<br>b</em>) stays inside its run, which is why blockTextOfHtml's
// <br> -> \n projection and sliceHtmlByText's matching offset accounting are
// still load-bearing and must not be removed.
function splitOnBr(el) {
    const runs = [];
    let current = document.createElement('div');
    for (const node of Array.from(el.childNodes)) {
        if ((node.nodeType === Node.ELEMENT_NODE) && (node.tagName.toLowerCase() === 'br')) {
            runs.push(current);
            current = document.createElement('div');
            continue;
        }
        current.appendChild(node.cloneNode(true));
    }
    runs.push(current);
    return runs;
}

// Collapse whitespace inside a block's HTML so that block.html and block.text
// share ONE projection.
//
// This is what makes P1 (segment -> render is idempotent) true by construction
// rather than by luck, and it is what lets sliceHtmlByText map a text offset
// onto the markup at all: block.text is READ BACK OUT of this html by
// blockTextOfHtml, so collapsing here is what defines the offset space both
// sides use. Text nodes are edited in place, leaving every tag untouched.
function normalizeBlockHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const root = doc.body;

    // Text nodes AND <br> in document order: a <br> is a line break for the
    // purposes of collapsing, so a space on either side of it must go the same
    // way as a space next to a literal \n.
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const nodes = [];
    while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.nodeType === Node.TEXT_NODE) { nodes.push(n); }
        else if (n.tagName && n.tagName.toLowerCase() === 'br') { nodes.push(n); }
    }

    const texts = [];
    let lastWasSpace = true;   // leading whitespace is dropped
    for (const node of nodes) {
        if (node.nodeType !== Node.TEXT_NODE) {
            // <br>: counts as a break, and swallows any space that follows.
            lastWasSpace = true;
            // A space already emitted just before the break is redundant.
            for (let i = texts.length - 1; i >= 0; i--) {
                if (texts[i].textContent === '') { continue; }
                texts[i].textContent = texts[i].textContent.replace(/ $/, '');
                break;
            }
            continue;
        }
        const s = String(node.textContent)
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/ *\n */g, '\n');
        let res = '';
        for (const ch of s) {
            if (ch === ' ') {
                if (lastWasSpace) { continue; }
                lastWasSpace = true;
                res += ch;
                continue;
            }
            lastWasSpace = (ch === '\n');
            res += ch;
        }
        node.textContent = res;
        texts.push(node);
    }

    // Trailing whitespace, mirroring the trim of the right-hand end.
    for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i].textContent.replace(/[ \n]+$/, '');
        texts[i].textContent = t;
        if (t !== '') { break; }
    }

    return root.innerHTML;
}

// HTML -> an ordered list of Blocks.
//
//   Block = { tag, listType, text, html }   // html is the INNER html, sanitized
//
// This is a NORMALIZATION, the way normalizeForDiff was for whitespace: the
// invariant is stated against the segmented-and-rendered sides, not against
// the byte-exact input HTML.
//
// Nested lists are flattened one level: an inner <li> becomes a block of the
// inner list's type. Deliberately lossy - the alternative is a recursive tree
// diff, and nested lists in a proofread answer are rare.
//
// A direct-child <br> is a BLOCK SEPARATOR, not inline content: see splitOnBr
// for why, and why it is not simply a member of BLOCK_TAGS.
export function segmentBlocks(html) {
    const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
    const blocks = [];

    // Emit one block per <br>-separated run of EL's children (see splitOnBr).
    // Empty runs have no text and are not emitted, but they still carry meaning:
    // an empty run BETWEEN two non-empty ones is a blank line (a <br><br> pair),
    // which is a PARAGRAPH break, so the block before it ends its wrapper
    // (sep=null) and renderBlocks emits the next run as its own <p>. Only a
    // SINGLE <br> to an adjacent non-empty run is an in-paragraph line break
    // (sep='br'). A trailing <br> (empty final run) likewise leaves sep=null, so
    // the last emitted block of a wrapper never points at a successor belonging
    // to a different wrapper.
    const pushBlocks = (el, tag, listType) => {
        const runs = splitOnBr(el).map(run => makeBlock(run, tag, listType, null));
        for (let i = 0; i < runs.length; i++) {
            if (runs[i].text === '') { continue; }
            const nextNonEmpty = (i + 1 < runs.length) && runs[i + 1].text !== '';
            runs[i].sep = nextNonEmpty ? 'br' : null;
            blocks.push(runs[i]);
        }
    };

    // A run of consecutive inline/text nodes at this level has no block of its
    // own, so it is gathered into an implicit <p>. Without this, an answer that
    // is a bare sentence with no markup would segment to nothing at all.
    let pending = null;
    const flushPending = () => {
        if (!pending) { return; }
        pushBlocks(pending, 'p', null);
        pending = null;
    };

    const walk = (parent, listType) => {
        for (const node of Array.from(parent.childNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                if (tag === 'ul' || tag === 'ol') {
                    flushPending();
                    walk(node, tag);
                    continue;
                }
                if (tag === 'li') {
                    flushPending();
                    // An <li> holding a nested list contributes its own text
                    // first, then the nested items as sibling blocks.
                    const nested = Array.from(node.children).filter(c => {
                        const t = c.tagName.toLowerCase();
                        return t === 'ul' || t === 'ol';
                    });
                    if (nested.length > 0) {
                        const shallow = node.cloneNode(true);
                        Array.from(shallow.children).forEach(c => {
                            const t = c.tagName.toLowerCase();
                            if (t === 'ul' || t === 'ol') { c.remove(); }
                        });
                        pushBlocks(shallow, 'li', listType || 'ul');
                        nested.forEach(n => walk(n, n.tagName.toLowerCase()));
                    } else {
                        pushBlocks(node, 'li', listType || 'ul');
                    }
                    continue;
                }
                // A <br> between blocks ends the implicit <p> being gathered.
                // The FIRST <br> after a run is a single-line junction ('br'), so
                // a bare "A<br>B" at body level comes back as one <p>. A SECOND
                // consecutive <br> (only whitespace in between) is a blank line, so
                // it promotes that junction to a paragraph break (sep=null) and the
                // two runs come back as separate <p> - matching the <br><br> rule
                // inside a wrapper (see pushBlocks).
                if (tag === 'br') {
                    const had = (pending !== null);
                    flushPending();
                    if (blocks.length > 0) {
                        const lastBlock = blocks[blocks.length - 1];
                        if (had) { lastBlock.sep = 'br'; }
                        else if (lastBlock.sep === 'br') { lastBlock.sep = null; }
                    }
                    continue;
                }
                if (BLOCK_TAGS.has(tag)) {
                    flushPending();
                    pushBlocks(node, tag, null);
                    continue;
                }
                // Inline element at block level: accumulate into the implicit <p>.
                if (!pending) { pending = document.createElement('div'); }
                pending.appendChild(node.cloneNode(true));
                continue;
            }
            if (node.nodeType === Node.TEXT_NODE) {
                if (String(node.textContent).trim() === '') { continue; }
                if (!pending) { pending = document.createElement('div'); }
                pending.appendChild(node.cloneNode(true));
            }
        }
        flushPending();
    };

    walk(doc.body, null);
    return blocks;
}

// Blocks -> HTML. The inverse of segmentBlocks in the only sense that matters:
// segment -> render -> segment -> render is stable (property P1 of the
// invariant). Consecutive <li> of the same list type are re-wrapped into a
// single <ul>/<ol>, so a list survives as one list instead of N one-item lists.
// Blocks carrying sep:'br' are re-joined into ONE wrapper separated by <br>,
// which is how the <br> the segmenter consumed gets put back. openRun mirrors
// the openList accumulator: it holds the tag of the wrapper currently left
// open, and only blocks of that same tag may join the run.
export function renderBlocks(blocks) {
    let out = '';
    let openList = null;
    let openRun = null;
    const list = (blocks || []);
    for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const next = list[i + 1] || null;
        // A run continues only while the next block exists and shares this
        // block's tag. Defensive: runs come out of one wrapper, so the tags
        // agree by construction - but an unbalanced wrapper must be impossible
        // even if some future caller hands over a hand-built block list.
        const joins = ((b.sep === 'br') && next && (next.tag === b.tag)
                       && ((b.tag !== 'li') || ((next.listType || 'ul') === (b.listType || 'ul'))));

        if (b.tag === 'li') {
            const type = b.listType || 'ul';
            if (openRun === null) {
                if (openList !== type) {
                    if (openList) { out += `</${openList}>`; }
                    out += `<${type}>`;
                    openList = type;
                }
                out += '<li>';
                openRun = 'li';
            }
            out += b.html;
            if (joins) { out += '<br>'; continue; }
            out += '</li>';
            openRun = null;
            continue;
        }

        if (openRun === null) {
            if (openList) { out += `</${openList}>`; openList = null; }
            out += `<${b.tag}>`;
            openRun = b.tag;
        }
        out += b.html;
        if (joins) { out += '<br>'; continue; }
        out += `</${openRun}>`;
        openRun = null;
    }
    if (openRun) { out += `</${openRun}>`; }
    if (openList) { out += `</${openList}>`; }
    return out;
}

// Plain text -> block HTML, one <p> per non-empty line.
//
// Used for the plain-text flavour of a paste or drop into the EDIT box, and
// wherever a plain-text original has to be given block structure before it can
// be segmented. Escapes, because the input is genuinely plain text: any '<' in
// it is a literal character, not markup.
export function textToBlockHtml(text) {
    return String(text == null ? '' : text)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .join('');
}

// The HTML for a [start, end) range of a block's plain text, with every
// enclosing inline tag reopened and reclosed.
//
// This is the one genuinely fiddly piece of the block model, so it is built
// with an escape hatch from the start: if the range cannot be mapped onto the
// DOM - i.e. the walk here and blockTextOfHtml's projection have drifted - it
// returns escapeHtml(fallbackText) for that hunk alone. The formatting of that
// one hunk is lost; malformed markup is never emitted. The console warning is
// there to make the case diagnosable rather than silent.
//
// The range is always WITHIN one block, so the ancestor chain of any touched
// text node is short and always closes.
export function sliceHtmlByText(blockHtml, start, end, fallbackText) {
    const bail = (why) => {
        console.warn('[ThunderAI] diff picker: HTML slice fell back to plain text (' + why + ')');
        return escapeHtml(fallbackText == null ? '' : String(fallbackText));
    };

    if (end <= start) { return ''; }

    try {
        const doc = new DOMParser().parseFromString(String(blockHtml || ''), 'text/html');
        const root = doc.body;

        // The offsets live in the space blockTextOfHtml() reads out of this very
        // html, so walking its text nodes in order reproduces that projection
        // exactly and an offset maps straight onto a (node, offset) pair.
        const out = doc.createDocumentFragment();
        let seen = 0;          // how much of the block's text has been consumed

        // blockHtml has already been through normalizeBlockHtml, so its text
        // nodes ARE the projection block.text was read from - no re-collapsing
        // here, which is what keeps the two offset spaces identical.

        // Clone the ancestor chain of a node up to (not including) root, so the
        // slice carries its <strong>/<em>/<a> wrappers. `leaf` is whatever this
        // position contributes - a text node, or a <br>.
        //
        // Ancestors already rebuilt for a previous leaf are REUSED rather than
        // cloned again, keyed by the source element. Without this, two text
        // nodes under one <strong> would come back as
        // <strong>a</strong><strong> b</strong> - visually identical, but not
        // equal to what renderBlocks emits, which would break the invariant on
        // string comparison alone.
        const shells = new Map();
        const graft = (node, leafNode) => {
            // Walk root-ward collecting the chain, then rebuild it top-down so
            // an existing shell can be reused at any level.
            const chain = [];
            let cur = node.parentNode;
            while (cur && cur !== root) { chain.unshift(cur); cur = cur.parentNode; }

            let parent = out;
            for (const src of chain) {
                let shell = shells.get(src);
                // Only reusable while it is still the last child of its parent:
                // anything appended after it would otherwise be re-parented into
                // the middle of the output.
                if (!shell || shell.parentNode !== parent || parent.lastChild !== shell) {
                    shell = src.cloneNode(false);
                    parent.appendChild(shell);
                    shells.set(src, shell);
                }
                parent = shell;
            }
            parent.appendChild(leafNode);
        };

        let done = false;
        const visit = (node) => {
            if (done) { return; }
            if (node.nodeType === Node.TEXT_NODE) {
                const norm = String(node.textContent);
                if (norm === '') { return; }
                const from = seen;
                const to = seen + norm.length;
                seen = to;
                // Overlap of [from, to) with [start, end)
                const a = Math.max(from, start);
                const b = Math.min(to, end);
                if (a < b) { graft(node, doc.createTextNode(norm.slice(a - from, b - from))); }
                if (seen >= end) { done = true; }
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) { return; }
            if (node.tagName.toLowerCase() === 'br') {
                const from = seen;
                seen += 1;   // <br> projects to exactly one \n
                if (from >= start && from < end) { graft(node, doc.createElement('br')); }
                if (seen >= end) { done = true; }
                return;
            }
            for (const child of Array.from(node.childNodes)) { visit(child); }
        };

        for (const child of Array.from(root.childNodes)) { visit(child); }

        // The walk must have covered the requested range. If it did not, the
        // two projections have drifted and the slice would be silently wrong -
        // so take the plain-text fallback instead of emitting it.
        if (seen < end) { return bail('range beyond block text'); }

        const holder = doc.createElement('div');
        holder.appendChild(out);
        return holder.innerHTML;
    } catch (e) {
        return bail(e && e.message ? e.message : 'exception');
    }
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

    /* Stepper, overflow and the inline "back to changes" on one line with a real
       gap. The narrow layout declares this too; it is stated here as well
       because the wide layout previously leaned on its children all being
       inline-flex, which silently gave no gap to a plain <button> sibling. */
    .picker-actions-nav {
      display: flex;
      align-items: center;
      gap: 8px;
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

    /* The inline way out of EDIT. Matches the stepper's 34px rather than the
       26px .mzta-btn-icon used elsewhere, so the actions row keeps one height
       whichever mode it is in. */
    .picker-review-btn {
      height: 34px;
      padding: 0 12px;
      font-size: .78125rem;
      gap: 6px;
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
      /* Alone on the nav line in EDIT (the stepper is hidden), so it spans it
         instead of sitting as a small tab against the left edge. */
      .picker-review-btn {
        flex: 1;
        justify-content: center;
        height: 44px;
        font-size: .8125rem;
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

    /* The body now holds REAL block elements - one per segmented block - so the
       picker shows the structure it is going to write into the mail. These
       rules only tame the UA defaults; the page's own font and colours are
       inherited. Margins are collapsed to a single trailing gap so a paragraph
       and a list item sit on the same rhythm.

       The EDITOR is in every selector here too, and that is the point rather
       than tidiness: it holds the same block elements from the same composer, so
       switching modes must not reflow the text the user is looking at. One
       selector list for both, not a second copy of the rules under a different
       prefix - two lists would drift the moment either side gained a tag. */
    .picker-body p,
    .picker-body blockquote,
    .picker-body pre,
    .picker-body h1,
    .picker-body h2,
    .picker-body h3,
    .picker-body h4,
    .picker-body h5,
    .picker-body h6,
    .picker-editor p,
    .picker-editor blockquote,
    .picker-editor pre,
    .picker-editor h1,
    .picker-editor h2,
    .picker-editor h3,
    .picker-editor h4,
    .picker-editor h5,
    .picker-editor h6 {
      margin: 0 0 .5em;
    }
    .picker-body > :last-child,
    .picker-editor > :last-child {
      margin-bottom: 0;
    }
    .picker-body ul,
    .picker-body ol,
    .picker-editor ul,
    .picker-editor ol {
      margin: 0 0 .5em;
      padding-inline-start: 1.5em;
    }
    .picker-body li,
    .picker-editor li {
      margin: 0;
    }
    /* Headings inside the picker are structure, not page chrome: keep them
       close to body size so a proofread of an h1 does not tower over the rest. */
    .picker-body h1,
    .picker-body h2,
    .picker-body h3,
    .picker-editor h1,
    .picker-editor h2,
    .picker-editor h3 {
      font-size: 1.05em;
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
      /* A <div> has no rows attribute and no intrinsic text-box height, so
         these two are what make the resize handle above behave the way it did
         on the <textarea> this replaced: the floor gives an empty editor
         something to grab, and the scroll container is what a dragged-smaller
         box needs in order to keep its content reachable instead of spilling
         it over the toolbar below. */
      min-height: 6em;
      overflow: auto;
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
        this._originalHtml = '';
        this._newHtml = '';
        // The composition source: blocks, each holding its own hunks.
        this._blocks = [];
        // The same hunk objects, flat and in document order, shared BY
        // REFERENCE with _blocks so the indexed UI paths need no changes.
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
        // 'review' (pick per change) or 'edit' (free editing, contenteditable).
        this._mode = 'review';
        // The canonical HTML the editor opened on, while EDIT is active. Lets
        // leaving EDIT tell a real edit from a look-and-leave, and keep the
        // accept/reject choices in the second case. null outside EDIT.
        this._editSnapshot = null;
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
        // The user dragging the editor's resize handle changes the picker's
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

        // A contenteditable, not a <textarea>: see the REVIEW/EDIT section for
        // why that is safe here and what bounds it. role/aria-multiline are what
        // give an editable div the same semantics the textarea had for free.
        this._editor = document.createElement('div');
        this._editor.className = 'picker-editor';
        this._editor.setAttribute('contenteditable', 'true');
        this._editor.setAttribute('role', 'textbox');
        this._editor.setAttribute('aria-multiline', 'true');
        this._editor.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_picker_editor'));
        this._root.appendChild(this._editor);

        // THE BOUNDARY THAT MAKES contenteditable ACCEPTABLE. Left alone, both
        // gestures hand the editor the source's raw DOM - styles, scripts,
        // whatever the page had - and that DOM would then be read straight back
        // out into the user's outgoing mail. Intercepted, each flavour goes
        // through the same allowlist as the answer: real markup through
        // sanitizeBlockHtml, plain text escaped by textToBlockHtml. A drop is a
        // paste by another gesture and gets the identical treatment; skipping
        // either one is skipping the whole boundary.
        this._editor.addEventListener('paste', (e) => {
            e.preventDefault();
            this._insertSanitized(e.clipboardData);
        });
        this._editor.addEventListener('drop', (e) => {
            e.preventDefault();
            this._insertSanitized(e.dataTransfer);
        });

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

        // The way out of EDIT, inline. In EDIT the overflow menu holds nothing
        // BUT this action - the stepper, the granularity toggle and both bulk
        // actions all operate on hunks and are hidden - so leaving it behind the
        // "..." made the only available command cost an extra click to find.
        // The menu copy stays for REVIEW, where it sits among the other actions
        // and has to read as one of them; exactly one of the two is ever visible
        // (see _syncModePlacement), so there is no duplicated action on screen.
        this._reviewBtn = this._makeToolbarButton('apiwebchat_picker_review', 'mzta-btn-secondary');
        this._reviewBtn.classList.add('picker-review-btn');
        this._reviewBtn.insertBefore(buildPencilIcon(15), this._reviewBtn.firstChild);
        this._reviewBtn.hidden = true;
        this._reviewBtn.addEventListener('click', () => this._setMode('review'));
        nav.appendChild(this._reviewBtn);

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
        // From _newHtml, not from the current composition: the granularity
        // switch re-compares the ORIGINAL against the ANSWER. Feeding the
        // composed text back in would make the answer's rejected parts
        // unreachable, turning a view setting into a destructive edit.
        this._rebuild(this._newHtml);
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
    // hatch: the current composition, freely editable.
    //
    // A CONTENTEDITABLE, over the <textarea> this replaced. The textarea's old
    // justification - contenteditable accepts pasted rich text, which breaks the
    // plain-text-only contract - died with that contract: both sides of the diff
    // are HTML now, so a plain-text editor was the one place the feature threw
    // away the very markup it exists to preserve.
    //
    // Three things bound what the editable surface can produce, and all three
    // are load-bearing:
    //
    //   - The SEGMENTER already normalizes arbitrary block HTML. Whatever DOM
    //     the browser's editing commands leave behind, _editorBlockHtml runs it
    //     through sanitize -> segment -> render, which is the same canonical
    //     shape _rebuild consumes from the answer. Nothing downstream has to
    //     trust the editor.
    //   - PASTE AND DROP ARE INTERCEPTED (see _buildChrome). They are the only
    //     way markup from outside can enter, so they are the only place the
    //     allowlist has to be applied on the way IN rather than on the way out.
    //   - styleWithCSS IS TURNED OFF, so Ctrl+B/I/U emit <b>/<i>/<u> instead of
    //     <span style>. Not cosmetic: the allowlist strips the style attribute,
    //     so under the default the shortcuts would silently do nothing.

    // The editor's content, in the pipeline's canonical form.
    //
    // sanitize (the security boundary) -> segment -> render is exactly what
    // _rebuild and composeResultBlocksHTML already emit, which is what lets the
    // unchanged-check in _setMode be a plain string comparison and keeps the
    // three readers of the editor from drifting apart.
    //
    // Gecko leaves a bare <br> behind in an emptied contenteditable. segmentBlocks
    // would drop the empty run it produces anyway, but the case is guarded
    // explicitly because "the editor is empty" is the one input where a wrong
    // answer writes a stray paragraph into the user's mail.
    _editorBlockHtml() {
        const raw = String(this._editor.innerHTML || '').trim();
        if (raw === '' || /^(?:<br\s*\/?>)+$/i.test(raw)) { return ''; }
        return renderBlocks(segmentBlocks(sanitizeBlockHtml(raw)));
    }

    // Insert a paste's or a drop's payload at the caret, allowlisted first.
    //
    // htmlToFragment is reused rather than re-implemented: it is the module's
    // single choke point for "sanitized HTML -> DOM", and this is precisely that
    // - the fragment here has been through sanitizeBlockHtml or was built by
    // textToBlockHtml, so it satisfies the same precondition every other caller
    // does.
    _insertSanitized(dt) {
        if (!dt) { return; }
        const html = dt.getData('text/html');
        // The html flavour when the source offered one, else the text flavour
        // escaped: a '<' the user copied out of a code sample is a literal
        // character, not markup.
        const frag = htmlToFragment(html
            ? sanitizeBlockHtml(html)
            : textToBlockHtml(dt.getData('text/plain') || ''));
        if (!frag.firstChild) { return; }

        // ShadowRoot.getSelection() is non-standard and Gecko does not implement
        // it, so in Thunderbird the document's selection is the live one - its
        // range endpoints do land on nodes inside the shadow tree for a caret the
        // user placed there. The ?? keeps the standard call first for engines
        // that do have it.
        const sel = this._root.getSelection?.() ?? document.getSelection();
        const range = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0) : null;

        // A caret that is not in the editor (or no caret at all - a drop can
        // arrive with the selection anywhere) has no meaningful insertion point,
        // so append instead of guessing. Never insert into a range outside the
        // editor: that would write sanitized-but-unexpected DOM into the picker's
        // own chrome.
        const anchor = range ? range.commonAncestorContainer : null;
        const inEditor = anchor && (anchor === this._editor || this._editor.contains(anchor));
        if (!inEditor) {
            this._editor.appendChild(frag);
            return;
        }

        range.deleteContents();
        // insertNode empties the fragment, so the node to collapse after has to
        // be captured before the call.
        const last = frag.lastChild;
        range.insertNode(frag);
        if (last) {
            range.setStartAfter(last);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

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
            // The composition WITH its markup, which is the whole point of the
            // editable surface: the user edits the formatted text rather than a
            // flattened transcript of it.
            //
            // Inserted through htmlToFragment (DOMParser + appendChild) rather
            // than .innerHTML: the Thunderbird review policy forbids live-DOM
            // .innerHTML writes, and setHTML() would need TB 148+ while this
            // add-on supports 140. composeResultBlocksHTML's output is built
            // from already-sanitized blocks, so the helper's precondition holds
            // exactly as it does at every other render site here.
            this._editor.replaceChildren(htmlToFragment(composeResultBlocksHTML(this._blocks)));
            // Remembered so leaving can tell "edited" from "looked and left".
            //
            // Read back through _editorBlockHtml() rather than off innerHTML
            // directly, so BOTH sides of the comparison on the way out are the
            // output of the same function. Taking it from innerHTML would assume
            // the browser's readback is byte-identical to what sanitize ->
            // segment -> render produces from it; any difference at all - a
            // normalized void tag, attribute order - would make an untouched
            // editor compare unequal and silently re-diff, throwing away the
            // choices this snapshot exists to protect.
            this._editSnapshot = this._editorBlockHtml();
            if (h > 0) { this._editor.style.height = h + 'px'; }
            this._mode = 'edit';
            this.setAttribute('mode', 'edit');
            // Off, so Ctrl+B/I/U emit <b>/<i>/<u> and not <span style> - which
            // the allowlist strips, making the shortcuts look broken. Here and
            // not in the constructor: the command is document-global and only
            // means anything once an editable surface exists. It is legacy API,
            // hence the guard - if it is ever removed the editor still works,
            // only the keyboard shortcuts lose their formatting.
            try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* not fatal */ }
            // Warn before it happens, not after: coming back from a CHANGED
            // editor re-diffs and discards the accept/reject choices.
            this._showNote('apiwebchat_picker_edit_hint');
        } else {
            this._mode = 'review';
            this.removeAttribute('mode');
            const edited = this._editorBlockHtml();
            if (edited === this._editSnapshot) {
                // Opened and closed without changing anything. Re-diffing here
                // would reset every accept/reject choice in exchange for nothing
                // at all - the text is the one the choices were made against, so
                // the existing blocks are still exactly right. Both sides of this
                // comparison are canonical renderBlocks output, so the browser's
                // own cosmetic editing noise normalizes away rather than reading
                // as an edit.
                this._noteEl.hidden = true;
                this._noteEl.textContent = '';
                this._renderAll();
                this._updateCounter();
            } else {
                // Re-diff the edited HTML against the ORIGINAL. This resets every
                // choice to accepted - see the comment on _rebuild. _rebuild also
                // resets the note, clearing the edit hint.
                this._rebuild(edited);
            }
            this._editSnapshot = null;
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
        // Which copy of the action is live - inline in EDIT, in the menu in
        // REVIEW. Before _updateCounter, so the counter's own visibility pass
        // sees the final state of the row.
        this._syncModePlacement();
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

    // Both sides are HTML. The picker keeps the answer's formatting, and takes
    // the original's from selection_html / body_html so that REJECTING a change
    // restores the original's own markup, not just its words.
    setContent(originalHtml, newHtml) {
        this._originalHtml = originalHtml == null ? '' : String(originalHtml);
        this._newHtml = newHtml == null ? '' : String(newHtml);
        // New content always arrives for review: opening straight into the
        // editor would hide the changes the button was clicked to see.
        this._mode = 'review';
        this.removeAttribute('mode');
        this._editor.replaceChildren();
        this._editSnapshot = null;
        this._rebuild(this._newHtml);
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
    _rebuild(newHtml) {
        // _blocks is the composition source; _hunks is the SAME hunk objects in
        // document order. Every indexed consumer (_renderHunk, _chooseSide,
        // _moveCurrent, the keyboard handler) keeps working on the flat array
        // untouched, because the objects are shared by reference - mutating
        // hunk.state through _hunks is mutating it in _blocks.
        this._blocks = buildHunks(this._originalHtml, newHtml, this._granularity);
        this._currentIdx = -1;

        if (this._blocks === null) {
            // The diff aborted. Nothing trustworthy to show, and composing a
            // result would be a guess, so say so and fall back to the answer.
            const blocks = segmentBlocks(newHtml);
            this._blocks = blocks.map((b, i) => ({
                kind: 'context',
                tag: b.tag,
                listType: b.listType,
                oldSep: b.sep,
                newSep: b.sep,
                hunks: [{
                    id: i,
                    type: 'context',
                    oldText: b.text,
                    newText: b.text,
                    oldHtml: b.html,
                    newHtml: b.html,
                    state: 'accepted',
                }],
            }));
            this._showNote('apiwebchat_picker_diff_failed');
        } else if (!hasChanges(this._blocks)) {
            // A single context hunk would otherwise render as a bare paragraph
            // under a "0 of 0 changes accepted" toolbar.
            this._showNote('apiwebchat_picker_no_changes');
        } else {
            this._noteEl.hidden = true;
            this._noteEl.textContent = '';
        }

        this._hunks = flatHunks(this._blocks);

        this._renderAll();
        this._updateCounter();
    }

    _showNote(i18nKey) {
        this._noteEl.textContent = browser.i18n.getMessage(i18nKey);
        this._noteEl.hidden = false;
    }

    // Render the blocks as REAL block elements, with each block's hunks inside
    // it, so the picker shows the structure it is going to produce instead of
    // the flat wall of text the plain-text model could only manage.
    //
    // _hunkEls / _sideEls / _interactive stay FLAT and globally indexed across
    // every block. That is deliberate and load-bearing: _renderHunk,
    // _chooseSide, _moveCurrent, _focusActiveSide and the keyboard handler are
    // pure index lookups and need no knowledge of blocks at all. Only this
    // method knows the nesting exists.
    _renderAll() {
        this._bodyEl.textContent = '';
        this._hunkEls = [];
        this._sideEls = [];
        this._interactive = [];

        let index = 0;
        let openList = null;   // the <ul>/<ol> currently collecting <li> blocks

        for (const block of (this._blocks || [])) {
            let host;
            if (block.tag === 'li') {
                const type = block.listType || 'ul';
                if (!openList || openList.tagName.toLowerCase() !== type) {
                    openList = document.createElement(type);
                    this._bodyEl.appendChild(openList);
                }
                host = document.createElement('li');
                openList.appendChild(host);
            } else {
                openList = null;
                host = document.createElement(block.tag);
                this._bodyEl.appendChild(host);
            }

            for (const hunk of block.hunks) {
                const span = document.createElement('span');
                this._hunkEls.push(span);
                this._sideEls.push(null);
                host.appendChild(span);

                if (hunk.type === 'context') {
                    // Already sanitized by segmentBlocks, so this renders the
                    // answer's own inline markup rather than escaping it.
                    //
                    // Always the new side, where composeResult consults
                    // contextSide(). The two agree except in one cosmetic case:
                    // a context hunk inside a replace block whose sides marked
                    // the SAME words up differently, with every change in that
                    // block rejected - the picker shows the answer's emphasis
                    // while the composed result carries the original's. Making
                    // this dynamic would mean rebuilding context DOM on every
                    // toggle, which is exactly what the surgical re-render (and
                    // the focus and tab order that ride on it) exists to avoid.
                    span.appendChild(htmlToFragment(hunk.newHtml));
                    index++;
                    continue;
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
                index++;
            }
        }
    }

    // One of the two versions of a change. `which` is 'old' (the original, red)
    // or 'new' (the answer's replacement, green). Clicking it keeps that side.
    _buildSide(index, which) {
        const hunk = this._hunks[index];
        const text = (which === 'old') ? hunk.oldText : hunk.newText;
        const html = (which === 'old') ? hunk.oldHtml : hunk.newHtml;

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
            // The hunk's own markup, so each side is shown the way it would be
            // written into the mail. Sanitized upstream by segmentBlocks; the
            // aria-label below deliberately stays on the plain text.
            side.appendChild(htmlToFragment(html));
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
        const { accepted, total } = countChanges(this._blocks);
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

    // "Back to changes" is inline in EDIT and in the menu in REVIEW - never in
    // both, or the same action would appear twice. Same two-copy shape as
    // "Reject all" above, driven by mode rather than by width.
    //
    // The overflow button goes with it: in EDIT the menu would otherwise open
    // holding a single hidden item and nothing else, which reads as a broken
    // control. Closing the menu here matters because the mode switch can happen
    // while it is open - the item the user just clicked lives in it.
    _syncModePlacement() {
        const editing = (this._mode === 'edit');
        this._reviewBtn.hidden = !editing;
        this._modeBtn.hidden = editing;
        this._overflowEl.hidden = editing;
        if (editing) { this._setMenuOpen(false); }
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
        // sits. Escape is not text, so the editor has no claim on it either.
        if (e.key === 'Escape' && this._menuOpen) {
            e.preventDefault();
            this._setMenuOpen(false);
            this._overflowBtn.focus();
            return;
        }
        // A real text input keeps every key, j and k included: they are text
        // there. The EDIT box is no longer one of these - it is a contenteditable
        // div - so keys typed in it are covered by the mode guard below instead.
        const target = e.composedPath()[0];
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) { return; }
        // Nothing to navigate or toggle in EDIT mode. This now carries the editor
        // itself as well as the case it was written for: focus sitting on a
        // toolbar button while editing, where j/k/arrows must not act either.
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
    // Reading the editor directly is what makes "Use this answer" and Copy work
    // straight from EDIT without forcing a trip back through REVIEW.
    //
    // In EDIT the projection is derived from the SAME normalized html
    // composeResultHTML() returns, one line per block, exactly as composeResult
    // does in REVIEW. Deliberately not innerText: two projections of the editor
    // that merely looked equivalent would let Copy and the inserted mail
    // disagree - the very drift block.text is read back out of block.html to
    // avoid - and innerText additionally depends on layout, which is the wrong
    // thing to depend on for an element the mode switch is about to hide.
    composeResultText() {
        if (this._mode === 'edit') {
            return segmentBlocks(this._editorBlockHtml()).map(b => b.text).join('\n');
        }
        return composeResult(this._blocks);
    }

    // The HTML written back into the mail. Both modes emit sanitized block HTML;
    // only the source differs.
    //
    // In REVIEW this walks the blocks, so the chosen side's MARKUP comes with
    // it - the whole point of the block model. escapeHtml is not used on this
    // path: the hunks' html already went through sanitizeInlineHtml, and
    // escaping it here would escape the very tags being preserved.
    //
    // In EDIT it is the editor's own content, put through the same
    // sanitize -> segment -> render pipeline, so the user's formatting survives
    // and the output is the same canonical shape either way - which is what
    // keeps the downstream plain-text conversion on one code path.
    composeResultHTML() {
        if (this._mode === 'edit') { return this._editorBlockHtml(); }
        return composeResultBlocksHTML(this._blocks);
    }
}

customElements.define('diff-picker', DiffPicker);
