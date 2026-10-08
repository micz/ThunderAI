// The diff picker driven directly: <diff-picker> elements created in the opened chat window (its
// module defines the element), fed an original and an answer with setGranularity() + setContent(),
// and used through their own controls, as spec 07 describes them. No worker message is involved.
//
// Spec 07 "The hunk model" (both sides of a change, every change accepted by default), "The
// `composeResult` invariant" (accept all = renderBlocks(segmentBlocks(answer)), reject all =
// renderBlocks(segmentBlocks(original)), on a table of cases, at both granularities; P1, segment ->
// render a fixed point), "Normalization, and what the invariant is really against" (a
// whitespace-only rewrite: zero changes), "Block-structured HTML" (nested lists flattened one level),
// "Line breaks: `<br>` is a block separator" (the pinned round trips; Body Text mode pairing line by
// line), "Into a plain text compose window" (p/li-wrapped output, <br> only inside a block), "The
// sanitizer is a security boundary" (every payload as the answer and as the original: the picker,
// both results and the editor), "`composeResultHTML()` and escaping", "UI" (sides, radio semantics,
// click keeps a side, idempotent; the keyboard), "The toolbar" (status copy, the stepper as the
// position readout, clamped; the overflow menu; bulk actions), "Two CSS traps in this shadow root"
// (its "Zero-changes state" paragraph), "Surgical re-render", "REVIEW and EDIT modes" (the host's
// mode attribute; paste and drop sanitized; setContent() forcing REVIEW), "`composeResultText()` is
// mode-aware", "EDIT → REVIEW re-diffs only if the text actually changed", "What is hidden in EDIT",
// "Granularity".
//
// The picker module's own renderBlocks()/segmentBlocks() are the terms the invariant is stated in
// (spec 07 states it against them), so they are imported as the oracle for the invariant only; every
// other expectation comes from the spec. Each test builds its own picker unless it says otherwise.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { loadFixture } from '../../helpers/core/load.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import { openWebchat } from '../../webchat/webchat-page.mjs';
import {
    allowlistProblems,
    executableProblems,
    htmlProblems,
} from '../../webchat/safety.mjs';

const { ctx } = await openWebchat({ local: { chat_show_usage_data: false } });
after(() => ctx.close());
const k = webchatTests('15');
// The module the page imported: the same instance (same url), for the invariant's own terms.
const DP = await import(new URL('../../../api_webchat/diffPicker.js', import.meta.url).href);
const { payloads } = loadFixture('sanitizer-payloads.json', 'webchat');

const S_HUNK = 'spec 07 "The hunk model"';
const S_INV = 'spec 07 "The `composeResult` invariant"';
const S_NORM = 'spec 07 "Normalization, and what the invariant is really against"';
const S_BLOCK = 'spec 07 "Block-structured HTML"';
const S_BR = 'spec 07 "Line breaks: `<br>` is a block separator"';
const S_PLAIN = 'spec 07 "Into a plain text compose window"';
const S_SAN = 'spec 07 "The sanitizer is a security boundary"';
const S_ESC = 'spec 07 "`composeResultHTML()` and escaping"';
const S_UI = 'spec 07 "UI"';
const S_TOOL = 'spec 07 "The toolbar"';
const S_ZERO = 'spec 07 "Two CSS traps in this shadow root"';
const S_SURG = 'spec 07 "Surgical re-render"';
const S_MODES = 'spec 07 "REVIEW and EDIT modes"';
const S_TEXT = 'spec 07 "`composeResultText()` is mode-aware"';
const S_E2R = 'spec 07 "EDIT → REVIEW re-diffs only if the text actually changed"';
const S_HIDDEN = 'spec 07 "What is hidden in EDIT"';
const S_GRAN = 'spec 07 "Granularity"';

const msg = (key, subs) => ctx.ctl.browser.i18n.getMessage(key, subs);

// ---- driving a picker -------------------------------------------------------------------

function makePicker(original, answer, granularity = 'words') {
    const p = ctx.document.createElement('diff-picker');
    ctx.document.body.appendChild(p);
    p.setGranularity(granularity);
    p.setContent(original, answer);
    return p;
}
const pq = (p, sel) => p.shadowRoot.querySelector(sel);
const pqa = (p, sel) => [...p.shadowRoot.querySelectorAll(sel)];
const hunks = p => pqa(p, '.picker-body .hunk');
const side = (p, i, which) => hunks(p)[i].querySelector('.hunk-side-' + which);
const counter = p => pq(p, '.picker-counter').textContent;
const stepLabel = p => pq(p, '.picker-step-label').textContent;
const active = p => hunks(p).map(h => h.querySelector('.is-active').classList.contains('hunk-side-new') ? 'new' : 'old');
const shown = el => !el.hidden && !el.closest('[hidden]');
async function openMenu(p) {
    if (pq(p, '.picker-overflow-btn').getAttribute('aria-expanded') !== 'true') await ctx.click(pq(p, '.picker-overflow-btn'));
}
const menuItem = (p, key) => pqa(p, '.picker-menu [role^="menuitem"]').find(b => b.getAttribute('aria-label') === msg(key));
async function acceptAll(p) { await openMenu(p); await ctx.click(menuItem(p, 'apiwebchat_picker_accept_all')); }
async function rejectAll(p) { await ctx.click(pq(p, '.picker-reject-btn')); }
async function toEdit(p) { await openMenu(p); await ctx.click(pq(p, '.picker-mode-btn')); }
async function toReview(p) { await ctx.click(pq(p, '.picker-review-btn')); }
const key = (el, k2, init = {}) => ctx.fire(el, 'keydown', { key: k2, composed: true, ...init });
const focused = p => p.shadowRoot.activeElement;
const canon = html => DP.renderBlocks(DP.segmentBlocks(html));

// ---- the invariant ----------------------------------------------------------------------

const CASES = [
    { id: 'words', why: 'a word changed, a block added to', o: '<p>Dear Sir,</p><p>I hope you are fine.</p><p>Best</p>', n: '<p>Dear Sir,</p><p>I hope you are well.</p><p>Best regards</p>' },
    { id: 'markup-and-words', why: 'the same words marked up differently, next to a changed word', o: '<p>Dear <b>Sir</b>, see you</p>', n: '<p>Dear Sir, see you soon</p>' },
    { id: 'markup-only', why: 'a block whose only difference is its markup', o: '<p>Dear <b>Sir</b>,</p><p>Hello</p>', n: '<p>Dear Sir,</p><p>Hello there</p>' },
    { id: 'br-lines', why: 'lines carried by <br> in one wrapper vs paragraphs', o: '<div>Line one<br>Line two<br><br>Para two</div>', n: '<p>Line one<br>Line 2</p><p>Para two</p>' },
    { id: 'lists', why: 'a list changing type and items', o: '<ul><li>alpha</li><li>beta</li></ul>', n: '<ol><li>alpha</li><li>gamma</li><li>delta</li></ol>' },
    { id: 'tag-change', why: 'the same words in a heading instead of a paragraph', o: '<p>Hello world</p><p>Bye</p>', n: '<h2>Hello world</h2><p>Bye now</p>' },
    { id: 'to-list', why: 'a paragraph turned into a list item', o: '<p>first item here</p>', n: '<ul><li>first item there</li></ul>' },
    { id: 'insert-delete', why: 'a block removed and one added', o: '<p>A one</p><p>B two</p><p>C three</p>', n: '<p>A one</p><p>C three</p><p>D four</p>' },
    { id: 'entities', why: 'escaped characters in the changed text', o: '<p>Tom &amp; Jerry &lt;3 you</p>', n: '<p>Tom &amp; Jerry &lt;4 you</p>' },
    { id: 'nested-br', why: 'a <br> nested in an inline element stays within its run', o: '<p><em>a<br>b</em> c</p>', n: '<p><em>a<br>b</em> d</p>' },
    { id: 'sentences', why: 'three reworded sentences, two changes each', o: '<p>One is here, as usual. Two is there, as planned. Three is everywhere, as expected.</p>', n: '<p>One was here, as always. Two was there, as agreed. Three was everywhere, as hoped.</p>' },
];

for (const c of CASES) {
    for (const g of ['words', 'sentences']) {
        k.test(`inv-accept-${c.id}-${g}`, S_INV, `${c.id} (${c.why}), ${g}: every change accepted (the default) gives the answer, normalized`, () => {
            const p = makePicker(c.o, c.n, g);
            assert.equal(p.composeResultHTML(), canon(c.n));
        });
        k.test(`inv-reject-${c.id}-${g}`, S_INV, `${c.id} (${c.why}), ${g}: every change rejected gives the original, normalized`, async () => {
            const p = makePicker(c.o, c.n, g);
            await rejectAll(p);
            assert.equal(p.composeResultHTML(), canon(c.o));
        });
    }
    k.test(`inv-text-${c.id}`, S_INV, `${c.id}: rejected, the plain-text result is the original's blocks, one per line`, async () => {
        const p = makePicker(c.o, c.n);
        await rejectAll(p);
        assert.equal(p.composeResultText(), DP.segmentBlocks(c.o).map(b => b.text).join('\n'));
    });
}

k.test('markup-only-choice', S_INV, 'the same words marked up differently are a change of their own: both sides on screen, each with its own markup, the original pickable', async () => {
    const p = makePicker('<p>Dear <b>Sir</b>,</p>', '<p>Dear Sir,</p>');
    assert.equal(hunks(p).length, 1);
    assert.equal(side(p, 0, 'old').querySelector('b')?.textContent, 'Sir');
    assert.equal(side(p, 0, 'new').querySelector('b'), null);
    assert.equal(side(p, 0, 'old').textContent, side(p, 0, 'new').textContent);
    await ctx.click(side(p, 0, 'old'));
    assert.equal(p.composeResultHTML(), '<p>Dear <b>Sir</b>,</p>');
});

k.test('wrapper-follows-side', S_INV, 'a block keeps the wrapper of the side it shows: the original\'s words rejected back into their <div>, an accepted neighbour in the answer\'s <p>', async () => {
    const p = makePicker('<div>one two</div><div>three four</div>', '<p>one too</p><p>three for</p>');
    await ctx.click(side(p, 0, 'old'));
    assert.equal(p.composeResultHTML(), '<div>one two</div><p>three for</p>');
});

k.test('p1-fixed-point', S_INV, 'P1: segment -> render is a normalization, so a second pass changes nothing, on every side of every case', () => {
    for (const html of CASES.flatMap(c => [c.o, c.n])) {
        assert.equal(canon(canon(html)), canon(html), html);
    }
});

// ---- line breaks and blocks --------------------------------------------------------------

k.test('br-round-trip', S_BR, '<p>a<br>b</p> comes back as <p>a<br>b</p>: a single <br> re-joins the run into one wrapper', () => {
    assert.equal(canon('<p>a<br>b</p>'), '<p>a<br>b</p>');
});

k.test('br-blank-line', S_BR, '<p>a<br><br>b</p> comes back as <p>a</p><p>b</p>: a blank line is a paragraph break', () => {
    assert.equal(canon('<p>a<br><br>b</p>'), '<p>a</p><p>b</p>');
});

k.test('br-trailing', S_BR, 'a trailing <br> leaves nothing pointing at a successor: <p>a<br></p> is <p>a</p>', () => {
    assert.equal(canon('<p>a<br></p>'), '<p>a</p>');
});

k.test('br-body-level', S_BR, 'at body level one <br> joins two lines in one paragraph, two make a paragraph break', () => {
    assert.equal(canon('a<br>b'), '<p>a<br>b</p>');
    assert.equal(canon('a<br><br>b'), '<p>a</p><p>b</p>');
});

k.test('br-not-a-wrapper', S_BR, '<br> is a separator, never emitted as a wrapper: no </br> in any output', () => {
    for (const html of CASES.flatMap(c => [c.o, c.n])) assert.doesNotMatch(canon(html), /<\/br>/i);
});

k.test('br-pairs-lines', S_BR, 'Body Text mode (lines as <br> in one <div>) against a paragraph answer pairs line by line: one change, not every line', () => {
    const p = makePicker('<div>Hello Bob<br>How are you<br>Bye</div>', '<p>Hello Bob<br>How are you doing<br>Bye</p>');
    assert.equal(hunks(p).length, 1);
    assert.match(side(p, 0, 'new').textContent, /doing/);
});

k.test('nested-list-flat', S_BLOCK, 'nested lists are flattened one level: the inner item becomes an item of the inner list\'s type', () => {
    const blocks = DP.segmentBlocks('<ul><li>outer<ol><li>inner</li></ol></li></ul>');
    assert.deepEqual(blocks.map(b => [b.tag, b.listType, b.text]), [['li', 'ul', 'outer'], ['li', 'ol', 'inner']]);
});

k.test('plain-compose-shape', S_PLAIN, 'composeResultHTML() emits <p>/<li>-wrapped blocks, with <br> only inside a block', () => {
    const p = makePicker(CASES[3].o, CASES[3].n);
    const doc = new ctx.window.DOMParser().parseFromString(p.composeResultHTML(), 'text/html');
    for (const el of doc.body.children) assert.ok(['p', 'ul', 'ol'].includes(el.localName), el.outerHTML);
    for (const br of doc.body.querySelectorAll('br')) assert.notEqual(br.parentElement, doc.body);
    assert.ok(doc.body.querySelector('p br'), 'the answer\'s line break survives inside its block');
});

// ---- normalization and the zero-changes state ------------------------------------------------

const ZERO = () => makePicker('<p>one two</p>', '<p>one    two</p>');

k.test('whitespace-zero', S_NORM, 'a whitespace-only rewrite ("one two" vs "one    two") is zero changes', () => {
    assert.equal(hunks(ZERO()).length, 0);
});

k.test('zero-state', S_ZERO, 'zero changes: a muted note instead of "0 of 0", no status, stepper or bulk actions; the granularity toggle and Use stay', () => {
    const p = ZERO();
    assert.ok(shown(pq(p, '.picker-note')));
    assert.equal(pq(p, '.picker-note').textContent, msg('apiwebchat_picker_no_changes'));
    assert.equal(shown(pq(p, '.picker-status')), false);
    assert.equal(shown(pq(p, '.picker-stepper')), false);
    assert.equal(shown(pq(p, '.picker-reject-btn')), false);
    assert.equal(pq(p, '.picker-menu [role="menuitem"]').hidden, true, 'Accept all');
    assert.ok(shown(pq(p, '.picker-gran')));
    assert.ok(shown(pq(p, '.picker-use-btn')));
    assert.equal(p.composeResultHTML(), '<p>one two</p>');
});

// ---- the sanitizer, on both sides ----------------------------------------------------------

const chrome = el => el.matches('.hunk, .hunk-side');
const markerOnly = el => el.matches('.hunk-marker');
for (const pl of payloads) {
    for (const [where, o, n] of [['answer', '<p>Plain original text.</p>', pl.html], ['original', pl.html, '<p>Plain answer text.</p>']]) {
        k.test(`san-${where}-${pl.id}`, S_SAN, `${pl.id} as the ${where}: the picker, both results and the editor hold nothing outside the allowlist, nothing executable`, async () => {
            const p = makePicker(o, n);
            assert.deepEqual(executableProblems(p), []);
            assert.deepEqual(allowlistProblems(pq(p, '.picker-body'), { transparent: chrome, skip: markerOnly }), []);
            assert.deepEqual(htmlProblems(ctx.window, p.composeResultHTML()), []);
            if (hunks(p).length) await rejectAll(p);
            assert.deepEqual(htmlProblems(ctx.window, p.composeResultHTML()), []);
            await toEdit(p);
            assert.deepEqual(htmlProblems(ctx.window, pq(p, '.picker-editor').innerHTML), []);
            assert.deepEqual(htmlProblems(ctx.window, p.composeResultHTML()), []);
            p.remove();
        });
    }
}

function pasteEvent(type, data) {
    const ev = new ctx.window.Event(type, { bubbles: true, cancelable: true, composed: true });
    const dt = { getData: t => data[t] ?? '' };
    Object.defineProperty(ev, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: dt });
    return ev;
}

k.test('paste-html', S_MODES, 'a paste is intercepted: its text/html goes through the allowlist before reaching the editor', async () => {
    const p = makePicker('<p>a b</p>', '<p>a c</p>');
    await toEdit(p);
    const ed = pq(p, '.picker-editor');
    const ev = pasteEvent('paste', { 'text/html': '<p>Pasted <img src=x onerror="window.__pwned=1"> <b>bold</b><script>x()</script></p>' });
    ed.dispatchEvent(ev);
    await ctx.settle();
    assert.equal(ev.defaultPrevented, true);
    assert.equal(ed.querySelector('img, script'), null);
    assert.equal(ed.querySelector('b')?.textContent, 'bold');
    assert.deepEqual(executableProblems(ed), []);
});

k.test('paste-text', S_MODES, 'a plain-text paste is escaped: a "<b>" the user copied is a literal, in a block of its own', async () => {
    const p = makePicker('<p>a b</p>', '<p>a c</p>');
    await toEdit(p);
    const ed = pq(p, '.picker-editor');
    ed.dispatchEvent(pasteEvent('paste', { 'text/plain': 'see <b>this</b>' }));
    await ctx.settle();
    assert.equal(ed.querySelector('b'), null);
    assert.ok(ed.textContent.includes('see <b>this</b>'), ed.innerHTML);
});

k.test('drop-sanitized', S_MODES, 'a drop gets the same treatment as a paste', async () => {
    const p = makePicker('<p>a b</p>', '<p>a c</p>');
    await toEdit(p);
    const ed = pq(p, '.picker-editor');
    const ev = pasteEvent('drop', { 'text/html': '<p><a href="javascript:window.__pwned=1" onclick="x()">dropped</a></p>' });
    ed.dispatchEvent(ev);
    await ctx.settle();
    assert.equal(ev.defaultPrevented, true);
    assert.match(ed.textContent, /dropped/);
    assert.deepEqual(executableProblems(ed), []);
});

// ---- escaping -------------------------------------------------------------------------------

k.test('escaping', S_ESC, 'composeResultHTML() keeps the tags and encodes the text exactly once: no &amp;lt;', async () => {
    const p = makePicker('<p>5 &lt; 6 &amp; <b>7</b> ok</p>', '<p>5 &lt; 6 &amp; <b>7</b> fine</p>');
    const accepted = p.composeResultHTML();
    assert.match(accepted, /5 &lt; 6 &amp; <b>7<\/b> fine/);
    assert.doesNotMatch(accepted, /&amp;lt;|&amp;amp;/);
    await rejectAll(p);
    assert.match(p.composeResultHTML(), /5 &lt; 6 &amp; <b>7<\/b> ok/);
});

// ---- the review UI: one picker, the tests in order --------------------------------------------

const U = makePicker(
    '<p>Alpha one two.</p><p>Beta three.</p><p>Gamma.</p>',
    '<p>Alpha one too.</p><p>Beta three four.</p><p>Delta.</p>');

k.test('two-sides', S_UI, 'each change shows both versions, the original then the answer\'s, the answer\'s in force by default', () => {
    assert.equal(hunks(U).length, 3);
    for (const h of hunks(U)) {
        const sides = [...h.children].filter(c => c.classList.contains('hunk-side'));
        assert.deepEqual(sides.map(s => s.classList.contains('hunk-side-old') ? 'old' : 'new'), ['old', 'new']);
    }
    assert.deepEqual(active(U), ['new', 'new', 'new']);
    for (const h of hunks(U)) assert.ok(h.querySelector('.hunk-side-old').classList.contains('is-inactive'));
});

k.test('default-accepted', S_HUNK, 'every change starts accepted, so a user who touches nothing gets the answer', () => {
    assert.equal(U.composeResultHTML(), canon('<p>Alpha one too.</p><p>Beta three four.</p><p>Delta.</p>'));
});

k.test('empty-side', S_UI, 'a pure insertion still renders its empty original side, as a dimmed placeholder', () => {
    const old = side(U, 1, 'old');
    assert.ok(old.classList.contains('is-empty'));
    assert.ok(old.querySelector('.hunk-marker'));
    assert.equal(old.getAttribute('aria-label'), msg('apiwebchat_picker_side_empty_inactive'));
});

k.test('radio', S_UI, 'each side is a focusable radio whose aria-checked says which is in force, with a descriptive label', () => {
    const [o, n] = [side(U, 0, 'old'), side(U, 0, 'new')];
    for (const s of [o, n]) {
        assert.equal(s.getAttribute('role'), 'radio');
        assert.equal(s.getAttribute('tabindex'), '0');
    }
    assert.equal(o.getAttribute('aria-checked'), 'false');
    assert.equal(n.getAttribute('aria-checked'), 'true');
    assert.equal(n.getAttribute('aria-label'), msg('apiwebchat_picker_side_new_active', [n.textContent]));
    assert.equal(o.getAttribute('aria-label'), msg('apiwebchat_picker_side_old_inactive', [o.textContent]));
});

k.test('status-all', S_TOOL, 'the status reads "All 3 changes accepted"; the counter is aria-live, the progress bar aria-hidden', () => {
    assert.equal(counter(U), msg('apiwebchat_picker_counter_all', ['3']));
    assert.equal(pq(U, '.picker-counter').getAttribute('aria-live'), 'polite');
    assert.equal(pq(U, '.picker-progress').getAttribute('aria-hidden'), 'true');
});

k.test('stepper-total', S_TOOL, 'before any navigation the stepper shows the total alone, not "0 / 3"', () => {
    assert.equal(stepLabel(U), '3');
});

k.test('next', S_TOOL, 'Next moves to the first change: "1 / 3", Previous disabled, the focus on the side in force', async () => {
    await ctx.click(pq(U, '.picker-step-next'));
    assert.equal(stepLabel(U), msg('apiwebchat_picker_step_short', ['1', '3']));
    assert.equal(pq(U, '.picker-step-prev').disabled, true);
    assert.equal(focused(U), side(U, 0, 'new'));
});

k.test('clamped', S_TOOL, 'Previous and Next are clamped, not wrapping: at the last change Next is disabled and stays there', async () => {
    await ctx.click(pq(U, '.picker-step-next'));
    await ctx.click(pq(U, '.picker-step-next'));
    assert.equal(stepLabel(U), msg('apiwebchat_picker_step_short', ['3', '3']));
    assert.equal(pq(U, '.picker-step-next').disabled, true);
    await ctx.click(pq(U, '.picker-step-next'));
    assert.equal(stepLabel(U), msg('apiwebchat_picker_step_short', ['3', '3']));
});

k.test('keys-move', S_UI, 'k / ArrowLeft move back, j / ArrowRight forward, the focus on the side in force', async () => {
    await key(focused(U), 'k');
    assert.equal(stepLabel(U), msg('apiwebchat_picker_step_short', ['2', '3']));
    await key(focused(U), 'ArrowLeft');
    assert.equal(stepLabel(U), msg('apiwebchat_picker_step_short', ['1', '3']));
    assert.equal(focused(U), side(U, 0, 'new'));
    await key(focused(U), 'j');
    await key(focused(U), 'ArrowRight');
    assert.equal(stepLabel(U), msg('apiwebchat_picker_step_short', ['3', '3']));
    assert.equal(focused(U), side(U, 2, 'new'));
});

k.test('keys-modified', S_UI, 'a modified key (Ctrl) is left to the browser', async () => {
    await key(focused(U), 'k', { ctrlKey: true });
    assert.equal(stepLabel(U), msg('apiwebchat_picker_step_short', ['3', '3']));
});

let before = null;
k.test('click-keeps', S_UI, 'clicking a side keeps it: the original of the first change, "2 of 3 changes accepted"', async () => {
    before = [...U.shadowRoot.querySelectorAll('*')];
    await ctx.click(side(U, 0, 'old'));
    assert.deepEqual(active(U), ['old', 'new', 'new']);
    assert.equal(counter(U), msg('apiwebchat_picker_counter', ['2', '3']));
    assert.match(U.composeResultHTML(), /Alpha one two\./);
});

k.test('surgical', S_SURG, 'a choice creates and destroys no DOM: the same elements, only reclassified', () => {
    assert.deepEqual([...U.shadowRoot.querySelectorAll('*')], before);
});

k.test('idempotent', S_UI, 'clicking the side already in force does nothing', async () => {
    await ctx.click(side(U, 0, 'old'));
    assert.deepEqual(active(U), ['old', 'new', 'new']);
});

k.test('enter-inactive', S_UI, 'Enter on the inactive side selects it', async () => {
    side(U, 2, 'old').focus();
    await key(side(U, 2, 'old'), 'Enter');
    assert.deepEqual(active(U), ['old', 'new', 'old']);
});

k.test('space-active', S_UI, 'Space on the side in force flips to the other one, and the focus follows', async () => {
    side(U, 2, 'old').focus();
    await key(side(U, 2, 'old'), ' ');
    assert.deepEqual(active(U), ['old', 'new', 'new']);
    assert.equal(focused(U), side(U, 2, 'new'));
});

k.test('menu', S_TOOL, 'the overflow menu holds Accept all and Edit manually; Reject all stays inline on the wide layout', async () => {
    await openMenu(U);
    assert.equal(pq(U, '.picker-overflow-btn').getAttribute('aria-expanded'), 'true');
    const visible = pqa(U, '.picker-menu [role^="menuitem"]').filter(b => !b.hidden).map(b => b.getAttribute('aria-label'));
    assert.deepEqual(visible, [msg('apiwebchat_picker_accept_all'), msg('apiwebchat_picker_edit')]);
    assert.ok(shown(pq(U, '.picker-reject-btn')));
});

k.test('menu-escape', S_TOOL, 'Escape closes the menu', async () => {
    await key(pq(U, '.picker-overflow-btn'), 'Escape');
    assert.equal(pq(U, '.picker-menu').hidden, true);
    assert.equal(pq(U, '.picker-overflow-btn').getAttribute('aria-expanded'), 'false');
});

k.test('menu-outside', S_TOOL, 'a pointerdown outside the menu closes it, one inside does not', async () => {
    await openMenu(U);
    await ctx.fire(pq(U, '.picker-menu'), 'pointerdown', { composed: true });
    assert.equal(pq(U, '.picker-menu').hidden, false);
    await ctx.fire(ctx.document.body, 'pointerdown');
    assert.equal(pq(U, '.picker-menu').hidden, true);
});

k.test('reject-all', S_TOOL, 'Reject all puts every change on its original; it then disables itself, Accept all enabled', async () => {
    await rejectAll(U);
    assert.deepEqual(active(U), ['old', 'old', 'old']);
    assert.equal(counter(U), msg('apiwebchat_picker_counter', ['0', '3']));
    assert.equal(pq(U, '.picker-reject-btn').disabled, true);
    assert.equal(menuItem(U, 'apiwebchat_picker_accept_all').disabled, false);
});

k.test('accept-all', S_TOOL, 'Accept all puts every change on the answer: "All 3 changes accepted", Accept all disabled', async () => {
    await acceptAll(U);
    assert.deepEqual(active(U), ['new', 'new', 'new']);
    assert.equal(counter(U), msg('apiwebchat_picker_counter_all', ['3']));
    assert.equal(menuItem(U, 'apiwebchat_picker_accept_all').disabled, true);
    assert.equal(pq(U, '.picker-menu').hidden, true, 'the menu closes once an item fired');
});

// ---- EDIT mode on the same picker -------------------------------------------------------------

k.test('edit-open', S_MODES, 'Edit manually: the host carries mode="edit", the editor holds the current composition WITH its markup, and a note warns before anything is lost', async () => {
    await ctx.click(side(U, 0, 'old'));
    await toEdit(U);
    assert.equal(U.getAttribute('mode'), 'edit');
    const ed = pq(U, '.picker-editor');
    assert.equal(ed.getAttribute('contenteditable'), 'true');
    assert.equal(ed.innerHTML, '<p>Alpha one two.</p><p>Beta three four.</p><p>Delta.</p>');
    assert.equal(pq(U, '.picker-note').textContent, msg('apiwebchat_picker_edit_hint'));
    assert.ok(shown(pq(U, '.picker-note')));
});

k.test('edit-hidden', S_HIDDEN, 'in EDIT the context strip (status, progress, granularity), the stepper, the bulk actions and the "..." are hidden; "Back to changes" is inline; Use stays', () => {
    assert.equal(shown(pq(U, '.picker-context')), false);
    assert.equal(shown(pq(U, '.picker-stepper')), false);
    assert.equal(shown(pq(U, '.picker-reject-btn')), false);
    assert.equal(shown(pq(U, '.picker-overflow')), false);
    assert.ok(shown(pq(U, '.picker-review-btn')));
    assert.ok(shown(pq(U, '.picker-use-btn')));
});

k.test('edit-keys-ignored', S_UI, 'in EDIT j / k act on nothing', async () => {
    await key(pq(U, '.picker-editor'), 'j');
    await key(pq(U, '.picker-use-btn'), 'k');
    assert.equal(U.getAttribute('mode'), 'edit');
    assert.equal(pqa(U, '.is-current').length <= 1, true);
});

k.test('edit-text', S_TEXT, 'in EDIT composeResultText() is the editor\'s projection, one line per block, and composeResultHTML() its canonical form', () => {
    assert.equal(U.composeResultText(), 'Alpha one two.\nBeta three four.\nDelta.');
    assert.equal(U.composeResultHTML(), '<p>Alpha one two.</p><p>Beta three four.</p><p>Delta.</p>');
});

k.test('back-unchanged', S_E2R, 'back to REVIEW with nothing edited: no re-diff, the choices survive, the note goes', async () => {
    await toReview(U);
    assert.equal(U.hasAttribute('mode'), false);
    assert.deepEqual(active(U), ['old', 'new', 'new']);
    assert.equal(counter(U), msg('apiwebchat_picker_counter', ['2', '3']));
    assert.equal(shown(pq(U, '.picker-note')), false);
});

k.test('back-changed', S_E2R, 'back to REVIEW after an edit: re-diffed against the ORIGINAL, every change accepted again', async () => {
    await toEdit(U);
    const ed = pq(U, '.picker-editor');
    ed.lastElementChild.textContent = 'Delta and epsilon.';
    await toReview(U);
    assert.match(counter(U), /^All \d+ changes accepted$/);
    assert.equal(U.composeResultHTML(), canon('<p>Alpha one two.</p><p>Beta three four.</p><p>Delta and epsilon.</p>'));
    await rejectAll(U);
    assert.equal(U.composeResultHTML(), canon('<p>Alpha one two.</p><p>Beta three.</p><p>Gamma.</p>'),
        'after EDIT -> REVIEW, reject all still gives the original');
});

k.test('setcontent-review', S_MODES, 'setContent() always opens in REVIEW with an empty editor', async () => {
    await toEdit(U);
    U.setContent('<p>x y</p>', '<p>x z</p>');
    await ctx.settle();
    assert.equal(U.hasAttribute('mode'), false);
    assert.equal(pq(U, '.picker-editor').innerHTML, '');
    assert.equal(hunks(U).length, 1);
});

k.test('click-current', S_TOOL, 'choosing a side makes that change the current one: the stepper reads its position, and Next moves on from it', async () => {
    const p = makePicker('<p>Alpha one two.</p><p>Beta three.</p><p>Gamma.</p>', '<p>Alpha one too.</p><p>Beta three four.</p><p>Delta.</p>');
    assert.equal(pq(p, '.picker-step-label').textContent, '3');
    await ctx.click(side(p, 1, 'old'));
    assert.equal(pq(p, '.picker-step-label').textContent, msg('apiwebchat_picker_step_short', ['2', '3']));
    await ctx.click(pq(p, '.picker-step-next'));
    assert.equal(pq(p, '.picker-step-label').textContent, msg('apiwebchat_picker_step_short', ['3', '3']));
    assert.equal(focused(p), side(p, 2, 'new'));
    p.remove();
});

const rings = p => hunks(p).map(h => h.classList.contains('is-current'));

k.test('click-ring', S_TOOL, 'the current change carries the ring, alone: a click moves it there from where the arrows left it, and the next arrow moves it on', async () => {
    const p = makePicker('<p>Alpha one two.</p><p>Beta three.</p><p>Gamma.</p>', '<p>Alpha one too.</p><p>Beta three four.</p><p>Delta.</p>');
    await ctx.click(pq(p, '.picker-step-next'));
    assert.deepEqual(rings(p), [true, false, false]);
    await ctx.click(side(p, 2, 'old'));
    assert.deepEqual(rings(p), [false, false, true]);
    await ctx.click(pq(p, '.picker-step-prev'));
    assert.deepEqual(rings(p), [false, true, false]);
    p.remove();
});

k.test('click-active-current', S_TOOL, 'a click on the side already in force changes nothing in the text but still makes its change current: the stepper and the ring follow', async () => {
    const p = makePicker('<p>Alpha one two.</p><p>Beta three.</p><p>Gamma.</p>', '<p>Alpha one too.</p><p>Beta three four.</p><p>Delta.</p>');
    await ctx.click(pq(p, '.picker-step-next'));
    await ctx.click(pq(p, '.picker-step-next'));
    await ctx.click(side(p, 0, 'new'));
    assert.deepEqual(active(p), ['new', 'new', 'new']);
    assert.equal(pq(p, '.picker-step-label').textContent, msg('apiwebchat_picker_step_short', ['1', '3']));
    assert.equal(pq(p, '.picker-step-prev').disabled, true);
    assert.deepEqual(rings(p), [true, false, false]);
    p.remove();
});

k.test('enter-current', S_TOOL, 'Enter on a side is a choice too: its change becomes the current one', async () => {
    const p = makePicker('<p>Alpha one two.</p><p>Beta three.</p><p>Gamma.</p>', '<p>Alpha one too.</p><p>Beta three four.</p><p>Delta.</p>');
    side(p, 1, 'old').focus();
    await key(side(p, 1, 'old'), 'Enter');
    assert.equal(pq(p, '.picker-step-label').textContent, msg('apiwebchat_picker_step_short', ['2', '3']));
    assert.deepEqual(rings(p), [false, true, false]);
    p.remove();
});

// ---- granularity ------------------------------------------------------------------------------

const G = makePicker(CASES[10].o, CASES[10].n);
const gran = g => pqa(G, '.picker-gran [role="radio"]').find(b => b.dataset.granularity === g);

k.test('gran-radios', S_GRAN, 'a radiogroup of two radios, the starting one checked', () => {
    assert.equal(pq(G, '.picker-gran').getAttribute('role'), 'radiogroup');
    assert.equal(gran('words').getAttribute('aria-checked'), 'true');
    assert.equal(gran('sentences').getAttribute('aria-checked'), 'false');
});

let wordCount = 0;
k.test('gran-switch', S_GRAN, 'switching to Sentences re-diffs: three reworded sentences give three changes, fewer than by word, every choice reset to accepted', async () => {
    wordCount = hunks(G).length;
    await ctx.click(side(G, 0, 'old'));
    await ctx.click(gran('sentences'));
    assert.equal(gran('sentences').getAttribute('aria-checked'), 'true');
    assert.equal(hunks(G).length, 3);
    assert.ok(wordCount > 3, String(wordCount));
    assert.deepEqual(active(G), ['new', 'new', 'new']);
});

k.test('gran-same-noop', S_GRAN, 'clicking the position already selected is a no-op: the choices survive', async () => {
    await ctx.click(side(G, 1, 'old'));
    await ctx.click(gran('sentences'));
    assert.deepEqual(active(G), ['new', 'old', 'new']);
});

k.test('gran-from-answer', S_GRAN, 're-diffs from the answer, never from the composition: after reject all and a switch, accept all is the answer again', async () => {
    await rejectAll(G);
    await ctx.click(gran('words'));
    assert.equal(G.composeResultHTML(), canon(CASES[10].n));
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
