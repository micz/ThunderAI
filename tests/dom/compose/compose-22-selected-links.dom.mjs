// Spec 03 "Mail links": getSelectedLinks, the links a selection touches, on a message display. A
// selection made inside a link's text clones that text without its <a> (getSelectedHtml), so its
// target would never reach {%mail_links%}.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    caretAfter,
    clearSelection,
    openMailDocument,
    select,
    send,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: 'selected-links@example.test',
    html: '<div class="moz-text-html"><p>Séminaire. <a href="https://example.org/visio?id=1">Rejoindre la visioconférence</a>'
        + ' — <a href="https://example.org/p.pdf">Programme</a></p><p>Fin du message, sans lien.</p>'
        + '<p><a href="https://example.org/join"><img alt="Bouton rejoindre" src="b.png"></a></p>'
        + '<p>Avant <a hidden href="https://example.org/h1">masqué un</a><span style="display: none"><a href="https://example.org/h2">masqué deux</a></span>'
        + '<a style="visibility: hidden" href="https://example.org/h3">masqué trois</a> <a href="https://example.org/v">Visible<span hidden> secret</span></a> après</p></div>',
});
after(() => ctx.close());
const k = composeTests('22');
const S = 'spec 03 "Mail links"';
const links = () => send(ctx, { command: 'getSelectedLinks' });

k.test('inside-link', S, 'a selection inside a link\'s text gives that link, which the selected HTML loses', async () => {
    select(ctx, 'Rejoindre', 'visio');
    assert.equal((await send(ctx, { command: 'getSelectedHtml' })).includes('href'), false);
    assert.deepEqual(await links(), [{ text: 'Rejoindre la visioconférence', href: 'https://example.org/visio?id=1' }]);
});

k.test('across-links', S, 'a selection across two links gives both, in order', async () => {
    select(ctx, 'Séminaire', 'Programme');
    assert.deepEqual((await links()).map(link => link.href), ['https://example.org/visio?id=1', 'https://example.org/p.pdf']);
});

k.test('no-link', S, 'a selection touching no link gives none, not the other links of the message', async () => {
    select(ctx, 'Fin du message');
    assert.deepEqual(await links(), []);
});

k.test('no-selection', S, 'without a selection, or with a collapsed caret, there is no selection to read (null)', async () => {
    clearSelection(ctx);
    assert.equal(await links(), null);
    caretAfter(ctx, 'Rejoindre');
    assert.equal(await links(), null);
});

k.test('image-only', S, 'an image selected alone, with no text, still gives its link, described by its alt', async () => {
    const range = ctx.document.createRange();
    range.selectNode(ctx.document.querySelector('img'));
    ctx.window.getSelection().removeAllRanges();
    ctx.window.getSelection().addRange(range);
    assert.deepEqual(await links(), [{ text: 'Bouton rejoindre', href: 'https://example.org/join' }]);
});

k.test('hidden', S, 'hidden links inside the selection, and the hidden part of a label, are left out', async () => {
    select(ctx, 'Avant', 'après');
    assert.deepEqual(await links(), [{ text: 'Visible', href: 'https://example.org/v' }]);
});

k.test('harness-clean', S, 'the content script ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
