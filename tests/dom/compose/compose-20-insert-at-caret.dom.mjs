// Group B on a compose window: insertAtCaret, the answer of action "3" (insert at cursor position)
// where the cursor is (HTML bodies written here, then the live plain text one of compose-04).
//
// Spec 01 "Inserting at the cursor in a compose window": never a confirmation, nothing replaced. The
// range is the caret saved by saveCaret when the prompt started (it survives the autoselect of
// {%mail_typed_text%}), else the current one, else the start of the email - above any quote or
// signature. Usable: inside the body, not inside ThunderAI's own elements. A selection is collapsed
// to its end; a caret right before one of ThunderAI's top-level elements goes after it. The saved
// caret is used once. The insertion is insertIntoEditor(), as for replaceSelectedText: one editor
// command, the caret left after the answer, by the fallback too. The editor is modelled
// (stubEditor): the undo stack itself is the manual test in Thunderbird.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    caretAfter,
    clearSelection,
    errorsSince,
    openMailDocument,
    plainTextComposeHtml,
    select,
    send,
    stubEditor,
} from '../../compose/compose-doc.mjs';

// One document per file: the plain text window's body replaces the HTML one for the last tests.
const doc = body => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
const ctx = await openMailDocument({ url: COMPOSE_URL, html: doc('') });
after(() => ctx.close());
const k = composeTests('20');
const editor = stubEditor(ctx);

const S_INSERT = 'spec 01 "Inserting at the cursor in a compose window"';

const TYPED = '<p>Hello Bob,</p><p>see you tomorrow.</p><p><br></p>';
const CITE = '<div class="moz-cite-prefix">On 05/11/2024 08:27, Mario wrote:<br></div>';
const QUOTE = '<blockquote type="cite"><p>The question</p></blockquote>';
const SIGNATURE = '<div class="moz-signature"><br>-- <br>Mic</div>';
const CONTAINER = '<div id="mzta-container"><div class="mzta_dialog">panel</div></div>';
const REPLY = TYPED + CITE + QUOTE + SIGNATURE;
const sentAtLoad = ctx.ctl.sent.length;
const dialogsAtLoad = ctx.dialogs.length;

const insert = (text, isPlainText = false) => send(ctx, { command: 'insertAtCaret', text, isPlainText, tabId: 3 });
const saveCaret = () => send(ctx, { command: 'saveCaret' });
const open = body => { ctx.document.body.innerHTML = body; clearSelection(ctx); };
const openPlain = () => {
    const live = new ctx.window.DOMParser().parseFromString(plainTextComposeHtml(), 'text/html').body;
    ctx.document.documentElement.replaceChild(ctx.document.importNode(live, true), ctx.document.body);
    clearSelection(ctx);
};
const caretAt = (node, offset) => {
    const range = ctx.document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = ctx.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
};
const para = i => ctx.document.body.children[i].innerHTML;
const lastCall = () => editor.calls.at(-1);

k.test('at-caret', S_INSERT, 'a caret in the body: the answer goes exactly there, through one insertHTML on a collapsed range, and resolves true', async () => {
    open(REPLY);
    caretAfter(ctx, 'see you');
    const calls = editor.calls.length;
    assert.equal(await insert('<b>NEW</b>'), true);
    assert.equal(editor.calls.length, calls + 1);
    const { command, showUI, value, range, focusCalls } = lastCall();
    assert.deepEqual([command, showUI, value], ['insertHTML', false, '<b>NEW</b>']);
    assert.ok(range.collapsed);
    assert.ok(focusCalls >= 1, 'the window is focused first');
    assert.equal(ctx.document.body.innerHTML, '<p>Hello Bob,</p><p>see you<b>NEW</b> tomorrow.</p><p><br></p>' + CITE + QUOTE + SIGNATURE);
});

k.test('caret-after-answer', S_INSERT, 'the caret is left after the answer: a second insertion follows the first', async () => {
    assert.equal(await insert('<i>MORE</i>'), true);
    assert.equal(para(1), 'see you<b>NEW</b><i>MORE</i> tomorrow.');
});

k.test('selection-kept', S_INSERT, 'a selection is not replaced: the answer goes at its end', async () => {
    open(REPLY);
    select(ctx, 'tomorrow');
    assert.equal(await insert('<i>Y</i>'), true);
    assert.equal(lastCall().range.collapsed, true);
    assert.equal(para(1), 'see you tomorrow<i>Y</i>.');
});

k.test('no-caret-at-start', S_INSERT, 'no caret at all: the answer goes at the start of the email, above the quote and the signature, which are untouched', async () => {
    open(REPLY);
    assert.equal(await insert('<p>TOP</p>'), true);
    assert.equal(ctx.document.body.innerHTML, '<p>TOP</p>' + REPLY);
});

k.test('no-caret-new-message', S_INSERT, 'a new message with a signature and no caret: the answer goes above the signature, never inside it', async () => {
    open('<p><br></p>' + SIGNATURE);
    assert.equal(await insert('<p>Body</p>'), true);
    assert.equal(ctx.document.body.innerHTML, '<p>Body</p><p><br></p>' + SIGNATURE);
});

k.test('no-caret-after-injected', S_INSERT, 'no caret: the answer goes after ThunderAI\'s own elements', async () => {
    open(CONTAINER + REPLY);
    assert.equal(await insert('<p>AFTER</p>'), true);
    assert.equal(ctx.document.body.innerHTML, CONTAINER + '<p>AFTER</p>' + REPLY);
});

k.test('caret-before-injected', S_INSERT, 'a caret right before #mzta-container: the answer goes after it, which stays the body\'s first child', async () => {
    open(CONTAINER + REPLY);
    caretAt(ctx.document.body, 0);
    assert.equal(await insert('<p>C</p>'), true);
    assert.equal(ctx.document.body.innerHTML, CONTAINER + '<p>C</p>' + REPLY);
});

k.test('saved-caret-autoselect', S_INSERT, 'the caret saved when the prompt started wins over the autoselect of {%mail_typed_text%}, which is not replaced', async () => {
    open(REPLY);
    caretAfter(ctx, 'see you');
    assert.equal(await saveCaret(), true);
    await send(ctx, { command: 'getOnlyTypedText', do_autoselect: true, with_html: true });
    assert.equal(ctx.window.getSelection().isCollapsed, false, 'the autoselect took the caret away');
    assert.equal(await insert('<b>X</b>'), true);
    assert.equal(ctx.document.body.innerHTML, '<p>Hello Bob,</p><p>see you<b>X</b> tomorrow.</p><p><br></p>' + CITE + QUOTE + SIGNATURE);
});

k.test('saved-caret-used-once', S_INSERT, 'the saved caret is used once: the next insertion goes to the current caret', async () => {
    caretAfter(ctx, 'Hello');
    assert.equal(await insert('<b>Z</b>'), true);
    assert.equal(para(0), 'Hello<b>Z</b> Bob,');
});

k.test('saved-caret-follows-edits', S_INSERT, 'the saved caret follows the edits made to the body before the answer arrives', async () => {
    open(REPLY);
    caretAfter(ctx, 'tomorrow');
    await saveCaret();
    ctx.document.body.prepend(ctx.document.createElement('p'));
    clearSelection(ctx);
    assert.equal(await insert('<b>T</b>'), true);
    assert.equal(para(2), 'see you tomorrow<b>T</b>.');
});

k.test('saved-caret-injected', S_INSERT, 'a saved caret inside ThunderAI\'s own elements is not usable: the current caret is used, the element untouched', async () => {
    open(CONTAINER + REPLY);
    caretAfter(ctx, 'pan');
    await saveCaret();
    caretAfter(ctx, 'Hello');
    assert.equal(await insert('<b>W</b>'), true);
    assert.equal(ctx.document.body.innerHTML, CONTAINER + '<p>Hello<b>W</b> Bob,</p><p>see you tomorrow.</p><p><br></p>' + CITE + QUOTE + SIGNATURE);
});

k.test('no-confirm', S_INSERT, 'never a confirmation dialog, with or without a caret', () => {
    assert.equal(ctx.dialogs.length, dialogsAtLoad);
});

k.test('fallback-caret-after', S_INSERT, 'the editor refuses: the answer is inserted directly at the caret, logged, and the caret is left after it', async () => {
    open(REPLY);
    caretAfter(ctx, 'Hello');
    editor.mode = 'refuse';
    const logged = ctx.con.entries.length;
    try {
        assert.equal(await insert('<b>F</b>'), true);
    } finally { editor.mode = 'ok'; }
    assert.equal(errorsSince(ctx, logged).length, 1);
    assert.equal(para(0), 'Hello<b>F</b> Bob,');
    assert.equal(await insert('G'), true);
    assert.equal(para(0), 'Hello<b>F</b>G Bob,');
});

k.test('plain-at-caret', S_INSERT, 'plain text: one insertText with the answer\'s \\n verbatim, at the caret', async () => {
    openPlain();
    const body = ctx.document.body;
    const second = body.childNodes[1];
    caretAt(body, 1);
    assert.equal(await insert('line one\nline two', true), true);
    const { command, value, range } = lastCall();
    assert.deepEqual([command, value], ['insertText', 'line one\nline two']);
    assert.ok(range.collapsed);
    assert.equal(body.childNodes[1].nodeType, 3);
    assert.equal(body.childNodes[1].data, 'line one\nline two');
    assert.equal(body.childNodes[2], second);
});

k.test('plain-no-caret', S_INSERT, 'plain text, no caret: the answer goes at the start, above the quote and the signature', async () => {
    openPlain();
    const SIG = ctx.$('div.moz-signature').outerHTML;
    clearSelection(ctx);
    assert.equal(await insert('top', true), true);
    assert.equal(ctx.document.body.firstChild.data, 'top');
    assert.equal(ctx.$('div.moz-signature').outerHTML, SIG);
});

k.test('nothing-to-background', S_INSERT, 'nothing is sent to the background after an insertion (no body round-trip: it would clear the undo history)', () => {
    assert.deepEqual(ctx.ctl.sent.slice(sentAtLoad), []);
});

k.test('harness-clean', S_INSERT, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
