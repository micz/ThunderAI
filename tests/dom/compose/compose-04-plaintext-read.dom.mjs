// Group A on a plain text compose window: the body of a live one, a reply, as Thunderbird's editor
// holds it (captured/plaintext_compose_body_live.html). Nothing typed yet: the two empty lines the
// editor opens with, the citation, the quote, the signature.
//
// What the capture shows: the body carries "white-space: pre-wrap"; the lines are top-level <br>; the
// citation is a div.moz-cite-prefix and the signature a div.moz-signature, as in HTML; the quote is a
// span (pre-wrap, display: block) holding the "> " of each line as text, its lines also <br>.
//
// Spec 03 "Newline contract of the compose placeholders": one \n between lines, a blank line between
// paragraphs, "in a plain text compose window" as in HTML. Spec 03 "Newline contract of the body
// placeholders". Spec 01 "The compose-extraction newline contract" (in a plain text window the
// whitespace is the window's own: white-space: pre-wrap, so it is kept). Spec 03 "Selection twins".

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
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({ url: COMPOSE_URL, html: plainTextComposeHtml() });
after(() => ctx.close());
const { cleanupNewlines, cleanupNewlinesKeepParagraphs } = ctx.mods.utils;
const { mztaHasLineStructure, mztaHtmlToLines, mztaNormalizePlain } = globalThis;
const k = composeTests('04');

const S_COMPOSE = 'spec 03 "Newline contract of the compose placeholders"';
const S_CONTRACT = 'spec 01 "The compose-extraction newline contract"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_TWINS = 'spec 03 "Selection twins (`selected_text` / `selected_html`)"';

const CITATION = 'On 08/09/2026 12:10, Example wrote:';
const QUOTE = [
    '> aggiungi un task con descrizione "pippo lavora" con titolo "fai lavorare',
    '> pippo", location "paperopoli" e scadenza domani alle 15:00.',
    '>',
    '>',
];
const SIGNATURE = ['--', '', '*Example*'];

k.test('capture-shape', S_CONTRACT, 'the live window: a pre-wrap body, top-level <br> lines, the citation and signature divs, the quote span', () => {
    assert.match(ctx.document.body.getAttribute('style'), /white-space:\s*pre-wrap/);
    assert.equal(ctx.document.body.firstChild.nodeName, 'BR');
    assert.ok(ctx.$('body > div.moz-cite-prefix'));
    assert.ok(ctx.$('body > div.moz-signature'));
    assert.match(ctx.$('body > span').getAttribute('style'), /white-space:\s*pre-wrap/);
});

k.test('typed-empty', S_COMPOSE, 'nothing typed yet: the typed text is empty', async () => {
    assert.equal(cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyTypedText' })), '');
});

k.test('quoted-exact', S_COMPOSE, 'the quoted text: the citation, the quote\'s lines with their "> ", a blank line, the signature with its own blank line', async () => {
    assert.equal(cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyQuotedText' })),
        [CITATION, ...QUOTE, '', ...SIGNATURE].join('\n'));
});

k.test('text-body', S_BODY, 'the body text: the same lines, no blank line', async () => {
    assert.equal(cleanupNewlines(await send(ctx, { command: 'getTextOnly' })),
        [CITATION, ...QUOTE, ...SIGNATURE.filter(Boolean)].join('\n'));
});

k.test('html-twin-structured', S_TWINS, 'the html body carries its line structure (<br>, <div>): its text twin, read back out of it, is the body text', async () => {
    const html = await send(ctx, { command: 'getFullHtml' });
    assert.equal(mztaHasLineStructure(html), true, html);
    assert.equal(mztaNormalizePlain(mztaHtmlToLines(html)), cleanupNewlines(await send(ctx, { command: 'getTextOnly' })));
});

k.test('selection-in-line', S_TWINS, 'a selection inside a quoted line: its text', async () => {
    select(ctx, 'location "paperopoli"');
    assert.equal(await send(ctx, { command: 'getSelectedText' }), 'location "paperopoli"');
    assert.equal(await send(ctx, { command: 'getSelectedHtml' }), 'location "paperopoli"');
});

k.test('harness-clean', S_COMPOSE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
