// Group D, the one document a panel can outlive its script in: a message display already open when
// the extension is reloaded, into which mzta-background.js injects the script again
// (tabs.executeScript). The document still holds what the previous instance drew - the two
// generating panels, whose generation died with it, and a summary banner.
//
// Spec 01 "Stale-result guard (rapid message switching)": "the one surviving document - an
// already-open tab re-injected on extension reload - gets both generating panels removed when the
// script loads"; "The message-display panels and dialogs": nothing else is removed, the new
// instance draws into the same container.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    openMailDocument,
    readCapture,
    send,
} from '../../compose/compose-doc.mjs';

const ID = 'msg-A@example.com';
const capture = readCapture('mail_html_reading.txt', { encoding: 'latin1' });
// The container as the previous instance left it (ids and nesting of _ensureContainer() / _addPanel()).
const LEFTOVER = '<div id="mzta-container"><div id="mzta-toolbar" style="display: none;"></div><div id="mzta-panels">'
    + '<div id="mzta-translation-generating" class="thunderai-translation-pane">Translating...</div>'
    + '<div id="mzta-summary-generating" class="thunderai-summary-pane">Generating...</div>'
    + '<div id="mzta-summary-banner" class="thunderai-summary-pane">Old summary.</div></div></div>';
const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: ID,
    html: '<!DOCTYPE html><html><head></head><body>' + LEFTOVER
        + '<div class="moz-text-html" lang="x-unicode">' + capture.body + '</div></body></html>',
});
after(() => ctx.close());
const k = composeTests('13');

const S_STALE = 'spec 01 "Stale-result guard (rapid message switching)"';

k.test('spinners-removed', S_STALE, 'the re-injected script removes both generating panels at load', () => {
    assert.equal(ctx.$('#mzta-summary-generating'), null);
    assert.equal(ctx.$('#mzta-translation-generating'), null);
});

const S_PANELS = 'spec 01 "The message-display panels and dialogs (`js/mzta-compose-script.js`)"';

k.test('rest-kept', S_PANELS, 'nothing else the previous instance drew is removed at load: its summary banner stays', () => {
    assert.ok(ctx.$('#mzta-summary-banner').textContent.includes('Old summary.'));
});

k.test('rest-replaced', S_PANELS, 'the new instance replaces the old banner with its own: one banner', async () => {
    await send(ctx, { command: 'showSummary', data: { summary: 'New summary.', headerMessageId: ID } });
    assert.equal(ctx.$$('#mzta-summary-banner').length, 1);
    assert.ok(ctx.$('#mzta-summary-banner').textContent.includes('New summary.'));
});

k.test('new-panel-draws', S_STALE, 'the new instance draws into the same container, once', async () => {
    await send(ctx, { command: 'showSummaryGenerating', headerMessageId: ID });
    assert.equal(ctx.$$('#mzta-container').length, 1);
    assert.equal(ctx.$$('#mzta-summary-generating').length, 1);
});

k.test('harness-clean', S_STALE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
