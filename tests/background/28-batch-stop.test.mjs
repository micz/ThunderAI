// A Stop in the middle of a batch: what has been done, what has not, and what is stored.
//
// Spec 01 "Batch cancellation (taBatchController)" and "Per-message pipelines in processEmails()",
// spec 04 "Batch cancellation (user-triggered stop)":
//  - cancel_batch (the popup's Stop) -> requestCancel(), answers {ok: true}; batch_status answers
//    getStatus() = {working, processed, cancelRequested, ...};
//  - batchStopped() is checked before each message is taken and between the features of a
//    message: after a Stop, queued messages do not start and in-flight ones stop after their
//    current call (there is no mid-request termination in v1);
//  - progress: a message with a target is ticked by its pipeline, also when it stopped early;
//    targets that never start because of a cancel are not counted;
//  - the outer finally always runs stopWorking() + endBatch(); when the last batch exits cancelled
//    by the user, showGenericInfo(batch_stopped_notice, N processed) - the blue panel - goes to
//    every tab;
//  - a batch begun after the request is not affected (a manual action right after a Stop runs);
//  - "What a stop leaves behind": the unstarted messages are not resumed; opening one offers the
//    summary and the translation as the manual button (summarize_auto / translate_auto = 3).
// Spec 01 "Cooperative check points": also after the between-chunks setTimeout(0) yield (every 5
// messages). The batch here has 7 messages and runs under node:test's mock timers.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { holding } from './fake-worker.mjs';
import {
    API,
    fromTab,
    featureOf,
    messageOf,
    sentPrompts,
    receive,
    record,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';

const ctx = await bgContext({
    local: {
        ...API,
        summarize: true, summarize_auto: 3,
        translate: true, translate_auto: 3, default_chatgpt_lang: 'Italian',
        batch_max_concurrency: 1,
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 10, type: 'messageCompose', windowId: 4 });
    },
});
const hold = holding();
ctx.workers.respond = hold.respond;
const k = caseTests('28-batch-stop');
const { taWorkingStatus } = await import('../../js/mzta-working-status.js');
const popup = msg => ctx.ctl.dispatchMessage(msg, SENDERS.popup);

const hs = [1, 2, 3, 4, 5, 6, 7].map(i => ctx.m.addMessage({ headerMessageId: 'st' + i + '@x' }));
const ids = hs.map(h => h.headerMessageId);

/** Turn the loop and fire due timers (mock clock) until cond() holds. */
async function until(t, cond, what) {
    for (let i = 0; i < 2000; i++) {
        if (cond()) return;
        await new Promise(r => setImmediate(r));
        t.mock.timers.tick(0);
    }
    throw new Error('until: ' + what);
}
const heldOpen = () => hold.held.filter(x => !x.done);
const answerHeld = (x, text) => { x.done = true; x.answer(text); };
const answerFor = x => featureOf(x.prompt) === 'summary'
    ? 'Summary ' + messageOf(x.prompt)
    : JSON.stringify({ subject: 'S', body: 'B ' + messageOf(x.prompt), status: '1' });

let statusBefore;
let statusAfterStop;
let cancelAnswer;

k.test('stop-scenario', 'seven messages arrive; the first is done, the user presses Stop while the second is summarized', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const batch = receive(ctx, hs);
    let ended = false;
    batch.then(() => { ended = true; });
    // Message 1: summary, then translation.
    for (let n = 0; n < 2; n++) {
        await until(t, () => heldOpen().length === 1, 'a prompt of message 1');
        assert.equal(messageOf(heldOpen()[0].prompt), 'st1@x');
        answerHeld(heldOpen()[0], answerFor(heldOpen()[0]));
    }
    // Message 2: its summary is in flight.
    await until(t, () => heldOpen().length === 1 && messageOf(heldOpen()[0].prompt) === 'st2@x', 'the summary of message 2');
    statusBefore = await popup({ command: 'batch_status' });
    cancelAnswer = await popup({ command: 'cancel_batch' });
    statusAfterStop = await popup({ command: 'batch_status' });
    // The call in flight finishes: no mid-request termination.
    answerHeld(heldOpen()[0], 'Summary st2@x');
    await until(t, () => ended, 'the batch to end');
    await batch;
});

k.test('status-while-running', 'batch_status during the batch: working, one message processed, no cancel', () => {
    assert.equal(statusBefore.working, true);
    assert.equal(statusBefore.processed, 1);
    assert.equal(statusBefore.cancelRequested, false);
});

k.test('cancel-answer', 'cancel_batch answers {ok: true}, and batch_status then reports the cancel', () => {
    assert.deepEqual(cancelAnswer, { ok: true });
    assert.equal(statusAfterStop.working, true, 'still winding down');
    assert.equal(statusAfterStop.cancelRequested, true);
});

k.test('done-before-stop', 'the message finished before the Stop keeps its summary and translation', () => {
    const r = record(ctx, 'st1@x');
    assert.equal(r.summary.summary, 'Summary st1@x');
    assert.equal(r.translation.translated_text, 'B st1@x');
});

k.test('in-flight-finishes', 'the summary in flight at the Stop completes and is stored', () => {
    assert.equal(record(ctx, 'st2@x').summary.summary, 'Summary st2@x');
});

k.test('next-feature-not-started', 'the message in flight stops before its next feature: no translation', () => {
    assert.equal(record(ctx, 'st2@x').translation, undefined);
    assert.equal(sentPrompts(ctx).some(p => p.feature === 'translation' && p.message === 'st2@x'), false);
});

k.test('queued-not-started', 'the queued messages never start: no prompt, nothing stored', () => {
    for (const id of ids.slice(2)) {
        assert.equal(sentPrompts(ctx).some(p => p.message === id), false, id);
        assert.equal(record(ctx, id), null, id);
    }
});

k.test('notice', 'the blue "stopped" notice, with the number of messages processed, goes to every tab', () => {
    const expected = ctx.ctl.browser.i18n.getMessage('batch_stopped_notice', ['2']);
    for (const tab of [7, 10]) {
        const info = ctx.m.sentTo(tab, 'showGenericInfo');
        assert.equal(info.length, 1, 'tab ' + tab);
        assert.equal(info[0].data.message, expected);
        assert.equal(info[0].data.source, ctx.ctl.browser.i18n.getMessage('batch_stop_source'));
    }
    assert.deepEqual(ctx.m.sentTo(7, 'showGenericError'), [], 'not the red rate-limit panel');
});

k.test('ended-clean', 'after the batch: no batch working, nothing in flight, the counter reset', async () => {
    assert.deepEqual(await popup({ command: 'batch_status' }), { working: false, processed: 0, cancelRequested: false, cancelReason: null });
    assert.equal(taWorkingStatus.WorkingLevel, 0);
});

k.test('not-resumed', 'the messages the Stop kept from starting are not processed later: still no prompt, nothing stored', async () => {
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
    assert.deepEqual(heldOpen(), []);
    for (const id of ids.slice(2)) assert.equal(record(ctx, id), null, id);
});

k.test('button-on-open', 'opening a message the Stop skipped offers the summary and the translation as the manual button', async () => {
    ctx.m.tab(7).displayed = hs[3].id;
    ctx.m.tabSends.length = 0;
    await fromTab(ctx, 7, { command: 'initSummary' });
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showSummaryButton', 'showTranslationButton']);
    assert.equal(ctx.m.sentTo(7, 'showSummaryButton')[0].headerMessageId, 'st4@x');
    assert.deepEqual(heldOpen(), [], 'nothing generated on open');
});

k.test('next-batch-runs', 'the next incoming mail is processed normally: the Stop never leaks into a later batch', async () => {
    ctx.workers.respond = (w, prompt) => w.deliver({ type: 'newToken', payload: { token: answerFor({ prompt }) } }, { type: 'tokensDone', payload: {} });
    const h = ctx.m.addMessage({ headerMessageId: 'after@x' });
    await receive(ctx, [h]);
    assert.ok(record(ctx, 'after@x').summary && record(ctx, 'after@x').translation);
});

k.test('stop-nothing-running', 'cancel_batch with no batch running changes nothing for the next one', async () => {
    assert.deepEqual(await popup({ command: 'cancel_batch' }), { ok: true });
    const h = ctx.m.addMessage({ headerMessageId: 'after2@x' });
    await receive(ctx, [h]);
    assert.ok(record(ctx, 'after2@x').summary);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
