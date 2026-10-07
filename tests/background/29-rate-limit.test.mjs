// A rate limit in the middle of a batch.
//
// Spec 01 "Batch cancellation (taBatchController)", "Automatic stop on a rate limit (#901)", and
// spec 04 #batch-stop-on-rate-limit:
//  - when a message fails with err.rateLimited, the failing pipeline calls stopForRateLimit() ->
//    requestCancel('rate_limit'): the queued messages do not start, the in-flight ones stop before
//    their next feature;
//  - checked after each feature: add tags (tags are not assigned), spam filter
//    ({success: false, rateLimited}), summarize on receive and translate ({rateLimited});
//  - the finally then shows the RED panel: showGenericError(batch_stopped_rate_limit, N), or
//    batch_stopped_retry_after with the wait formatted by formatDuration() ("1 h") when the provider
//    asked for a wait - instead of the blue batch_stopped_notice;
//  - only the current batch stops: the next incoming mail starts a new batch.
// Spec 01 "In-flight jobs": config errors are broadcast and not stored - so a rate-limited failure,
// which is not one, leaves an error record on the message it failed on, and on that one only.
// One batch per scenario, each with its own messages; batch_max_concurrency 1 (the default).

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { answering } from './fake-worker.mjs';
import {
    API,
    featureOf,
    messageOf,
    sentPrompts,
    receive,
    record,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await bgContext({
    local: {
        ...API,
        spamfilter: true, spamfilter_skip_addressbook: false,
        add_tags: true, add_tags_auto: true,
        summarize: true, summarize_auto: 3,
        translate: true, translate_auto: 3, default_chatgpt_lang: 'Italian',
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 10, type: 'messageCompose', windowId: 4 });
    },
});
const k = caseTests('29-rate-limit');

/** fail: {feature, message, retryAfterMs} - that prompt answers a rate-limit error. */
let fail = null;
ctx.workers.respond = answering(prompt => {
    const f = featureOf(prompt);
    const hid = messageOf(prompt);
    if (fail && fail.feature === f && fail.message === hid) {
        return { error: 'OpenAI API request failed: 429 Too Many Requests', extra: { rateLimited: true, retryAfterMs: fail.retryAfterMs ?? null } };
    }
    return {
        spam: '{"spamValue": 5, "explanation": "ok"}',
        add_tags: '{"tags": ["Work"]}',
        summary: 'Summary ' + hid,
        translation: JSON.stringify({ subject: 'S', body: 'B ' + hid, status: '1' }),
    }[f];
});

const batch = prefix => [1, 2, 3, 4].map(i => ctx.m.addMessage({ headerMessageId: prefix + i + '@x' }));
const prompted = id => sentPrompts(ctx).filter(p => p.message === id).map(p => p.feature);
const labels = id => ctx.m.byHeaderId(id).tags;
const lastError = tab => ctx.m.sentTo(tab, 'showGenericError').pop();
const reset = () => { ctx.m.tabSends.length = 0; };

k.test('summary-stops', 'a rate limit on the summary of message 2: message 1 complete, message 2 stops there, 3 and 4 never start', async () => {
    const hs = batch('su');
    fail = { feature: 'summary', message: 'su2@x' };
    reset();
    await receive(ctx, hs);
    assert.deepEqual(prompted('su1@x'), ['spam', 'add_tags', 'summary', 'translation']);
    assert.deepEqual(prompted('su2@x'), ['spam', 'add_tags', 'summary'], 'no translation after the rate limit');
    assert.deepEqual(prompted('su3@x'), []);
    assert.deepEqual(prompted('su4@x'), []);
});

k.test('summary-stored', 'what is stored: message 1 everything, message 2 its spam report and an error summary, 3 and 4 nothing', () => {
    const r1 = record(ctx, 'su1@x');
    assert.ok(r1.spam && r1.summary && r1.translation);
    assert.equal(r1.summary.error, false);
    const r2 = record(ctx, 'su2@x');
    assert.ok(r2.spam);
    assert.equal(r2.summary.error, true);
    assert.equal(r2.translation, undefined);
    assert.equal(record(ctx, 'su3@x'), null);
    assert.equal(record(ctx, 'su4@x'), null);
    assert.equal(labels('su2@x').length, 1, 'message 2 was tagged before its summary failed');
});

k.test('red-panel', 'the red panel says the provider refused, with the number of messages processed, on every tab', () => {
    const expected = ctx.ctl.browser.i18n.getMessage('batch_stopped_rate_limit', ['2']);
    for (const tab of [7, 10]) assert.equal(lastError(tab).data.message, expected, 'tab ' + tab);
    assert.equal(lastError(7).data.source, ctx.ctl.browser.i18n.getMessage('batch_stop_source'));
    assert.deepEqual(ctx.m.sentTo(7, 'showGenericInfo'), [], 'not the blue notice');
});

k.test('next-batch', 'the next incoming mail starts a new batch, unaffected', async () => {
    fail = null;
    const h = ctx.m.addMessage({ headerMessageId: 'next@x' });
    await receive(ctx, [h]);
    assert.deepEqual(prompted('next@x'), ['spam', 'add_tags', 'summary', 'translation']);
});

k.test('spam-stops', 'a rate limit on the spam filter: the message is not moved, nothing else runs on it, the batch stops', async () => {
    const hs = batch('sp');
    fail = { feature: 'spam', message: 'sp2@x' };
    reset();
    await receive(ctx, hs);
    assert.deepEqual(prompted('sp2@x'), ['spam']);
    assert.equal(ctx.m.byHeaderId('sp2@x').folder.id, 'f-inbox');
    assert.equal(record(ctx, 'sp2@x').spam.moved, false);
    assert.deepEqual(prompted('sp3@x'), []);
    assert.equal(lastError(7).data.message, ctx.ctl.browser.i18n.getMessage('batch_stopped_rate_limit', ['2']));
});

k.test('tags-stop', 'a rate limit on add_tags: no tag is assigned to that message, and the batch stops', async () => {
    const hs = batch('tg');
    fail = { feature: 'add_tags', message: 'tg2@x' };
    reset();
    await receive(ctx, hs);
    assert.deepEqual(prompted('tg2@x'), ['spam', 'add_tags']);
    assert.deepEqual(labels('tg2@x'), []);
    assert.equal(record(ctx, 'tg2@x').summary, undefined);
    assert.deepEqual(prompted('tg3@x'), []);
});

k.test('translation-stops', 'a rate limit on the translation of message 2: 3 and 4 never start', async () => {
    const hs = batch('tr');
    fail = { feature: 'translation', message: 'tr2@x' };
    reset();
    await receive(ctx, hs);
    assert.deepEqual(prompted('tr2@x'), ['spam', 'add_tags', 'summary', 'translation']);
    assert.deepEqual(prompted('tr3@x'), []);
    assert.equal(record(ctx, 'tr2@x').translation.error, true);
});

k.test('retry-after', 'when the provider names a wait, the red panel says when to retry (batch_stopped_retry_after, formatDuration)', async () => {
    const hs = batch('ra');
    fail = { feature: 'summary', message: 'ra1@x', retryAfterMs: 3600000 };
    reset();
    await receive(ctx, hs);
    const expected = ctx.ctl.browser.i18n.getMessage('batch_stopped_retry_after', ['1', ctx.utils.formatDuration(3600000)]);
    assert.equal(lastError(7).data.message, expected);
    assert.match(lastError(7).data.message, /1 h/);
    assert.deepEqual(prompted('ra2@x'), []);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    fail = null;
    assertClean(ctx);
});

k.coverage();
