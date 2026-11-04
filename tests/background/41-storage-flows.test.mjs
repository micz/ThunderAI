// What the background saves of a message, and what it does when saving fails (spec 01
// "Per-Message Data Storage"):
//  - summaries and translations are saved with the message's subject, from and message_date, the
//    shape buildMessageMetadata() gives the spam reports (arrays from the MIME headers, an ISO
//    date): in the jobs, built as soon as the message is known, from the full message once
//    fetched; on incoming mail, from the message data the batch already holds; a "Message not
//    found" error is saved with them empty;
//  - the webchat save (chatgpt_saveSummary) carries only the Message-ID and the text: the metadata
//    comes from the message it resolves to, and is empty when it cannot be resolved;
//  - a result shown in a panel whose save failed is still shown, with the error message in its data
//    (storage_error), so the panel can put a red notice above it: a summary, a translation, a
//    manually requested spam check; an automatic run with no panel open only logs it.
// How the panel draws the notice is the compose area's (compose/README.md).
// Spec 01 "Per-Message Data Storage", the mirror: a saved record is also in storage.local under its
// mirror key; the background answers reconcileMessageStorage with the counts of the realignment, or
// the error message.

import assert from 'node:assert/strict';
import { bgContext, flush } from './context.mjs';
import {
    API,
    featureResponder,
    record,
    fromTab,
    receive,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const H = {};
const ctx = await bgContext({
    local: {
        ...API,
        summarize: true,
        summarize_auto: 1,
        summarize_display_mode: 'inline',
        translate: true,
        translate_auto: 1,
        translate_lang: 'Italian',
        spamfilter: true,
        spamfilter_show_msg_panel: true,
        spamfilter_threshold: 70,
    },
    setup(m) {
        H.s = m.addMessage({ headerMessageId: 'meta-s@x', subject: 'Quarterly report', author: 'Alice <alice@example.test>', date: '2026-03-04T05:06:07.000Z' });
        H.t = m.addMessage({ headerMessageId: 'meta-t@x', subject: 'Rapporto', author: 'Bob <bob@example.test>', date: '2026-03-05T05:06:07.000Z' });
        m.addTab({ id: 7, type: 'mail', active: true });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('41-storage-flows');
const { taStorage } = await import('../../js/mzta-storage.js');
const show = (hid, over = {}) => {
    const h = ctx.m.byHeaderId(hid) || ctx.m.addMessage({ headerMessageId: hid, ...over });
    ctx.m.tab(7).displayed = h.id;
    ctx.m.tabSends.length = 0;
    return h;
};
/** Make every write of one type reject for the rest of test t. */
const failWrites = (t, method) => t.mock.method(taStorage.prototype, method, async () => {
    throw new Error('QuotaExceededError: the disk is full');
});

// --- Metadata -----------------------------------------------------------------------------------

k.test('summary-metadata', 'a generated summary is saved with the subject, sender and date of its message', async () => {
    show('meta-s@x');
    await fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'meta-s@x' });
    const r = (await record(ctx, 'meta-s@x')).summary;
    assert.equal(r.error, false);
    assert.deepEqual(r.subject, ['Quarterly report']);
    assert.deepEqual(r.from, ['Alice <alice@example.test>']);
    assert.equal(r.message_date, '2026-03-04T05:06:07.000Z');
});

k.test('translation-metadata', 'a generated translation is saved with the subject, sender and date of its message', async () => {
    show('meta-t@x');
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'meta-t@x' });
    const r = (await record(ctx, 'meta-t@x')).translation;
    assert.equal(r.error, false);
    assert.deepEqual(r.subject, ['Rapporto']);
    assert.deepEqual(r.from, ['Bob <bob@example.test>']);
    assert.equal(r.message_date, '2026-03-05T05:06:07.000Z');
});

k.test('receive-metadata', 'on incoming mail the summary and the translation are saved with the metadata of the message', async () => {
    const prev = { summarize_auto: 1, translate_auto: 1 };
    await ctx.ctl.browser.storage.local.set({ summarize_auto: 3, translate_auto: 3, spamfilter: false });
    await ctx.bg.reload_pref_init();
    try {
        const h = ctx.m.addMessage({ headerMessageId: 'meta-r@x', subject: 'Incoming', author: 'Carol <carol@example.test>', date: '2026-03-06T00:00:00.000Z' });
        await receive(ctx, [h]);
        await flush();
        const r = await record(ctx, 'meta-r@x');
        for (const type of ['summary', 'translation']) {
            assert.ok(r?.[type], type + ' saved');
            assert.deepEqual(r[type].subject, ['Incoming'], type);
            assert.deepEqual(r[type].from, ['Carol <carol@example.test>'], type);
            assert.equal(r[type].message_date, '2026-03-06T00:00:00.000Z', type);
        }
    } finally {
        await ctx.ctl.browser.storage.local.set({ ...prev, spamfilter: true });
        await ctx.bg.reload_pref_init();
    }
});

k.test('not-found-empty', 'a "Message not found" error is saved with empty subject, sender and date', async () => {
    await ctx.bg._generateSummaryForMessage('ghost-s@x', null, {});
    await ctx.bg._generateTranslationForMessage('ghost-t@x', null, {});
    const s = (await record(ctx, 'ghost-s@x')).summary;
    const t = (await record(ctx, 'ghost-t@x')).translation;
    for (const r of [s, t]) {
        assert.equal(r.error, true);
        assert.equal(r.message, 'Message not found');
        assert.deepEqual([r.subject, r.from, r.message_date], [[], [], '']);
    }
});

k.test('webchat-metadata', 'chatgpt_saveSummary saves the summary with the metadata of the message it resolves to', async () => {
    show('meta-s@x');
    await ctx.ctl.dispatchMessage({ command: 'chatgpt_saveSummary', text: 'A **webchat** summary', headerMessageId: 'meta-s@x', tabId: 7 },
        { url: 'moz-extension://00000000-test-uuid/api_webchat/index.html', id: 'thunderai@micz.it' });
    await flush();
    const r = (await record(ctx, 'meta-s@x')).summary;
    assert.match(r.summary, /webchat/);
    assert.deepEqual(r.subject, ['Quarterly report']);
    assert.deepEqual(r.from, ['Alice <alice@example.test>']);
    assert.equal(r.message_date, '2026-03-04T05:06:07.000Z');
});

k.test('webchat-unresolved', 'chatgpt_saveSummary for a message that cannot be resolved saves the summary with empty metadata', async () => {
    ctx.m.tab(7).displayed = null;
    await ctx.ctl.dispatchMessage({ command: 'chatgpt_saveSummary', text: 'Orphan summary', headerMessageId: 'gone@x', tabId: 7 },
        { url: 'moz-extension://00000000-test-uuid/api_webchat/index.html', id: 'thunderai@micz.it' });
    await flush();
    const r = (await record(ctx, 'gone@x')).summary;
    assert.equal(r.summary, 'Orphan summary');
    assert.deepEqual([r.subject, r.from, r.message_date], [[], [], '']);
});

// --- Save failures ------------------------------------------------------------------------------

k.test('summary-save-failed', 'a summary whose save failed is still shown, with the error message for the red notice', async (t) => {
    failWrites(t, 'writeSummary');
    show('fail-s@x');
    await fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'fail-s@x' });
    const shown = ctx.m.sentTo(7, 'showSummary').at(-1);
    assert.ok(shown, 'the summary is shown');
    assert.equal(shown.data.error, undefined);
    assert.match(shown.data.summary, /fail-s@x/);
    assert.match(shown.data.storage_error, /disk is full/);
    assert.equal(await record(ctx, 'fail-s@x'), null, 'nothing saved');
});

k.test('summary-saved-no-notice', 'a summary saved normally carries no storage_error', async () => {
    show('ok-s@x');
    await fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'ok-s@x' });
    const shown = ctx.m.sentTo(7, 'showSummary').at(-1);
    assert.match(shown.data.summary, /ok-s@x/);
    assert.equal('storage_error' in shown.data, false);
});

k.test('translation-save-failed', 'a translation whose save failed is still shown, with the error message for the red notice', async (t) => {
    failWrites(t, 'writeTranslation');
    show('fail-t@x');
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'fail-t@x' });
    const shown = ctx.m.sentTo(7, 'showTranslation').at(-1);
    assert.ok(shown, 'the translation is shown');
    assert.equal(shown.data.translated_text, 'Corpo fail-t@x');
    assert.match(shown.data.storage_error, /disk is full/);
});

k.test('spam-save-failed', 'a manual spam check whose save failed shows the verdict, with the error message for the red notice', async (t) => {
    failWrites(t, 'writeSpam');
    show('fail-p@x');
    await fromTab(ctx, 7, { command: 'refreshSpamReport', headerMessageId: 'fail-p@x' });
    const shown = ctx.m.sentTo(7, 'showSpamReport').at(-1);
    assert.ok(shown, 'the report is shown');
    assert.equal(shown.data.spamValue, 10, 'the verdict, not an error');
    assert.match(shown.data.storage_error, /disk is full/);
});

k.test('webchat-save-failed', 'a webchat summary whose save failed is still shown, with the error message', async (t) => {
    failWrites(t, 'writeSummary');
    show('meta-s@x');
    await ctx.ctl.dispatchMessage({ command: 'chatgpt_saveSummary', text: 'Unsaved summary', headerMessageId: 'meta-s@x', tabId: 7 },
        { url: 'moz-extension://00000000-test-uuid/api_webchat/index.html', id: 'thunderai@micz.it' });
    await flush();
    const shown = ctx.m.sentTo(7, 'showSummary').at(-1);
    assert.equal(shown.data.summary, 'Unsaved summary');
    assert.match(shown.data.storage_error, /disk is full/);
});

k.test('automatic-logged', 'an automatic run with no panel open logs the failed save, and shows nothing', async (t) => {
    failWrites(t, 'writeSpam');
    ctx.m.tab(7).displayed = null;
    ctx.m.tabSends.length = 0;
    ctx.con.clear();
    const h = ctx.m.addMessage({ headerMessageId: 'auto-p@x' });
    await receive(ctx, [h]);
    await flush();
    assert.match(ctx.con.all().join(' | '), /Could not store the report for auto-p@x: .*disk is full/);
    assert.deepEqual(ctx.m.sentTo(7, 'showSpamReport'), []);
});

// --- The mirror and its realignment --------------------------------------------------------------

const PAGE = { url: 'moz-extension://00000000-test-uuid/options/mzta-options.html', id: 'thunderai@micz.it' };

k.test('summary-mirrored', 'a generated summary is saved in storage.local under its mirror key, the very record IndexedDB holds', async () => {
    show('mirror-s@x');
    await fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'mirror-s@x' });
    const r = (await record(ctx, 'mirror-s@x')).summary;
    assert.ok(r);
    assert.deepEqual(ctx.ctl.localData()['summary:mirror-s@x'], r);
});

k.test('reconcile-command', 'reconcileMessageStorage realigns IndexedDB with the mirror and answers the counts per type', async () => {
    const rec = taStorage.buildRecord('translation', 'mirror-only@x', { translated_text: 'Restored' }, 1000);
    await ctx.ctl.browser.storage.local.set({ 'translation:mirror-only@x': rec });
    const answer = await ctx.ctl.dispatchMessage({ command: 'reconcileMessageStorage' }, PAGE);
    assert.equal(answer.ok, true);
    assert.deepEqual(answer.counts.translation, { restored: 1, removed: 0 });
    assert.deepEqual(Object.keys(answer.counts).sort(), ['spam', 'summary', 'translation']);
    assert.equal((await record(ctx, 'mirror-only@x')).translation.translated_text, 'Restored');
});

k.test('reconcile-command-error', 'reconcileMessageStorage answers the error message when the realignment fails', async (t) => {
    t.mock.method(taStorage, 'reconcileWithMirror', async () => { throw new Error('IndexedDB unavailable'); });
    ctx.con.clear();
    const answer = await ctx.ctl.dispatchMessage({ command: 'reconcileMessageStorage' }, PAGE);
    assert.deepEqual(answer, { ok: false, error: 'IndexedDB unavailable' });
    assert.match(ctx.con.all().join(' | '), /reconcileMessageStorage: IndexedDB unavailable/);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
