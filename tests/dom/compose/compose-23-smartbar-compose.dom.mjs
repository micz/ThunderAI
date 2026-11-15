// The SmartBar chat of a compose window (claude-spec/10-smartbar-compose.md): what the compose
// script reads of the email being written and how it changes it.
//
// "What the model sees, at every turn": smartbarComposeRead gives the text written (up to the
// quote, the forwarded content or the signature), the quoted part and the selection, the
// selection only inside the text written. "Select": smartbarComposeSelect selects the passage
// found exactly once in the text written (whitespace normalized, across inline elements and
// paragraphs), never in the quote; not found or ambiguous leaves the selection alone.
// "Proposals and Apply": smartbarComposeReplace finds the target by its text: "all" only while the
// text written is still the original, "selection" through the live selection when it still holds
// the original, else the original found exactly once; replaced through one editor command, the
// quote, the signature and ThunderAI's own elements untouched. A plain text window gets the text.
// The editor is modelled (stubEditor): the undo stack itself is the manual test in Thunderbird.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    openMailDocument,
    plainTextComposeHtml,
    send,
    stubEditor,
} from '../../compose/compose-doc.mjs';

const doc = body => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
const ctx = await openMailDocument({ url: COMPOSE_URL, html: doc('') });
after(() => ctx.close());
const k = composeTests('23');
const editor = stubEditor(ctx);

const S_READ = 'spec 10 "compose window: What the model sees, at every turn"';
const S_SELECT = 'spec 10 "compose window: Select"';
const S_APPLY = 'spec 10 "compose window: Proposals and Apply"';

const CONTAINER = '<div id="mzta-container"><div class="mzta_dialog">panel</div></div>';
const TYPED = '<p>Hi <b>Bob</b>,</p><p>ok for me. See you on Monday.</p><p>ok for me too.</p>';
const CITE = '<div class="moz-cite-prefix">On 05/11/2024 08:27, Bob wrote:<br></div>';
const QUOTE = '<blockquote type="cite"><p>Monday at ten?</p></blockquote>';
const SIGNATURE = '<div class="moz-signature"><br>-- <br>Mic</div>';

const open = body => { ctx.document.body.innerHTML = body; ctx.window.getSelection().removeAllRanges(); };
const sel = () => ctx.window.getSelection();
const selectText = (node, start, end) => {
    const r = ctx.document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    sel().removeAllRanges();
    sel().addRange(r);
};
const read = () => send(ctx, { command: 'smartbarComposeRead' });
const select = passage => send(ctx, { command: 'smartbarComposeSelect', passage });
const replace = o => send(ctx, { command: 'smartbarComposeReplace', isPlainText: false, ...o });
const norm = s => s.replace(/\s+/g, ' ').trim();

k.test('read', S_READ, 'the text written, the quoted part, no selection; ThunderAI\'s elements are not read', async () => {
    open(CONTAINER + TYPED + CITE + QUOTE + SIGNATURE);
    const r = await read();
    assert.equal(norm(r.typedText), 'Hi Bob, ok for me. See you on Monday. ok for me too.');
    assert.match(r.quotedText, /On 05\/11\/2024 08:27, Bob wrote:/);
    assert.match(r.quotedText, /Monday at ten\?/);
    assert.ok(!r.typedText.includes('panel') && !r.typedText.includes('Mic'));
    assert.equal(r.selection, '');
});

k.test('read-selection', S_READ, 'the selection inside the text written is read; one in the quote is not', async () => {
    open(TYPED + CITE + QUOTE);
    const p2 = ctx.document.body.children[1].firstChild;
    selectText(p2, 0, 9);
    assert.equal((await read()).selection, 'ok for me');
    selectText(ctx.document.querySelector('blockquote p').firstChild, 0, 6);
    assert.equal((await read()).selection, '');
});

k.test('select-found', S_SELECT, 'a passage found once is selected, across inline elements and paragraphs', async () => {
    open(TYPED + CITE + QUOTE);
    assert.deepEqual(await select('See you on   Monday.'), { status: 'found' });
    assert.equal(sel().toString(), 'See you on Monday.');
    assert.deepEqual(await select('Hi Bob, ok for me.'), { status: 'found' });
    // Across two paragraphs: from "Hi " to the end of "ok for me." (jsdom's toString() puts no
    // separator between the paragraphs, Thunderbird's a line break: the range is what counts).
    const r = sel().getRangeAt(0);
    assert.deepEqual([r.startContainer.data, r.startOffset], ['Hi ', 0]);
    assert.deepEqual([r.endContainer.data, r.endOffset], ['ok for me. See you on Monday.', 10]);
});

k.test('select-not-changed', S_SELECT, 'ambiguous, not found, or only in the quote: the selection is not changed', async () => {
    open(TYPED + CITE + QUOTE);
    selectText(ctx.document.body.firstChild.firstChild, 0, 2);
    assert.deepEqual(await select('ok for me'), { status: 'ambiguous' });
    assert.deepEqual(await select('the prices'), { status: 'not_found' });
    assert.deepEqual(await select('Monday at ten?'), { status: 'not_found' }, 'never in the quote');
    assert.deepEqual(await select('   '), { status: 'not_found' });
    assert.equal(sel().toString(), 'Hi');
});

k.test('replace-all', S_APPLY, '"all": the text written replaced through one insertHTML, the quote and the signature untouched', async () => {
    open(CONTAINER + TYPED + CITE + QUOTE + SIGNATURE);
    const before = editor.calls.length;
    const original = (await read()).typedText;
    assert.deepEqual(await replace({ scope: 'all', original, html: '<p>Dear Bob, I agree.</p>', text: 'Dear Bob, I agree.' }), { status: 'applied' });
    assert.equal(editor.calls.length, before + 1);
    assert.equal(editor.calls.at(-1).command, 'insertHTML');
    assert.equal(ctx.document.body.innerHTML, CONTAINER + '<p>Dear Bob, I agree.</p>' + CITE + QUOTE + SIGNATURE);
});

k.test('replace-all-changed', S_APPLY, '"all": the text written changed since the proposal, nothing is written', async () => {
    open(TYPED + CITE + QUOTE);
    const before = editor.calls.length;
    assert.deepEqual(await replace({ scope: 'all', original: 'Hi Bob, something else', html: '<p>x</p>', text: 'x' }), { status: 'changed' });
    assert.equal(editor.calls.length, before);
    assert.equal(ctx.document.body.innerHTML, TYPED + CITE + QUOTE);
});

k.test('replace-all-empty', S_APPLY, '"all" on an empty text written: the text goes above the quote', async () => {
    open('<p><br></p>' + CITE + QUOTE);
    assert.deepEqual(await replace({ scope: 'all', original: '', html: '<p>Yes.</p>', text: 'Yes.' }), { status: 'applied' });
    assert.ok(ctx.document.body.innerHTML.startsWith('<p>Yes.</p>'));
    assert.ok(ctx.document.body.innerHTML.endsWith(CITE + QUOTE));
});

k.test('replace-selection-live', S_APPLY, '"selection": the live selection holding the original is replaced, even when the text is there twice', async () => {
    open(TYPED + CITE + QUOTE);
    const p3 = ctx.document.body.children[2].firstChild;
    selectText(p3, 0, 9);
    assert.deepEqual(await replace({ scope: 'selection', original: 'ok for me', html: 'fine by me', text: 'fine by me' }), { status: 'applied' });
    assert.equal(ctx.document.body.children[2].textContent, 'fine by me too.');
    assert.equal(ctx.document.body.children[1].textContent, 'ok for me. See you on Monday.');
});

k.test('replace-selection-search', S_APPLY, '"selection" with the selection gone: the original found once is replaced; twice or not at all, nothing is written', async () => {
    open(TYPED + CITE + QUOTE);
    assert.deepEqual(await replace({ scope: 'selection', original: 'See you on Monday.', html: 'See you Tuesday.', text: 'See you Tuesday.' }), { status: 'applied' });
    assert.equal(ctx.document.body.children[1].textContent, 'ok for me. See you Tuesday.');
    const html = ctx.document.body.innerHTML;
    assert.deepEqual(await replace({ scope: 'selection', original: 'ok for me', html: 'x', text: 'x' }), { status: 'ambiguous' });
    assert.deepEqual(await replace({ scope: 'selection', original: 'Monday at ten?', html: 'x', text: 'x' }), { status: 'changed' }, 'never in the quote');
    assert.equal(ctx.document.body.innerHTML, html);
});

k.test('plain-text', S_APPLY, 'a plain text window: the text written read, then replaced through insertText', async () => {
    const live = new ctx.window.DOMParser().parseFromString(plainTextComposeHtml({ typed: true }), 'text/html').body;
    ctx.document.documentElement.replaceChild(ctx.document.importNode(live, true), ctx.document.body);
    sel().removeAllRanges();
    const r = await read();
    assert.equal(norm(r.typedText), 'line one line two line three');
    assert.match(r.quotedText, /wrote:/);
    assert.deepEqual(await replace({ scope: 'all', original: r.typedText, isPlainText: true, text: 'New line', html: '<p>New line</p>' }), { status: 'applied' });
    assert.equal(editor.calls.at(-1).command, 'insertText');
    assert.equal(editor.calls.at(-1).value, 'New line');
    assert.equal(norm((await read()).typedText), 'New line');
});

k.test('harness-clean', S_APPLY, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
