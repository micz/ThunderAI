// Group B on a plain text compose window (captured/mail_text_compose_signature_quote_text.txt, the
// body as the text compose-04 reads).
//
// Spec 01 "Writing into a plain text compose window": with message.isPlainText the answer is
// inserted as a Text node, never through DOMParser - in HTML a bare \n is collapsible whitespace,
// so parsing would render every line break as a space (#855) - and compose_reloadBody follows,
// carrying isPlainText so the round-trip writes plainTextBody. Spec 07 "Into a plain text compose
// window": the conversion back to text happened upstream (stripHtmlKeepLines()); the content script
// inserts the text as it is.

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
    sentCommands,
    textNodes,
} from '../../compose/compose-doc.mjs';

const capture = readCapture('mail_text_compose_signature_quote_text.txt');
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ctx = await openMailDocument({
    url: COMPOSE_URL,
    html: '<!DOCTYPE html><html><head></head><body style="font-family: -moz-fixed; white-space: pre-wrap; width: 72ch;">'
        + escape(capture.body) + '</body></html>',
    commands: { compose_reloadBody: () => true },
});
after(() => ctx.close());
const k = composeTests('06');

const S_WRITE = 'spec 01 "Writing into a plain text compose window"';
const S_PICKER = 'spec 07 "Into a plain text compose window"';

const ANSWER = 'plain\nnew lines\n\npara';
const replace = text => send(ctx, { command: 'replaceSelectedText', text, isPlainText: true, tabId: 4 });
let expected = capture.body;

k.test('text-node', S_WRITE, 'the answer lands as one Text node holding its \\n verbatim, in the selection\'s place', async () => {
    select(ctx, 'only text with');
    assert.equal(await replace(ANSWER), true);
    expected = expected.replace('only text with', ANSWER);
    assert.ok(textNodes(ctx).some(n => n.data === ANSWER), 'a Text node holding exactly the answer');
    assert.equal(ctx.document.body.textContent, expected);
});

k.test('no-element', S_WRITE, 'no element is created: no <br>, no <p>', () => {
    assert.equal(ctx.$$('body *').length, 0);
});

k.test('reload-plain', S_WRITE, 'compose_reloadBody follows, flagged as plain text', () => {
    const reloads = sentCommands(ctx, 'compose_reloadBody');
    assert.equal(reloads.length, 1);
    assert.equal(reloads[0].tabId, 4);
    assert.equal(reloads[0].isPlainText, true);
});

k.test('markup-literal', S_PICKER, 'text that looks like markup is inserted as text, not parsed', async () => {
    select(ctx, 'Regards!!');
    assert.equal(await replace('<b>bold</b> &amp; <p>x</p>'), true);
    expected = expected.replace('Regards!!', '<b>bold</b> &amp; <p>x</p>');
    assert.equal(ctx.$$('body *').length, 0);
    assert.equal(ctx.document.body.textContent, expected);
});

k.test('rest-untouched', S_WRITE, 'the lines around the selections - the quote and the signature - are untouched', () => {
    assert.ok(ctx.document.body.textContent.endsWith(
        '\n\nOn 05/11/2024 08:27, sender8@example.com wrote:\n> This is the body of test email number 8. It was received.\n\n-- \nThis is my best signature!!!'
        + capture.body.slice(capture.body.indexOf('This is my best signature!!!') + 'This is my best signature!!!'.length)));
});

k.test('harness-clean', S_WRITE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
