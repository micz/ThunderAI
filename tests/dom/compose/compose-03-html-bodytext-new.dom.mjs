// Group A on a new message in an HTML compose window in Body Text mode, with a signature and no
// quote (fixtures/compose/html-compose-bodytext-new.json: <br> lines inside one <div>, a blank
// line as <br><br>, the editor's trailing bogus <br>). Then the generating panels in a compose
// window, whose own displayed message is unknown.
//
// Spec 03 "Newline contract of the compose placeholders": the same contract "in HTML Body Text
// mode" as in Paragraph mode. Spec 01 "The compose-extraction newline contract": the trailing
// bogus <br> is trimmed, so nothing doubles. Spec 01 "Stale-result guard": the content script draws
// a generating panel only when the supplied id is non-empty and matches its own, "or its own id is
// unknown, e.g. in a compose window"; hide... removes it unconditionally without an id.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    COMPOSE_URL,
    fixture,
    openMailDocument,
    send,
} from '../../compose/compose-doc.mjs';

const ctx = await openMailDocument({ html: fixture('html-compose-bodytext-new.json').html, url: COMPOSE_URL });
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

k.test('typed-lines', S_COMPOSE, 'Body Text mode: one \\n per <br>, a blank line for <br><br>', async () => {
    const t = await typed();
    assert.ok(t.startsWith(TYPED), JSON.stringify(t));
});

k.test('bogus-br-trimmed', S_CONTRACT, 'the trailing bogus <br> adds no line: the next node follows after exactly one \\n', async () => {
    const raw = await send(ctx, { command: 'getOnlyTypedText' });
    assert.ok(raw.startsWith('Hello Bob,\n\nsee you\ntomorrow.') && !raw.startsWith('Hello Bob,\n\nsee you\ntomorrow.\n\n'),
        JSON.stringify(raw));
});

k.test('typed-without-signature', S_RICHTEXT, 'the signature is not typed text', async () => {
    assert.equal(await typed(), TYPED);
});

k.test('quoted-empty', S_COMPOSE, 'no quote, no quoted text', async () => {
    assert.equal(cleanupNewlinesKeepParagraphs(await send(ctx, { command: 'getOnlyQuotedText' })), '');
});

k.test('text-body', S_BODY, 'body text: one line per <br>, the blank line collapsed', async () => {
    assert.equal(cleanupNewlines(await send(ctx, { command: 'getTextOnly' })),
        'Hello Bob,\nsee you\ntomorrow.\n--\nThis is my best signature!!!');
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

k.test('harness-clean', S_COMPOSE, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
