// Group B on a reply window just opened: insertReply, the answer of chatgpt_replyMessage at the top
// of the reply (an HTML reply written here, then the live plain text one of compose-04).
//
// Spec 01 "Writing a reply": the answer goes through the editor (one execCommand, so one undo
// step) and nothing is sent to the background afterwards. HTML: the answer replaces whatever
// precedes the first quote or signature (the quote, or the forward container, or the signature,
// whichever comes first), followed by a <br> unless that block starts with one (#849); with
// neither, it goes before the body's first node, with the same spacer rule, and none on an empty
// body. Plain text: before everything, followed by a blank line when the body holds any text.
// ThunderAI's own elements stay above it, untouched. The editor is modelled (stubEditor): the undo
// stack itself is the manual test in Thunderbird.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    errorsSince,
    openMailDocument,
    plainTextComposeHtml,
    send,
    stubEditor,
    textNodes,
} from '../../compose/compose-doc.mjs';

// One document per file: the plain text window's body replaces the HTML one for the last tests.
const doc = body => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
const ctx = await openMailDocument({ url: COMPOSE_URL, html: doc('') });
after(() => ctx.close());
const k = composeTests('18');
const editor = stubEditor(ctx);

const S_REPLY = 'spec 01 "Writing a reply"';

const CITE = '<div class="moz-cite-prefix">On 05/11/2024 08:27, Mario wrote:<br></div>';
const QUOTE = '<blockquote type="cite"><p>The question</p></blockquote>';
const SIGNATURE = '<div class="moz-signature"><br>-- <br>Mic</div>';
const CONTAINER = '<div id="mzta-container"><div class="mzta_dialog">panel</div></div>';
const sentAtLoad = ctx.ctl.sent.length;

const reply = (text, isPlainText = false) => send(ctx, { command: 'insertReply', text, isPlainText });
const open = body => { ctx.document.body.innerHTML = body; ctx.window.getSelection().removeAllRanges(); };
const openPlainReply = () => {
    const live = new ctx.window.DOMParser().parseFromString(plainTextComposeHtml(), 'text/html').body;
    ctx.document.documentElement.replaceChild(ctx.document.importNode(live, true), ctx.document.body);
    ctx.window.getSelection().removeAllRanges();
};
const lastCall = () => editor.calls.at(-1);

k.test('above-quote', S_REPLY, 'HTML: the answer replaces the empty lines above the quote, through one insertHTML, followed by a <br> (the cite prefix does not start with one)', async () => {
    open('<p><br></p>' + CITE + QUOTE + SIGNATURE);
    const first = ctx.document.body.firstChild;
    assert.equal(await reply('<p>Answer</p>'), true);
    const { command, showUI, value, range } = lastCall();
    assert.deepEqual([command, showUI, value], ['insertHTML', false, '<p>Answer</p><br>']);
    assert.equal(range.startContainer, ctx.document.body);
    assert.equal(range.nodeAfterStart, first);
    assert.equal(ctx.document.body.innerHTML, '<p>Answer</p><br>' + CITE + QUOTE + SIGNATURE);
});

k.test('signature-above-quote', S_REPLY, 'HTML, signature above the quote: the answer goes above the signature, with no spacer (it starts with a <br>)', async () => {
    open('<br><br>' + SIGNATURE + CITE + QUOTE);
    assert.equal(await reply('<p>Answer</p>'), true);
    assert.equal(lastCall().value, '<p>Answer</p>');
    assert.equal(ctx.document.body.innerHTML, '<p>Answer</p>' + SIGNATURE + CITE + QUOTE);
});

k.test('forward', S_REPLY, 'HTML, a forward (no cite prefix): the answer goes above the forward container', async () => {
    const FWD = '<div class="moz-forward-container">-------- Forwarded Message --------</div>';
    open('<p><br></p>' + FWD);
    assert.equal(await reply('<p>Answer</p>'), true);
    assert.equal(ctx.document.body.innerHTML, '<p>Answer</p><br>' + FWD);
});

k.test('no-quote-text', S_REPLY, 'HTML, neither quote nor signature: the answer goes before the first node, which is kept, with a spacer', async () => {
    open('<p>Typed</p>');
    assert.equal(await reply('<p>Answer</p>'), true);
    assert.equal(ctx.document.body.innerHTML, '<p>Answer</p><br><p>Typed</p>');
});

k.test('empty-body', S_REPLY, 'HTML, an empty body: the answer alone, no spacer', async () => {
    open('');
    assert.equal(await reply('<p>Answer</p>'), true);
    assert.equal(lastCall().value, '<p>Answer</p>');
    assert.equal(ctx.document.body.innerHTML, '<p>Answer</p>');
});

k.test('whole-document', S_REPLY, 'HTML, an answer that is a whole document is reduced to its body\'s children', async () => {
    open(CITE + QUOTE);
    assert.equal(await reply('<html><head><title>t</title></head><body><p>Answer</p></body></html>'), true);
    assert.equal(lastCall().value, '<p>Answer</p><br>');
    assert.deepEqual(ctx.$$('body body, body html, body head, body title'), []);
});

k.test('injected-kept', S_REPLY, 'HTML: ThunderAI\'s own elements stay above the answer, untouched', async () => {
    open(CONTAINER + '<p><br></p>' + CITE + QUOTE);
    assert.equal(await reply('<p>Answer</p>'), true);
    assert.equal(ctx.document.body.innerHTML, CONTAINER + '<p>Answer</p><br>' + CITE + QUOTE);
});

k.test('focus-first', S_REPLY, 'the window is focused before the editor command', () => {
    assert.ok(lastCall().focusCalls >= 1);
});

k.test('fallback', S_REPLY, 'HTML, the editor refuses: the answer is inserted directly, in the same place, and the failure is logged', async () => {
    open('<p><br></p>' + CITE + QUOTE);
    editor.mode = 'refuse';
    const logged = ctx.con.entries.length;
    try {
        assert.equal(await reply('<p>One</p><p>Two</p>'), true);
    } finally { editor.mode = 'ok'; }
    assert.equal(ctx.document.body.innerHTML, '<p>One</p><p>Two</p><br>' + CITE + QUOTE);
    assert.equal(errorsSince(ctx, logged).length, 1);
});

const ANSWER = 'line one\nline two\n\nline four';

k.test('plain-top', S_REPLY, 'plain text: one insertText of the answer and a blank line, on a caret before everything', async () => {
    openPlainReply();
    const first = ctx.document.body.firstChild;
    assert.equal(await reply(ANSWER, true), true);
    const { command, value, range } = lastCall();
    assert.deepEqual([command, value], ['insertText', ANSWER + '\n\n']);
    assert.ok(range.collapsed);
    assert.equal(range.nodeAfterStart, first);
    assert.equal(ctx.document.body.firstChild.data, ANSWER + '\n\n');
});

k.test('plain-empty', S_REPLY, 'plain text, a body with no text: the answer alone', async () => {
    open('<br><br>');
    assert.equal(await reply(ANSWER, true), true);
    assert.equal(lastCall().value, ANSWER);
});

k.test('plain-fallback', S_REPLY, 'plain text, the editor throws: one Text node holding the answer, and the failure is logged', async () => {
    open('<br>quoted<br>');
    editor.mode = 'throw';
    const logged = ctx.con.entries.length;
    try {
        assert.equal(await reply(ANSWER, true), true);
    } finally { editor.mode = 'ok'; }
    assert.ok(textNodes(ctx).some(n => n.data === ANSWER + '\n\n'));
    assert.equal(errorsSince(ctx, logged).length, 1);
});

k.test('nothing-to-background', S_REPLY, 'nothing is sent to the background after an insertion', () => {
    assert.deepEqual(ctx.ctl.sent.slice(sentAtLoad), []);
});

k.test('harness-clean', S_REPLY, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
