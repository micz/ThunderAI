// Group B on an HTML compose window: the answer takes the font Thunderbird gives typed text
// (issue #1048), for replaceSelectedText, insertAtCaret and insertReply alike.
//
// Spec 01 "The compose font": Thunderbird applies the compose font of its settings as the
// editor's pending style, which execCommand('insertHTML') ignores. insertIntoEditor() reads it
// with queryCommandValue('fontName' / 'fontSize') BEFORE it focuses the window and moves the
// selection (either drops it), and wraps each run of inline content of each block in a <tt>
// ('tt', "Fixed Width") or a <font face>, plus <font size> unless it is the default "3". Left
// alone: runs with no text (the reply's <br> spacer), a <pre>'s content, a heading's size; the
// default font changes nothing; plain text is never wrapped. The fallback inserts the same markup.
// The editor and its pending style are modelled (stubEditor): how Gecko renders it is the manual
// test in Thunderbird.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    caretAfter,
    openMailDocument,
    select,
    send,
    stubEditor,
} from '../../compose/compose-doc.mjs';

const doc = body => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
const ctx = await openMailDocument({ url: COMPOSE_URL, html: doc('') });
after(() => ctx.close());
const k = composeTests('21');
const editor = stubEditor(ctx);

const S_FONT = 'spec 01 "The compose font"';

const CITE = '<div class="moz-cite-prefix">On 05/11/2024 08:27, Mario wrote:<br></div>';
const QUOTE = '<blockquote type="cite"><p>The question</p></blockquote>';

// The body, a selection on `word`, then the editor's pending style (setting the selection drops it).
const open = (body, word, font) => {
    ctx.document.body.innerHTML = body;
    select(ctx, word);
    editor.font = { fontName: '', fontSize: '', ...font };
};
const replace = (text, isPlainText = false) => send(ctx, { command: 'replaceSelectedText', text, isPlainText, tabId: 3 });
const lastCall = () => editor.calls.at(-1);

k.test('face-paragraphs', S_FONT, 'a configured face wraps the content of each paragraph in a <font face>, inside the block, its markup kept', async () => {
    open('<p>old text</p>', 'old', { fontName: 'monospace' });
    assert.equal(await replace('<p>One</p><p>Two <b>bold</b></p>'), true);
    assert.equal(lastCall().value, '<p><font face="monospace">One</font></p><p><font face="monospace">Two <b>bold</b></font></p>');
});

k.test('read-before-selection', S_FONT, 'the font is read before the window is focused and the selection moved (either drops the pending style)', () => {
    assert.deepEqual(editor.queries.slice(-2), [
        { command: 'fontName', value: 'monospace' },
        { command: 'fontSize', value: '' },
    ]);
});

k.test('fixed-width-tt', S_FONT, '"Fixed Width" (the editor\'s value tt) wraps in a <tt>', async () => {
    open('<p>old text</p>', 'old', { fontName: 'tt' });
    assert.equal(await replace('<p>One</p>'), true);
    assert.equal(lastCall().value, '<p><tt>One</tt></p>');
});

k.test('face-and-size', S_FONT, 'face and a non-default size go on one <font>; a heading keeps its own size', async () => {
    open('<p>old text</p>', 'old', { fontName: 'Arial, sans-serif', fontSize: '4' });
    assert.equal(await replace('<h2>Title</h2><p>Body</p>'), true);
    assert.equal(lastCall().value, '<h2><font face="Arial, sans-serif">Title</font></h2><p><font face="Arial, sans-serif" size="4">Body</font></p>');
});

k.test('tt-and-size', S_FONT, '"Fixed Width" with a size: a <font size> inside the <tt>', async () => {
    open('<p>old text</p>', 'old', { fontName: 'tt', fontSize: '2' });
    assert.equal(await replace('<p>One</p>'), true);
    assert.equal(lastCall().value, '<p><tt><font size="2">One</font></tt></p>');
});

k.test('default-unchanged', S_FONT, 'the default font (no face, size "3" or none) leaves the answer as it is', async () => {
    open('<p>old text</p>', 'old', { fontSize: '3' });
    assert.equal(await replace('<p>One</p><p>Two</p>'), true);
    assert.equal(lastCall().value, '<p>One</p><p>Two</p>');
});

k.test('inline-and-nested', S_FONT, 'top-level inline content is one run; lists and cells are walked; a <pre> keeps its own font; a run with no text is left alone', async () => {
    open('<p>old text</p>', 'old', { fontName: 'monospace' });
    assert.equal(await replace('Hi <i>you</i><ul><li>a</li><li>b<ol><li>c</li></ol></li></ul><pre>code</pre><table><tbody><tr><td>x</td></tr></tbody></table><br>'), true);
    assert.equal(lastCall().value,
        '<font face="monospace">Hi <i>you</i></font>'
        + '<ul><li><font face="monospace">a</font></li><li><font face="monospace">b</font><ol><li><font face="monospace">c</font></li></ol></li></ul>'
        + '<pre>code</pre>'
        + '<table><tbody><tr><td><font face="monospace">x</font></td></tr></tbody></table><br>');
});

k.test('insert-at-caret', S_FONT, 'insertAtCaret: the answer takes the font too', async () => {
    ctx.document.body.innerHTML = '<p>typed here</p>';
    caretAfter(ctx, 'typed');
    editor.font = { fontName: 'monospace', fontSize: '' };
    assert.equal(await send(ctx, { command: 'insertAtCaret', text: '<p>Ins</p>', isPlainText: false, tabId: 3 }), true);
    assert.equal(lastCall().value, '<p><font face="monospace">Ins</font></p>');
});

k.test('reply', S_FONT, 'insertReply: the answer takes the font of the new reply\'s caret, the <br> spacer stays bare', async () => {
    ctx.document.body.innerHTML = '<p><br></p>' + CITE + QUOTE;
    const range = ctx.document.createRange();
    range.setStart(ctx.document.body.firstChild, 0);
    const sel = ctx.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    editor.font = { fontName: 'tt', fontSize: '' };
    assert.equal(await send(ctx, { command: 'insertReply', text: '<p>Answer</p>', isPlainText: false }), true);
    assert.equal(lastCall().value, '<p><tt>Answer</tt></p><br>');
});

k.test('plain-text-untouched', S_FONT, 'a plain text window: the answer is inserted as text, never wrapped', async () => {
    open('<p>old text</p>', 'old', { fontName: 'monospace' });
    assert.equal(await replace('<p>One</p>', true), true);
    assert.deepEqual([lastCall().command, lastCall().value], ['insertText', '<p>One</p>']);
});

k.test('fallback', S_FONT, 'the editor refuses: the direct insertion carries the same font', async () => {
    editor.mode = 'refuse';
    try {
        open('<p>old text</p>', 'old', { fontName: 'monospace' });
        assert.equal(await replace('<p>One</p>'), true);
    } finally { editor.mode = 'ok'; }
    assert.equal(ctx.$('font[face="monospace"]')?.textContent, 'One');
});

k.test('harness-clean', S_FONT, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
