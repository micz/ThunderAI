// Group A on a live message display (captured/html_display_live.html, the mail of compose-15) into
// which ANOTHER add-on has drawn a banner above the mail and a footer below it, from its own message
// display script - an "External sender / Possible spoofing" notice, as one did in the field. The
// menu reads a message display with `display: true`: only Thunderbird's own part containers
// (div.moz-text-html / -plain / -flowed, top-level ones) are read, so neither reaches the AI.
//
// Spec 01 "Message display: only the mail's own part containers are read" (the restriction, the
// flag, nested containers taken once, the fallback, nothing changed without the flag); spec 03
// "Newline contract of the body placeholders"; spec 01 "`getCleanBodyHtml()` returns a DETACHED
// clone" (the reading never edits the live document).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    liveCaptureHtml,
    openMailDocument,
    send,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: 'live-19@example.com',
    html: liveCaptureHtml('html_display_live.html'),
});
after(() => ctx.close());
const { cleanupNewlines } = ctx.mods.utils;
const k = composeTests('19');

const S_DISPLAY = 'spec 01 "Message display: only the mail\'s own part containers are read"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_DETACHED = 'spec 01 "`getCleanBodyHtml()` returns a DETACHED clone, so `innerText` does not work there"';

const MAIL = 'Ciao,\nquesto è invece il body text, cosa mi dici?\neV';
const BANNER = ['External', 'Possible spoofing: example.com not confirmed by SPF, DKIM or DMARC.', 'Details'];
const FOOTER = 'Scanned by another add-on';

// What another add-on's message display script does: its own markup, right above the mail and last
// in the body. Not first: a DIV before the header table goes with it (the forwarded-header removal),
// which would hide the defect this file is about.
const doc = ctx.document;
const part = doc.querySelector('body > div.moz-text-html');
const banner = doc.createElement('div');
banner.className = 'other-addon-banner';
banner.innerHTML = `<span>${BANNER[0]}</span><span>${BANNER[1]}</span><a href="#">${BANNER[2]}</a>`;
part.before(banner);
const footer = doc.createElement('div');
footer.textContent = FOOTER;
doc.body.append(footer);

const text = async (display = true) => cleanupNewlines(await send(ctx, { command: 'getTextOnly', display }));
const html = (display = true) => send(ctx, { command: 'getFullHtml', display });
const bodyHtml = doc.body.innerHTML;

k.test('text-mail-only', S_DISPLAY, 'the body text is the mail: no banner, no footer, no header table', async () => {
    assert.equal(await text(), MAIL);
});

k.test('html-mail-only', S_DISPLAY, 'the HTML body is the mail\'s part container, without the banner, the footer or the header table', async () => {
    const h = await html();
    for (const t of [...BANNER, FOOTER, 'Subject:', 'test body text']) assert.ok(!h.includes(t), t);
    assert.ok(h.startsWith('<div class="moz-text-html"') && h.includes('<b>body text</b>'), h);
});

k.test('reading-is-detached', S_DETACHED, 'reading leaves the displayed document as it was, the other add-on\'s markup included', () => {
    assert.equal(doc.body.innerHTML, bodyHtml);
});

k.test('without-flag-whole-body', S_DISPLAY, 'without `display` (a compose window) the whole body is read, as before', async () => {
    const t = await text(false);
    assert.ok(t.includes(BANNER[1]) && t.includes(FOOTER) && t.includes('cosa mi dici?'), t);
    assert.ok((await html(false)).includes(BANNER[1]));
});

k.test('nested-part-once', S_DISPLAY, 'a container nested in another (an inline forwarded message) is read once, inside its parent', async () => {
    const nested = doc.createElement('div');
    nested.className = 'moz-text-plain';
    nested.textContent = 'Forwarded line';
    part.append(nested);
    assert.equal(await text(), MAIL + '\nForwarded line');
    assert.equal((await html()).split('Forwarded line').length, 2);
    nested.remove();
});

k.test('parts-in-order', S_DISPLAY, 'several top-level part containers are all read, in document order, and nothing between them', async () => {
    const between = doc.createElement('div');
    between.textContent = 'Between the parts';
    const second = doc.createElement('div');
    second.className = 'moz-text-flowed';
    second.textContent = 'Second part';
    footer.before(between, second);
    assert.equal(await text(), MAIL + '\nSecond part');
    between.remove();
    second.remove();
});

k.test('no-part-whole-body', S_DISPLAY, 'a body with no part container is read whole', async () => {
    part.className = 'not-a-part';
    const t = await text();
    assert.ok(t.includes(BANNER[1]) && t.includes('cosa mi dici?'), t);
    part.className = 'moz-text-html';
});

k.test('harness-clean', S_BODY, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
