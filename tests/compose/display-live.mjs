/*
 *  The tests every live message display capture gets (compose-15 / 16 / 17): one capture per file,
 *  because one process opens one document (the content script's top-level constants).
 *
 *  What the captures show (tests/fixtures/compose/captured/*_live.html, the <body> read with
 *  tabs.executeScript): the body opens with the message's header table (table.moz-main-header,
 *  Subject / From / Date), a <br> and a <meta>, then the mail in div.moz-text-html; the source is
 *  pretty-printed (a newline after each <br>, indentation).
 *
 *  Spec 03 "Newline contract of the body placeholders" (getTextOnly: one \n per block or <br>, no
 *  blank line, HTML source whitespace not a line). Spec 01 "Where the body comes from" (the header
 *  block - the same table a forwarded message carries - in neither the text nor the HTML).
 */

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../helpers/core/dom-harness.mjs';
import { composeTests } from '../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    liveCaptureHtml,
    openMailDocument,
    send,
} from './compose-doc.mjs';

const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_PARTS = 'spec 01 "Where the body comes from — `listInlineTextParts()`, not a `getFull()` walk"';

/**
 * @param {string} nn      the compose-NN file
 * @param {object} c       {file, text: the expected body text, header: [texts of the header table]}
 * @param {Function} more  optional (k, ctx) => void: the file's own tests
 */
export async function liveDisplayTests(nn, c, more) {
    const ctx = await openMailDocument({ url: DISPLAY_URL, displayedMessageId: 'live-' + nn + '@example.com', html: liveCaptureHtml(c.file) });
    after(() => ctx.close());
    const k = composeTests(nn);

    k.test('shape', S_PARTS, `${c.file}: the header table, then the mail in div.moz-text-html`, () => {
        assert.ok(ctx.$('body > table.moz-main-header'));
        assert.ok(ctx.$('body > div.moz-text-html'));
    });
    k.test('text', S_BODY, `${c.file}: the body text, one line per line of the mail, the header not read`, async () => {
        assert.equal(ctx.mods.utils.cleanupNewlines(await send(ctx, { command: 'getTextOnly' })), c.text);
    });
    k.test('html', S_PARTS, `${c.file}: the HTML body is the mail without the header table`, async () => {
        const html = await send(ctx, { command: 'getFullHtml' });
        for (const h of c.header) assert.ok(!html.includes(h), h);
        assert.ok(html.includes('class="moz-text-html"'), 'the mail itself is there');
    });
    if (more) more(k, ctx);
    k.test('harness-clean', S_BODY, 'the content script ran on modelled APIs only', () => {
        assertHarnessClean(ctx);
    });
    k.coverage();
}
