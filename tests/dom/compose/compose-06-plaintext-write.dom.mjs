// Group B on a plain text compose window: the body of a live one (captured/plaintext_compose_body_live.html,
// see compose-04).
//
// Spec 01 "Writing into a plain text compose window": with message.isPlainText the answer is
// inserted as a Text node, never through DOMParser - in HTML a bare \n is collapsible whitespace,
// so parsing would render every line break as a space (#855); the window's body is
// white-space: pre-wrap, so the \n of that Text node render as lines - and compose_reloadBody
// follows, carrying isPlainText so the round-trip writes plainTextBody. Spec 07 "Into a plain text
// compose window": the conversion back to text happened upstream (stripHtmlKeepLines()); the
// content script inserts the text as it is.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    openMailDocument,
    plainTextComposeHtml,
    select,
    send,
    sentCommands,
    textNodes,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({
    url: COMPOSE_URL,
    html: plainTextComposeHtml(),
    commands: { compose_reloadBody: () => true },
});
after(() => ctx.close());
const k = composeTests('06');

const S_WRITE = 'spec 01 "Writing into a plain text compose window"';
const S_PICKER = 'spec 07 "Into a plain text compose window"';

const ANSWER = 'plain\nnew lines\n\npara';
const replace = text => send(ctx, { command: 'replaceSelectedText', text, isPlainText: true, tabId: 4 });
const elements = () => ctx.$$('body *').map(el => el.outerHTML);
const ELEMENTS = elements();
const CITE = ctx.$('div.moz-cite-prefix').outerHTML;
const SIGNATURE = ctx.$('div.moz-signature').outerHTML;
const quoteSpan = () => ctx.$('body > span');
let expectedQuote = quoteSpan().textContent;

k.test('text-node', S_WRITE, 'the answer lands as one Text node holding its \\n verbatim, in the selection\'s place', async () => {
    select(ctx, '"paperopoli"');
    assert.equal(await replace(ANSWER), true);
    expectedQuote = expectedQuote.replace('"paperopoli"', ANSWER);
    assert.ok(textNodes(ctx).some(n => n.data === ANSWER), 'a Text node holding exactly the answer');
    assert.equal(quoteSpan().textContent, expectedQuote);
});

k.test('no-element', S_WRITE, 'no element is created: no <br>, no <p>', () => {
    assert.equal(ctx.$$('body *').length, ELEMENTS.length);
});

k.test('reload-plain', S_WRITE, 'compose_reloadBody follows, flagged as plain text', () => {
    const reloads = sentCommands(ctx, 'compose_reloadBody');
    assert.equal(reloads.length, 1);
    assert.equal(reloads[0].tabId, 4);
    assert.equal(reloads[0].isPlainText, true);
});

k.test('markup-literal', S_PICKER, 'text that looks like markup is inserted as text, not parsed', async () => {
    select(ctx, 'scadenza domani');
    assert.equal(await replace('<b>bold</b> &amp; <p>x</p>'), true);
    expectedQuote = expectedQuote.replace('scadenza domani', '<b>bold</b> &amp; <p>x</p>');
    assert.equal(ctx.$$('body *').length, ELEMENTS.length);
    assert.equal(quoteSpan().textContent, expectedQuote);
});

k.test('rest-untouched', S_WRITE, 'the citation and the signature around the selections are untouched', () => {
    assert.equal(ctx.$('div.moz-cite-prefix').outerHTML, CITE);
    assert.equal(ctx.$('div.moz-signature').outerHTML, SIGNATURE);
});

k.test('harness-clean', S_WRITE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
