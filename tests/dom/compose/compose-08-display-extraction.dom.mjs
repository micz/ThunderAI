// Group A in the message display, on a hand-written HTML mail holding every shape the extraction
// rules name (fixtures/compose/html-display-newsletter.json): the interactive {%mail_text_body%}
// (getTextOnly + cleanupNewlines()) and {%mail_html_body%} (getFullHtml).
//
// Spec 03 "Newline contract of the body placeholders": <br>/<hr> -> \n, a block -> a line, table
// cells separated by a space, never a blank line (empty Outlook spacer paragraphs fold away); both
// paths run mztaStripHidden() first (inline display:none / visibility:hidden in any spacing or case,
// !important included, the hidden attribute; NOT a vendor longhand like -x-display:none).
// Spec 01 "Non-breaking spaces": a non-breaking space becomes a space, never dropped.
// Spec 01 "getCleanBodyHtml() returns a DETACHED clone": <style> and <script> are removed from the
// clone, so neither their text nor the CSS reaches the text or the HTML.
// Spec 01 "The text/HTML rule": hidden markup is stripped from the TEXT, never from the HTML, and
// selections are untouched on every path.
// The expected text is the fixture's `text_body`, written from those rules.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    fixture,
    openMailDocument,
    select,
    send,
} from '../../compose/compose-doc.mjs';

const mail = fixture('html-display-newsletter.json');
const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: 'newsletter-1@example.com',
    html: '<!DOCTYPE html><html><head></head><body><div class="moz-text-html" lang="x-unicode">'
        + mail.mail_html + '</div></body></html>',
});
after(() => ctx.close());
const { cleanupNewlines } = ctx.mods.utils;
const k = composeTests('08');

const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_HIDDEN = 'spec 01 "Hidden elements — `mztaStripHidden()`, and why the attribute selector was wrong"';
const S_TEXT_HTML = 'spec 01 "The text/HTML rule: stripped from the TEXT, never from the HTML"';
const S_PARTS = 'spec 01 "Where the body comes from — `listInlineTextParts()`, not a `getFull()` walk"';
const S_DETACHED ='spec 01 "`getCleanBodyHtml()` returns a DETACHED clone, so `innerText` does not work there"';

const textBody = async () => cleanupNewlines(await send(ctx, { command: 'getTextOnly' }));

k.test('text-body-exact', S_BODY, 'the body text: one line per block, cells spaced, spacer folded, hidden and <style>/<script> gone', async () => {
    assert.equal(await textBody(), mail.text_body);
});

k.test('hidden-not-in-text', S_HIDDEN, 'no hidden element reaches the text, in any spelling', async () => {
    const t = await textBody();
    for (const hidden of mail.hidden_texts) assert.ok(!t.includes(hidden), hidden);
});

k.test('vendor-longhand-kept', S_HIDDEN, 'mso-hide:all;-x-display:none is not a display:none declaration: its text stays', async () => {
    assert.ok((await textBody()).split('\n').includes('Vendor longhand stays'));
});

k.test('style-script-not-in-text', S_DETACHED, 'the stylesheet rules and the script source are not read as body copy', async () => {
    const t = await textBody();
    assert.ok(!t.includes('color:red') && !t.includes('MsoNormal') && !t.includes('script text'), t);
});

k.test('forward-header-gone', S_PARTS, 'the header block of a forwarded message (the moz-main-header table and the DIV before it) is in neither the text nor the HTML', async () => {
    const t = await textBody();
    const html = await send(ctx, { command: 'getFullHtml' });
    for (const header of mail.header_texts) {
        assert.ok(!t.includes(header), header + ' in the text');
        assert.ok(!html.includes(header), header + ' in the HTML');
    }
});

k.test('html-keeps-hidden', S_TEXT_HTML, 'the HTML body keeps the hidden markup', async () => {
    const html = await send(ctx, { command: 'getFullHtml' });
    for (const hidden of mail.hidden_texts) assert.ok(html.includes(hidden), hidden);
    assert.ok(html.includes('display: none'), html);
});

k.test('html-no-style-script', S_DETACHED, 'the HTML body carries no <style> and no <script>', async () => {
    const html = await send(ctx, { command: 'getFullHtml' });
    assert.ok(!/<style|<script/i.test(html), html);
});

k.test('selection-keeps-hidden', S_TEXT_HTML, 'a selection is untouched: the hidden text the user selected is in the selected html', async () => {
    select(ctx, 'Preheader', 'Dear customer');
    const html = await send(ctx, { command: 'getSelectedHtml' });
    assert.ok(html.includes('Preheader: 50% off today only') && html.includes('Hidden attr text'), html);
});

k.test('harness-clean', S_BODY, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
