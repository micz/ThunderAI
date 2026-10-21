// Group A on an HTML compose window in Paragraph mode, a reply as the editor holds it when the reply
// opens (fixtures/compose/html-compose-paragraph-reply.json: no serializer indentation). Exact values.
//
// Spec 03 "Newline contract of the compose placeholders": typed and quoted text carry one \n
// between lines and a blank line between paragraphs, after cleanupNewlinesKeepParagraphs(), and the
// non-breaking space (both spellings) becomes a plain space. Spec 01 "The compose-extraction newline
// contract": each top-level node projected with <br> -> \n, its trailing break trimmed, joined with
// \n, or \n\n before a block-level node (P, BLOCKQUOTE, UL, OL, TABLE, H1-H6, PRE).
// Spec 03 "Newline contract of the body placeholders": getTextOnly, after cleanupNewlines(), one \n
// per block, never a blank line. Spec 03 "Selection twins": a fragment carrying its own tags is
// trusted and its text read back out of it with htmlToLines(); the autoselect range of
// getOnlyTypedText. Spec 01 "The rich-text layer": lastNode keyed off node.textContent.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    clearSelection,
    fixture,
    openMailDocument,
    select,
    send,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({ html: fixture('html-compose-paragraph-reply.json').html, url: COMPOSE_URL });
after(() => ctx.close());
const { cleanupNewlines, cleanupNewlinesKeepParagraphs } = ctx.mods.utils;
const { mztaHtmlToLines, mztaNormalizePlain, mztaHasLineStructure } = globalThis;
const k = composeTests('02');

const S_COMPOSE = 'spec 03 "Newline contract of the compose placeholders"';
const S_CONTRACT = 'spec 01 "The compose-extraction newline contract"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_TWINS = 'spec 03 "Selection twins (`selected_text` / `selected_html`)"';
const S_TEXT_HTML = 'spec 01 "The text/HTML rule: stripped from the TEXT, never from the HTML"';
const S_RICHTEXT = 'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"';

const TYPED = 'Ciao Mario,\n\nHere we use HTML because we are pretty!\nAnd a second line.\n\nRegards!!!';
const QUOTE_LINES = 'This is the body of test email number 8. It was received.\nA second quoted line.';

/** The selection twin of spec 03, computed with the shared layer's own functions. */
const twinText = html => mztaNormalizePlain(mztaHtmlToLines(html));

k.test('typed-exact', S_COMPOSE, 'typed text: a blank line between paragraphs, one \\n for the <br>, the non-breaking space a space', async () => {
    assert.equal(cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyTypedText' })), TYPED);
});

k.test('typed-raw-joins', S_CONTRACT, 'the raw typed text joins the paragraphs with \\n\\n and keeps the <br> as one \\n', async () => {
    const raw = await send(ctx, { command: 'getOnlyTypedText' });
    assert.ok(raw.startsWith('Ciao Mario,\n\nHere we use HTML because we are pretty!\nAnd a second line.\n\nRegards!!!'),
        JSON.stringify(raw));
    assert.ok(!raw.includes('On 05/11/2024'), 'stops at the moz-cite-prefix');
});

k.test('quoted-exact-start', S_COMPOSE, 'quoted text: the citation line, a blank line (blockquote), the quoted lines one per line', async () => {
    const q = cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyQuotedText' }));
    assert.ok(q.startsWith('On 05/11/2024 08:27, sender8@example.com wrote:\n\n' + QUOTE_LINES), JSON.stringify(q));
    assert.ok(!q.includes('Ciao Mario'), 'no typed text in the quoted text');
});

k.test('text-body-exact', S_BODY, 'body text: one line per block or <br>, no blank line, the empty paragraph folded away', async () => {
    assert.equal(cleanupNewlines(await send(ctx, { command: 'getTextOnly' })),
        'Ciao Mario,\nHere we use HTML because we are pretty!\nAnd a second line.\nRegards!!!\n'
        + 'On 05/11/2024 08:27, sender8@example.com wrote:\n' + QUOTE_LINES + '\n--\nThis is my best signature!!!');
});

k.test('full-html-unedited', S_TEXT_HTML, 'getFullHtml is the body markup', async () => {
    assert.equal(await send(ctx, { command: 'getFullHtml' }), ctx.document.body.innerHTML);
});

k.test('no-selection-empty', S_TWINS, 'with nothing selected both twins are empty', async () => {
    clearSelection(ctx);
    assert.equal(await send(ctx, { command: 'getSelectedText' }), '');
    assert.equal(await send(ctx, { command: 'getSelectedHtml' }), '');
});

k.test('selection-in-line', S_TWINS, 'a selection inside one line: its text, and an html twin without structure', async () => {
    select(ctx, 'use HTML because');
    assert.equal(await send(ctx, { command: 'getSelectedText' }), 'use HTML because');
    const html = await send(ctx, { command: 'getSelectedHtml' });
    assert.equal(html, 'use HTML because');
    assert.equal(mztaHasLineStructure(html), false);
});

k.test('selection-across-blocks', S_TWINS, 'a selection across paragraphs: its fragment keeps the <p> and <br>, and the text twin read out of it has their lines', async () => {
    select(ctx, 'pretty!', 'Regards');
    const html = await send(ctx, { command: 'getSelectedHtml' });
    assert.equal(mztaHasLineStructure(html), true, html);
    assert.ok(html.includes('<br>') && html.includes('</p><p>'), html);
    assert.equal(twinText(html), 'pretty!\nAnd a second line.\nRegards');
});

k.test('selection-mid-tag', S_TWINS, 'a range cutting through <b> yields a balanced fragment: no half-open tag', async () => {
    select(ctx, 'is my ', 'be');
    const html = await send(ctx, { command: 'getSelectedHtml' });
    assert.equal(html, 'is my <b>be</b>');
    assert.equal(twinText(html), 'is my be');
});

k.test('autoselect-typed-range', S_RICHTEXT, 'autoselect: the range runs from the first typed node to the last one with text (the empty <p> excluded)', async () => {
    clearSelection(ctx);
    await send(ctx, { command: 'getOnlyTypedText', do_autoselect: true });
    const html = await send(ctx, { command: 'getSelectedHtml' });
    assert.equal(html, '<p>Ciao&nbsp;Mario,</p><p>Here we use HTML because we are pretty!<br>And a second line.</p><p>Regards!!!</p>');
});

k.test('autoselect-twin-agrees', S_TWINS, 'the autoselected html and the typed text are twins: the same lines', async () => {
    const html = await send(ctx, { command: 'getSelectedHtml' });
    const typed = cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyTypedText' }));
    assert.equal(twinText(html), cleanupNewlines(typed));
});

k.test('autoselect-quoted-range', S_RICHTEXT, 'autoselect on the quoted text: from the citation to the last node with text', async () => {
    clearSelection(ctx);
    await send(ctx, { command: 'getOnlyQuotedText', do_autoselect: true });
    const range = ctx.window.getSelection().getRangeAt(0);
    const body = ctx.document.body;
    assert.equal(range.startContainer, body);
    assert.equal(body.childNodes[range.startOffset], ctx.$('div.moz-cite-prefix'));
    assert.equal(range.endContainer, body);
    assert.equal(body.childNodes[range.endOffset - 1], ctx.$('div.moz-signature'));
});

k.test('no-autoselect-no-range', S_RICHTEXT, 'without do_autoselect the walkers leave the selection alone', async () => {
    clearSelection(ctx);
    await send(ctx, { command: 'getOnlyTypedText' });
    await send(ctx, { command: 'getOnlyQuotedText' });
    assert.equal(ctx.window.getSelection().rangeCount, 0);
});

k.test('harness-clean', S_COMPOSE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
