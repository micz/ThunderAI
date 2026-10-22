// Group A on a plain text compose window with typed lines: the live capture of compose-04 with
// "line one", "line two", a blank line and "line three" typed above the citation, in the capture's
// own shape - top-level text and <br> under the white-space: pre-wrap body
// (fixtures/compose/plaintext-compose-typed.json).
//
// Spec 03 "Newline contract of the compose placeholders": one \n between lines, one blank line
// between paragraphs, "in a plain text compose window" as in HTML. Spec 01 "The compose-extraction
// newline contract": nothing doubles up. Spec 01 "The rich-text layer": the autoselect range runs to
// the last node with text.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    openMailDocument,
    plainTextComposeHtml,
    send,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({ url: COMPOSE_URL, html: plainTextComposeHtml({ typed: true }) });
after(() => ctx.close());
const { cleanupNewlines, cleanupNewlinesKeepParagraphs } = ctx.mods.utils;
const k = composeTests('14');

const S_COMPOSE = 'spec 03 "Newline contract of the compose placeholders"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_RICHTEXT = 'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"';

k.test('typed-lines', S_COMPOSE, 'one \\n per <br>, one blank line for <br><br>: the typed lines as typed', async () => {
    assert.equal(cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyTypedText' })),
        'line one\nline two\n\nline three');
});

k.test('text-body', S_BODY, 'the body text: every line once, no blank line', async () => {
    const t = cleanupNewlines(await send(ctx, { command: 'getTextOnly' }));
    assert.ok(t.startsWith('line one\nline two\nline three\nOn 08/09/2026 12:10, Example wrote:\n'), JSON.stringify(t));
});

k.test('autoselect-typed', S_RICHTEXT, 'autoselect: the range covers the typed lines, from the first to "line three"', async () => {
    await send(ctx, { command: 'getOnlyTypedText', do_autoselect: true });
    const range = ctx.window.getSelection().getRangeAt(0);
    const body = ctx.document.body;
    assert.equal(body.childNodes[range.startOffset].data, 'line one');
    assert.equal(body.childNodes[range.endOffset - 1].data, 'line three');
    ctx.window.getSelection().removeAllRanges();
});

k.test('harness-clean', S_COMPOSE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
