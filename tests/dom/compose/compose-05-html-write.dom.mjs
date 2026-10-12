// Group B on an HTML compose window: replaceSelectedText, the answer replacing the selection
// (fixtures/compose/html-compose-paragraph-reply.json).
//
// Spec 01 "Replacing text in a compose window": the answer goes through the editor, one
// execCommand('insertHTML') on the selection, so it is one step of the editor's undo stack; its
// value is the serialization of the parsed body's children, never a <body>, <html> or <head>; the
// window is focused first; nothing is sent to the background afterwards (any setComposeDetails
// with a body clears the undo history from Thunderbird 143, bug 1975127); ThunderAI's own elements
// are kept out of the range. When the editor refuses or throws, the answer is inserted directly
// (the parsed nodes through a DocumentFragment, every node in order: childNodes is live, walking
// it while appending would skip every other node) and the failure is logged. The editor is
// modelled (stubEditor): the undo stack itself is the manual test in Thunderbird.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertHarnessClean,
    msg,
} from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    caretAfter,
    clearSelection,
    errorsSince,
    fixture,
    openMailDocument,
    select,
    send,
    stubEditor,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({
    html: fixture('html-compose-paragraph-reply.json').html,
    url: COMPOSE_URL,
});
after(() => ctx.close());
const k = composeTests('05');
const editor = stubEditor(ctx);

const S_WRITE = 'spec 01 "Replacing text in a compose window"';

const top = () => [...ctx.document.body.children];
const original = top().map(el => el.outerHTML);
const [P_GREETING, P_TEXT, P_REGARDS, P_EMPTY, CITE, QUOTE, SIGNATURE] = original;
const replace = (text, tabId = 3) => send(ctx, { command: 'replaceSelectedText', text, isPlainText: false, tabId });
const P_TEXT_EL = top()[1];
const sentAtLoad = ctx.ctl.sent.length;
const lastCall = () => editor.calls.at(-1);

k.test('inline-markup', S_WRITE, 'an answer replacing a selected word lands in its place, with its markup', async () => {
    select(ctx, 'HTML');
    assert.equal(await replace('<b>XML</b>'), true);
    assert.equal(top()[1].innerHTML, 'Here we use <b>XML</b> because we are pretty!<br>And a second line.');
});

k.test('one-insert-html', S_WRITE, 'the answer goes through the editor: one execCommand(\'insertHTML\', false, markup), on the selection', () => {
    assert.equal(editor.calls.length, 1);
    const { command, showUI, value, range } = lastCall();
    assert.deepEqual([command, showUI, value], ['insertHTML', false, '<b>XML</b>']);
    assert.equal(range.text, 'HTML');
});

k.test('focus-first', S_WRITE, 'a compose window without focus is focused before the editor command', () => {
    assert.ok(lastCall().focusCalls >= 1);
});

k.test('rest-untouched-inline', S_WRITE, 'every other node of the body is untouched', () => {
    const now = top().map(el => el.outerHTML);
    assert.deepEqual([now[0], ...now.slice(2)], [P_GREETING, P_REGARDS, P_EMPTY, CITE, QUOTE, SIGNATURE]);
});

k.test('paragraphs-no-body', S_WRITE, 'answer paragraphs are inserted as nodes: no <body>, <html> or <head> lands in the compose body', async () => {
    select(ctx, 'Ciao', 'Mario,');
    assert.equal(await replace('<p>One</p><p>Two</p><p>Three</p>', 5), true);
    assert.equal(lastCall().value, '<p>One</p><p>Two</p><p>Three</p>');
    assert.deepEqual(ctx.$$('body body, body html, body head'), []);
});

k.test('whole-document', S_WRITE, 'an answer that is a whole document is reduced to its body\'s children', async () => {
    select(ctx, 'One');
    assert.equal(await replace('<!DOCTYPE html><html><head><title>t</title></head><body><p>Uno</p></body></html>'), true);
    assert.equal(lastCall().value, '<p>Uno</p>');
    assert.deepEqual(ctx.$$('body body, body html, body head, body title'), []);
});

k.test('mixed-nodes-in-order', S_WRITE, 'text and element nodes alternating are all inserted, in order', async () => {
    select(ctx, 'Regards!!!');
    assert.equal(await replace('a<b>b</b>c<i>d</i>e'), true);
    assert.equal(top()[2].innerHTML, 'a<b>b</b>c<i>d</i>e');
});

k.test('quote-signature-untouched', S_WRITE, 'the quote and the signature are untouched by every replacement', () => {
    assert.equal(ctx.$('div.moz-cite-prefix').outerHTML, CITE);
    assert.equal(ctx.$('blockquote').outerHTML, QUOTE);
    assert.equal(ctx.$('div.moz-signature').outerHTML, SIGNATURE);
});

k.test('one-command-per-insert', S_WRITE, 'one insertHTML per insertion, nothing else', () => {
    assert.deepEqual(editor.calls.map(c => c.command), ['insertHTML', 'insertHTML', 'insertHTML', 'insertHTML']);
});

k.test('nothing-to-background', S_WRITE, 'nothing is sent to the background after an insertion (no body round-trip: it would clear the undo history)', () => {
    assert.deepEqual(ctx.ctl.sent.slice(sentAtLoad), []);
});

// No selection: the user is asked (Replace_No_Selected_Text); yes inserts at the start of the
// email, wherever the cursor is.
const confirmWith = answer => {
    const orig = globalThis.confirm;
    globalThis.confirm = (...args) => { orig(...args); return answer; };
    return () => { globalThis.confirm = orig; };
};

k.test('no-selection-declined', S_WRITE, 'no selection, the user declines: nothing is inserted, no editor command', async () => {
    caretAfter(ctx, 'Here we use');
    const before = ctx.document.body.innerHTML;
    const calls = editor.calls.length;
    const restore = confirmWith(false);
    try {
        assert.equal(await replace('<b>no</b>'), false);
    } finally { restore(); }
    assert.equal(ctx.dialogs.at(-1).args[0], msg('Replace_No_Selected_Text'));
    assert.equal(ctx.document.body.innerHTML, before);
    assert.equal(editor.calls.length, calls);
});

k.test('no-selection-at-start', S_WRITE, 'no selection, the user accepts: the editor command runs on a caret at the start of the email, not at the cursor', async () => {
    caretAfter(ctx, 'Here we use');
    const line = top()[1].innerHTML;
    const first = ctx.document.body.firstChild;
    assert.equal(await replace('<p>START</p>'), true);
    const { range } = lastCall();
    assert.ok(range.collapsed);
    assert.equal(range.startContainer, ctx.document.body);
    assert.equal(range.nodeAfterStart, first);
    assert.equal(ctx.document.body.firstElementChild.outerHTML, '<p>START</p>');
    assert.equal(ctx.document.body.firstElementChild.nextSibling, first);
    assert.equal(top()[2].innerHTML, line, 'nothing inserted at the cursor');
});

k.test('no-cursor-at-start', S_WRITE, 'no cursor at all: the answer lands at the start of the email', async () => {
    clearSelection(ctx);
    assert.equal(await replace('<p>TOP</p>'), true);
    assert.equal(ctx.document.body.firstElementChild.outerHTML, '<p>TOP</p>');
});

// ThunderAI's own elements: #mzta-container is the body's first child when a panel was drawn.
const container = ctx.document.createElement('div');
container.id = 'mzta-container';
container.innerHTML = '<div class="mzta_dialog">panel</div>';
const CONTAINER = container.outerHTML;

k.test('no-selection-after-injected', S_WRITE, 'no selection: the answer lands after ThunderAI\'s own elements', async () => {
    ctx.document.body.prepend(container);
    clearSelection(ctx);
    assert.equal(await replace('<p>AFTER</p>'), true);
    assert.equal(ctx.document.body.firstElementChild.outerHTML, CONTAINER);
    assert.equal(top()[1].outerHTML, '<p>AFTER</p>');
});

k.test('selection-keeps-injected', S_WRITE, 'a selection reaching into ThunderAI\'s own elements (select all) leaves them out of the range: they are not touched', async () => {
    const afterContainer = container.nextSibling;
    const range = ctx.document.createRange();
    range.setStart(container.firstChild.firstChild, 2);
    range.setEnd(afterContainer, 1);
    const sel = ctx.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    assert.equal(await replace('<p>ALL</p>'), true);
    const call = lastCall();
    assert.equal(call.range.startContainer, ctx.document.body);
    assert.equal(call.range.nodeAfterStart, afterContainer);
    assert.equal(call.range.text, 'AFTER');
    assert.equal(container.outerHTML, CONTAINER);
    assert.equal(top()[0], container);
});

// The fallback: the editor refuses or throws, and the answer is still inserted, directly.
k.test('fallback-refused', S_WRITE, 'the editor refuses the command: the answer is inserted directly, every node in order, and the failure is logged', async () => {
    editor.mode = 'refuse';
    const logged = ctx.con.entries.length;
    try {
        select(ctx, 'second');
        assert.equal(await replace('<p>One</p>x<p>Two</p><p>Three</p>'), true);
    } finally { editor.mode = 'ok'; }
    assert.equal(lastCall().command, 'insertHTML');
    assert.equal(P_TEXT_EL.innerHTML, 'Here we use <b>XML</b> because we are pretty!<br>And a <p>One</p>x<p>Two</p><p>Three</p> line.');
    assert.deepEqual(ctx.$$('body body, body html, body head'), []);
    assert.equal(errorsSince(ctx, logged).length, 1);
});

k.test('fallback-thrown', S_WRITE, 'the editor command throws: the answer is inserted directly in the selection\'s place, and the failure is logged', async () => {
    editor.mode = 'throw';
    const logged = ctx.con.entries.length;
    try {
        select(ctx, 'pretty');
        assert.equal(await replace('<i>nice</i>'), true);
    } finally { editor.mode = 'ok'; }
    assert.equal(P_TEXT_EL.innerHTML, 'Here we use <b>XML</b> because we are <i>nice</i>!<br>And a <p>One</p>x<p>Two</p><p>Three</p> line.');
    assert.equal(errorsSince(ctx, logged).length, 1);
    assert.equal(ctx.$('div.moz-signature').outerHTML, SIGNATURE);
});

k.test('harness-clean', S_WRITE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
