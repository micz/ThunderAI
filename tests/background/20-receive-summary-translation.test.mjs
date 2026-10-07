// What the background does when mail arrives with summarize_auto = 3 and translate_auto = 3.
//
// Spec 01 "Data Flow: Background Summary on Email Receive" and "Background Translation on Email
// Receive": onNewMailReceived -> newEmailListener (gated on _process_incoming) -> processEmails()
// -> per message, in its pipeline, _generateSummaryForMessage(id, null, {messageData}) then
// _generateTranslationForMessage(id, null, {messageData}) -> saveSummary() / saveTranslation();
// tabId is null, "but the job broadcasts its generating panel and its result to every tab already
// displaying the message".
// Spec 01 "onNewMailReceived registration": registered once, with monitorAllFolders = true.
// Spec 01 "Per-message pipelines": features in series (spam, add_tags, summary, translate); the
// stores are keyed on headerMessageId, so summarize / translate are set only on the first target
// with a given id; nothing is written for a skipped message.
// Spec 01 "Shared guards": isMessageInAutoSkippedFolder() - junk, trash, drafts, templates,
// outbox, sent are never processed automatically; archives is deliberately absent.
// Spec 01 "In-flight jobs": broadcast through _sendToTabsDisplaying() (mail and messageDisplay
// tabs, getDisplayedMessage() checked per tab), generating before the result; a cache hit is not
// broadcast and costs no API call; one startWorking()/stopWorking() pair per job.
// Spec 01 "Stale-result guard": showSummaryGenerating / showTranslationGenerating always carry
// headerMessageId. "Panel HTML sanitization": the broadcast payload crosses the sanitizer, the
// stored object is never modified.
// Spec 04 "Worker Lifecycle & Timeout": a fresh mzta_specialCommand (and worker) per prompt.
// (Spec 01 "Per-Message Data Storage": summaries and translations are not truncated at the moment,
// so there is no cache limit to assert here; the seeded 100 old records only make the store full.)

import assert from 'node:assert/strict';
import { bgContext, flush } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    record,
    newMailListener,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const OLD = Date.parse('2025-01-01T00:00:00Z');
const seeded = {};
for (let i = 0; i < 100; i++) {
    seeded['msg:old' + i + '@x'] = {
        v: 1, ts: OLD + i,
        summary: { summary: 'old ' + i, summary_html: '', error: false, message: '', summary_date: new Date(OLD + i).toISOString(), ts: OLD + i },
        translation: { translated_text: 'vecchio ' + i, lang: 'Italian', error: false, message: '', ts: OLD + i },
    };
}

const H = {};
const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, summarize_auto: 3,
        translate: true, translate_auto: 3,
        default_chatgpt_lang: 'Italian',
        ...seeded,
    },
    setup(m) {
        H.a = m.addMessage({ headerMessageId: 'a@example.test', subject: 'Quarterly report' });
        H.b = m.addMessage({ headerMessageId: 'b@example.test' });
        m.addTab({ id: 7, type: 'mail', active: true, displayed: H.a.id });
        m.addTab({ id: 8, type: 'messageDisplay', windowId: 2, displayed: H.a.id });
        m.addTab({ id: 9, type: 'mail', windowId: 3, displayed: H.b.id });
        m.addTab({ id: 10, type: 'messageCompose', windowId: 4 });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('20-receive-summary-translation');
const { taWorkingStatus } = await import('../../js/mzta-working-status.js');
const { taBatchController } = await import('../../js/mzta-batch-controller.js');

k.test('listener-registered', 'onNewMailReceived has one listener, registered with monitorAllFolders = true', () => {
    newMailListener(ctx);
    assert.deepEqual(ctx.ctl.browser.messages.onNewMailReceived._extraArgs[0], [true]);
});

k.test('process-incoming', 'with summarize_auto = 3 or translate_auto = 3, incoming mail wakes the pipeline', () => {
    assert.equal(ctx.bg.$eval('_process_incoming'), true);
});

await receive(ctx, [H.a]);
await flush();

k.test('summary-stored', 'the summary is stored on the message it was generated for', () => {
    const rec = record(ctx, 'a@example.test');
    assert.ok(rec && rec.summary, 'a summary for a@example.test');
    assert.equal(rec.summary.error, false);
    assert.match(rec.summary.summary, /a@example\.test/);
    assert.match(rec.summary.summary_html, /<strong>a@example\.test<\/strong>/, 'the HTML rendering of the answer');
});

k.test('translation-stored', 'the translation is stored on the message, with its subject, body, status and target language', () => {
    const t = record(ctx, 'a@example.test').translation;
    assert.equal(t.translated_text, 'Corpo a@example.test');
    assert.equal(t.translated_subject, 'Oggetto a@example.test');
    assert.equal(t.translation_status, '1');
    assert.equal(t.lang, 'Italian');
    assert.equal(t.error, false);
});

k.test('prompts-for-the-message', 'each prompt is built from the received message, summary first, then translation', () => {
    assert.deepEqual(sentPrompts(ctx), [
        { feature: 'summary', message: 'a@example.test' },
        { feature: 'translation', message: 'a@example.test' },
    ]);
    assert.equal(ctx.standIns.buildSummaryPrompt[0][0].message.id, H.a.id, 'the summary prompt got this very header');
    assert.deepEqual(ctx.standIns.buildSummaryPrompt[0][0].subject, ['Quarterly report']);
});

k.test('broadcast-displaying', 'every tab displaying the message gets the generating panel, then the result', () => {
    for (const tab of [7, 8]) {
        assert.deepEqual(ctx.m.commandsTo(tab), ['showSummaryGenerating', 'showSummary', 'showTranslationGenerating', 'showTranslation'], 'tab ' + tab);
    }
    assert.deepEqual(ctx.m.commandsTo(9), [], 'a tab displaying another message gets nothing');
    assert.deepEqual(ctx.m.commandsTo(10), [], 'a compose tab gets nothing');
});

k.test('generating-has-id', 'the generating panels carry the headerMessageId of their message', () => {
    for (const cmd of ['showSummaryGenerating', 'showTranslationGenerating']) {
        assert.equal(ctx.m.sentTo(7, cmd)[0].headerMessageId, 'a@example.test', cmd);
    }
});

k.test('result-has-id', 'the result panels carry their message id (the banner buttons send it back)', () => {
    assert.equal(ctx.m.sentTo(7, 'showSummary')[0].data.headerMessageId, 'a@example.test');
    assert.equal(ctx.m.sentTo(7, 'showTranslation')[0].data.headerMessageId, 'a@example.test');
});

k.test('sanitized-not-stored', 'the broadcast summary HTML crossed the sanitizer; the stored one is left as it was', () => {
    const shown = ctx.m.sentTo(7, 'showSummary')[0].data.summary_html;
    assert.ok(shown.startsWith('<!--sanitized-->'), 'sanitized on the way out');
    assert.equal(shown, '<!--sanitized-->' + record(ctx, 'a@example.test').summary.summary_html);
});

k.test('fresh-worker-per-prompt', 'one worker per prompt, each terminated once answered', () => {
    assert.equal(ctx.workers.created.length, 2);
    assert.deepEqual(ctx.workers.live(), []);
});

k.test('working-back', 'once the batch is over, nothing is working and no batch is active', () => {
    assert.equal(taWorkingStatus.WorkingLevel, 0);
    assert.equal(taBatchController.isWorking(), false);
});

k.test('cache-hit', 'the same message arriving again costs no API call: summary and translation come from the cache', async () => {
    const before = ctx.workers.created.length;
    ctx.m.tabSends.length = 0;
    await receive(ctx, [H.a]);
    await flush();
    assert.equal(ctx.workers.created.length, before);
    assert.deepEqual(ctx.m.commandsTo(7), [], 'a cache hit is not broadcast (the tabs show it already)');
});

k.test('dedup-same-id', 'two headers with one headerMessageId in a batch (a copy in another folder): one summary, one translation', async () => {
    const c1 = ctx.m.addMessage({ headerMessageId: 'c@example.test' });
    const c2 = ctx.m.addMessage({ headerMessageId: 'c@example.test', folderId: 'f-lists' });
    const before = ctx.workers.prompts().length;
    await receive(ctx, [c1, c2]);
    await flush();
    assert.deepEqual(sentPrompts(ctx).slice(before), [
        { feature: 'summary', message: 'c@example.test' },
        { feature: 'translation', message: 'c@example.test' },
    ]);
});

for (const folderId of ['f-junk', 'f-trash', 'f-drafts', 'f-templates', 'f-outbox', 'f-sent']) {
    k.test('skip-' + folderId.slice(2), `a message arriving in ${folderId.slice(2)} is neither summarized nor translated, and nothing is stored`, async () => {
        const h = ctx.m.addMessage({ headerMessageId: 'skip-' + folderId + '@example.test', folderId });
        const before = ctx.workers.prompts().length;
        await receive(ctx, [h]);
        await flush();
        assert.deepEqual(ctx.workers.prompts().slice(before), []);
        assert.equal(record(ctx, h.headerMessageId), null);
    });
}

k.test('archives-processed', 'archives is not a skipped folder: an archived message is summarized and translated', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'arch@example.test', folderId: 'f-archives' });
    await receive(ctx, [h]);
    await flush();
    const rec = record(ctx, 'arch@example.test');
    assert.ok(rec?.summary && rec?.translation);
});

k.test('plain-folder-processed', 'a message delivered to a plain folder (a server-side filter) is processed too', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'list@example.test', folderId: 'f-lists' });
    await receive(ctx, [h]);
    await flush();
    assert.ok(record(ctx, 'list@example.test')?.summary);
});

k.test('several-messages', 'a batch of several messages: each gets its own summary and translation, none on another', async () => {
    const hs = [1, 2, 3].map(i => ctx.m.addMessage({ headerMessageId: 'multi' + i + '@example.test' }));
    await receive(ctx, hs);
    await flush();
    for (const h of hs) {
        const rec = record(ctx, h.headerMessageId);
        assert.match(rec.summary.summary, new RegExp(h.headerMessageId.replace(/[.@]/g, '\\$&')));
        assert.equal(rec.translation.translated_text, 'Corpo ' + h.headerMessageId);
    }
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
