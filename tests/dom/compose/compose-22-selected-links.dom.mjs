// Spec 03 "Mail links": getSelectedLinks, the links a selection touches, on a message display. A
// selection made inside a link's text clones that text without its <a> (getSelectedHtml), so its
// target would never reach {%mail_links%}.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
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
        + '<p><a href="https://example.org/join"><img alt="Bouton rejoindre" src="b.png"></a></p></div>',
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

k.test('no-selection', S, 'without a selection there is nothing', async () => {
    clearSelection(ctx);
    assert.deepEqual(await links(), []);
});

k.test('harness-clean', S, 'the content script ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
