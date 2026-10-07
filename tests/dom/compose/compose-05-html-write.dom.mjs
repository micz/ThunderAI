// Group B on an HTML compose window: replaceSelectedText, the answer replacing the selection
// (fixtures/compose/html-compose-paragraph-reply.json).
//
// Spec 01 "Writing into a plain text compose window", the HTML branch of the same handler: the
// answer is parsed and its NODES are inserted through a DocumentFragment, never the parsed <body>
// itself (a nested <body> is flattened by the serializer of the compose_reloadBody round-trip that
// follows), every node of the parsed body is inserted (childNodes is live: walking it while
// appending would skip every other node), and compose_reloadBody follows the insertion. What lands
// is the answer, where the selection was; the rest of the body is untouched.

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
    fixture,
    openMailDocument,
    select,
    send,
    sentCommands,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({
    html: fixture('html-compose-paragraph-reply.json').html,
    url: COMPOSE_URL,
    commands: { compose_reloadBody: () => true },
});
after(() => ctx.close());
const k = composeTests('05');

const S_WRITE = 'spec 01 "Writing into a plain text compose window"';

const top = () => [...ctx.document.body.children];
const original = top().map(el => el.outerHTML);
const [P_GREETING, P_TEXT, P_REGARDS, P_EMPTY, CITE, QUOTE, SIGNATURE] = original;
const replace = (text, tabId = 3) => send(ctx, { command: 'replaceSelectedText', text, isPlainText: false, tabId });

k.test('inline-markup', S_WRITE, 'an answer replacing a selected word lands in its place, with its markup', async () => {
    select(ctx, 'HTML');
    assert.equal(await replace('<b>XML</b>'), true);
    assert.equal(top()[1].innerHTML, 'Here we use <b>XML</b> because we are pretty!<br>And a second line.');
});

k.test('rest-untouched-inline', S_WRITE, 'every other node of the body is untouched', () => {
    const now = top().map(el => el.outerHTML);
    assert.deepEqual([now[0], ...now.slice(2)], [P_GREETING, P_REGARDS, P_EMPTY, CITE, QUOTE, SIGNATURE]);
});

k.test('reload-after-insert', S_WRITE, 'compose_reloadBody follows the insertion, for the answer\'s tab, as HTML', () => {
    const reloads = sentCommands(ctx, 'compose_reloadBody');
    assert.equal(reloads.length, 1);
    assert.equal(reloads[0].tabId, 3);
    assert.equal(reloads[0].isPlainText, false);
});

k.test('paragraphs-no-body', S_WRITE, 'answer paragraphs are inserted as nodes: no <body>, <html> or <head> lands in the compose body', async () => {
    select(ctx, 'Ciao', 'Mario,');
    assert.equal(await replace('<p>One</p><p>Two</p><p>Three</p>', 5), true);
    assert.deepEqual(ctx.$$('body body, body html, body head'), []);
});

k.test('every-node-inserted', S_WRITE, 'every node of the answer is inserted, in order: none skipped', () => {
    const inserted = ctx.$$('body > p:first-child > p').map(p => p.textContent);
    assert.deepEqual(inserted, ['One', 'Two', 'Three']);
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

k.test('one-reload-per-insert', S_WRITE, 'one compose_reloadBody per insertion, each for its tab', () => {
    assert.deepEqual(sentCommands(ctx, 'compose_reloadBody').map(m => m.tabId), [3, 5, 3]);
});

// No selection (spec 01 "Writing into a plain text compose window"): the user is asked
// (Replace_No_Selected_Text); yes inserts at the start of the email, wherever the cursor is.
const S_NOSEL = S_WRITE;
const confirmWith = answer => {
    const orig = globalThis.confirm;
    globalThis.confirm = (...args) => { orig(...args); return answer; };
    return () => { globalThis.confirm = orig; };
};

k.test('no-selection-declined', S_NOSEL, 'no selection, the user declines: nothing is inserted, no reload', async () => {
    caretAfter(ctx, 'Here we use');
    const before = ctx.document.body.innerHTML;
    const reloads = sentCommands(ctx, 'compose_reloadBody').length;
    const restore = confirmWith(false);
    try {
        assert.equal(await replace('<b>no</b>'), false);
    } finally { restore(); }
    assert.equal(ctx.dialogs.at(-1).args[0], msg('Replace_No_Selected_Text'));
    assert.equal(ctx.document.body.innerHTML, before);
    assert.equal(sentCommands(ctx, 'compose_reloadBody').length, reloads);
});

k.test('no-selection-at-start', S_NOSEL, 'no selection, the user accepts: the answer lands at the start of the email, not at the cursor', async () => {
    caretAfter(ctx, 'Here we use');
    const line = top()[1].innerHTML;
    assert.equal(await replace('<p>START</p>'), true);
    assert.equal(ctx.document.body.firstElementChild.outerHTML, '<p>START</p>');
    assert.equal(top()[2].innerHTML, line, 'nothing inserted at the cursor');
});

k.test('no-cursor-at-start', S_NOSEL, 'no cursor at all: the answer lands at the start of the email', async () => {
    clearSelection(ctx);
    assert.equal(await replace('<p>TOP</p>'), true);
    assert.equal(ctx.document.body.firstElementChild.outerHTML, '<p>TOP</p>');
});

k.test('harness-clean', S_WRITE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
