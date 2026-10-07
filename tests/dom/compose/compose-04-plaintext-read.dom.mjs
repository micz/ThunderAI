// Group A on a plain text compose window (captured/mail_text_compose_signature_quote_text.txt).
// Spec 01 "The compose-extraction newline contract" (#855): in a plain text compose window "the
// breaks are already real \n in the text nodes, there are no <br> to replace". The document is the
// captured text/plain body as that text, in a body styled as Thunderbird's plain text editor
// (white-space: pre-wrap). How the editor splits the quote and the signature into elements is not
// in the spec and not captured (README "Under-specified"), so the text stays one text node and the
// quoted text is not tested here.
//
// Spec 03 "Newline contract of the compose placeholders": the same contract "in a plain text
// compose window". Spec 03 "Newline contract of the body placeholders". Spec 01 "Streaming:
// re-render the whole accumulated raw each time" (the rule of getMailBody(): a value holding neither a block tag nor a <br> is rebuilt from its
// text twin with linesToHtml(..., {mode: 'br'})), and spec 03 "Selection twins" (a structure-less
// selection: its text from the \n, its html rebuilt with linesToHtml).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    openMailDocument,
    readCapture,
    select,
    send,
} from '../../compose/compose-doc.mjs';

const capture = readCapture('mail_text_compose_signature_quote_text.txt');
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ctx = await openMailDocument({
    url: COMPOSE_URL,
    html: '<!DOCTYPE html><html><head></head><body style="font-family: -moz-fixed; white-space: pre-wrap; width: 72ch;">'
        + escape(capture.body) + '</body></html>',
});
after(() => ctx.close());
const { cleanupNewlines, cleanupNewlinesKeepParagraphs } = ctx.mods.utils;
const { mztaHasLineStructure, mztaLinesToHtml, mztaNormalizePlain } = globalThis;
const k = composeTests('04');

const S_COMPOSE = 'spec 03 "Newline contract of the compose placeholders"';
const S_CONTRACT = 'spec 01 "The compose-extraction newline contract"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_TWINS = 'spec 03 "Selection twins (`selected_text` / `selected_html`)"';
const S_WEBCHAT = 'spec 01 "Streaming: re-render the whole accumulated raw each time"';

const LINES = [
    'here only text with a signature!',
    'Regards!!',
    '',
    'On 05/11/2024 08:27, sender8@example.com wrote:',
    '> This is the body of test email number 8. It was received.',
    '',
    '--',
    'This is my best signature!!!',
];

k.test('capture-shape', S_CONTRACT, 'the capture is a plain text draft, and the window holds its lines as \\n in a text node', () => {
    assert.match(capture.headers['content-type'], /^text\/plain/);
    assert.equal(ctx.$$('body *').length, 0, 'no element: no <br>, no block');
    assert.ok(ctx.document.body.textContent.includes('Regards!!\n\nOn 05/11/2024'));
});

k.test('typed-verbatim-lines', S_COMPOSE, 'the typed text keeps every line and every blank line, nothing doubled', async () => {
    assert.equal(cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyTypedText' })), LINES.join('\n'));
});

k.test('text-body', S_BODY, 'the body text: the same lines, no blank line', async () => {
    assert.equal(cleanupNewlines(await send(ctx, { command: 'getTextOnly' })), LINES.filter(Boolean).join('\n'));
});

k.test('html-twin-rebuilt', S_WEBCHAT, 'the html body carries no line structure, so its twin is rebuilt from the text: one <br> per line', async () => {
    const html = await send(ctx, { command: 'getFullHtml' });
    assert.equal(mztaHasLineStructure(html), false, html);
    const text = cleanupNewlines(await send(ctx, { command: 'getTextOnly' }));
    assert.equal(mztaLinesToHtml(text, { mode: 'br' }), LINES.filter(Boolean).join('<br>'));
});

k.test('selection-across-lines', S_TWINS, 'a selection across a line break: its text keeps the \\n, its html twin is rebuilt with a <br>', async () => {
    select(ctx, 'signature!', 'Regards');
    const text = await send(ctx, { command: 'getSelectedText' });
    const html = await send(ctx, { command: 'getSelectedHtml' });
    assert.equal(text, 'signature!\nRegards');
    assert.equal(mztaHasLineStructure(html), false, html);
    const twin = mztaNormalizePlain(text);
    assert.equal(twin, 'signature!\nRegards');
    assert.equal(mztaLinesToHtml(twin, { mode: 'br' }), 'signature!<br>Regards');
});

k.test('harness-clean', S_COMPOSE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
