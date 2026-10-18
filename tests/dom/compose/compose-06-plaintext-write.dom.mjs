// Group B on a plain text compose window: the body of a live one (captured/plaintext_compose_body_live.html,
// see compose-04).
//
// Spec 01 "Replacing text in a compose window": with message.isPlainText the answer goes through the
// editor as text - one execCommand('insertText') carrying the whole answer, its \n verbatim, so it
// is one undo step - never through insertHTML or a parse: in HTML a bare \n is collapsible
// whitespace, so parsing would render every line break as a space (#855). Nothing is sent to the
// background afterwards. When the editor refuses or throws, the answer is inserted directly as one
// Text node (the window's body is white-space: pre-wrap, so its \n render as lines). Spec 07 "Into
// a plain text compose window": the conversion back to text happened upstream
// (stripHtmlKeepLines()); the content script inserts the text as it is. What Gecko's plain text
// editor makes of each \n is not modelled (stubEditor): that is the manual test in Thunderbird.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    openMailDocument,
    plainTextComposeHtml,
    errorsSince,
    select,
    send,
    stubEditor,
    textNodes,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({
    url: COMPOSE_URL,
    html: plainTextComposeHtml(),
});
after(() => ctx.close());
const k = composeTests('06');
const editor = stubEditor(ctx);

const S_WRITE = 'spec 01 "Replacing text in a compose window"';
const S_PICKER = 'spec 07 "Into a plain text compose window"';

const ANSWER = 'plain\nnew lines\n\npara';
const replace = text => send(ctx, { command: 'replaceSelectedText', text, isPlainText: true, tabId: 4 });
const elements = () => ctx.$$('body *').map(el => el.outerHTML);
const ELEMENTS = elements();
const CITE = ctx.$('div.moz-cite-prefix').outerHTML;
const SIGNATURE = ctx.$('div.moz-signature').outerHTML;
const quoteSpan = () => ctx.$('body > span');
let expectedQuote = quoteSpan().textContent;
const sentAtLoad = ctx.ctl.sent.length;

k.test('insert-text', S_WRITE, 'the answer goes through the editor: one execCommand("insertText", false, answer) with its \\n verbatim, on the selection', async () => {
    select(ctx, '"paperopoli"');
    assert.equal(await replace(ANSWER), true);
    assert.equal(editor.calls.length, 1);
    const { command, showUI, value, range, focusCalls } = editor.calls[0];
    assert.deepEqual([command, showUI, value], ['insertText', false, ANSWER]);
    assert.equal(range.text, '"paperopoli"');
    assert.ok(focusCalls >= 1, 'the window is focused first');
    expectedQuote = expectedQuote.replace('"paperopoli"', ANSWER);
    assert.equal(quoteSpan().textContent, expectedQuote);
});

k.test('nothing-to-background', S_WRITE, 'nothing is sent to the background after the insertion (no body round-trip: it would clear the undo history)', () => {
    assert.deepEqual(ctx.ctl.sent.slice(sentAtLoad), []);
});

k.test('markup-literal', S_PICKER, 'text that looks like markup is inserted as text, not parsed', async () => {
    select(ctx, 'scadenza domani');
    assert.equal(await replace('<b>bold</b> &amp; <p>x</p>'), true);
    assert.deepEqual([editor.calls.at(-1).command, editor.calls.at(-1).value], ['insertText', '<b>bold</b> &amp; <p>x</p>']);
    expectedQuote = expectedQuote.replace('scadenza domani', '<b>bold</b> &amp; <p>x</p>');
    assert.equal(ctx.$$('body *').length, ELEMENTS.length);
    assert.equal(quoteSpan().textContent, expectedQuote);
});

k.test('rest-untouched', S_WRITE, 'the citation and the signature around the selections are untouched', () => {
    assert.equal(ctx.$('div.moz-cite-prefix').outerHTML, CITE);
    assert.equal(ctx.$('div.moz-signature').outerHTML, SIGNATURE);
});

for (const mode of ['refuse', 'throw']) {
    k.test(`fallback-${mode}`, S_WRITE, `the editor ${mode === 'refuse' ? 'refuses the command' : 'command throws'}: the answer is inserted directly as one Text node holding its \\n, no element created, and the failure is logged`, async () => {
        editor.mode = mode;
        const logged = ctx.con.entries.length;
        const answer = `${mode}\nline two\n\nline four`;
        try {
            select(ctx, mode === 'refuse' ? 'pippo lavora' : 'alle 15:00');
            assert.equal(await replace(answer), true);
        } finally { editor.mode = 'ok'; }
        assert.ok(textNodes(ctx).some(n => n.data === answer), 'a Text node holding exactly the answer');
        assert.equal(ctx.$$('body *').length, ELEMENTS.length);
        assert.equal(errorsSince(ctx, logged).length, 1);
    });
}

k.test('harness-clean', S_WRITE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
