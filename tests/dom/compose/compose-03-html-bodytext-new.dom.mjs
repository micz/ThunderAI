// Group A on a live HTML compose window in Body Text mode: a new message with three typed lines and
// the identity's signature (captured/html_compose_bodytext_window_live.html, the <body> read with
// tabs.executeScript, anonymized: every text but the typed lines turned to "x", images and links
// replaced). Then the generating panels in a compose window, whose own displayed message is unknown.
//
// What the capture shows: the typed lines are text and <br> directly in <body>, with a newline after
// each <br> and no wrapper; "tomorrow." is followed straight by div.moz-signature, with no bogus
// <br>; the signature carries Outlook's nested markup (p, span, b, links, images, &nbsp; spacers).
//
// Spec 03 "Newline contract of the compose placeholders": one \n per <br>, a blank line for
// <br><br>, "in HTML Body Text mode" as elsewhere. Spec 01 "The compose-extraction newline
// contract" (the top level read as a flow) and "The rich-text layer" (the typed text stops at the
// signature). Spec 03 "Newline contract of the body placeholders". Spec 01 "Stale-result guard": the
// content script draws a generating panel only when the supplied id is non-empty and matches its
// own, "or its own id is unknown, e.g. in a compose window"; hide... removes it unconditionally
// without an id.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    liveCaptureHtml,
    openMailDocument,
    send,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({ html: liveCaptureHtml('html_compose_bodytext_window_live.html'), url: COMPOSE_URL });
after(() => ctx.close());
const { cleanupNewlines, cleanupNewlinesKeepParagraphs } = ctx.mods.utils;
const k = composeTests('03');

const S_COMPOSE = 'spec 03 "Newline contract of the compose placeholders"';
const S_CONTRACT = 'spec 01 "The compose-extraction newline contract"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_RICHTEXT = 'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"';
const S_STALE = 'spec 01 "Stale-result guard (rapid message switching)"';

const TYPED = 'Hello Bob,\n\nsee you\ntomorrow.';
const typed = async () => cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyTypedText' }));

k.test('capture-shape', S_CONTRACT, 'the live window: the typed lines as text and <br> straight in the body, then the signature div', () => {
    const body = ctx.document.body;
    assert.equal(body.firstChild.nodeType, ctx.window.Node.TEXT_NODE);
    assert.equal(ctx.$$('body > br').length, 3);
    assert.equal(ctx.$$('body > div').length, 1);
    assert.ok(ctx.$('body > div.moz-signature'));
});

k.test('typed-lines', S_COMPOSE, 'Body Text mode: one \\n per <br>, a blank line for <br><br>', async () => {
    assert.equal(await typed(), TYPED);
});

k.test('typed-without-signature', S_RICHTEXT, 'the signature is not typed text', async () => {
    assert.ok(!(await typed()).includes('--'));
});

k.test('quoted-empty', S_COMPOSE, 'no quote, no quoted text', async () => {
    assert.equal(cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyQuotedText' })), '');
});

k.test('text-body', S_BODY, 'body text: one line per <br> or block, the blank line collapsed, then the signature', async () => {
    const t = cleanupNewlines(await send(ctx, { command: 'getTextOnly' }));
    assert.ok(t.startsWith('Hello Bob,\nsee you\ntomorrow.\n--\n'), JSON.stringify(t));
    assert.ok(!t.includes('\n\n'), JSON.stringify(t));
});

// The generating panels, in a compose window (getDisplayedMessageId answered null).
k.test('generating-any-id', S_STALE, 'own id unknown: a generating panel with a non-empty id is drawn', async () => {
    assert.equal(await send(ctx, { command: 'showSummaryGenerating', headerMessageId: 'any@example.com' }), true);
    assert.ok(ctx.$('#mzta-summary-generating'));
    assert.equal(await send(ctx, { command: 'showTranslationGenerating', headerMessageId: 'any@example.com' }), true);
    assert.ok(ctx.$('#mzta-translation-generating'));
});

k.test('hide-without-id', S_STALE, 'hide... without an id removes the panel unconditionally', async () => {
    await send(ctx, { command: 'hideSummaryGenerating' });
    await send(ctx, { command: 'hideTranslationGenerating' });
    assert.equal(ctx.$('#mzta-summary-generating'), null);
    assert.equal(ctx.$('#mzta-translation-generating'), null);
});

k.test('generating-empty-id', S_STALE, 'an empty id is never drawn, even with the own id unknown', async () => {
    assert.equal(await send(ctx, { command: 'showSummaryGenerating', headerMessageId: '' }), false);
    assert.equal(await send(ctx, { command: 'showTranslationGenerating' }), false);
    assert.equal(ctx.$('#mzta-summary-generating'), null);
    assert.equal(ctx.$('#mzta-translation-generating'), null);
});

k.test('typed-skips-panels', S_RICHTEXT, 'the panels drawn into the compose body are not typed text', async () => {
    await send(ctx, { command: 'showGenericInfo', data: { message: 'Info.' } });
    assert.equal(await typed(), TYPED);
});

k.test('harness-clean', S_COMPOSE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
